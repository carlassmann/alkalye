import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { makeDocumentTransport } from "../src/client/document-transport"
import * as Effect from "effect/Effect"
import * as Crypto from "effect/Crypto"
import * as Redacted from "effect/Redacted"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { Signatures } from "../src/platform/signatures"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { startServer } from "../src/server/index"
import { DocumentApi } from "../src/shared/document-api"
import {
	buildAction,
	restoreSnapshot,
	undoAction,
} from "../src/shared/document-actions"
import { encode } from "../src/shared/base64"
import { Replica } from "../src/shared/crdt"
import { expandDeletions } from "../src/shared/model"
import { newComment, newDocument, setFields } from "../src/shared/documents"
import {
	blobDigest,
	blobReference,
	maximumBlobChunkBytes,
} from "../src/shared/document-blobs"

let directory = await mkdtemp(join(tmpdir(), "alkalye-document-http-"))
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
function client(seed: number) {
	return Effect.gen(function* () {
		let signatures = yield* Signatures
		let identity = yield* signatures.account(
			Redacted.make(encode(new Uint8Array(32).fill(seed))),
		)
		let anonymous = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: instance.server.url,
		})
		let issued = yield* anonymous.authentication.challenge({
			payload: { publicKey: identity.publicKey, purpose: "bearer" },
		})
		let signature = yield* identity.signAuthentication(issued, {
			origin: instance.server.url.origin,
			purpose: "bearer",
		})
		let login = yield* anonymous.authentication.bearerLogin({
			payload: { id: issued.id, publicKey: identity.publicKey, signature },
		})
		let api = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: instance.server.url,
			transformClient: client =>
				HttpClient.mapRequest(
					client,
					HttpClientRequest.bearerToken(Redacted.make(login.token)),
				),
		})
		return { api, subject: login.subject, token: Redacted.make(login.token) }
	})
}
function run<A, E>(
	task: Effect.Effect<A, E, HttpClient.HttpClient | Signatures | Crypto.Crypto>,
) {
	return Effect.runPromise(
		task.pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.provide(Signatures.layer),
			Effect.provide(webCryptoLayer),
		),
	)
}
function createAction(document: string, actor: string) {
	return buildAction(new Replica(actor), document, "Create document", replica =>
		newDocument(
			replica,
			document,
			"Untitled",
			"---\ntitle: Frontmatter title\npath: Writing\ntags: [one, two]\n---\nQuote",
		),
	)
}
test("HTTP refuses orphaned text anchors and unknown removals atomically, then accepts a corrected action", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(27)
			let document = "causal-http"
			yield* owner.api.workspaces.create({
				payload: {
					workspace: "causal-space",
					name: "Causal",
					request: "create-causal",
				},
			})
			yield* owner.api.documents.create({
				payload: {
					workspace: "causal-space",
					action: yield* createAction(
						document,
						owner.subject + "-causal-birth",
					),
				},
			})
			let snapshot = yield* owner.api.documents.snapshot({
				params: { document },
			})
			let replica = yield* restoreSnapshot(
				snapshot,
				owner.subject + "-causal-editor",
			)
			for (let kind of ["anchor", "remove"]) {
				let action = yield* buildAction(
					replica,
					document,
					"Invalid text " + kind,
					staged => {
						let note = staged.set(
							document,
							"presentationNote",
							"Must roll back",
						)
						let source = staged.text(document)
						let change = staged.prepareEdit(
							document,
							kind === "anchor" ? source + "!" : source.slice(0, -1),
						)
						if (!change) throw new Error("Missing text action")
						if (kind === "anchor") {
							let first = change.insert[0]
							if (!first) throw new Error("Missing insertion")
							first.after = "0000000000000001:unaccepted:00000000"
						} else change.remove = ["0000000000000001:unaccepted:00000000"]
						return [note, change]
					},
				)
				let result = yield* owner.api.documents
					.commit({ params: { document }, payload: action })
					.pipe(Effect.result)
				if (result._tag !== "Failure")
					throw new Error("Orphaned text committed")
				expect(result.failure._tag).toBe("CausalDependencyMissing")
				let after = yield* owner.api.documents.snapshot({
					params: { document },
				})
				expect(after.position).toBe(snapshot.position)
				let restored = yield* restoreSnapshot(after, "inspect")
				expect(restored.text(document)).toBe(replica.text(document))
				expect(restored.fields(document).presentationNote).toBeUndefined()
			}
			let corrected = yield* buildAction(
				replica,
				document,
				"Valid text",
				staged => [staged.edit(document, staged.text(document) + "!")],
			)
			let position = yield* owner.api.documents.commit({
				params: { document },
				payload: corrected,
			})
			let after = yield* owner.api.documents.snapshot({ params: { document } })
			expect(after.position).toBe(position)
			expect((yield* restoreSnapshot(after, "peer")).text(document)).toBe(
				replica.text(document) + "!",
			)
		}),
	))
test("attachment source and manifest commit atomically only after their bytes exist; deletion retains historical bytes", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(24)
			let workspace = "attachment-order-space",
				document = "attachment-order-document"
			yield* owner.api.workspaces.create({
				payload: { workspace, name: "Attachments", request: "create" },
			})
			yield* owner.api.documents.create({
				payload: {
					workspace,
					action: yield* createAction(document, owner.subject + "-birth"),
				},
			})
			let bytes = new Uint8Array([1, 4, 9, 16])
			let digest = yield* blobDigest(bytes)
			let reference = yield* blobReference({
				version: 1,
				type: "image/png",
				size: bytes.length,
				chunks: [{ digest, size: bytes.length }],
			})
			let snapshot = yield* owner.api.documents.snapshot({
				params: { document },
			})
			let replica = yield* restoreSnapshot(snapshot, owner.subject + "-attach")
			let source = replica.text(document)
			let action = yield* buildAction(
				replica,
				document,
				"Attach image",
				staged => [
					...setFields(staged, "ordered-asset", {
						type: "asset",
						document,
						name: "Image",
						data: reference,
					}),
					staged.edit(document, source + "\n![Image](asset:ordered-asset)"),
				],
			)
			let rejected = yield* owner.api.documents
				.commit({ params: { document }, payload: action })
				.pipe(Effect.result)
			expect(rejected._tag).toBe("Failure")
			if (rejected._tag === "Failure")
				expect(rejected.failure._tag).toBe("BlobBytesMissing")
			let after = yield* owner.api.documents.snapshot({ params: { document } })
			expect(after.position).toBe(snapshot.position)
			let untouched = yield* restoreSnapshot(after, "inspect")
			expect(untouched.fields("ordered-asset").type).toBeUndefined()
			expect(untouched.text(document)).toBe(source)
			expect(
				yield* owner.api.documents.missingBlobs({
					params: { document },
					payload: [
						{ digest, size: bytes.length },
						{ digest, size: bytes.length },
					],
				}),
			).toEqual([digest])
			expect(
				yield* owner.api.documents.missingBlobs({
					params: { document },
					payload: [],
				}),
			).toEqual([])
			yield* owner.api.documents.putBlob({
				params: { document, digest },
				payload: bytes,
			})
			expect(
				yield* owner.api.documents.missingBlobs({
					params: { document },
					payload: [{ digest, size: bytes.length }],
				}),
			).toEqual([])
			let position = yield* owner.api.documents.commit({
				params: { document },
				payload: action,
			})
			expect(
				yield* owner.api.documents.commit({
					params: { document },
					payload: action,
				}),
			).toBe(position)
			let committed = yield* restoreSnapshot(
				yield* owner.api.documents.snapshot({ params: { document } }),
				owner.subject + "-remove",
			)
			expect(committed.fields("ordered-asset").data).toBe(reference)
			expect(committed.text(document)).toContain("asset:ordered-asset")
			let removal = yield* buildAction(
				committed,
				document,
				"Remove image",
				staged => [
					staged.set("ordered-asset", "type", "deleted"),
					staged.edit(document, source),
				],
			)
			yield* owner.api.documents.commit({
				params: { document },
				payload: removal,
			})
			expect(
				yield* owner.api.documents.getBlob({ params: { document, digest } }),
			).toEqual(bytes)
			let events = yield* owner.api.documents.history({
				params: { document },
				query: { log: after.log },
			})
			expect(
				events.some(
					entry =>
						entry.action.id === action.id &&
						entry.action.changes.some(change => change.value === reference),
				),
			).toBe(true)
			let forbiddenBirth = yield* buildAction(
				new Replica(owner.subject + "-bad-birth"),
				"asset-bearing-birth",
				"Create with asset",
				staged => [
					...newDocument(
						staged,
						"asset-bearing-birth",
						"Untitled",
						"![image](asset:birth-asset)",
					),
					...setFields(staged, "birth-asset", {
						type: "asset",
						document: "asset-bearing-birth",
						data: reference,
					}),
				],
			)
			expect(
				(yield* owner.api.documents
					.create({ payload: { workspace, action: forbiddenBirth } })
					.pipe(Effect.result))._tag,
			).toBe("Failure")
			expect(
				(yield* owner.api.workspaces.library()).documents.some(
					row => row.document === "asset-bearing-birth",
				),
			).toBe(false)
		}),
	))

