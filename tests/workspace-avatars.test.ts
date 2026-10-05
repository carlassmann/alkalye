import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { Signatures } from "../src/platform/signatures"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { startServer } from "../src/server/index"
import { encode } from "../src/shared/base64"
import { DocumentApi } from "../src/shared/document-api"

// The original's space avatars: an owner uploads or removes a square image
// that every member's library carries.

let image = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w=="
let directory = await mkdtemp(join(tmpdir(), "alkalye-workspace-avatars-"))
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

test("an owner's avatar reaches every member and can be removed", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(71)
			let writer = yield* client(72)
			yield* owner.api.workspaces.create({
				payload: { workspace: "studio", name: "Studio", request: "create" },
			})
			yield* owner.api.workspaces.membership({
				params: { workspace: "studio", member: writer.subject },
				payload: { role: "writer", request: "join" },
			})
			expect(yield* avatarOf(writer, "studio")).toBeUndefined()

			let first = yield* setAvatar(owner, "studio", image, "avatar-1")
			expect(yield* setAvatar(owner, "studio", image, "avatar-1")).toBe(first)
			for (let account of [owner, writer])
				expect(yield* avatarOf(account, "studio")).toBe(image)
			let snapshot = yield* owner.api.workspaces.snapshot({
				params: { workspace: "studio" },
			})
			expect(snapshot.avatar).toBe(image)

			yield* setAvatar(owner, "studio", null, "avatar-2")
			for (let account of [owner, writer])
				expect(yield* avatarOf(account, "studio")).toBeUndefined()
			expect(
				(yield* owner.api.workspaces.snapshot({
					params: { workspace: "studio" },
				})).avatar,
			).toBeUndefined()
		}),
	))

test("only owners change avatars, never on personal workspaces, and only images", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(81)
			let writer = yield* client(82)
			yield* owner.api.workspaces.create({
				payload: { workspace: "guarded", name: "Guarded", request: "create" },
			})
			yield* owner.api.workspaces.membership({
				params: { workspace: "guarded", member: writer.subject },
				payload: { role: "writer", request: "join" },
			})
			expect(
				yield* failure(setAvatar(writer, "guarded", image, "writer-avatar")),
			).toBe("PermissionDenied")
			expect(
				yield* failure(
					setAvatar(owner, "personal-" + owner.subject, image, "personal"),
				),
			).toBe("PermissionDenied")
			for (let invalid of [
				"data:text/html;base64,PHNjcmlwdD4=",
				"https://example.com/avatar.png",
				"data:image/png;base64," + "A".repeat(130_000),
			]) {
				expect(
					yield* failure(setAvatar(owner, "guarded", invalid, "invalid")),
				).toBe("SchemaError")
				let response = yield* Effect.promise(() =>
					fetch(
						new URL("/api/workspaces/guarded/avatar", instance.server.url),
						{
							method: "PUT",
							headers: {
								authorization: "Bearer " + owner.token,
								"content-type": "application/json",
							},
							body: JSON.stringify({ image: invalid, request: "raw" }),
						},
					),
				)
				expect(response.status).toBe(400)
			}
			expect(yield* avatarOf(owner, "guarded")).toBeUndefined()
		}),
	))

test("avatars survive a restart", async () => {
	let data = await mkdtemp(join(tmpdir(), "alkalye-avatar-restart-"))
	try {
		let first = await Effect.runPromise(
			startServer({ port: 0, data, build: false }),
		)
		await run(
			Effect.gen(function* () {
				let owner = yield* client(91, first.server.url)
				yield* owner.api.workspaces.create({
					payload: { workspace: "kept", name: "Kept", request: "create" },
				})
				yield* setAvatar(owner, "kept", image, "kept-avatar")
			}),
		)
		await Effect.runPromise(first.close())
		let restarted = await Effect.runPromise(
			startServer({ port: 0, data, build: false }),
		)
		try {
			await run(
				Effect.gen(function* () {
					let owner = yield* client(91, restarted.server.url)
					expect(yield* avatarOf(owner, "kept")).toBe(image)
				}),
			)
		} finally {
			await Effect.runPromise(restarted.close())
		}
	} finally {
		await rm(data, { recursive: true, force: true })
	}
})

type Client = Effect.Success<ReturnType<typeof client>>
function client(seed: number, base = instance.server.url) {
	return Effect.gen(function* () {
		let signatures = yield* Signatures
		let identity = yield* signatures.account(
			Redacted.make(encode(new Uint8Array(32).fill(seed))),
		)
		let anonymous = yield* HttpApiClient.make(DocumentApi, { baseUrl: base })
		let issued = yield* anonymous.authentication.challenge({
			payload: { publicKey: identity.publicKey, purpose: "bearer" },
		})
		let signature = yield* identity.signAuthentication(issued, {
			origin: base.origin,
			purpose: "bearer",
		})
		let login = yield* anonymous.authentication.bearerLogin({
			payload: { id: issued.id, publicKey: identity.publicKey, signature },
		})
		let api = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: base,
			transformClient: client =>
				HttpClient.mapRequest(
					client,
					HttpClientRequest.bearerToken(Redacted.make(login.token)),
				),
		})
		return { api, subject: login.subject, token: login.token }
	})
}
function setAvatar(
	owner: Client,
	workspace: string,
	image: string | null,
	request: string,
) {
	return owner.api.workspaces.avatar({
		params: { workspace },
		payload: { image, request },
	})
}
function avatarOf(account: Client, workspace: string) {
	return account.api.workspaces
		.library()
		.pipe(
			Effect.map(
				library =>
					library.workspaces.find(space => space.workspace === workspace)
						?.avatar,
			),
		)
}
function failure<A, E extends { _tag: string }, R>(
	effect: Effect.Effect<A, E, R>,
) {
	return effect.pipe(
		Effect.as("Success"),
		Effect.catch(error => Effect.succeed(error._tag)),
	)
}
function run<A, E>(
	effect: Effect.Effect<
		A,
		E,
		Signatures | HttpClient.HttpClient | Crypto.Crypto
	>,
) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provide(Signatures.layer),
			Effect.provide(FetchHttpClient.layer),
			Effect.provide(webCryptoLayer),
		),
	)
}
