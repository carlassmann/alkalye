import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import { WorkspaceStore } from "../src/server/document-store"
import { sqliteLayer } from "../src/platform/sqlite"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { Identity } from "../src/shared/workspace"
import { Replica } from "../src/shared/crdt"
import { buildAction } from "../src/shared/document-actions"
import { blobDigest } from "../src/shared/document-blobs"
import { newDocument } from "../src/shared/documents"

let directory = await mkdtemp(join(tmpdir(), "alkalye-native-blobs-"))
afterAll(() => rm(directory, { recursive: true, force: true }))
function infrastructure(
	name: string,
	maximumBytes = 4,
	maximumAccountBytes = 16,
	maximumServerBytes = 64,
) {
	let filename = join(directory, name + ".sqlite")
	return Layer.mergeAll(
		WorkspaceStore.layer(filename),
		sqliteLayer(filename),
		webCryptoLayer,
	).pipe(
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					ALKALYE_DOCUMENT_BLOB_BYTES: maximumBytes,
					ALKALYE_ACCOUNT_BLOB_BYTES: maximumAccountBytes,
					ALKALYE_SERVER_BLOB_BYTES: maximumServerBytes,
				}),
			),
		),
	)
}
function run<A, E>(
	task: Effect.Effect<A, E, WorkspaceStore | SqlClient.SqlClient | Identity>,
	name: string,
	maximumBytes = 4,
	maximumAccountBytes = 16,
	maximumServerBytes = 64,
) {
	return Effect.runPromise(
		task.pipe(
			Effect.provide(
				infrastructure(
					name,
					maximumBytes,
					maximumAccountBytes,
					maximumServerBytes,
				),
			),
			Effect.provideService(Identity, {
				subject: "owner",
				actors: ["owner", "owner-other"],
			}),
		),
	)
}
function seed() {
	return WorkspaceStore.use(store =>
		Effect.gen(function* () {
			yield* store.create("space", "Blobs", "create")
			yield* store.createDocument(
				"space",
				yield* buildAction(new Replica("owner"), "doc", "Create", staged =>
					newDocument(staged, "doc", "Untitled", "Source"),
				),
			)
		}),
	)
}
test("concurrent native chunk writes share a durable document quota and retries do not charge twice", async () => {
	await run(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]
			let ids = yield* Effect.forEach(chunks, blobDigest).pipe(
				Effect.provide(webCryptoLayer),
			)
			let results = yield* Effect.forEach(
				chunks,
				(bytes, index) =>
					store.putBlob("doc", ids[index] ?? "", bytes).pipe(Effect.result),
				{ concurrency: 2 },
			)
			expect(results.filter(result => result._tag === "Success").length).toBe(1)
			let successful = results.findIndex(result => result._tag === "Success")
			let bytes = chunks[successful],
				digest = ids[successful]
			if (!bytes || !digest) throw new Error("Missing successful upload")
			yield* store.putBlob("doc", digest, bytes)
			expect(yield* store.getBlob("doc", digest)).toEqual(bytes)
			expect(
				(yield* store.missingBlobs(
					"doc",
					ids.map(digest => ({ digest, size: 3 })),
				)).length,
			).toBe(1)
		}),
		"quota",
	)
})
test("owner account quota covers separate workspaces and charges inherited writers to the workspace owner", async () => {
	await run(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			yield* store.create("other-space", "Other", "create-other")
			yield* store.createDocument(
				"other-space",
				yield* buildAction(
					new Replica("owner-other"),
					"other-doc",
					"Create",
					staged => newDocument(staged, "other-doc", "Untitled", "Source"),
				),
			)
			yield* store.membership("other-space", "writer", "writer", "grant")
			let first = new Uint8Array([1, 2, 3]),
				second = new Uint8Array([4, 5, 6])
			let digest = yield* blobDigest(first).pipe(Effect.provide(webCryptoLayer))
			let otherDigest = yield* blobDigest(second).pipe(
				Effect.provide(webCryptoLayer),
			)
			yield* store.putBlob("doc", digest, first)
			let denied = yield* store
				.putBlob("other-doc", otherDigest, second)
				.pipe(
					Effect.provideService(Identity, { subject: "writer", actors: [] }),
					Effect.result,
				)
			expect(denied._tag).toBe("Failure")
			if (
				denied._tag === "Failure" &&
				denied.failure._tag === "BlobQuotaExceeded"
			)
				expect(denied.failure.scope).toBe("account")
			else throw new Error("Missing typed account quota failure")
			expect(
				yield* store.missingBlobs("other-doc", [
					{ digest: otherDigest, size: second.length },
				]),
			).toEqual([otherDigest])
			yield* store.putBlob("doc", digest, first)
			expect(yield* store.getBlob("doc", digest)).toEqual(first)
		}),
		"account-quota",
		4,
		4,
	)
})
test("concurrent uploads across workspaces cannot exceed their shared owner account quota", async () => {
	await run(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			yield* store.create("other-space", "Other", "create-other")
			yield* store.createDocument(
				"other-space",
				yield* buildAction(
					new Replica("owner-other"),
					"other-doc",
					"Create",
					staged => newDocument(staged, "other-doc", "Untitled", "Source"),
				),
			)
			let uploads = [
				{ document: "doc", bytes: new Uint8Array([1, 2, 3]) },
				{ document: "other-doc", bytes: new Uint8Array([4, 5, 6]) },
			]
			let results = yield* Effect.forEach(
				uploads,
				upload =>
					Effect.gen(function* () {
						let digest = yield* blobDigest(upload.bytes).pipe(
							Effect.provide(webCryptoLayer),
						)
						let result = yield* store
							.putBlob(upload.document, digest, upload.bytes)
							.pipe(Effect.result)
						return { ...upload, digest, result }
					}),
				{ concurrency: 2 },
			)
			expect(
				results.filter(upload => upload.result._tag === "Success"),
			).toHaveLength(1)
			let rejected = results.find(upload => upload.result._tag === "Failure")
			if (
				!rejected ||
				rejected.result._tag !== "Failure" ||
				rejected.result.failure._tag !== "BlobQuotaExceeded"
			)
				throw new Error("Missing concurrent account quota failure")
			expect(rejected.result.failure.scope).toBe("account")
			expect(
				yield* store.missingBlobs(rejected.document, [
					{ digest: rejected.digest, size: rejected.bytes.length },
				]),
			).toEqual([rejected.digest])
		}),
		"concurrent-account-quota",
		8,
		4,
	)
})
test("server quota covers concurrent uploads from independent account owners", async () => {
	await run(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let other = { subject: "another-owner", actors: ["another-owner"] }
			yield* Effect.gen(function* () {
				yield* store.create("other-space", "Other", "create-other")
				yield* store.createDocument(
					"other-space",
					yield* buildAction(
						new Replica("another-owner"),
						"other-doc",
						"Create",
						staged => newDocument(staged, "other-doc", "Untitled", "Source"),
					),
				)
			}).pipe(Effect.provideService(Identity, other))
			let uploads = [
				{
					document: "doc",
					identity: { subject: "owner", actors: ["owner"] },
					bytes: new Uint8Array([1, 2, 3]),
				},
				{
					document: "other-doc",
					identity: other,
					bytes: new Uint8Array([4, 5, 6]),
				},
			]
			let results = yield* Effect.forEach(
				uploads,
				upload =>
					Effect.gen(function* () {
						let digest = yield* blobDigest(upload.bytes).pipe(
							Effect.provide(webCryptoLayer),
						)
						return yield* store
							.putBlob(upload.document, digest, upload.bytes)
							.pipe(
								Effect.provideService(Identity, upload.identity),
								Effect.result,
							)
					}),
				{ concurrency: 2 },
			)
			expect(results.filter(result => result._tag === "Success")).toHaveLength(
				1,
			)
			let rejected = results.find(result => result._tag === "Failure")
			if (
				!rejected ||
				rejected._tag !== "Failure" ||
				rejected.failure._tag !== "BlobQuotaExceeded"
			)
				throw new Error("Missing typed server quota failure")
			expect(rejected.failure.scope).toBe("server")
		}),
		"server-quota",
		8,
		8,
		4,
	)
})
test("native chunks survive closing and reopening the SQLite engine without the event payload table", async () => {
	let bytes = new Uint8Array([10, 20, 30, 40])
	let digest = await Effect.runPromise(
		blobDigest(bytes).pipe(Effect.provide(webCryptoLayer)),
	)
	await run(
		Effect.gen(function* () {
			yield* seed()
			let store = yield* WorkspaceStore
			yield* store.putBlob("doc", digest, bytes)
			let sql = yield* SqlClient.SqlClient
			yield* sql`DROP TABLE effect_event_journal`
		}),
		"restart",
	)
	await run(
		WorkspaceStore.use(store => store.getBlob("doc", digest)).pipe(
			Effect.tap(downloaded =>
				Effect.sync(() => expect(downloaded).toEqual(bytes)),
			),
		),
		"restart",
	)
})
test("corrupted durable blob bytes are reported missing and repaired only by digest-verified incoming bytes", async () => {
	await run(
		Effect.gen(function* () {
			yield* seed()
			let store = yield* WorkspaceStore
			let bytes = new Uint8Array([1, 2, 3])
			let digest = yield* blobDigest(bytes).pipe(Effect.provide(webCryptoLayer))
			yield* store.putBlob("doc", digest, bytes)
			let sql = yield* SqlClient.SqlClient
			yield* sql`UPDATE document_blobs SET bytes=${new Uint8Array([9, 9, 9])} WHERE document=${"doc"} AND digest=${digest}`
			let corrupt = yield* store.getBlob("doc", digest).pipe(Effect.result)
			expect(corrupt._tag).toBe("Failure")
			if (corrupt._tag === "Failure")
				expect(corrupt.failure._tag).toBe("BlobCorrupt")
			expect(
				yield* store.missingBlobs("doc", [{ digest, size: bytes.length }]),
			).toEqual([digest])
			yield* store.putBlob("doc", digest, bytes)
			expect(yield* store.getBlob("doc", digest)).toEqual(bytes)
			expect(
				yield* store.missingBlobs("doc", [{ digest, size: bytes.length }]),
			).toEqual([])
		}),
		"corrupt",
	)
})
test("missing chunk discovery repairs wrong-size and non-binary rows without downloading them", async () => {
	await run(
		Effect.gen(function* () {
			yield* seed()
			let store = yield* WorkspaceStore
			let sql = yield* SqlClient.SqlClient
			let bytes = new Uint8Array([1, 2, 3])
			let digest = yield* blobDigest(bytes).pipe(Effect.provide(webCryptoLayer))
			let chunks = [{ digest, size: bytes.length }]
			yield* store.putBlob("doc", digest, bytes)
			yield* sql`UPDATE document_blobs SET bytes=${new Uint8Array([9])} WHERE document=${"doc"} AND digest=${digest}`
			expect(yield* store.missingBlobs("doc", chunks)).toEqual([digest])
			yield* store.putBlob("doc", digest, bytes)
			expect(yield* store.missingBlobs("doc", chunks)).toEqual([])
			yield* sql`UPDATE document_blobs SET bytes=${"bad"} WHERE document=${"doc"} AND digest=${digest}`
			expect(yield* store.missingBlobs("doc", chunks)).toEqual([digest])
			yield* store.putBlob("doc", digest, bytes)
			expect(yield* store.getBlob("doc", digest)).toEqual(bytes)
			yield* store.membership("space", "reader", "reader", "grant-reader")
			let reader = yield* store
				.missingBlobs("doc", chunks)
				.pipe(
					Effect.provideService(Identity, { subject: "reader", actors: [] }),
					Effect.result,
				)
			if (reader._tag !== "Failure")
				throw new Error("Reader discovered upload state")
			expect(reader.failure._tag).toBe("PermissionDenied")
			let contradictory = yield* store
				.missingBlobs("doc", [...chunks, { digest, size: 2 }])
				.pipe(Effect.result)
			if (contradictory._tag !== "Failure")
				throw new Error("Contradictory sizes accepted")
			expect(contradictory.failure._tag).toBe("DocumentConflict")
		}),
		"wrong-size",
	)
})