test("document history pages preserve global cursor gaps and reject unsafe page sizes", () =>
	run(
		Effect.gen(function* () {
			let { api, subject } = yield* client(8)
			yield* api.workspaces.create({
				payload: { workspace: "paged-space", name: "Pages", request: "create" },
			})
			let ids: string[] = []
			for (let document of ["paged-document", "interleaved-document"]) {
				let action = yield* createAction(document, subject + "-" + document)
				yield* api.documents.create({
					payload: { workspace: "paged-space", action },
				})
				if (document === "paged-document") ids.push(action.id)
			}
			for (let index = 0; index < 4; index++) {
				for (let document of ["paged-document", "interleaved-document"]) {
					let replica = yield* restoreSnapshot(
						yield* api.documents.snapshot({ params: { document } }),
						subject + "-" + document,
					)
					let action = yield* buildAction(
						replica,
						document,
						"Write " + index,
						staged => [staged.edit(document, staged.text(document) + index)],
					)
					yield* api.documents.commit({ params: { document }, payload: action })
					if (document === "paged-document") ids.push(action.id)
				}
			}
			let snapshot = yield* api.documents.snapshot({
				params: { document: "paged-document" },
			})
			let seen: string[] = []
			let positions: number[] = []
			let after = 0
			while (true) {
				let page = yield* api.documents.history({
					params: { document: "paged-document" },
					query: { after, log: snapshot.log, limit: 2 },
				})
				expect(page.length).toBeLessThanOrEqual(2)
				for (let entry of page) {
					expect(entry.position).toBeGreaterThan(after)
					seen.push(entry.action.id)
					positions.push(entry.position)
					after = entry.position
				}
				if (page.length < 2) break
			}
			expect(seen).toEqual(ids)
			expect(
				positions.some(
					(position, index) =>
						index > 0 && position > (positions[index - 1] ?? 0) + 1,
				),
			).toBe(true)
			for (let limit of [0, -1, 1.5, 1001])
				expect(
					(yield* api.documents
						.history({
							params: { document: "paged-document" },
							query: { log: snapshot.log, limit },
						})
						.pipe(Effect.result))._tag,
				).toBe("Failure")
		}),
	))
test("a bound client cannot read or write through another account's session", () =>
	run(
		Effect.gen(function* () {
			let first = yield* client(9)
			let second = yield* client(10)
			yield* second.api.workspaces.create({
				payload: {
					workspace: "bound-account-space",
					name: "Bound account",
					request: "create",
				},
			})
			let api = yield* HttpApiClient.make(DocumentApi, {
				baseUrl: instance.server.url,
				transformClient: client =>
					HttpClient.mapRequest(client, request =>
						request.pipe(
							HttpClientRequest.bearerToken(second.token),
							HttpClientRequest.setHeader("x-alkalye-account", first.subject),
						),
					),
			})
			let result = yield* api.workspaces
				.snapshot({ params: { workspace: "bound-account-space" } })
				.pipe(Effect.result)
			expect(result._tag).toBe("Failure")
			if (result._tag === "Failure")
				expect(result.failure._tag).toBe("AccountChanged")
			let create = yield* api.workspaces
				.create({
					payload: {
						workspace: "wrong-account-write",
						name: "Wrong account",
						request: "create",
					},
				})
				.pipe(Effect.result)
			expect(create._tag).toBe("Failure")
			if (create._tag === "Failure")
				expect(create.failure._tag).toBe("AccountChanged")
		}),
	))
test("whole-document HTTP stream includes text, comments and asset references; snapshots and sidebar do not require history", () =>
	run(
		Effect.gen(function* () {
			let { api, subject } = yield* client(1)
			let actor = subject + "-whole-doc-actor"
			yield* api.workspaces.create({
				payload: {
					workspace: "entire-document",
					name: "Entire document",
					request: "create",
				},
			})
			let action = yield* createAction("whole-doc", actor)
			let position = yield* api.documents.create({
				payload: { workspace: "entire-document", action },
			})
			let snapshot = yield* api.documents.snapshot({
				params: { document: "whole-doc" },
			})
			expect(snapshot.position).toBe(position)
			let replica = yield* restoreSnapshot(snapshot, actor)
			let comment = yield* buildAction(
				replica,
				"whole-doc",
				"Add comment",
				staged =>
					newComment(
						staged,
						"whole-comment",
						"whole-doc",
						"Quote",
						"Discuss this",
						"Owner",
					),
			)
			yield* api.documents.commit({
				params: { document: "whole-doc" },
				payload: comment,
			})
			replica = yield* restoreSnapshot(
				yield* api.documents.snapshot({ params: { document: "whole-doc" } }),
				actor,
			)
			let asset = yield* buildAction(
				replica,
				"whole-doc",
				"Attach asset",
				staged =>
					setFields(staged, "whole-asset", {
						type: "asset",
						document: "whole-doc",
						name: "Photo",
						mime: "image/png",
						source: "blob-reference",
					}),
			)
			let attached = yield* api.documents.commit({
				params: { document: "whole-doc" },
				payload: asset,
			})
			let current = yield* api.documents.snapshot({
				params: { document: "whole-doc" },
			})
			let restored = yield* restoreSnapshot(current, "read-only")
			expect(restored.fields("whole-comment").body).toBe("Discuss this")
			expect(restored.fields("whole-asset").source).toBe("blob-reference")
			let sidebar = yield* api.workspaces.snapshot({
				params: { workspace: "entire-document" },
			})
			expect(sidebar.documents[0]).toMatchObject({
				owner: subject,
				position: attached,
				metadata: {
					title: "Frontmatter title",
					path: "Writing",
					tags: ["one", "two"],
				},
			})
			let tail = yield* api.documents.history({
				params: { document: "whole-doc" },
				query: { after: snapshot.position, log: snapshot.log },
			})
			expect(tail.map(entry => entry.action.label)).toEqual([
				"Add comment",
				"Attach asset",
			])
			expect(tail.every(entry => entry.action.subject === subject)).toBe(true)
			let originalAsset = tail[1]?.action
			if (!originalAsset) return yield* Effect.die("Missing action")
			let undo = yield* undoAction(
				yield* restoreSnapshot(current, actor),
				originalAsset,
			)
			yield* api.documents.commit({
				params: { document: "whole-doc" },
				payload: undo,
			})
			let undone = yield* restoreSnapshot(
				yield* api.documents.snapshot({ params: { document: "whole-doc" } }),
				"reader",
			)
			expect(undone.fields("whole-asset").type).toBe("deleted")
			expect(undone.fields("whole-comment").type).toBe("comment")
		}),
	))
