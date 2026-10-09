import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as SqlClient from "effect/sql/SqlClient"
import { sqliteLayer } from "../src/platform/sqlite"
import { webCryptoLayer } from "../src/platform/web-crypto"
import {
	WorkspaceStore,
	DocumentMaintenance,
} from "../src/server/document-store"
import { WorkspaceTransfers } from "../src/server/workspace-transfer"
import { buildAction } from "../src/shared/document-actions"
import { blobDigest } from "../src/shared/document-blobs"
import { newDocument } from "../src/shared/documents"
import { Replica } from "../src/shared/crdt"
import { Identity } from "../src/shared/workspace"

let directory = await mkdtemp(join(tmpdir(), "alkalye-blob-quota-"))
afterAll(() => rm(directory, { recursive: true, force: true }))
function runtime(name: string, serverLimit = 12) {
	return ManagedRuntime.make(
		Layer.mergeAll(
			WorkspaceStore.live,
			WorkspaceTransfers.live,
			DocumentMaintenance.live,
		).pipe(
			Layer.provideMerge(sqliteLayer(join(directory, name + ".sqlite"))),
			Layer.provideMerge(webCryptoLayer),
			Layer.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({
						ALKALYE_DOCUMENT_BLOB_BYTES: 8,
						ALKALYE_ACCOUNT_BLOB_BYTES: 8,
						ALKALYE_SERVER_BLOB_BYTES: serverLimit,
					}),
				),
			),
		),
	)
}
function principal<A, E, R>(task: Effect.Effect<A, E, R>, subject = "first") {
	return task.pipe(
		Effect.provideService(Identity, { subject, actors: [subject] }),
	)
}
function createDocument(
	store: WorkspaceStore["Service"],
	document: string,
	workspace: string,
	actor = "first",
) {
	return Identity.use(identity =>
		buildAction(
			new Replica(actor + "-" + document),
			document,
			"Create",
			replica => newDocument(replica, document, "", "Seed"),
		).pipe(
			Effect.flatMap(action => store.createDocument(workspace, action)),
			Effect.provideService(Identity, {
				...identity,
				actors: [...identity.actors, actor + "-" + document],
			}),
		),
	)
}

test("native attachment quota migration preserves idempotent bytes and follows public owner moves", async () => {
	let first = runtime("migration")
	try {
		await first.runPromise(
			principal(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					yield* store.create("source", "Source", "source")
					yield* createDocument(store, "moving", "source")
					yield* createDocument(store, "remaining", "source")
					let bytes = new Uint8Array([1, 2, 3, 4])
					let digest = yield* blobDigest(bytes)
					yield* store.putBlob("moving", digest, bytes)
					yield* store.putBlob("moving", digest, bytes)
					yield* store.putBlob("remaining", digest, bytes)
					expect(
						yield* store
							.putBlob(
								"remaining",
								yield* blobDigest(new Uint8Array([5])),
								new Uint8Array([5]),
							)
							.pipe(
								Effect.catchTag("BlobQuotaExceeded", error =>
									Effect.succeed(error.scope),
								),
							),
					).toBe("account")
					let sql = yield* SqlClient.SqlClient
					let triggers = yield* sql<{
						name: string
					}>`SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'document_blob_%'`
					for (let trigger of triggers)
						yield* sql`DROP TRIGGER ${sql(trigger.name)}`
					yield* sql`DROP TABLE document_blob_document_usage`
					yield* sql`DROP TABLE document_blob_account_usage`
					yield* sql`DROP TABLE document_blob_server_usage`
					yield* sql`DELETE FROM document_blob_migrations WHERE migration_id=4`
				}),
			),
		)
	} finally {
		await first.dispose()
	}
	let reopened = runtime("migration")
	try {
		await reopened.runPromise(
			principal(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					let bytes = new Uint8Array([1, 2, 3, 4])
					let digest = yield* blobDigest(bytes)
					yield* store.putBlob("moving", digest, bytes)
					expect(Array.from(yield* store.getBlob("moving", digest))).toEqual([
						1, 2, 3, 4,
					])
					yield* principal(
						store.create("destination", "Destination", "destination"),
						"second",
					)
					yield* principal(
						store.membership("destination", "first", "writer", "grant"),
						"second",
					)
					yield* store.moveDocument("moving", "destination", "move")
					let three = new Uint8Array([6, 7, 8])
					yield* store.putBlob("remaining", yield* blobDigest(three), three)
					expect(
						yield* store
							.putBlob(
								"moving",
								yield* blobDigest(new Uint8Array([9, 10])),
								new Uint8Array([9, 10]),
							)
							.pipe(
								Effect.catchTag("BlobQuotaExceeded", error =>
									Effect.succeed(error.scope),
								),
							),
					).toBe("server")
					expect(
						yield* store
							.putBlob(
								"remaining",
								yield* blobDigest(new Uint8Array([11, 12])),
								new Uint8Array([11, 12]),
							)
							.pipe(
								Effect.catchTag("BlobQuotaExceeded", error =>
									Effect.succeed(error.scope),
								),
							),
					).toBe("document")
				}),
			),
		)
	} finally {
		await reopened.dispose()
	}
})

