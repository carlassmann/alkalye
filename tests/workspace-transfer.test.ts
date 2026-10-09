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
import { WorkspaceStore } from "../src/server/document-store"
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
		Layer.mergeAll(WorkspaceStore.live, WorkspaceTransfers.live).pipe(
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
