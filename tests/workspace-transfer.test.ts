import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
import { Identity } from "../src/shared/workspace"
import { Replica } from "../src/shared/crdt"
import {
	buildAction,
	restoreSnapshot,
	undoAction,
} from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"
import { blobDigest } from "../src/shared/document-blobs"

let directory = await mkdtemp(join(tmpdir(), "alkalye-transfer-"))
afterAll(() => rm(directory, { recursive: true, force: true }))
function runtime(name: string) {
	return ManagedRuntime.make(
		Layer.mergeAll(
			WorkspaceStore.live,
			WorkspaceTransfers.live,
			DocumentMaintenance.live,
		).pipe(
			Layer.provideMerge(sqliteLayer(join(directory, name + ".sqlite"))),
			Layer.provideMerge(webCryptoLayer),
		),
	)
}
function owner<A, E, R>(task: Effect.Effect<A, E, R>) {
	return task.pipe(
		Effect.provideService(Identity, {
			subject: "owner",
			actors: ["owner", "owner-edit"],
		}),
	)
}
test("frozen workspace transfers preserve accepted history, ACL, Undo and attachments across cold owners", async () => {
	let source = runtime("source")
	let target = runtime("target")
	try {
		let saved = await source.runPromise(
			owner(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					let transfer = yield* WorkspaceTransfers
					yield* store.create("space", "Migration", "create")
					yield* store.membership("space", "writer", "writer", "grant")
					let creation = yield* buildAction(
						new Replica("owner"),
						"doc",
						"Create",
						r => newDocument(r, "doc", "Title", "Body😀"),
					)
					yield* store.createDocument("space", creation)
					let snapshot = yield* store.snapshot("doc")
					if (!snapshot)
						return yield* Effect.fail(new Error("Missing created snapshot"))
					let replica = yield* restoreSnapshot(snapshot, "owner-edit")
					let initialSource = replica.text("doc")
					let edit = yield* buildAction(replica, "doc", "Typing", r => [
						r.edit("doc", initialSource.replace("Body", "Bodyx")),
					])
					let position = yield* store.commit(edit)
					let bytes = new Uint8Array([1, 2, 255])
					let digest = yield* blobDigest(bytes)
					yield* store.putBlob("doc", digest, bytes)
					yield* store.createInvitation(
						"invite",
						{ workspace: "space" },
						"reader",
						digest,
					)
					yield* transfer.freezeWorkspace("space", 1)
					let refused = yield* store
						.rename("space", "No", "rename")
						.pipe(Effect.exit)
					expect(refused._tag).toBe("Failure")
					let frozenEdit = yield* store.commit(edit).pipe(Effect.exit)
					expect(frozenEdit._tag).toBe("Failure")
					let blockedBlob = yield* store
						.putBlob("doc", digest, bytes)
						.pipe(Effect.exit)
					expect(blockedBlob._tag).toBe("Failure")
					let blockedMember = yield* store
						.membership("space", "other", "writer", "late-grant")
						.pipe(Effect.exit)
					expect(blockedMember._tag).toBe("Failure")
					let bundle = yield* transfer.exportWorkspace("space", 1)
					let retriedBundle = yield* transfer.exportWorkspace("space", 1)
					expect(retriedBundle).toEqual(bundle)
					return { bundle, edit, position, digest, initialSource }
				}),
			),
		)
		await target.runPromise(
			Effect.gen(function* () {
				let store = yield* WorkspaceStore
				let transfers = yield* WorkspaceTransfers
				let sql = yield* SqlClient.SqlClient
				let identity = yield* sql<{
					publicKey: string
				}>`SELECT publicKey FROM journal_identity WHERE id=1`
				yield* transfers.importWorkspace(saved.bundle)
				yield* transfers.importWorkspace(saved.bundle)
				let changed = yield* transfers
					.importWorkspace({
						...saved.bundle,
						workspaces: saved.bundle.workspaces.map(row => ({
							...row,
							name: "Changed",
						})),
					})
					.pipe(Effect.exit)
				expect(changed._tag).toBe("Failure")
				expect(
					yield* sql<{
						publicKey: string
					}>`SELECT publicKey FROM journal_identity WHERE id=1`,
				).toEqual(identity)
				// Root publishes routing only after its import receipt is durable.
				yield* transfers.activateImportedWorkspace("space", 1)
				yield* transfers.activateImportedWorkspace("space", 1)
				expect(yield* owner(store.commit(saved.edit))).toBe(saved.position)
				expect(yield* owner(store.accessRole("doc", "writer"))).toBe("writer")
				expect(yield* owner(store.getBlob("doc", saved.digest))).toEqual(
					new Uint8Array([1, 2, 255]),
				)
				let snapshot = yield* owner(store.snapshot("doc"))
				if (!snapshot)
					return yield* Effect.fail(new Error("Missing imported snapshot"))
				expect((yield* restoreSnapshot(snapshot, "read")).text("doc")).toBe(
					saved.initialSource.replace("Body", "Bodyx"),
				)
				let original = yield* owner(store.action("doc", saved.edit.id))
				if (!original)
					return yield* Effect.fail(new Error("Missing imported action"))
				let inverse = yield* undoAction(
					yield* restoreSnapshot(snapshot, "owner-edit"),
					original,
				)
				yield* owner(store.commit(inverse))
				let restored = yield* owner(store.snapshot("doc"))
				if (!restored)
					return yield* Effect.fail(new Error("Missing Undo snapshot"))
				expect((yield* restoreSnapshot(restored, "read")).text("doc")).toBe(
					saved.initialSource,
				)
			}),
		)
	} finally {
		await source.dispose()
		await target.dispose()
	}
	let cold = runtime("target")
	try {
		await cold.runPromise(
			owner(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					let snapshot = yield* store.snapshot("doc")
					if (!snapshot)
						return yield* Effect.fail(new Error("Missing cold snapshot"))
					expect((yield* restoreSnapshot(snapshot, "cold")).text("doc")).toBe(
						'---\ntitle: "Title"\n---\nBody😀',
					)
					expect((yield* store.history("doc")).length).toBe(3)
					expect(
						(yield* store.invitations({ workspace: "space" })).length,
					).toBe(1)
				}),
			),
		)
	} finally {
		await cold.dispose()
	}
})