test("action chain discovery uses current permissions and masks missing or unrelated receipts", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(80),
				reader = yield* client(81),
				unrelated = yield* client(82)
			let workspace = "chain-permissions",
				document = "chain-private-document"
			yield* owner.api.workspaces.create({
				payload: { workspace, name: "Chain permissions", request: "create" },
			})
			let birth = yield* createAction(document, owner.subject + "-chain-birth")
			let position = yield* owner.api.documents.create({
				payload: { workspace, action: birth },
			})
			yield* owner.api.workspaces.membership({
				params: { workspace, member: reader.subject },
				payload: { role: "reader", request: "read" },
			})
			expect(
				yield* reader.api.documents.chain({
					params: { document, action: birth.id },
				}),
			).toMatchObject({
				document,
				from: birth.id,
				latest: birth.id,
				position,
				depth: 0,
			})
			for (let params of [
				{ document, action: "absent" },
				{ document: "absent", action: birth.id },
			]) {
				let absent = yield* owner.api.documents
					.chain({ params })
					.pipe(Effect.result)
				expect(absent._tag).toBe("Failure")
				if (absent._tag === "Failure")
					expect(absent.failure._tag).toBe("ResourceUnavailable")
			}
			let privateChain = yield* unrelated.api.documents
				.chain({ params: { document, action: birth.id } })
				.pipe(Effect.result)
			expect(privateChain._tag).toBe("Failure")
			if (privateChain._tag === "Failure")
				expect(privateChain.failure._tag).toBe("ResourceUnavailable")
			yield* owner.api.workspaces.membership({
				params: { workspace, member: reader.subject },
				payload: { role: null, request: "revoke" },
			})
			let revoked = yield* reader.api.documents
				.chain({ params: { document, action: birth.id } })
				.pipe(Effect.result)
			expect(revoked._tag).toBe("Failure")
			if (revoked._tag === "Failure")
				expect(revoked.failure._tag).toBe("ResourceUnavailable")
		}),
	))

test("HTTP owner/writer/reader permissions are persisted and cannot be supplied in a request body", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(2)
			let writer = yield* client(3)
			let reader = yield* client(4)
			yield* owner.api.workspaces.create({
				payload: { workspace: "roles", name: "Roles", request: "create" },
			})
			yield* owner.api.documents.create({
				payload: {
					workspace: "roles",
					action: yield* createAction(
						"roles-doc",
						owner.subject + "-roles-owner",
					),
				},
			})
			yield* owner.api.workspaces.membership({
				params: { workspace: "roles", member: writer.subject },
				payload: { role: "writer", request: "writer" },
			})
			yield* owner.api.workspaces.membership({
				params: { workspace: "roles", member: reader.subject },
				payload: { role: "reader", request: "reader" },
			})
			let snapshot = yield* reader.api.documents.snapshot({
				params: { document: "roles-doc" },
			})
			let forbidden = yield* buildAction(
				yield* restoreSnapshot(snapshot, reader.subject + "-reader-producer"),
				"roles-doc",
				"Reader edit",
				staged => [
					staged.edit("roles-doc", staged.text("roles-doc") + "blocked"),
				],
			)
			let impersonation = yield* Effect.tryPromise(() =>
				fetch(
					new URL("/api/documents/roles-doc/actions", instance.server.url),
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							authorization: "Bearer " + Redacted.value(reader.token),
						},
						body: JSON.stringify({
							...forbidden,
							subject: owner.subject,
							role: "owner",
						}),
					},
				),
			)
			expect(impersonation.status).toBe(403)
			let blocked = yield* reader.api.documents
				.commit({ params: { document: "roles-doc" }, payload: forbidden })
				.pipe(Effect.result)
			expect(blocked._tag).toBe("Failure")
			if (blocked._tag === "Failure")
				expect(blocked.failure._tag).toBe("PermissionDenied")
			let edit = yield* buildAction(
				yield* restoreSnapshot(snapshot, writer.subject + "-writer-producer"),
				"roles-doc",
				"Writer edit",
				staged => [
					staged.edit("roles-doc", staged.text("roles-doc") + " allowed"),
				],
			)
			yield* writer.api.documents.commit({
				params: { document: "roles-doc" },
				payload: edit,
			})
			let memberChange = yield* writer.api.workspaces
				.membership({
					params: { workspace: "roles", member: reader.subject },
					payload: { role: "writer", request: "escalation" },
				})
				.pipe(Effect.result)
			expect(memberChange._tag).toBe("Failure")
			yield* owner.api.workspaces.membership({
				params: { workspace: "roles", member: writer.subject },
				payload: { role: null, request: "revoke" },
			})
			let denied = yield* writer.api.documents
				.snapshot({ params: { document: "roles-doc" } })
				.pipe(Effect.result)
			expect(denied._tag).toBe("Failure")
			if (denied._tag === "Failure")
				expect(denied.failure._tag).toBe("ResourceUnavailable")
			let recorded = yield* owner.api.documents.history({
				params: { document: "roles-doc" },
				query: {},
			})
			expect(recorded.at(-1)?.action.subject).toBe(writer.subject)
		}),
	))
test("unknown documents do not leak existence and history epochs must match", () =>
	run(
		Effect.gen(function* () {
			let { api } = yield* client(5)
			for (let document of ["absent-doc", "whole-doc"]) {
				let response = yield* api.documents
					.snapshot({ params: { document } })
					.pipe(Effect.result)
				expect(response._tag).toBe("Failure")
				if (response._tag === "Failure")
					expect(response.failure._tag).toBe("ResourceUnavailable")
			}
			let owner = yield* client(1)
			let history = yield* owner.api.documents
				.history({
					params: { document: "whole-doc" },
					query: { log: "obsolete-log" },
				})
				.pipe(Effect.result)
			expect(history._tag).toBe("Failure")
			if (history._tag === "Failure")
				expect(history.failure._tag).toBe("DocumentHistoryUnavailable")
		}),
	))

test("native Effect compression negotiates downloadable snapshots without compressing authentication responses", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(1)
			function snapshot(encoding: string) {
				return Effect.tryPromise(() =>
					fetch(
						new URL("/api/documents/whole-doc/snapshot", instance.server.url),
						{
							headers: {
								authorization: "Bearer " + Redacted.value(owner.token),
								"accept-encoding": encoding,
							},
							decompress: false,
						},
					),
				)
			}
			let plain = yield* snapshot("identity")
			let compressed = yield* snapshot("gzip")
			expect(plain.status).toBe(200)
			expect(compressed.status).toBe(200)
			expect(plain.headers.get("content-encoding")).toBeNull()
			expect(compressed.headers.get("content-encoding")).toBe("gzip")
			expect(compressed.headers.get("vary")).toContain("Accept-Encoding")
			expect(compressed.headers.get("cache-control")).toBe("no-store")
			let bytes = new Uint8Array(
				yield* Effect.promise(() => compressed.arrayBuffer()),
			)
			let text = yield* Effect.promise(() => plain.text())
			expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe(text)
			expect(bytes.length).toBeLessThan(new TextEncoder().encode(text).length)
			let disabled = yield* snapshot("gzip;q=0")
			expect(disabled.headers.get("content-encoding")).toBeNull()
			let session = yield* Effect.tryPromise(() =>
				fetch(new URL("/api/accounts/session", instance.server.url), {
					headers: {
						authorization: "Bearer " + Redacted.value(owner.token),
						"accept-encoding": "gzip",
					},
					decompress: false,
				}),
			)
			expect(session.headers.get("content-encoding")).toBeNull()
		}),
	))

