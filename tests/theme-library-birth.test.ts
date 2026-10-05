import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { Signatures } from "../src/platform/signatures"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { encode } from "../src/shared/base64"
import { Replica } from "../src/shared/crdt"
import { buildAction, restoreSnapshot } from "../src/shared/document-actions"
import { DocumentApi } from "../src/shared/document-api"
import { newDocument } from "../src/shared/documents"
import { themeLibraryBirth } from "../src/shared/theme-library"
import { startServer } from "../src/server/index"

let directory = await mkdtemp(join(tmpdir(), "alkalye-theme-birth-"))
let instance: Effect.Success<ReturnType<typeof startServer>>
beforeAll(async () => {
	instance = await Effect.runPromise(
		startServer({ port: 0, data: directory, build: false }),
	)
})
afterAll(async () => {
	await Effect.runPromise(instance.close())
	await rm(directory, { recursive: true, force: true })
})

test("two devices create one theme library and retain both first themes", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			let [first, second] = yield* Effect.all([client(), client()], {
				concurrency: 2,
			})
			let birth = themeLibraryBirth(first.subject)
			yield* first.api.workspaces.create({
				payload: {
					workspace: birth.workspace,
					name: "Personal",
					request: "personal-v1",
				},
			})
			let create = (account: typeof first) =>
				Effect.gen(function* () {
					let action = yield* buildAction(
						new Replica(birth.actor),
						birth.document,
						"Create document",
						staged =>
							newDocument(staged, birth.document, "Untitled", birth.source).map(
								operation =>
									operation ? { ...operation, time: 0 } : operation,
							),
					)
					return yield* account.api.documents.create({
						payload: { workspace: birth.workspace, action },
					})
				})
			let admitted = yield* Effect.all([create(first), create(second)], {
				concurrency: 2,
			})
			expect(admitted[0]).toBe(admitted[1])
			let add = (account: typeof first, id: string) =>
				Effect.gen(function* () {
					let replica = yield* restoreSnapshot(
						yield* account.api.documents.snapshot({
							params: { document: birth.document },
						}),
						account.subject + "-" + id,
					)
					let action = yield* buildAction(
						replica,
						birth.document,
						"Add theme",
						staged => [
							staged.set(id, "type", "theme"),
							staged.set(id, "document", birth.document),
							staged.edit(id, "```css theme\n.content { color: red; }\n```"),
						],
					)
					return yield* account.api.documents.commit({
						params: { document: birth.document },
						payload: action,
					})
				})
			yield* Effect.all(
				[add(first, "first-theme"), add(second, "second-theme")],
				{ concurrency: 2 },
			)
			let replica = yield* restoreSnapshot(
				yield* first.api.documents.snapshot({
					params: { document: birth.document },
				}),
				"observer",
			)
			expect(replica.text(birth.document)).toBe(birth.source)
			expect(
				replica
					.records("theme")
					.map(theme => theme.id)
					.sort(),
			).toEqual(["first-theme", "second-theme"])
			let library = yield* first.api.workspaces.library()
			expect(
				library.documents.filter(
					document => document.document === birth.document,
				),
			).toHaveLength(1)
		}).pipe(
			Effect.provide(Signatures.layer),
			Effect.provide(FetchHttpClient.layer),
			Effect.provide(webCryptoLayer),
		),
	))

function client() {
	return Effect.gen(function* () {
		let signatures = yield* Signatures
		let identity = yield* signatures.account(
			Redacted.make(encode(new Uint8Array(32).fill(87))),
		)
		let anonymous = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: instance.server.url,
		})
		let challenge = yield* anonymous.authentication.challenge({
			payload: { publicKey: identity.publicKey, purpose: "bearer" },
		})
		let signature = yield* identity.signAuthentication(challenge, {
			origin: instance.server.url.origin,
			purpose: "bearer",
		})
		let login = yield* anonymous.authentication.bearerLogin({
			payload: { id: challenge.id, publicKey: identity.publicKey, signature },
		})
		let api = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: instance.server.url,
			transformClient: client =>
				HttpClient.mapRequest(
					client,
					HttpClientRequest.bearerToken(Redacted.make(login.token)),
				),
		})
		return { api, subject: login.subject }
	})
}