test("native missing-chunk discovery retains every descriptor across bounded SQL queries", async () => {
	let instance = runtime("descriptors")
	try {
		await instance.runPromise(
			principal(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					yield* store.create("space", "Space", "create")
					yield* createDocument(store, "doc", "space")
					let descriptors = yield* Effect.forEach(
						Array.from({ length: 220 }, (_, index) => index),
						index =>
							blobDigest(new Uint8Array([index])).pipe(
								Effect.map(digest => ({ digest, size: 1 })),
							),
					)
					let first = descriptors[0]
					if (!first) throw new Error("Missing first descriptor")
					yield* store.putBlob("doc", first.digest, new Uint8Array([0]))
					expect(yield* store.missingBlobs("doc", descriptors)).toEqual(
						descriptors.slice(1).map(chunk => chunk.digest),
					)
					expect(
						(yield* store
							.missingBlobs("doc", [...descriptors, { ...first, size: 2 }])
							.pipe(Effect.exit))._tag,
					).toBe("Failure")
				}),
			),
		)
	} finally {
		await instance.dispose()
	}
})

test("retired cross-owner copies free quota and cyclic replacement counts retained chunks once", async () => {
	let source = runtime("retired-source", 8)
	let target = runtime("retired-target", 8)
	try {
		let digest = await source.runPromise(
			blobDigest(new Uint8Array([1, 2, 3, 4])),
		)
		await source.runPromise(
			principal(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					yield* store.create("from", "From", "from")
					yield* createDocument(store, "travel", "from")
					yield* store.putBlob("travel", digest, new Uint8Array([1, 2, 3, 4]))
				}),
			),
		)
		await target.runPromise(
			principal(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					yield* store.create("to", "To", "to")
					yield* store.membership("to", "first", "writer", "writer")
				}),
				"second",
			),
		)
		let bundle = await source.runPromise(
			principal(
				WorkspaceTransfers.use(t => t.stageDocumentMove("travel", "to", "out")),
			),
		)
		await target.runPromise(
			principal(WorkspaceTransfers.use(t => t.importDocumentMove(bundle))),
		)
		await target.runPromise(
			principal(
				WorkspaceTransfers.use(t => t.activateDocumentMove("travel", "out")),
			),
		)
		await target.runPromise(
			principal(
				DocumentMaintenance.use(m =>
					m.recordImportedMove("travel", "from", "to", "out"),
				),
			),
		)
		await source.runPromise(
			principal(
				WorkspaceTransfers.use(t => t.retireDocumentMove("travel", "out")),
			),
		)
		await source.runPromise(
			principal(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					yield* createDocument(store, "fresh", "from")
					let bytes = new Uint8Array([5, 6, 7, 8, 9])
					yield* store.putBlob("fresh", yield* blobDigest(bytes), bytes)
					expect(
						Array.from(yield* store.getBlob("fresh", yield* blobDigest(bytes))),
					).toEqual([5, 6, 7, 8, 9])
				}),
			),
		)
		let returning = await target.runPromise(
			principal(
				WorkspaceTransfers.use(t =>
					t.stageDocumentMove("travel", "from", "back"),
				),
			),
		)
		await source.runPromise(
			principal(WorkspaceTransfers.use(t => t.importDocumentMove(returning))),
		)
		await source.runPromise(
			principal(
				WorkspaceTransfers.use(t => t.activateDocumentMove("travel", "back")),
			),
		)
		await source.runPromise(
			principal(
				DocumentMaintenance.use(m =>
					m.recordImportedMove("travel", "to", "from", "back"),
				),
			),
		)
		await target.runPromise(
			principal(
				WorkspaceTransfers.use(t => t.retireDocumentMove("travel", "back")),
			),
		)
		await source.runPromise(
			principal(
				WorkspaceStore.use(store =>
					store
						.getBlob("travel", digest)
						.pipe(
							Effect.map(bytes =>
								expect(Array.from(bytes)).toEqual([1, 2, 3, 4]),
							),
						),
				),
			),
		)
		await target.runPromise(
			principal(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					yield* createDocument(store, "target-fresh", "to", "second")
					let bytes = new Uint8Array([10, 11, 12, 13, 14])
					yield* store.putBlob("target-fresh", yield* blobDigest(bytes), bytes)
				}),
				"second",
			),
		)
	} finally {
		await Promise.all([source.dispose(), target.dispose()])
	}
})