test("workspace owner retains control of writer-created documents after membership removal", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(11)
			let writer = yield* client(12)
			let outsider = yield* client(13)
			yield* owner.api.workspaces.create({
				payload: {
					workspace: "creation-ownership",
					name: "Owned workspace",
					request: "create",
				},
			})
			yield* owner.api.workspaces.membership({
				params: { workspace: "creation-ownership", member: writer.subject },
				payload: { role: "writer", request: "invite" },
			})
			let actor = writer.subject + "-creator"
			let escalated = yield* buildAction(
				new Replica(actor),
				"forged-ownership-doc",
				"Create and grant",
				staged => [
					...newDocument(staged, "forged-ownership-doc", "Untitled", "Quote"),
					staged.set(
						"forged-ownership-doc",
						"access:" + outsider.subject,
						"writer",
					),
				],
			)
			let rejected = yield* writer.api.documents
				.create({
					payload: { workspace: "creation-ownership", action: escalated },
				})
				.pipe(Effect.result)
			expect(rejected._tag).toBe("Failure")
			if (rejected._tag === "Failure")
				expect(rejected.failure._tag).toBe("PermissionDenied")
			let created = yield* createAction("writer-created-doc", actor)
			yield* writer.api.documents.create({
				payload: { workspace: "creation-ownership", action: created },
			})
			let sidebar = yield* owner.api.workspaces.snapshot({
				params: { workspace: "creation-ownership" },
			})
			expect(sidebar.documents[0]?.owner).toBe(owner.subject)
			let snapshot = yield* writer.api.documents.snapshot({
				params: { document: "writer-created-doc" },
			})
			let pending = yield* buildAction(
				yield* restoreSnapshot(snapshot, actor),
				"writer-created-doc",
				"Grant outsider",
				staged => [
					staged.set(
						"writer-created-doc",
						"access:" + outsider.subject,
						"writer",
					),
				],
			)
			yield* owner.api.workspaces.membership({
				params: { workspace: "creation-ownership", member: writer.subject },
				payload: { role: null, request: "remove" },
			})
			for (let attempt of [
				writer.api.documents
					.snapshot({
						params: { document: "writer-created-doc" },
					})
					.pipe(Effect.asVoid),
				writer.api.documents
					.commit({
						params: { document: "writer-created-doc" },
						payload: pending,
					})
					.pipe(Effect.asVoid),
				outsider.api.documents
					.snapshot({
						params: { document: "writer-created-doc" },
					})
					.pipe(Effect.asVoid),
			]) {
				let result = yield* attempt.pipe(Effect.result)
				expect(result._tag).toBe("Failure")
				if (result._tag === "Failure")
					expect(result.failure._tag).toBe("ResourceUnavailable")
			}
			expect(
				(yield* owner.api.documents.snapshot({
					params: { document: "writer-created-doc" },
				})).document,
			).toBe("writer-created-doc")
		}),
	))
test("an account cannot reserve another account's unused producer identity", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(21)
			let attacker = yield* client(22)
			yield* owner.api.workspaces.create({
				payload: {
					workspace: "actor-ownership",
					name: "Actor ownership",
					request: "create",
				},
			})
			yield* owner.api.workspaces.membership({
				params: { workspace: "actor-ownership", member: attacker.subject },
				payload: { role: "writer", request: "invite" },
			})
			let action = yield* createAction(
				"unused-actor-doc",
				owner.subject + "-unused-actor",
			)
			let rejected = yield* attacker.api.documents
				.create({ payload: { workspace: "actor-ownership", action } })
				.pipe(Effect.result)
			expect(rejected._tag).toBe("Failure")
			if (rejected._tag === "Failure")
				expect(rejected.failure._tag).toBe("DocumentConflict")
			yield* owner.api.documents.create({
				payload: { workspace: "actor-ownership", action },
			})
			expect(
				(yield* owner.api.documents.snapshot({
					params: { document: "unused-actor-doc" },
				})).document,
			).toBe("unused-actor-doc")
		}),
	))
test("HTTP rejects excessive actions and compact text expansions before durable mutation", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(31)
			yield* owner.api.workspaces.create({
				payload: {
					workspace: "bounded-input",
					name: "Bounded input",
					request: "create",
				},
			})
			let action = yield* createAction(
				"oversized-doc",
				owner.subject + "-bounded-producer",
			)
			let text = action.changes.find(change => change.kind === "text")
			if (!text) return yield* Effect.die("Missing source operation")
			let register = action.changes.find(change => change.kind === "set")
			if (!register) return yield* Effect.die("Missing register operation")
			for (let changes of [
				Array.from({ length: 1025 }, () => action.changes[0]),
				[{ ...register, value: "x".repeat(200_001) }],
				[{ ...register, field: "x".repeat(257) }],
				[{ ...register, author: "x".repeat(257) }],
				[
					{ ...register, value: "x".repeat(100_001) },
					{ ...register, value: "y".repeat(100_001) },
				],
				[{ ...text, remove: [{ id: text.id + ":00000000", count: 200_001 }] }],
				[
					{
						...text,
						insert: [
							{
								id: text.id + ":00000000",
								after: "",
								value: "x".repeat(200_001),
							},
						],
					},
				],
				[
					{
						...text,
						insert: [
							{
								id: text.id + ":00000000",
								after: "",
								value: "x",
								order: Array.from({ length: 200_001 }, () => "x"),
							},
						],
					},
				],
				[
					{
						...text,
						insert: [
							{ id: text.id + ":00000000", after: "x".repeat(161), value: "x" },
						],
					},
				],
			]) {
				let response = yield* Effect.tryPromise(() =>
					fetch(new URL("/api/documents", instance.server.url), {
						method: "POST",
						headers: {
							"content-type": "application/json",
							authorization: "Bearer " + Redacted.value(owner.token),
						},
						body: JSON.stringify({
							workspace: "bounded-input",
							action: { ...action, changes },
						}),
					}),
				)
				expect(response.status).toBe(400)
			}
			for (let malformed of [
				{ ...action, label: "x".repeat(257) },
				{
					...action,
					guards: [{ target: action.document, state: "x".repeat(43) }],
				},
				{
					...action,
					undoOf: action.id,
					guards: [
						{ target: action.document, state: "x".repeat(43) },
						{ target: action.document, state: "x".repeat(43) },
					],
				},
				{
					...action,
					undoOf: action.id,
					guards: [{ target: "unrelated-document", state: "x".repeat(43) }],
				},
				{
					...action,
					undoOf: action.id,
					guards: [{ target: action.document, state: "x".repeat(200_001) }],
				},
			]) {
				let response = yield* Effect.tryPromise(() =>
					fetch(new URL("/api/documents", instance.server.url), {
						method: "POST",
						headers: {
							"content-type": "application/json",
							authorization: "Bearer " + Redacted.value(owner.token),
						},
						body: JSON.stringify({
							workspace: "bounded-input",
							action: malformed,
						}),
					}),
				)
				expect(response.status).toBe(400)
			}
			expect(
				(yield* owner.api.workspaces.snapshot({
					params: { workspace: "bounded-input" },
				})).documents,
			).toEqual([])
			yield* owner.api.documents.create({
				payload: { workspace: "bounded-input", action },
			})
			expect(
				(yield* owner.api.workspaces.snapshot({
					params: { workspace: "bounded-input" },
				})).documents,
			).toHaveLength(1)
		}),
	))

