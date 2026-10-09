import { workspaceStoreLayer } from "../src/server/bun-databases"
import { afterAll, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { WorkspaceStore } from "../src/server/document-store"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { Replica } from "../src/shared/crdt"
import {
	applyAction,
	buildAction,
	restoreSnapshot,
	undoAction,
} from "../src/shared/document-actions"
import { newDocument, newComment } from "../src/shared/documents"
import { Identity } from "../src/shared/workspace"

let directory = await mkdtemp(join(tmpdir(), "alkalye-compact-head-"))
afterAll(() => rm(directory, { recursive: true, force: true }))
let original = "A😀🦊B\n".repeat(32)
function run<A, E>(
	filename: string,
	work: Effect.Effect<A, E, WorkspaceStore | Identity | Crypto.Crypto>,
) {
	return Effect.runPromise(
		work.pipe(
			Effect.provideService(Identity, { subject: "owner", actors: ["owner"] }),
			Effect.provide(
				Layer.merge(workspaceStoreLayer(filename), webCryptoLayer),
			),
		),
	)
}
function create() {
	return Effect.gen(function* () {
		let store = yield* WorkspaceStore
		yield* store.create("space", "Workspace", "create-space")
		let creation = yield* buildAction(
			new Replica("owner"),
			"doc",
			"Create",
			staged => newDocument(staged, "doc", "Compact", original),
		)
		yield* store.createDocument("space", creation)
		return creation
	})
}
function read() {
	return Effect.gen(function* () {
		let store = yield* WorkspaceStore
		let snapshot = yield* store.snapshot("doc")
		if (!snapshot) return yield* Effect.die("Missing snapshot")
		let replica = yield* restoreSnapshot(snapshot, "owner")
		return { store, snapshot, replica }
	})
}
function acceptedAction(id: string) {
	return Effect.gen(function* () {
		let store = yield* WorkspaceStore
		let action = yield* store.action("doc", id)
		if (!action) return yield* Effect.die("Missing committed action")
		return action
	})
}
function storedFormat(filename: string) {
	let database = new Database(filename, { readonly: true })
	try {
		return database
			.query(
				"SELECT json_extract(state,'$.format') AS format FROM document_heads",
			)
			.get()
	} finally {
		database.close()
	}
}

test("compact creation and interval checkpoints reopen with exact Unicode source, history and Undo", async () => {
	let filename = join(directory, "interval.sqlite")
	await run(filename, create())
	expect(storedFormat(filename)).toEqual({ format: "alkalye-state-v3" })
	let canonicalSource = await run(
		filename,
		read().pipe(Effect.map(({ replica }) => replica.text("doc"))),
	)
	expect(canonicalSource).toBe('---\ntitle: "Compact"\n---\n' + original)
	let last = await run(
		filename,
		Effect.gen(function* () {
			let { store, replica } = yield* read()
			let comment = yield* buildAction(replica, "doc", "Comment", staged =>
				newComment(
					staged,
					"comment",
					"doc",
					"A😀",
					"Persist discussion",
					"Owner",
					canonicalSource.indexOf("A😀"),
				),
			)
			yield* store.commit(comment)
			yield* applyAction(replica, yield* acceptedAction(comment.id))
			let deletion = yield* buildAction(
				replica,
				"doc",
				"Delete emoji",
				staged => [staged.edit("doc", canonicalSource.replace("😀", ""))],
			)
			yield* store.commit(deletion)
			let committedDeletion = yield* acceptedAction(deletion.id)
			yield* applyAction(replica, committedDeletion)
			let cancel = yield* undoAction(replica, committedDeletion, "owner")
			yield* store.commit(cancel)
			yield* applyAction(replica, yield* acceptedAction(cancel.id))
			expect(replica.text("doc")).toBe(canonicalSource)
			let action = yield* buildAction(replica, "doc", "Note 1", staged => [
				staged.set("doc", "note", "1"),
			])
			for (let value = 1; value <= 96; value++) {
				if (value !== 1)
					action = yield* buildAction(
						replica,
						"doc",
						"Note " + value,
						staged => [staged.set("doc", "note", String(value))],
					)
				yield* store.commit(action)
				yield* applyAction(replica, yield* acceptedAction(action.id))
			}
			return yield* acceptedAction(action.id)
		}),
	)
	expect(storedFormat(filename)).toEqual({ format: "alkalye-state-v3" })
	await run(
		filename,
		Effect.gen(function* () {
			let { store, replica } = yield* read()
			expect(replica.text("doc")).toBe(canonicalSource)
			expect(replica.fields("doc").note).toBe("96")
			expect(replica.fields("comment").body).toBe("Persist discussion")
			expect(yield* store.history("doc")).toHaveLength(100)
			let undo = yield* undoAction(replica, last, "owner")
			let position = yield* store.commit(undo)
			expect(yield* store.commit(undo)).toBe(position)
			let snapshot = yield* store.snapshot("doc")
			if (!snapshot) return yield* Effect.die("Missing snapshot after Undo")
			expect(snapshot.position).toBe(position)
		}),
	)
	await run(
		filename,
		Effect.gen(function* () {
			let { store, replica } = yield* read()
			expect(replica.text("doc")).toBe(canonicalSource)
			expect(replica.fields("doc").note).toBe("95")
			expect(replica.fields("comment").quote).toBe("A😀")
			expect(yield* store.history("doc")).toHaveLength(101)
		}),
	)
})

test("legacy expanded heads remain readable after a fresh store scope", async () => {
	let filename = join(directory, "legacy.sqlite")
	await run(filename, create())
	let { expanded, canonicalSource } = await run(
		filename,
		read().pipe(
			Effect.map(({ replica }) => ({
				expanded: JSON.stringify(replica.checkpoint()),
				canonicalSource: replica.text("doc"),
			})),
		),
	)
	expect(canonicalSource).toBe('---\ntitle: "Compact"\n---\n' + original)
	let database = new Database(filename)
	try {
		database.query("UPDATE document_heads SET state=?").run(expanded)
	} finally {
		database.close()
	}
	await run(
		filename,
		read().pipe(
			Effect.tap(({ replica }) =>
				Effect.sync(() => expect(replica.text("doc")).toBe(canonicalSource)),
			),
		),
	)
})

test("fresh compact checkpoint corruption is rejected without publishing a snapshot", async () => {
	let filename = join(directory, "corrupt.sqlite")
	await run(filename, create())
	let database = new Database(filename)
	try {
		database
			.query("UPDATE document_heads SET state=?")
			.run(
				'{"format":"alkalye-state-v3","clock":-1,"targets":[],"restored":[]}',
			)
	} finally {
		database.close()
	}
	let result = await run(
		filename,
		WorkspaceStore.use(store => store.snapshot("doc")).pipe(Effect.result),
	)
	expect(result._tag).toBe("Failure")
	if (result._tag === "Failure")
		expect(result.failure._tag).toBe("DocumentConflict")
})