test("frozen personal export retries remain immutable while identity preferences advance", async () => {
	let source = runtime("preferences")
	try {
		await source.runPromise(
			owner(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					let transfers = yield* WorkspaceTransfers
					yield* store.savePreferences({ name: "Before" }, "before")
					yield* transfers.freezeWorkspace("personal-owner", 1)
					let initial = yield* transfers.exportWorkspace("personal-owner", 1)
					yield* store.savePreferences({ name: "After" }, "after")
					expect((yield* store.preferences()).name).toBe("After")
					expect(yield* transfers.exportWorkspace("personal-owner", 1)).toEqual(
						initial,
					)
				}),
			),
		)
	} finally {
		await source.dispose()
	}
})

test("document moves stage current permissions and preserve retry identities under a fresh destination log", async () => {
	let source = runtime("move-source")
	let target = runtime("move-target")
	function destination<A, E, R>(task: Effect.Effect<A, E, R>) {
		return task.pipe(
			Effect.provideService(Identity, {
				subject: "destination-owner",
				actors: ["destination-owner"],
			}),
		)
	}
	try {
		let prepared = await source.runPromise(
			owner(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					let transfers = yield* WorkspaceTransfers
					yield* store.create("from", "Source", "create-from")
					yield* store.membership("from", "writer", "writer", "source-writer")
					let birth = yield* buildAction(
						new Replica("owner"),
						"moving",
						"Create",
						r => newDocument(r, "moving", "Moved", "Original😀"),
					)
					yield* store.createDocument("from", birth)
					let snapshot = yield* store.snapshot("moving")
					if (!snapshot)
						return yield* Effect.fail(new Error("Missing source snapshot"))
					let replica = yield* restoreSnapshot(snapshot, "owner-edit")
					let edit = yield* buildAction(replica, "moving", "Edit", r => [
						r.edit("moving", replica.text("moving") + "x"),
					])
					let oldPosition = yield* store.commit(edit)
					let bytes = new Uint8Array([4, 5, 6])
					let digest = yield* blobDigest(bytes)
					yield* store.putBlob("moving", digest, bytes)
					yield* store.createInvitation(
						"move-invite",
						{ document: "moving" },
						"reader",
						digest,
					)
					let writerDenied = yield* transfers
						.stageDocumentMove("moving", "to", "writer-attempt")
						.pipe(
							Effect.provideService(Identity, {
								subject: "writer",
								actors: [],
							}),
							Effect.exit,
						)
					expect(writerDenied._tag).toBe("Failure")
					return {
						edit,
						oldPosition,
						log: snapshot.log,
						source: replica.text("moving") + "x",
						digest,
					}
				}),
			),
		)
		await target.runPromise(
			destination(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					yield* store.create("to", "Destination", "create-to")
					yield* store.membership("to", "owner", "writer", "grant-owner")
					let occupied = yield* buildAction(
						new Replica("destination-owner"),
						"occupied",
						"Create",
						r => newDocument(r, "occupied", "Kept", "Kept"),
					)
					yield* store.createDocument("to", occupied)
				}),
			),
		)
		await target.runPromise(
			owner(WorkspaceTransfers.use(t => t.authorizeDocumentDestination("to"))),
		)
		let bundle = await source.runPromise(
			owner(
				WorkspaceTransfers.use(t =>
					t.stageDocumentMove("moving", "to", "move-one"),
				),
			),
		)
		await target.runPromise(
			destination(
				WorkspaceStore.use(s =>
					s.membership("to", "owner", null, "revoke-before-import"),
				),
			),
		)
		let denied = await target.runPromise(
			owner(
				WorkspaceTransfers.use(t => t.importDocumentMove(bundle)).pipe(
					Effect.flip,
				),
			),
		)
		expect(denied._tag).toBe("PermissionDenied")
		await source.runPromise(
			owner(
				WorkspaceTransfers.use(t => t.abortDocumentMove("moving", "move-one")),
			),
		)
		let aborted = await source.runPromise(
			owner(
				WorkspaceTransfers.use(t =>
					t.stageDocumentMove("moving", "to", "move-one"),
				).pipe(Effect.exit),
			),
		)
		expect(aborted._tag).toBe("Failure")
		await target.runPromise(
			destination(
				WorkspaceStore.use(s =>
					s.membership("to", "owner", "writer", "restore-owner"),
				),
			),
		)
		bundle = await source.runPromise(
			owner(
				WorkspaceTransfers.use(t =>
					t.stageDocumentMove("moving", "to", "move-two"),
				),
			),
		)
		await source.runPromise(
			owner(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					expect((yield* store.snapshot("moving").pipe(Effect.exit))._tag).toBe(
						"Failure",
					)
					expect(
						(yield* store.commit(prepared.edit).pipe(Effect.exit))._tag,
					).toBe("Failure")
				}),
			),
		)
		let receipt = await target.runPromise(
			owner(WorkspaceTransfers.use(t => t.importDocumentMove(bundle))),
		)
		expect(receipt.log).not.toBe(prepared.log)
		expect(receipt.position).toBeGreaterThan(prepared.oldPosition)
		expect(
			await target.runPromise(
				owner(WorkspaceTransfers.use(t => t.importDocumentMove(bundle))),
			),
		).toEqual(receipt)
		await target.runPromise(
			owner(
				WorkspaceTransfers.use(t =>
					t.activateDocumentMove("moving", "move-two"),
				),
			),
		)
		await target.runPromise(
			owner(
				WorkspaceTransfers.use(t =>
					t.activateDocumentMove("moving", "move-two"),
				),
			),
		)
		await target.runPromise(
			owner(
				DocumentMaintenance.use(m =>
					m.recordImportedMove("moving", "from", "to", "move-two"),
				),
			),
		)

		await source.runPromise(
			owner(
				WorkspaceTransfers.use(t => t.retireDocumentMove("moving", "move-two")),
			),
		)
		await source.runPromise(
			owner(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					expect(
						(yield* store.library()).documents.map(row => row.document),
					).not.toContain("moving")
					expect((yield* store.snapshot("moving").pipe(Effect.exit))._tag).toBe(
						"Failure",
					)
				}),
			),
		)
		await target.runPromise(
			owner(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					expect(yield* store.commit(prepared.edit)).toBe(receipt.position)
					expect(yield* store.getBlob("moving", prepared.digest)).toEqual(
						new Uint8Array([4, 5, 6]),
					)
					expect(
						(yield* store.invitations({ document: "moving" })).map(
							row => row.invitation,
						),
					).toContain("move-invite")
					let snapshot = yield* store.snapshot("moving")
					if (!snapshot)
						return yield* Effect.fail(new Error("Missing moved snapshot"))
					expect(
						(yield* restoreSnapshot(snapshot, "reader")).text("moving"),
					).toBe(prepared.source)
					expect(snapshot.log).toBe(receipt.log)
					expect(
						(yield* store.history("moving", 0, prepared.log).pipe(Effect.exit))
							._tag,
					).toBe("Failure")
					let action = yield* store.action("moving", prepared.edit.id)
					if (!action)
						return yield* Effect.fail(new Error("Missing original action"))
					let undo = yield* undoAction(
						yield* restoreSnapshot(snapshot, "owner-edit"),
						action,
					)
					yield* store.commit(undo)
					let restored = yield* store.snapshot("moving")
					if (!restored)
						return yield* Effect.fail(new Error("Missing moved Undo"))
					expect(
						(yield* restoreSnapshot(restored, "reader")).text("moving"),
					).toBe(prepared.source.slice(0, -1))
				}),
			),
		)
		let back = await target.runPromise(
			owner(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					let snapshot = yield* store.snapshot("moving")
					if (!snapshot)
						return yield* Effect.fail(new Error("Missing return snapshot"))
					let replica = yield* restoreSnapshot(snapshot, "owner-edit")
					let edit = yield* buildAction(replica, "moving", "Edit again", r => [
						r.edit("moving", replica.text("moving") + " after"),
					])
					yield* store.commit(edit)
					return yield* WorkspaceTransfers.use(t =>
						t.stageDocumentMove("moving", "from", "move-back"),
					)
				}),
			),
		)
		let returned = await source.runPromise(
			owner(WorkspaceTransfers.use(t => t.importDocumentMove(back))),
		)
		await source.runPromise(
			owner(
				WorkspaceTransfers.use(t =>
					t.activateDocumentMove("moving", "move-back"),
				),
			),
		)
		await source.runPromise(
			owner(
				DocumentMaintenance.use(m =>
					m.recordImportedMove("moving", "to", "from", "move-back"),
				),
			),
		)
		await target.runPromise(
			owner(
				WorkspaceTransfers.use(t =>
					t.retireDocumentMove("moving", "move-back"),
				),
			),
		)
		await source.runPromise(
			owner(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					let snapshot = yield* store.snapshot("moving")
					if (!snapshot)
						return yield* Effect.fail(new Error("Missing returned snapshot"))
					expect(snapshot.log).toBe(returned.log)
					expect(
						(yield* restoreSnapshot(snapshot, "reader")).text("moving"),
					).toBe(prepared.source.slice(0, -1) + " after")
					expect(
						(yield* store.workspaceHistory("from")).some(
							row => row.fact.change.kind === "documentMoved",
						),
					).toBe(true)
				}),
			),
		)
	} finally {
		await source.dispose()
		await target.dispose()
	}
	let retired = runtime("move-target")
	let migrated = runtime("move-target-migrated")
	try {
		let frozen = await retired.runPromise(
			owner(
				Effect.gen(function* () {
					let transfer = yield* WorkspaceTransfers
					yield* transfer.freezeWorkspace("to", 1)
					return yield* transfer.exportWorkspace("to", 1)
				}),
			),
		)
		expect(
			frozen.document_transfer_fences.some(
				row => row.document === "moving" && row.phase === "retired",
			),
		).toBe(true)
		expect(frozen.document_move_exports.length).toBeGreaterThan(0)
		expect(frozen.document_move_receipts.length).toBeGreaterThan(0)
		await migrated.runPromise(
			WorkspaceTransfers.use(t => t.importWorkspace(frozen)),
		)
		await migrated.runPromise(
			WorkspaceTransfers.use(t => t.activateImportedWorkspace("to", 1)),
		)
		expect(
			await migrated.runPromise(
				owner(WorkspaceStore.use(s => s.snapshot("moving")).pipe(Effect.exit)),
			),
		).toHaveProperty("_tag", "Failure")
		let repeated = await migrated.runPromise(
			WorkspaceTransfers.use(t =>
				t
					.freezeWorkspace("to", 2)
					.pipe(Effect.andThen(t.exportWorkspace("to", 2))),
			),
		)
		expect(repeated.document_transfer_fences).toEqual(
			frozen.document_transfer_fences,
		)
		expect(repeated.document_move_exports).toEqual(frozen.document_move_exports)
		expect(repeated.document_move_receipts).toEqual(
			frozen.document_move_receipts,
		)
	} finally {
		await retired.dispose()
		await migrated.dispose()
	}
	let cold = runtime("move-source")
	try {
		await cold.runPromise(
			owner(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					expect((yield* store.history("moving")).length).toBe(4)
					expect(
						(yield* store.library()).documents.find(
							row => row.document === "moving",
						)?.workspace,
					).toBe("from")
				}),
			),
		)
	} finally {
		await cold.dispose()
	}
})