test("library catalogue lists only current access, includes separate document grants and preserves effective roles", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(91)
			let member = yield* client(92)
			let guest = yield* client(93)
			for (let workspace of ["library-writers", "library-readers"])
				yield* owner.api.workspaces.create({
					payload: { workspace, name: workspace, request: "create" },
				})
			for (let [workspace, document] of [
				["library-writers", "library-first"],
				["library-readers", "library-second"],
			]) {
				if (!workspace || !document)
					return yield* Effect.die("Missing library fixture identity")
				yield* owner.api.documents.create({
					payload: {
						workspace,
						action: yield* createAction(
							document,
							owner.subject + "-" + document,
						),
					},
				})
			}
			yield* owner.api.workspaces.membership({
				params: { workspace: "library-writers", member: member.subject },
				payload: { role: "writer", request: "writers" },
			})
			yield* owner.api.workspaces.membership({
				params: { workspace: "library-readers", member: member.subject },
				payload: { role: "reader", request: "readers" },
			})
			for (let document of ["library-first", "library-second"]) {
				let replica = yield* restoreSnapshot(
					yield* owner.api.documents.snapshot({ params: { document } }),
					owner.subject + "-grant-" + document,
				)
				let grant = yield* buildAction(
					replica,
					document,
					"Grant library access",
					staged => [
						staged.set(
							document,
							"access:" + member.subject,
							document === "library-first" ? "reader" : "writer",
						),
						...(document === "library-second"
							? [staged.set(document, "access:" + guest.subject, "reader")]
							: []),
					],
				)
				yield* owner.api.documents.commit({
					params: { document },
					payload: grant,
				})
			}
			let own = yield* owner.api.workspaces.library()
			expect(own.workspaces.map(workspace => workspace.role)).toEqual([
				"owner",
				"owner",
			])
			expect(
				own.documents.every(
					document =>
						document.role === "owner" &&
						document.metadata.title === "Frontmatter title",
				),
			).toBe(true)
			let inherited = yield* member.api.workspaces.library()
			expect(inherited.workspaces.map(workspace => workspace.role)).toEqual([
				"reader",
				"writer",
			])
			expect(inherited.documents.map(document => document.role)).toEqual([
				"writer",
				"writer",
			])
			let shared = yield* guest.api.workspaces.library()
			expect(shared.workspaces).toEqual([])
			expect(
				shared.documents.map(document => [document.document, document.role]),
			).toEqual([["library-second", "reader"]])
			for (let workspace of ["library-writers", "library-readers"])
				yield* owner.api.workspaces.membership({
					params: { workspace, member: member.subject },
					payload: { role: null, request: "leave" },
				})
			let remaining = yield* member.api.workspaces.library()
			expect(remaining.workspaces).toEqual([])
			expect(
				remaining.documents.map(document => [document.document, document.role]),
			).toEqual([
				["library-second", "writer"],
				["library-first", "reader"],
			])
			let document = "library-second"
			let replica = yield* restoreSnapshot(
				yield* owner.api.documents.snapshot({ params: { document } }),
				owner.subject + "-revoke-library",
			)
			let revoke = yield* buildAction(
				replica,
				document,
				"Revoke guest",
				staged => [staged.set(document, "access:" + guest.subject, "")],
			)
			yield* owner.api.documents.commit({
				params: { document },
				payload: revoke,
			})
			expect((yield* guest.api.workspaces.library()).documents).toEqual([])
			expect(JSON.stringify(shared)).not.toContain("Paragraph text")
		}),
	))

test("native blob HTTP verifies immutable chunks, scopes them to a document and checks current roles", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(21)
			let reader = yield* client(22)
			let outsider = yield* client(23)
			let workspace = "binary-space"
			let document = "binary-document"
			yield* owner.api.workspaces.create({
				payload: { workspace, name: "Binary", request: "create" },
			})
			for (let id of [document, "binary-other"])
				yield* owner.api.documents.create({
					payload: {
						workspace,
						action: yield* createAction(id, owner.subject + "-" + id),
					},
				})
			let bytes = new Uint8Array([0, 255, 128, 60, 62, 10, 0])
			let digest = yield* blobDigest(bytes)
			let params = { document, digest }
			yield* Effect.all(
				[
					owner.api.documents.putBlob({ params, payload: bytes }),
					owner.api.documents.putBlob({ params, payload: bytes }),
				],
				{ concurrency: 2 },
			)
			expect(yield* owner.api.documents.getBlob({ params })).toEqual(bytes)
			let raw = yield* Effect.tryPromise(() =>
				fetch(
					new URL(
						`/api/documents/${document}/blobs/${digest}`,
						instance.server.url,
					),
					{
						headers: { Authorization: "Bearer " + Redacted.value(owner.token) },
					},
				),
			)
			expect(raw.headers.get("content-type")).toBe("application/octet-stream")
			let altered = yield* owner.api.documents
				.putBlob({ params, payload: new Uint8Array([1, 2]) })
				.pipe(Effect.result)
			expect(altered._tag).toBe("Failure")
			if (altered._tag === "Failure")
				expect(altered.failure._tag).toBe("BlobCorrupt")
			expect(yield* owner.api.documents.getBlob({ params })).toEqual(bytes)
			let foreign = yield* owner.api.documents
				.getBlob({ params: { document: "binary-other", digest } })
				.pipe(Effect.result)
			expect(foreign._tag).toBe("Failure")
			if (foreign._tag === "Failure")
				expect(foreign.failure._tag).toBe("ResourceUnavailable")
			for (let task of [
				outsider.api.documents.getBlob({ params }),
				outsider.api.documents.putBlob({ params, payload: bytes }),
			]) {
				let denied = yield* task.pipe(Effect.result)
				expect(denied._tag).toBe("Failure")
				if (denied._tag === "Failure")
					expect(denied.failure._tag).toBe("ResourceUnavailable")
			}
			yield* owner.api.workspaces.membership({
				params: { workspace, member: reader.subject },
				payload: { role: "reader", request: "reader" },
			})
			expect(yield* reader.api.documents.getBlob({ params })).toEqual(bytes)
			let denied = yield* reader.api.documents
				.putBlob({ params, payload: bytes })
				.pipe(Effect.result)
			expect(denied._tag).toBe("Failure")
			if (denied._tag === "Failure")
				expect(denied.failure._tag).toBe("PermissionDenied")
			yield* owner.api.workspaces.membership({
				params: { workspace, member: reader.subject },
				payload: { role: "writer", request: "writer" },
			})
			let next = new Uint8Array([7, 8, 9])
			let nextParams = { document, digest: yield* blobDigest(next) }
			yield* reader.api.documents.putBlob({ params: nextParams, payload: next })
			expect(
				yield* owner.api.documents.getBlob({ params: nextParams }),
			).toEqual(next)
			yield* owner.api.workspaces.membership({
				params: { workspace, member: reader.subject },
				payload: { role: null, request: "revoke" },
			})
			for (let task of [
				reader.api.documents.getBlob({ params }),
				reader.api.documents.putBlob({ params, payload: bytes }),
			]) {
				let denied = yield* task.pipe(Effect.result)
				expect(denied._tag).toBe("Failure")
				if (denied._tag === "Failure")
					expect(denied.failure._tag).toBe("ResourceUnavailable")
			}
			for (let bytes of [
				new Uint8Array(),
				new Uint8Array(maximumBlobChunkBytes + 1),
			]) {
				let response = yield* Effect.tryPromise(() =>
					fetch(
						new URL(
							`/api/documents/${document}/blobs/${digest}`,
							instance.server.url,
						),
						{
							method: "PUT",
							headers: {
								Authorization: "Bearer " + Redacted.value(owner.token),
								"Content-Type": "application/octet-stream",
							},
							body: bytes,
						},
					),
				)
				expect(response.status).toBe(400)
			}
		}),
	))

test("single-action HTTP reads recover register beforeimages without fetching preceding history", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(28)
			let document = "lazy-action-document",
				workspace = "lazy-action-space"
			yield* owner.api.workspaces.create({
				payload: { workspace, name: "Lazy action", request: "create" },
			})
			let birth = yield* createAction(document, owner.subject + "-lazy-birth")
			yield* owner.api.documents.create({
				payload: { workspace, action: birth },
			})
			let initial = yield* owner.api.documents.snapshot({
				params: { document },
			})
			let edit = yield* buildAction(
				yield* restoreSnapshot(initial, owner.subject + "-lazy-edit"),
				document,
				"Change playback note",
				staged => [staged.set(document, "presentationNote", "Saved note")],
			)
			yield* owner.api.documents.commit({ params: { document }, payload: edit })
			let later = yield* buildAction(
				yield* restoreSnapshot(
					yield* owner.api.documents.snapshot({ params: { document } }),
					owner.subject + "-lazy-later",
				),
				document,
				"Change background",
				staged => [staged.set(document, "background", "blue")],
			)
			yield* owner.api.documents.commit({
				params: { document },
				payload: later,
			})
			let http = yield* HttpClient.HttpClient
			let requests: string[] = []
			let transport = yield* makeDocumentTransport(
				instance.server.url.origin,
				owner.subject,
			).pipe(
				Effect.provideService(
					HttpClient.HttpClient,
					HttpClient.mapRequest(http, request => {
						requests.push(request.url)
						return HttpClientRequest.bearerToken(owner.token)(request)
					}),
				),
			)
			let fetched = yield* transport.action(document, edit.id)
			expect(fetched.id).toBe(edit.id)
			expect(fetched.document).toBe(document)
			expect(fetched.subject).toBe(owner.subject)
			expect(fetched.changes).toEqual(edit.changes)
			expect(fetched.before).toContainEqual({
				target: document,
				field: "presentationNote",
				value: "",
			})
			let current = yield* restoreSnapshot(
				yield* transport.snapshot(document),
				owner.subject + "-lazy-undo",
			)
			let undo = yield* undoAction(current, fetched)
			yield* transport.commit(undo)
			let restored = yield* restoreSnapshot(
				yield* transport.snapshot(document),
				"verify",
			)
			expect(restored.fields(document).presentationNote).toBe("")
			expect(restored.fields(document).background).toBe("blue")
			expect(restored.text(document)).toBe(current.text(document))
			expect(requests.some(url => url.includes("/history"))).toBe(false)
			expect(requests.filter(url => url.includes("/actions/"))).toHaveLength(1)
		}),
	))

test("single-action HTTP reads enforce current access and mask unrelated identities", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(29),
				reader = yield* client(30),
				outsider = yield* client(31)
			let workspace = "single-read-space",
				document = "single-read-document"
			yield* owner.api.workspaces.create({
				payload: { workspace, name: "Single reads", request: "create" },
			})
			let birth = yield* createAction(document, owner.subject + "-single-birth")
			yield* owner.api.documents.create({
				payload: { workspace, action: birth },
			})
			let other = yield* createAction(
				"single-read-other",
				owner.subject + "-single-other",
			)
			yield* owner.api.documents.create({
				payload: { workspace, action: other },
			})
			yield* owner.api.workspaces.membership({
				params: { workspace, member: reader.subject },
				payload: { role: "reader", request: "grant-reader" },
			})
			let read = yield* reader.api.documents.action({
				params: { document, action: birth.id },
			})
			expect(read.id).toBe(birth.id)
			expect(read.subject).toBe(owner.subject)
			for (let params of [
				{ document, action: other.id },
				{ document, action: "not-an-action" },
				{ document: "not-a-document", action: birth.id },
			]) {
				let denied = yield* reader.api.documents
					.action({ params })
					.pipe(Effect.result)
				if (denied._tag !== "Failure")
					throw new Error("Unrelated action became available")
				expect(denied.failure._tag).toBe("ResourceUnavailable")
			}
			let denied = yield* outsider.api.documents
				.action({ params: { document, action: birth.id } })
				.pipe(Effect.result)
			if (denied._tag !== "Failure") throw new Error("Outsider read history")
			expect(denied.failure._tag).toBe("ResourceUnavailable")
			yield* owner.api.workspaces.membership({
				params: { workspace, member: reader.subject },
				payload: { role: null, request: "revoke-reader" },
			})
			let revoked = yield* reader.api.documents
				.action({ params: { document, action: birth.id } })
				.pipe(Effect.result)
			if (revoked._tag !== "Failure")
				throw new Error("Revoked reader read history")
			expect(revoked.failure._tag).toBe("ResourceUnavailable")
			let anonymous = yield* Effect.tryPromise(() =>
				fetch(
					new URL(
						"/api/documents/" +
							document +
							"/actions/" +
							encodeURIComponent(birth.id),
						instance.server.url,
					),
				),
			)
			expect(anonymous.status).toBe(401)
		}),
	))

test("a pruned single action returns its typed history failure while current snapshot remains readable", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(32)
			let workspace = "single-pruned-space",
				document = "single-pruned-document"
			yield* owner.api.workspaces.create({
				payload: { workspace, name: "Pruned", request: "create" },
			})
			let birth = yield* createAction(document, owner.subject + "-pruned-birth")
			let position = yield* owner.api.documents.create({
				payload: { workspace, action: birth },
			})
			let initial = yield* owner.api.documents.snapshot({
				params: { document },
			})
			let later = yield* buildAction(
				yield* restoreSnapshot(initial, owner.subject + "-pruned-later"),
				document,
				"Retained note",
				staged => [staged.set(document, "presentationNote", "Still readable")],
			)
			yield* owner.api.documents.commit({
				params: { document },
				payload: later,
			})
			let before = yield* owner.api.documents.snapshot({ params: { document } })
			yield* Effect.acquireUseRelease(
				Effect.sync(() => new Database(join(directory, "documents.sqlite"))),
				database =>
					Effect.sync(() =>
						database
							.prepare(
								"DELETE FROM effect_event_journal WHERE id=(SELECT entry FROM document_actions WHERE document=? AND action=?)",
							)
							.run(document, birth.id),
					),
				database => Effect.sync(() => database.close()),
			)
			let unavailable = yield* owner.api.documents
				.action({ params: { document, action: birth.id } })
				.pipe(Effect.result)
			if (
				unavailable._tag !== "Failure" ||
				unavailable.failure._tag !== "DocumentHistoryUnavailable"
			)
				throw new Error("Pruned action was not reported as unavailable history")
			expect(unavailable.failure.reason).toBe("ActionPruned")
			expect(unavailable.failure.document).toBe(document)
			expect(unavailable.failure.action).toBe(birth.id)
			expect(unavailable.failure.position).toBe(position)
			expect(
				yield* owner.api.documents.chain({
					params: { document, action: birth.id },
				}),
			).toMatchObject({ latest: birth.id, position, depth: 0 })
			let retained = yield* owner.api.documents.action({
				params: { document, action: later.id },
			})
			expect(retained.id).toBe(later.id)
			expect(retained.changes).toEqual(later.changes)
			let allHistory = yield* owner.api.documents
				.history({ params: { document }, query: {} })
				.pipe(Effect.result)
			if (allHistory._tag !== "Failure")
				throw new Error("Pruned preceding history became available")
			expect(allHistory.failure._tag).toBe("DocumentHistoryUnavailable")
			let current = yield* Effect.acquireUseRelease(
				startServer({ port: 0, data: directory, build: false }),
				fresh =>
					Effect.gen(function* () {
						let api = yield* HttpApiClient.make(DocumentApi, {
							baseUrl: fresh.server.url,
							transformClient: client =>
								HttpClient.mapRequest(
									client,
									HttpClientRequest.bearerToken(owner.token),
								),
						})
						return yield* api.documents.snapshot({ params: { document } })
					}),
				fresh => fresh.close(),
			)
			expect(current).toEqual(before)
		}),
	))

test("native document actions refuse unreferenced cancellation and implicit document birth undo", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(33)
			let workspace = "cancel-gate-space",
				document = "cancel-gate-document"
			yield* owner.api.workspaces.create({
				payload: { workspace, name: "Cancellation gate", request: "create" },
			})
			let birth = yield* createAction(document, owner.subject + "-cancel-birth")
			yield* owner.api.documents.create({
				payload: { workspace, action: birth },
			})
			let before = yield* owner.api.documents.snapshot({ params: { document } })
			let actor = owner.subject + "-cancel-producer"
			let replica = yield* restoreSnapshot(before, actor)
			let original = birth.changes.find(change => change.kind === "text")
			if (!original) throw new Error("Missing source contribution")
			let cancellation = replica.cancel(document, original.id)
			for (let undoOf of [undefined, birth.id]) {
				let response = yield* owner.api.documents
					.commit({
						params: { document },
						payload: {
							id: cancellation.id,
							document,
							actor,
							label: "Unverified cancellation",
							changes: [cancellation],
							guards: [],
							accessGuards: [],
							...(undoOf ? { undoOf } : {}),
						},
					})
					.pipe(Effect.result)
				if (response._tag !== "Failure")
					throw new Error("An unauthorized cancellation was accepted")
				expect(response.failure._tag).toBe(
					undoOf ? "UndoUnavailable" : "DocumentConflict",
				)
				expect(
					yield* owner.api.documents.snapshot({ params: { document } }),
				).toEqual(before)
			}
			let history = yield* owner.api.documents.history({
				params: { document },
				query: {},
			})
			expect(history).toHaveLength(1)
		}),
	))

test("cold native stores migrate a legacy head once and keep its undo boundary across later edits", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(34)
			let workspace = "legacy-head-space",
				document = "legacy-head-document"
			yield* owner.api.workspaces.create({
				payload: { workspace, name: "Legacy head", request: "create" },
			})
			let birth = yield* createAction(
				document,
				owner.subject + "-legacy-head-birth",
			)
			yield* owner.api.documents.create({
				payload: { workspace, action: birth },
			})
			let initial = yield* owner.api.documents.snapshot({
				params: { document },
			})
			let current = (yield* restoreSnapshot(initial, "inspect")).checkpoint()
			let legacyState = JSON.stringify({
				...current,
				format: "alkalye-state-v1",
				targets: current.targets.map(target => ({
					id: target.id,
					created: target.created,
					updated: target.updated,
					atoms: target.atoms,
					fields: target.fields,
					removed: target.visibility.removals.flatMap(([, runs]) =>
						expandDeletions(runs),
					),
				})),
			})
			yield* Effect.acquireUseRelease(
				Effect.sync(() => new Database(join(directory, "documents.sqlite"))),
				database =>
					Effect.sync(() =>
						database
							.prepare("UPDATE document_heads SET state=? WHERE document=?")
							.run(legacyState, document),
					),
				database => Effect.sync(() => database.close()),
			)
			function freshApi(baseUrl: URL) {
				return HttpApiClient.make(DocumentApi, {
					baseUrl,
					transformClient: client =>
						HttpClient.mapRequest(
							client,
							HttpClientRequest.bearerToken(owner.token),
						),
				})
			}
			type AwaitedClient = Effect.Success<ReturnType<typeof freshApi>>
			function cold<A, E>(use: (api: AwaitedClient) => Effect.Effect<A, E>) {
				return Effect.acquireUseRelease(
					startServer({ port: 0, data: directory, build: false }),
					fresh =>
						Effect.gen(function* () {
							let api = yield* freshApi(fresh.server.url)
							return yield* use(api)
						}),
					fresh => fresh.close(),
				)
			}
			let later = yield* cold(api =>
				Effect.gen(function* () {
					let snapshot = yield* api.documents.snapshot({ params: { document } })
					let restored = yield* restoreSnapshot(
						snapshot,
						owner.subject + "-legacy-head-edit",
					)
					expect(restored.checkpoint().format).toBe("alkalye-state-v2")
					expect(
						restored.checkpoint().targets.find(target => target.id === document)
							?.visibility.floor,
					).toBe(current.clock)
					let original = birth.changes.find(change => change.kind === "text")
					if (!original) throw new Error("Missing birth source")
					expect(restored.canCancel(document, original.id)).toBe(false)
					let atom = restored.visible(document)[0]
					if (!atom) throw new Error("Missing migrated source atom")
					for (let clock of [1, current.clock]) {
						let actor = owner.subject + "-below-floor-" + clock
						let id = `${String(clock).padStart(16, "0")}:${actor}`
						let failed = yield* api.documents
							.commit({
								params: { document },
								payload: {
									id,
									document,
									actor,
									label: "Delete below migration floor",
									guards: [],
									accessGuards: [],
									changes: [
										{
											id,
											clock,
											actor,
											author: "Writer",
											time: Date.now(),
											target: document,
											kind: "text",
											insert: [],
											remove: [atom.id],
											field: "",
											value: "",
										},
									],
								},
							})
							.pipe(Effect.result)
						if (failed._tag !== "Failure")
							throw new Error("Below-floor text was accepted")
						expect(failed.failure._tag).toBe("DocumentConflict")
						expect(failed.failure.message).toContain("migration floor")
						expect(
							yield* api.documents.snapshot({ params: { document } }),
						).toEqual(snapshot)
					}

					let action = yield* buildAction(
						restored,
						document,
						"Edit after migration",
						staged => [staged.edit(document, staged.text(document) + "!")],
					)
					yield* api.documents.commit({ params: { document }, payload: action })
					return action.id
				}),
			)
			yield* cold(api =>
				Effect.gen(function* () {
					let snapshot = yield* api.documents.snapshot({ params: { document } })
					let restored = yield* restoreSnapshot(snapshot, "cold-inspect")
					expect(restored.text(document)).toBe(
						(yield* restoreSnapshot(initial, "before")).text(document) + "!",
					)
					expect(
						restored.checkpoint().targets.find(target => target.id === document)
							?.visibility.floor,
					).toBe(current.clock)
					expect(restored.canCancel(document, later)).toBe(true)
				}),
			)
		}),
	))

test("whole-document HTTP compensation lazily fetches one action, retains blobs and preserves peer deletions through cold redo", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(35)
			let document = "whole-undo-http",
				workspace = "whole-undo-space"
			yield* owner.api.workspaces.create({
				payload: { workspace, name: "Whole undo", request: "create" },
			})
			yield* owner.api.documents.create({
				payload: {
					workspace,
					action: yield* buildAction(
						new Replica(owner.subject + "-whole-birth"),
						document,
						"Create",
						staged => newDocument(staged, document, "Untitled", "ab"),
					),
				},
			})
			let bytes = new TextEncoder().encode("Immutable attachment bytes"),
				digest = yield* blobDigest(bytes)
			yield* owner.api.documents.putBlob({
				params: { document, digest },
				payload: bytes,
			})
			let reference = yield* blobReference({
				version: 1,
				type: "image/png",
				size: bytes.length,
				chunks: [{ digest, size: bytes.length }],
			})
			let state = yield* owner.api.documents.snapshot({ params: { document } })
			let action = yield* buildAction(
				yield* restoreSnapshot(state, owner.subject + "-whole-compose"),
				document,
				"Compose",
				staged => [
					...newComment(
						staged,
						"whole-undo-comment",
						document,
						"ab",
						"Note",
						"Owner",
					),
					...setFields(staged, "whole-undo-photo", {
						type: "asset",
						document,
						data: reference,
						name: "Photo.png",
					}),
					staged.edit(document, "aXYZb\n![Photo](asset:whole-undo-photo)"),
				],
			)
			yield* owner.api.documents.commit({
				params: { document },
				payload: action,
			})
			let peer = yield* client(36)
			yield* owner.api.workspaces.membership({
				params: { workspace, member: peer.subject },
				payload: { role: "writer", request: "peer-writer" },
			})
			let peerEdit = yield* buildAction(
				yield* restoreSnapshot(
					yield* peer.api.documents.snapshot({ params: { document } }),
					peer.subject + "-whole-delete",
				),
				document,
				"Peer deletion",
				staged => [
					staged.edit(document, "aXZb\n![Photo](asset:whole-undo-photo)"),
				],
			)
			yield* peer.api.documents.commit({
				params: { document },
				payload: peerEdit,
			})
			let http = yield* HttpClient.HttpClient,
				requests: string[] = []
			let remote = yield* makeDocumentTransport(
				instance.server.url.origin,
				owner.subject,
			).pipe(
				Effect.provideService(
					HttpClient.HttpClient,
					HttpClient.mapRequest(http, request => {
						requests.push(request.url)
						return HttpClientRequest.bearerToken(owner.token)(request)
					}),
				),
			)
			let original = yield* remote.action(document, action.id)
			expect(yield* remote.chain(document, action.id)).toMatchObject({
				from: action.id,
				latest: action.id,
				depth: 0,
				log: state.log,
			})
			let cold = yield* restoreSnapshot(
				yield* remote.snapshot(document),
				owner.subject + "-whole-undo",
			)
			let undo = yield* undoAction(cold, original)
			let incomplete = yield* owner.api.documents
				.commit({
					params: { document },
					payload: { ...undo, changes: [undo.changes[0]] },
				})
				.pipe(Effect.result)
			expect(incomplete._tag).toBe("Failure")
			if (incomplete._tag === "Failure")
				expect(incomplete.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "Stale",
				})
			let position = yield* remote.commit(undo)
			expect(yield* remote.commit(undo)).toBe(position)
			expect(yield* remote.chain(document, action.id)).toMatchObject({
				from: action.id,
				latest: undo.id,
				position,
				depth: 1,
			})
			let undone = yield* remote.snapshot(document)
			let restored = yield* restoreSnapshot(undone, "inspect")
			expect(restored.text(document)).toBe("ab")
			expect(restored.fields("whole-undo-comment").type).toBe("deleted")
			expect(restored.fields("whole-undo-photo").type).toBe("deleted")
			expect(
				yield* owner.api.documents.getBlob({ params: { document, digest } }),
			).toEqual(bytes)
			let redo = yield* undoAction(
				yield* restoreSnapshot(undone, owner.subject + "-whole-redo"),
				yield* remote.action(document, undo.id),
			)
			let redoPosition = yield* remote.commit(redo)
			expect(yield* remote.commit(undo)).toBe(position)
			expect(redoPosition).toBeGreaterThan(position)
			expect(yield* remote.chain(document, action.id)).toMatchObject({
				from: action.id,
				latest: redo.id,
				position: redoPosition,
				depth: 2,
			})
			expect(yield* remote.chain(document, undo.id)).toMatchObject({
				from: undo.id,
				latest: redo.id,
				depth: 1,
			})
			let redone = yield* restoreSnapshot(
				yield* remote.snapshot(document),
				"inspect",
			)
			expect(redone.text(document)).toBe(
				"aXZb\n![Photo](asset:whole-undo-photo)",
			)
			expect(redone.fields("whole-undo-photo").data).toBe(reference)
			expect(redone.fields("whole-undo-comment").body).toBe("Note")
			let reuse = yield* remote
				.commit(
					yield* undoAction(redone, original, owner.subject + "-whole-reuse"),
				)
				.pipe(Effect.result)
			expect(reuse._tag).toBe("Failure")
			if (reuse._tag === "Failure")
				expect(reuse.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "Superseded",
				})
			expect(requests.some(url => url.includes("/history"))).toBe(false)
			expect(
				requests.filter(
					url => /\/actions\//.test(url) && !url.endsWith("/chain"),
				),
			).toHaveLength(2)
			expect(requests.filter(url => url.endsWith("/chain"))).toHaveLength(4)
			let fresh = yield* Effect.acquireUseRelease(
				startServer({ port: 0, data: directory, build: false }),
				server =>
					HttpApiClient.make(DocumentApi, {
						baseUrl: server.server.url,
						transformClient: client =>
							HttpClient.mapRequest(
								client,
								HttpClientRequest.bearerToken(owner.token),
							),
					}).pipe(
						Effect.flatMap(api =>
							Effect.gen(function* () {
								expect(
									yield* api.documents.chain({
										params: { document, action: action.id },
									}),
								).toMatchObject({
									latest: redo.id,
									position: redoPosition,
									depth: 2,
								})
								return yield* api.documents.snapshot({ params: { document } })
							}),
						),
					),
				server => server.close(),
			)
			expect(
				(yield* restoreSnapshot(fresh, "after-restart")).revision(document),
			).toBe(redone.revision(document))
		}),
	))

test("Effect routing accepts encoded document identifiers and native action ids at their legal bounds", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(39),
				document = "boundary" + ":".repeat(192),
				actor = owner.subject + "-" + "x".repeat(56)
			expect(document).toHaveLength(200)
			expect(actor).toHaveLength(100)
			let workspace = "router-boundary-space"
			yield* owner.api.workspaces.create({
				payload: { workspace, name: "Router boundary", request: "create" },
			})
			let birth = yield* buildAction(
				new Replica(actor),
				document,
				"Create",
				staged => newDocument(staged, document, "Untitled", "Source"),
			)
			expect(birth.id).toHaveLength(117)
			yield* owner.api.documents.create({
				payload: { workspace, action: birth },
			})
			expect(
				(yield* owner.api.documents.action({
					params: { document, action: birth.id },
				})).id,
			).toBe(birth.id)
			expect(
				yield* owner.api.documents.chain({
					params: { document, action: birth.id },
				}),
			).toMatchObject({ document, from: birth.id, latest: birth.id })
			expect(
				(yield* restoreSnapshot(
					yield* owner.api.documents.snapshot({ params: { document } }),
					"inspect",
				)).text(document),
			).toBe("Source")
			let missing = yield* owner.api.documents
				.action({ params: { document, action: "x".repeat(128) } })
				.pipe(Effect.result)
			expect(missing._tag).toBe("Failure")
			if (missing._tag === "Failure")
				expect(missing.failure._tag).toBe("ResourceUnavailable")
		}),
	))

test("account preference events merge only changed fields, retry exactly and remain private", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(70)
			let other = yield* client(71)
			let before = yield* owner.api.preferences.get()
			expect(before.editor.smartPairs).toBe(true)
			let request = "preferences-test-" + crypto.randomUUID()
			let first = yield* owner.api.preferences.save({
				payload: {
					request,
					patch: { name: "Native writer", editor: { smartPairs: false } },
				},
			})
			let second = yield* owner.api.preferences.save({
				payload: {
					request: crypto.randomUUID(),
					patch: { appearance: "light", editor: { lineWidth: 80 } },
				},
			})
			expect(second).toBeGreaterThan(first)
			expect(
				yield* owner.api.preferences.save({
					payload: {
						request,
						patch: { name: "Native writer", editor: { smartPairs: false } },
					},
				}),
			).toBe(first)
			let saved = yield* owner.api.preferences.get()
			expect(saved.name).toBe("Native writer")
			expect(saved.appearance).toBe("light")
			expect(saved.editor.smartPairs).toBe(false)
			expect(saved.editor.lineWidth).toBe(80)
			expect(saved.editor.lineHeight).toBe(before.editor.lineHeight)
			expect((yield* other.api.preferences.get()).name).toBe(before.name)
			expect(
				(yield* owner.api.preferences
					.save({ payload: { request, patch: { name: "Changed retry" } } })
					.pipe(Effect.result))._tag,
			).toBe("Failure")
			expect((yield* owner.api.preferences.get()).name).toBe("Native writer")
		}),
	))
