import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as SqlSchema from "effect/sql/SqlSchema"
import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import { TestClock } from "effect/testing"
import * as EventLog from "effect/eventlog/EventLog"
import * as EventJournal from "effect/eventlog/EventJournal"
import { sqliteLayer } from "../../src/platform/sqlite"
import { webCryptoLayer } from "../../src/platform/web-crypto"
import { documentReplica } from "./session"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import {
	CommittedActionSchema,
	committedAction,
} from "../../src/shared/document-actions"
import * as SqlClient from "effect/sql/SqlClient"
import { parseOperation } from "../../src/shared/model"
import { Replica } from "../../src/shared/crdt"
import { metadataSource } from "../../src/shared/document-metadata"
import {
	commentRange,
	newComment,
	newDocument,
	replyToComment,
	setFields,
} from "../../src/shared/documents"
import {
	applyAction,
	buildAction,
	restoreSnapshot,
	undoAction,
	DocumentActionSchema,
	type DocumentAction,
} from "./document"
import {
	commit,
	DocumentStore,
	readAction,
	Principal,
	readHistory,
	readSnapshot,
} from "./journal"

let directory = await mkdtemp(join(tmpdir(), "alkalye-effect-document-events-"))
afterAll(() => rm(directory, { recursive: true, force: true }))
function layer(
	name: string,
	role: "owner" | "writer" | "reader" = "owner",
	actor = "owner",
) {
	let filename = join(directory, name + ".sqlite")
	return Layer.mergeAll(
		webCryptoLayer,
		DocumentStore.layer(filename),
		sqliteLayer(filename),
		Layer.succeed(Principal, { subject: "owner", actors: [actor], role }),
	)
}
function initial() {
	return buildAction(new Replica("owner"), "doc", "Create document", staged =>
		newDocument(
			staged,
			"doc",
			"Untitled",
			"---\ntitle: Source title\n---\nQuote",
		),
	)
}

test("large-document register undo preserves unseen peer source edits without target guards", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let source = "Paragraph text.\n".repeat(3125)
			let create = yield* buildAction(
				new Replica("owner"),
				"doc",
				"Create",
				staged => newDocument(staged, "doc", "Untitled", source),
			)
			yield* commit(create)
			let mode = yield* buildAction(
				yield* load(),
				"doc",
				"Set mode",
				staged => [staged.set("doc", "mode", "slideshow")],
			)
			yield* commit(mode)
			let persisted = yield* readAction("doc", mode.id)
			if (!persisted) return yield* Effect.die("Missing settings action")
			let undo = yield* undoAction(yield* load(), persisted)
			expect(undo.guards).toEqual([])
			expect(JSON.stringify(undo).length).toBeLessThan(2000)
			let peer = yield* buildAction(
				yield* load("doc", "peer"),
				"doc",
				"Peer source",
				staged => [staged.edit("doc", source + "Peer text")],
			)
			yield* commit(peer).pipe(
				Effect.provideService(Principal, {
					subject: "peer",
					actors: ["peer"],
					role: "writer",
				}),
			)
			yield* commit(undo)
			let restored = yield* load()
			expect(restored.text("doc")).toBe(source + "Peer text")
			expect(restored.fields("doc").mode).toBe("")
		}).pipe(Effect.provide(layer("compact-guard"))),
	)
})

test("before-image budgets reject large overwrites atomically and keep smaller compensable edits available", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			for (let field of ["first", "second"]) {
				let edit = yield* buildAction(
					yield* load(),
					"doc",
					"Save settings",
					staged => [staged.set("doc", field, "x".repeat(150_000))],
				)
				yield* commit(edit)
			}
			let clear = yield* buildAction(
				yield* load(),
				"doc",
				"Clear both",
				staged => [
					staged.set("doc", "first", ""),
					staged.set("doc", "second", ""),
				],
			)
			expect(Exit.isFailure(yield* commit(clear).pipe(Effect.exit))).toBe(true)
			let retained = yield* load()
			expect(retained.fields("doc").first).toHaveLength(150_000)
			expect(retained.fields("doc").second).toHaveLength(150_000)
			expect(yield* readHistory("doc")).toHaveLength(3)
			let smaller = yield* buildAction(
				retained,
				"doc",
				"Clear first",
				staged => [staged.set("doc", "first", "")],
			)
			yield* commit(smaller)
			let fact = yield* readAction("doc", smaller.id)
			if (!fact) return yield* Effect.die("Missing compensable action")
			yield* commit(yield* undoAction(yield* load(), fact))
			expect((yield* load()).fields("doc").first).toHaveLength(150_000)
		}).pipe(Effect.provide(layer("before-image-budget"))),
	)
})

test("bounded document actions preserve long frontmatter headers when editing one metadata field", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let entries = Array.from(
				{ length: 160 },
				(_, index) => `custom${index}: preserved${index}`,
			).join("\n")
			let source = `---\ntitle: Before\n${entries}\n---\nBody`
			let create = yield* buildAction(
				new Replica("owner"),
				"doc",
				"Create",
				staged => newDocument(staged, "doc", "Untitled", source),
			)
			yield* commit(create)
			let edit = yield* buildAction(yield* load(), "doc", "Rename", staged => [
				staged.edit(
					"doc",
					metadataSource(staged.text("doc"), { title: "After" }),
				),
			])
			yield* commit(edit)
			let restored = yield* load()
			expect(restored.text("doc")).toBe(
				source.replace("title: Before", 'title: "After"'),
			)
			expect(restored.metadata("doc").title).toBe("After")
		}).pipe(Effect.provide(layer("long-frontmatter"))),
	)
})

test("large native pastes use compact runs and restore every character from the document snapshot", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let source = "x".repeat(150_000)
			let paste = yield* buildAction(yield* load(), "doc", "Paste", staged => [
				staged.edit("doc", source),
			])
			expect(JSON.stringify(paste).length).toBeLessThan(155_000)
			yield* commit(paste)
			expect((yield* load()).text("doc")).toBe(source)
		}).pipe(Effect.provide(layer("large-paste"))),
	)
})

test("typed malformed proposals return domain failures before cache lookup or durable mutation", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let create = yield* initial()
			let [first, ...others] = create.changes
			let malformed: DocumentAction[] = [
				{ ...create, label: "x".repeat(300) },
				{ ...create, guards: [{ target: "doc", state: "x".repeat(43) }] },
				{
					...create,
					changes: [{ ...first, value: "x".repeat(200_001) }, ...others],
				},
			]
			for (let proposal of malformed) {
				let result = yield* commit(proposal).pipe(Effect.result)
				expect(result._tag).toBe("Failure")
				if (result._tag === "Failure")
					expect(result.failure._tag).toBe("DocumentConflict")
			}
			expect(yield* readSnapshot("doc")).toBeUndefined()
			expect(yield* readHistory("doc")).toEqual([])
			yield* commit(create)
			expect(yield* readSnapshot("doc")).toBeDefined()
		}).pipe(Effect.provide(layer("typed-boundary"))),
	)
})
function load(document = "doc", actor = "owner") {
	return Effect.gen(function* () {
		let snapshot = yield* readSnapshot(document)
		if (!snapshot) return yield* Effect.die("Missing snapshot")
		return yield* restoreSnapshot(snapshot, actor)
	})
}

function nativeEntries() {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		return yield* SqlSchema.findAll({
			Request: Schema.Void,
			Result: Schema.Struct({ payload: Schema.Uint8Array }),
			execute: () => sql`SELECT payload FROM effect_event_journal`,
		})(undefined)
	})
}
function stored(proposal: typeof DocumentActionSchema.Type) {
	return Effect.gen(function* () {
		let action = yield* readAction(proposal.document, proposal.id)
		if (!action) return yield* Effect.die("Missing persisted action")
		return action
	})
}

test("a native document stream atomically records source, comments, assets and drawings; a cold snapshot needs no event table", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let original = yield* load()
			let attachment = yield* buildAction(
				original,
				"doc",
				"Discuss and illustrate",
				staged => [
					...setFields(staged, "asset", {
						type: "asset",
						document: "doc",
						name: "photo.png",
						mime: "image/png",
						digest: "sha256:content-addressed-blob",
					}),
					...setFields(staged, "board", {
						type: "whiteboard",
						document: "doc",
						"shape:box": '{"kind":"rectangle"}',
					}),
					...newComment(
						staged,
						"comment",
						"doc",
						"Quote",
						"Look here",
						"Owner",
					),
					staged.edit("doc", staged.text("doc") + "\n![Photo](asset:asset)"),
					staged.set("doc", "mode", "slideshow"),
				],
			)
			expect(original.fields("comment").type).toBeUndefined()
			let position = yield* commit(attachment)
			expect(yield* nativeEntries()).toHaveLength(2)
			let sql = yield* SqlClient.SqlClient
			yield* sql`ALTER TABLE effect_event_journal RENAME TO history_unavailable`
			let snapshot = yield* readSnapshot("doc")
			if (!snapshot) return yield* Effect.die("Missing current snapshot")
			expect(snapshot.position).toBe(position)
			let cold = yield* restoreSnapshot(snapshot, "cold")
			expect(cold.metadata("doc").title).toBe("Source title")
			expect(cold.fields("doc").mode).toBe("slideshow")
			expect(cold.fields("asset").digest).toBe("sha256:content-addressed-blob")
			expect(cold.fields("asset").data).toBeUndefined()
			expect(cold.fields("comment").body).toBe("Look here")
			expect(cold.fields("board")["shape:box"]).toBe('{"kind":"rectangle"}')
			let range = commentRange(cold, "doc", cold.fields("comment"))
			expect(range && cold.text("doc").slice(range.start, range.end)).toBe(
				"Quote",
			)
			yield* sql`ALTER TABLE history_unavailable RENAME TO effect_event_journal`
			let history = yield* readHistory("doc")
			expect(history.map(entry => entry.action.label)).toEqual([
				"Create document",
				"Discuss and illustrate",
			])
			let beforeAttachment = new Replica("historical")
			let created = history[0]
			if (!created) return yield* Effect.die("Missing creation event")
			yield* applyAction(beforeAttachment, created.action)
			expect(beforeAttachment.text("doc")).toBe(original.text("doc"))
			expect(beforeAttachment.fields("comment").type).toBeUndefined()
			expect(yield* readHistory("doc", position, snapshot.log)).toEqual([])
		}).pipe(Effect.provide(layer("cold"))),
	)
})

test("a snapshot plus its indexed tail reconstructs a document after SQLite reopening", async () => {
	let saved = await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let snapshot = yield* readSnapshot("doc")
			if (!snapshot) return yield* Effect.die("Missing snapshot")
			let replica = yield* load()
			yield* commit(
				yield* buildAction(replica, "doc", "Add discussion", staged =>
					newComment(staged, "comment", "doc", "Quote", "A thought", "Owner"),
				),
			)
			return snapshot
		}).pipe(Effect.provide(layer("reopen"))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let replica = yield* restoreSnapshot(saved, "reopened")
			let tail = yield* readHistory("doc", saved.position, saved.log)
			expect(tail).toHaveLength(1)
			for (let entry of tail) yield* applyAction(replica, entry.action)
			let current = yield* load()
			expect(replica.revision("doc")).toBe(current.revision("doc"))
			expect(replica.revision("comment")).toBe(current.revision("comment"))
		}).pipe(Effect.provide(layer("reopen"))),
	)
})

test("undo after a cold snapshot appends a compensating action for comments and assets", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			let attached = yield* buildAction(
				replica,
				"doc",
				"Attach and comment",
				staged => [
					...setFields(staged, "asset", {
						type: "asset",
						document: "doc",
						digest: "old-blob",
					}),
					...newComment(
						staged,
						"comment",
						"doc",
						"Quote",
						"A thought",
						"Owner",
					),
				],
			)
			yield* commit(attached)
			let cold = yield* load()
			let undo = yield* undoAction(cold, yield* stored(attached))
			expect(undo.undoOf).toBe(attached.id)
			yield* commit(undo)
			let current = yield* load()
			expect(current.fields("asset").type).toBe("deleted")
			expect(current.fields("comment").type).toBe("deleted")
			expect(current.fields("asset").document).toBe("doc")
			expect(
				(yield* readHistory("doc")).map(entry => entry.action.label),
			).toEqual([
				"Create document",
				"Attach and comment",
				"Undo Attach and comment",
			])
			let redo = yield* undoAction(current, yield* stored(undo))
			yield* commit(redo)
			let restored = yield* load()
			expect(restored.fields("asset").digest).toBe("old-blob")
			expect(restored.fields("comment").body).toBe("A thought")
			let replay = new Replica("historical")
			for (let entry of yield* readHistory("doc"))
				yield* applyAction(replay, entry.action)
			for (let target of restored.checkpoint().targets)
				expect(replay.revision(target.id)).toBe(restored.revision(target.id))
		}).pipe(Effect.provide(layer("undo"))),
	)
})

test("a peer reply protects a newly created comment; unseen peer edits reject a pending undo atomically", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			let created = yield* buildAction(
				replica,
				"doc",
				"Comment and attach",
				staged => [
					...newComment(
						staged,
						"comment",
						"doc",
						"Quote",
						"A thought",
						"Owner",
					),
					...setFields(staged, "asset", {
						type: "asset",
						document: "doc",
						digest: "old-blob",
					}),
				],
			)
			yield* commit(created)
			replica = yield* load()
			let pending = yield* undoAction(replica, yield* stored(created))
			let peer = yield* load("doc", "peer")
			let reply = yield* buildAction(peer, "doc", "Reply", staged => [
				replyToComment(staged, "comment", "Keep this discussion", "Peer", {
					id: "reply",
					time: 123,
				}),
			])
			yield* commit(reply).pipe(
				Effect.provideService(Principal, {
					subject: "peer",
					actors: ["peer"],
					role: "writer",
				}),
			)
			expect(Exit.isFailure(yield* commit(pending).pipe(Effect.exit))).toBe(
				true,
			)
			expect(
				Exit.isFailure(
					yield* commit({ ...pending, guards: [] }).pipe(Effect.exit),
				),
			).toBe(true)
			let current = yield* load()
			expect(current.fields("asset").type).toBe("asset")
			expect(current.fields("comment").type).toBe("comment")
			let selective = yield* undoAction(current, yield* stored(created))
			expect(selective.changes.every(change => change.target === "asset")).toBe(
				true,
			)
			yield* commit(selective)
			current = yield* load()
			expect(current.fields("asset").type).toBe("deleted")
			expect(current.fields("comment")["reply:123:reply"]).toContain(
				"Keep this discussion",
			)
		}).pipe(Effect.provide(layer("peer"))),
	)
})

test("journal failure rolls back the action index and snapshot; retry records the complete action", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let action = yield* initial()
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TRIGGER reject_action BEFORE INSERT ON effect_event_journal BEGIN SELECT RAISE(ABORT,'journal unavailable'); END`
			expect(
				yield* commit(action).pipe(Effect.catchTag("SqlError", Effect.succeed)),
			).toMatchObject({ _tag: "SqlError" })
			expect(yield* readSnapshot("doc")).toBeUndefined()
			expect(yield* sql`SELECT * FROM document_actions`).toEqual([])
			expect(yield* nativeEntries()).toEqual([])
			yield* sql`DROP TRIGGER reject_action`
			let position = yield* commit(action)
			expect(yield* commit(action)).toBe(position)
			expect(yield* nativeEntries()).toHaveLength(1)
			expect(yield* readHistory("doc")).toHaveLength(1)
			expect(
				Exit.isFailure(
					yield* commit({ ...action, label: "Forged retry" }).pipe(Effect.exit),
				),
			).toBe(true)
			expect((yield* readSnapshot("doc"))?.position).toBe(position)
		}).pipe(Effect.provide(layer("rollback"))),
	)
})

test("a throwing action builder leaves the live document untouched", async () => {
	let replica = new Replica("owner")
	let before = replica.checkpoint()
	let failed = await Effect.runPromise(
		buildAction(replica, "doc", "Broken action", staged => {
			staged.set("doc", "type", "document")
			throw new Error("Builder failed")
		}).pipe(Effect.exit),
	)
	expect(Exit.isFailure(failed)).toBe(true)
	expect(replica.checkpoint()).toEqual(before)
})

test("failed outer COMMIT leaves a warm document unchanged and retry commits its complete action", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			let before = yield* readSnapshot("doc")
			let proposal = yield* buildAction(
				replica,
				"doc",
				"Change and discuss",
				staged => [
					staged.edit("doc", staged.text("doc") + "\nPending"),
					...newComment(
						staged,
						"comment",
						"doc",
						"Quote",
						"Pending comment",
						"Owner",
					),
				],
			)
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TABLE deferred_parent (id INTEGER PRIMARY KEY)`
			yield* sql`CREATE TABLE deferred_child (parent INTEGER REFERENCES deferred_parent(id) DEFERRABLE INITIALLY DEFERRED)`
			yield* sql`CREATE TRIGGER fail_warm_commit AFTER INSERT ON effect_event_journal BEGIN INSERT INTO deferred_child VALUES (123); END`
			expect(
				yield* commit(proposal).pipe(
					Effect.catchTag("SqlError", Effect.succeed),
				),
			).toMatchObject({ _tag: "SqlError" })
			expect(yield* readSnapshot("doc")).toEqual(before)
			expect(yield* readHistory("doc")).toHaveLength(1)
			yield* sql`DROP TRIGGER fail_warm_commit`
			yield* commit(proposal)
			expect((yield* load()).text("doc")).toContain("Pending")
			expect((yield* load()).fields("comment").body).toBe("Pending comment")
		}).pipe(Effect.provide(layer("warm-rollback"))),
	)
})

test("a killed writer process advances an existing cache; cold reopening restores the same checkpoint and tail", async () => {
	let saved = await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let before = yield* readSnapshot("doc")
			let process = yield* Effect.acquireRelease(
				Effect.sync(() =>
					Bun.spawn(
						[
							"bun",
							join(import.meta.dir, "process-fixture.ts"),
							join(directory, "other-process.sqlite"),
							"doc",
							"\nOther process",
						],
						{
							env: { ...Bun.env, HOLD_AFTER_COMMIT: "1" },
							stdout: "pipe",
							stderr: "pipe",
						},
					),
				),
				process =>
					Effect.sync(() => process.kill("SIGKILL")).pipe(
						Effect.andThen(Effect.promise(() => process.exited)),
					),
			)
			let signal = yield* Effect.tryPromise(() =>
				process.stdout.getReader().read(),
			).pipe(Effect.timeout("3 seconds"))
			if (!signal.value)
				return yield* Effect.die("Writer exited before committing")
			expect(new TextDecoder().decode(signal.value)).toContain('"position":2')
			process.kill("SIGKILL")
			yield* Effect.tryPromise(() => process.exited)
			let after = yield* readSnapshot("doc")
			expect(after?.position).toBeGreaterThan(before?.position ?? 0)
			expect((yield* load()).text("doc")).toContain("Other process")
			return after
		}).pipe(Effect.scoped, Effect.provide(layer("other-process"))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* readSnapshot("doc")).toEqual(saved)
			let sql = yield* SqlClient.SqlClient
			let heads = yield* SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({ position: Schema.Natural }),
				execute: () => sql`SELECT position FROM document_heads`,
			})(undefined)
			expect(heads).toEqual([{ position: 1 }])
		}).pipe(Effect.provide(layer("other-process"))),
	)
})

test("an actively used document stays warm across elapsed time without rebuilding its mandatory tail", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			yield* commit(
				yield* buildAction(replica, "doc", "Append", staged => [
					staged.edit("doc", staged.text("doc") + "\nTail"),
				]),
			)
			expect((yield* load()).text("doc")).toContain("Tail")
			let sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM effect_event_journal WHERE id IN (SELECT entry FROM document_actions WHERE position=2)`
			expect((yield* load()).text("doc")).toContain("Tail")
			for (let index = 0; index < 4; index++) {
				yield* TestClock.adjust("10 seconds")
				expect((yield* load()).text("doc")).toContain("Tail")
			}
		}).pipe(
			Effect.provide(layer("cache-expiry")),
			Effect.provide(TestClock.layer()),
		),
	)
})

test("denied proposals and missing-document probes preserve a warm document cache", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			let before = yield* readSnapshot("doc")
			for (let index = 0; index < 40; index++)
				expect(yield* readSnapshot("missing-" + index)).toBeUndefined()
			let proposal = yield* buildAction(replica, "doc", "Denied", staged => [
				staged.set("doc", "setting", "Denied"),
			])
			expect(
				yield* commit(proposal).pipe(
					Effect.provideService(Principal, {
						subject: "owner",
						actors: ["owner"],
						role: "reader",
					}),
					Effect.catchTag("DocumentConflict", Effect.succeed),
				),
			).toMatchObject({ message: "Document action is not authorized" })
			let sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM document_heads`
			yield* sql`DELETE FROM effect_event_journal`
			for (let index = 0; index < 40; index++) {
				let document = "missing-write-" + index
				let changes = proposal.changes.map(change => ({
					...change,
					target: document,
				}))
				let missing = Schema.decodeUnknownSync(DocumentActionSchema)({
					...proposal,
					document,
					changes,
				})
				expect(
					yield* commit(missing).pipe(
						Effect.provideService(Principal, {
							subject: "owner",
							actors: ["owner"],
							role: "reader",
						}),
						Effect.catchTag("DocumentConflict", Effect.succeed),
					),
				).toMatchObject({ message: "Document action is not authorized" })
				expect(
					yield* commit(missing).pipe(
						Effect.catchTag("DocumentConflict", Effect.succeed),
					),
				).toMatchObject({ message: "Actor identity is not authorized" })
			}
			expect(yield* readSnapshot("doc")).toEqual(before)
		}).pipe(Effect.provide(layer("cache-preserved"))),
	)
})

test("ambient transactions cannot publish document facts or notices through an inner savepoint", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			let store = yield* DocumentStore
			let notices = yield* store.changes
			let action = yield* initial()
			let result = yield* sql
				.withTransaction(commit(action))
				.pipe(Effect.catchTag("TransactionOwnershipError", Effect.succeed))
			expect(result).toMatchObject({
				_tag: "TransactionOwnershipError",
				message: "The store must own its transaction",
			})
			expect(yield* readSnapshot("doc")).toBeUndefined()
			expect(yield* PubSub.takeUpTo(notices, 1)).toEqual([])
			expect(yield* commit(action)).toBe(1)
		}).pipe(Effect.scoped, Effect.provide(layer("transaction-owner"))),
	)
})

test("a WAL snapshot and history read remain available while another connection owns the write lock", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let sql = yield* SqlClient.SqlClient
			yield* sql.withTransaction(
				Effect.gen(function* () {
					expect((yield* load()).text("doc")).toBe(
						"---\ntitle: Source title\n---\nQuote",
					)
					expect(yield* readHistory("doc")).toHaveLength(1)
				}),
			)
		}).pipe(Effect.provide(layer("wal-reader"))),
	)
})

test("periodic checkpoints bound recovery and permit cold loading after older event payloads are removed", async () => {
	let saved = await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			for (let index = 0; index < 205; index++) {
				let proposal = yield* buildAction(replica, "doc", "Setting", staged => [
					staged.set("doc", "setting", String(index)),
				])
				yield* commit(proposal)
				yield* applyAction(replica, yield* stored(proposal))
			}
			let sql = yield* SqlClient.SqlClient
			let heads = yield* SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({
					position: Schema.Natural,
					version: Schema.Natural,
				}),
				execute: () => sql`SELECT position,version FROM document_heads`,
			})(undefined)
			expect(heads).toEqual([{ position: 200, version: 200 }])
			yield* sql`DELETE FROM effect_event_journal WHERE id IN (SELECT entry FROM document_actions WHERE document='doc' AND position<=200)`
			return yield* readSnapshot("doc")
		}).pipe(Effect.provide(layer("cadence"))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* readSnapshot("doc")).toEqual(saved)
			expect((yield* load()).fields("doc").setting).toBe("204")
			expect(yield* readHistory("doc", 200, saved?.log)).toHaveLength(6)
		}).pipe(Effect.provide(layer("cadence"))),
	)
})

test("checkpoint write failure rolls back the native action and tip at the cadence boundary", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			for (let index = 0; index < 98; index++) {
				let proposal = yield* buildAction(replica, "doc", "Setting", staged => [
					staged.set("doc", "setting", String(index)),
				])
				yield* commit(proposal)
				yield* applyAction(replica, yield* stored(proposal))
			}
			let before = yield* readSnapshot("doc")
			let proposal = yield* buildAction(
				replica,
				"doc",
				"Checkpoint boundary",
				staged => [staged.set("doc", "setting", "Complete")],
			)
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON document_heads BEGIN SELECT RAISE(ABORT,'checkpoint unavailable'); END`
			expect(
				yield* commit(proposal).pipe(
					Effect.catchTag("SqlError", Effect.succeed),
				),
			).toMatchObject({ _tag: "SqlError" })
			expect(yield* readSnapshot("doc")).toEqual(before)
			expect(yield* nativeEntries()).toHaveLength(99)
			yield* sql`DROP TRIGGER fail_checkpoint`
			expect(yield* commit(proposal)).toBe(100)
			expect((yield* load()).fields("doc").setting).toBe("Complete")
		}).pipe(Effect.provide(layer("checkpoint-rollback"))),
	)
})

test("more open documents than cache capacity retain complete durable state", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			for (let index = 0; index < 40; index++) {
				let document = "document-" + index
				let actor = "actor-" + index
				let proposal = yield* buildAction(
					new Replica(actor),
					document,
					"Create",
					staged => newDocument(staged, document, "Untitled", "Body " + index),
				)
				yield* commit(proposal).pipe(
					Effect.provideService(Principal, {
						subject: "owner",
						actors: [actor],
						role: "owner",
					}),
				)
			}
			for (let index = 0; index < 40; index++) {
				let document = "document-" + index
				expect((yield* load(document)).text(document)).toBe("Body " + index)
			}
		}).pipe(Effect.provide(layer("cache-capacity"))),
	)
})

test("overlapping covered actions are idempotent after checkpoint restore and preserve offline edits", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			let proposal = yield* buildAction(
				replica,
				"doc",
				"Edit and discuss",
				staged => [
					staged.edit("doc", staged.text("doc") + "\nCommitted"),
					...newComment(
						staged,
						"comment",
						"doc",
						"Quote",
						"Discussion",
						"Owner",
					),
				],
			)
			yield* commit(proposal)
			let cold = yield* load("doc", "offline-device")
			let own = cold.edit("doc", cold.text("doc") + "\nOffline")
			if (!own) return yield* Effect.die("Missing offline action")
			let before = cold.revision("doc")
			let commentBefore = cold.revision("comment")
			for (let entry of yield* readHistory("doc")) {
				yield* applyAction(cold, entry.action)
				yield* applyAction(cold, entry.action)
			}
			expect(cold.revision("doc")).toBe(before)
			expect(cold.revision("comment")).toBe(commentBefore)
			expect(cold.text("doc")).toContain("Offline")
		}).pipe(Effect.provide(layer("checkpoint-overlap"))),
	)
})

test("prevalidation rejects duplicate identities and an unowned child before any live or durable mutation", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			let proposal = yield* buildAction(replica, "doc", "Setting", staged => [
				staged.set("doc", "setting", "Pending"),
			])
			let change = proposal.changes[0]
			let duplicate = Schema.decodeUnknownSync(DocumentActionSchema)({
				...proposal,
				changes: [change, change],
			})
			expect(
				yield* commit(duplicate).pipe(
					Effect.catchTag("DocumentConflict", Effect.succeed),
				),
			).toMatchObject({ message: "Action identity must match its operations" })
			let invalidChild = yield* buildAction(
				replica,
				"doc",
				"Mixed targets",
				staged => [
					staged.set("doc", "setting", "Pending"),
					staged.set("unowned-child", "type", "comment"),
				],
			)
			expect(
				yield* commit(invalidChild).pipe(
					Effect.catchTag("DocumentConflict", Effect.succeed),
				),
			).toMatchObject({
				message: "A document action cannot mutate another document",
			})
			expect((yield* load()).fields("doc").setting).toBeUndefined()
			expect((yield* load()).fields("unowned-child").type).toBeUndefined()
			expect(yield* readHistory("doc")).toHaveLength(1)
			expect(yield* nativeEntries()).toHaveLength(1)
		}).pipe(Effect.provide(layer("action-preflight"))),
	)
})

test("a post-commit cache defect preserves the receipt and notice and rebuilds on the next read", async () => {
	let apply = Replica.prototype.apply
	let failed = false
	let logged = false
	Replica.prototype.apply = function (changes) {
		if (
			!failed &&
			changes.some(
				change => change.field === "setting" && change.value === "Cache fault",
			)
		) {
			failed = true
			throw new Error("Injected cache projection defect")
		}
		return apply.call(this, changes)
	}
	try {
		await Effect.runPromise(
			Effect.gen(function* () {
				yield* commit(yield* initial())
				let replica = yield* load()
				let change = replica.create("doc", "set")
				change.field = "setting"
				change.value = "Cache fault"
				let proposal = Schema.decodeUnknownSync(DocumentActionSchema)({
					id: change.id,
					document: "doc",
					actor: replica.actor,
					label: "Change",
					changes: [change],
					guards: [],
					accessGuards: [],
				})
				let store = yield* DocumentStore
				let subscription = yield* store.changes
				let position = yield* commit(proposal)
				expect(failed).toBe(true)
				expect(logged).toBe(true)
				expect(position).toBe(2)
				expect(
					(yield* PubSub.takeAll(subscription)).map(notice => notice.position),
				).toEqual([2])
				expect((yield* load()).fields("doc").setting).toBe("Cache fault")
				expect(yield* commit(proposal)).toBe(position)
				expect(yield* nativeEntries()).toHaveLength(2)
			}).pipe(
				Effect.scoped,
				Effect.provide(layer("cache-defect")),
				Effect.provide(
					Logger.layer([
						Logger.make(() => {
							logged = true
							throw new Error("Injected logger defect")
						}),
					]),
				),
			),
		)
	} finally {
		Replica.prototype.apply = apply
	}
})

test("hundreds of comment revisions stay in optional history rather than the current snapshot", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			yield* commit(
				yield* buildAction(replica, "doc", "Add comment", staged =>
					newComment(staged, "comment", "doc", "Quote", "Initial", "Owner"),
				),
			)
			for (let index = 0; index < 500; index++) {
				replica = yield* load()
				yield* commit(
					yield* buildAction(replica, "doc", "Edit comment", staged => [
						staged.set("comment", "body", "Revision " + index),
					]),
				)
			}
			let snapshot = yield* readSnapshot("doc")
			if (!snapshot) return yield* Effect.die("Missing snapshot")
			let entries = yield* nativeEntries()
			expect(entries).toHaveLength(502)
			expect(snapshot.state.length).toBeLessThan(12_000)
			let restored = yield* restoreSnapshot(snapshot, "cold")
			expect(restored.fields("comment").body).toBe("Revision 499")
			console.log(
				"MEASURE whole document",
				JSON.stringify({
					events: entries.length,
					snapshotBytes: new TextEncoder().encode(JSON.stringify(snapshot))
						.length,
					historyPayloadBytes: entries.reduce(
						(size, entry) => size + entry.payload.byteLength,
						0,
					),
				}),
			)
		}).pipe(Effect.provide(layer("comment-history"))),
	)
})

for (let role of ["reader", "writer"] satisfies ("reader" | "writer")[]) {
	test(
		role + " cannot grant document access through the event stream",
		async () => {
			await Effect.runPromise(
				Effect.gen(function* () {
					let action = yield* buildAction(
						new Replica("owner"),
						"doc",
						"Grant access",
						staged => [
							...newDocument(staged, "doc", "Untitled", "Body"),
							staged.set("doc", "access:peer", "writer"),
						],
					)
					expect(Exit.isFailure(yield* commit(action).pipe(Effect.exit))).toBe(
						true,
					)
					expect(yield* readSnapshot("doc")).toBeUndefined()
					expect(yield* nativeEntries()).toEqual([])
				}).pipe(Effect.provide(layer("access-" + role, role))),
			)
		},
	)
}

test("a document envelope cannot contain another document's records or a forged actor", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let foreign = yield* buildAction(
				new Replica("owner"),
				"doc",
				"Foreign record",
				staged =>
					setFields(staged, "comment", {
						type: "comment",
						document: "other-doc",
						body: "Foreign",
					}),
			)
			expect(Exit.isFailure(yield* commit(foreign).pipe(Effect.exit))).toBe(
				true,
			)
			let forged = yield* buildAction(
				new Replica("peer"),
				"doc",
				"Forge actor",
				staged => newDocument(staged, "doc", "Untitled", "Body"),
			)
			expect(Exit.isFailure(yield* commit(forged).pipe(Effect.exit))).toBe(true)
			expect(yield* readSnapshot("doc")).toBeUndefined()
		}).pipe(Effect.provide(layer("foreign"))),
	)
})

test("inflated clocks cannot freeze subsequent document edits", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			let change = new Replica("owner").set("doc", "mode", "slideshow")
			let id = String(Number.MAX_SAFE_INTEGER).padStart(16, "0") + ":owner"
			let forged = Schema.decodeUnknownSync(DocumentActionSchema)({
				id,
				document: "doc",
				actor: "owner",
				label: "Inflate clock",
				changes: [{ ...change, id, clock: Number.MAX_SAFE_INTEGER }],
				before: [],
				guards: [],
				accessGuards: [],
			})
			expect(Exit.isFailure(yield* commit(forged).pipe(Effect.exit))).toBe(true)
			expect((yield* load()).clock).toBe(replica.clock)
			yield* commit(
				yield* buildAction(replica, "doc", "Continue editing", staged => [
					staged.edit("doc", staged.text("doc") + "\nStill writable"),
				]),
			)
			expect((yield* load()).text("doc")).toContain("Still writable")
		}).pipe(Effect.provide(layer("clock"))),
	)
})

test("global ownership rejects claiming another document root or child", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let original = yield* load()
			yield* commit(
				yield* buildAction(original, "doc", "Add comment", staged =>
					newComment(staged, "comment", "doc", "Quote", "Original", "Owner"),
				),
			)
			for (let target of ["doc", "comment"]) {
				let proposal = yield* buildAction(
					new Replica("peer"),
					"other",
					"Claim target",
					staged => [
						...newDocument(staged, "other", "Untitled", "Other document"),
						...setFields(staged, target, {
							type: "comment",
							document: "other",
						}),
					],
				)
				let denied = yield* commit(proposal).pipe(
					Effect.provideService(Principal, {
						subject: "peer",
						actors: ["peer"],
						role: "owner",
					}),
					Effect.exit,
				)
				expect(Exit.isFailure(denied)).toBe(true)
				expect(yield* readSnapshot("other")).toBeUndefined()
			}
			expect((yield* load()).fields("comment").body).toBe("Original")
		}).pipe(Effect.provide(layer("ownership"))),
	)
})

test("undo uses the persisted server before-image; forged provenance or compensation is rejected", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			yield* commit(
				yield* buildAction(replica, "doc", "Add comment", staged =>
					newComment(staged, "comment", "doc", "Quote", "Original", "Owner"),
				),
			)
			replica = yield* load()
			let changed = yield* buildAction(
				replica,
				"doc",
				"Edit comment",
				staged => [staged.set("comment", "body", "Updated")],
			)
			yield* commit(
				Schema.decodeUnknownSync(DocumentActionSchema)({
					...changed,
					before: [{ target: "comment", field: "body", value: "Injected" }],
				}),
			)
			let persisted = (yield* readHistory("doc")).find(
				entry => entry.action.id === changed.id,
			)?.action
			if (!persisted) return yield* Effect.die("Missing persisted action")
			expect(persisted.before[0]?.value).toBe("Original")
			let cold = yield* load()
			let undo = yield* undoAction(cold, persisted)
			expect(
				Exit.isFailure(
					yield* commit({ ...undo, undoOf: "missing" }).pipe(Effect.exit),
				),
			).toBe(true)
			let forged = Schema.decodeUnknownSync(DocumentActionSchema)({
				...undo,
				changes: undo.changes.map(change => ({ ...change, value: "Injected" })),
			})
			expect(Exit.isFailure(yield* commit(forged).pipe(Effect.exit))).toBe(true)
			yield* commit(undo)
			expect((yield* load()).fields("comment").body).toBe("Original")
			let fact = (yield* readHistory("doc")).at(-1)?.action
			if (!fact) return yield* Effect.die("Missing undo fact")
			expect("guards" in fact).toBe(false)
			let pending = yield* restoreSnapshot(
				{
					format: "document-state-v1",
					document: "doc",
					log: "pending",
					position: 0,
					state: JSON.stringify(cold.checkpoint()),
				},
				"pending",
			)
			replyToComment(pending, "comment", "Unrelated pending reply", "Peer", {
				id: "pending",
				time: 456,
			})
			yield* applyAction(pending, fact)
			expect(pending.fields("comment").body).toBe("Original")
			expect(pending.fields("comment")["reply:456:pending"]).toContain(
				"Unrelated pending reply",
			)
		}).pipe(Effect.provide(layer("provenance"))),
	)
})

test("history distinguishes snapshot recovery from permanently unavailable actions", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let snapshot = yield* readSnapshot("doc")
			if (!snapshot) return yield* Effect.die("Missing snapshot")
			expect(
				yield* readHistory("doc", snapshot.position, "other-log").pipe(
					Effect.catchTag("DocumentHistoryUnavailable", Effect.succeed),
				),
			).toMatchObject({ reason: "EpochChanged" })
			expect(
				yield* readHistory("doc", snapshot.position + 100, snapshot.log).pipe(
					Effect.catchTag("DocumentHistoryUnavailable", Effect.succeed),
				),
			).toMatchObject({ reason: "CursorInvalid" })
			let sql = yield* SqlClient.SqlClient
			yield* sql`UPDATE document_heads SET log='restored-backup' WHERE document='doc'`
			yield* sql`UPDATE document_tips SET log='restored-backup' WHERE document='doc'`
			expect(
				Exit.isFailure(
					yield* readHistory("doc", snapshot.position, snapshot.log).pipe(
						Effect.exit,
					),
				),
			).toBe(true)
			yield* sql`DELETE FROM effect_event_journal`
			expect(
				yield* readHistory("doc").pipe(
					Effect.catchTag("DocumentHistoryUnavailable", Effect.succeed),
				),
			).toMatchObject({
				reason: "ActionPruned",
				document: "doc",
				position: snapshot.position,
			})
			let creation = yield* initial()
			expect(
				yield* readAction("doc", creation.id).pipe(
					Effect.catchTag("DocumentHistoryUnavailable", Effect.succeed),
				),
			).toMatchObject({ reason: "ActionPruned", action: creation.id })
			expect((yield* load()).metadata("doc").title).toBe("Source title")
		}).pipe(Effect.provide(layer("epoch"))),
	)
})

test("undo cannot remove an asset now referenced by another writer", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			let attached = yield* buildAction(replica, "doc", "Attach", staged =>
				setFields(staged, "asset", {
					type: "asset",
					document: "doc",
					digest: "blob",
				}),
			)
			yield* commit(attached)
			let peer = yield* load("doc", "peer")
			yield* commit(
				yield* buildAction(peer, "doc", "Reference asset", staged => [
					staged.edit("doc", staged.text("doc") + "\n![Photo](asset:asset)"),
				]),
			).pipe(
				Effect.provideService(Principal, {
					subject: "peer",
					actors: ["peer"],
					role: "writer",
				}),
			)
			let undo = yield* undoAction(yield* load(), yield* stored(attached)).pipe(
				Effect.result,
			)
			expect(undo._tag).toBe("Failure")
			if (undo._tag === "Failure")
				expect(undo.failure._tag).toBe("UndoUnavailable")
			expect((yield* load()).fields("asset").type).toBe("asset")
		}).pipe(Effect.provide(layer("asset-reference"))),
	)
})

test("undoing document creation cannot orphan a collaborator's discussion", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let created = yield* initial()
			yield* commit(created)
			let peer = yield* load("doc", "peer")
			yield* commit(
				yield* buildAction(peer, "doc", "Discuss", staged =>
					newComment(
						staged,
						"comment",
						"doc",
						"Quote",
						"Keep this document",
						"Peer",
					),
				),
			).pipe(
				Effect.provideService(Principal, {
					subject: "peer",
					actors: ["peer"],
					role: "writer",
				}),
			)
			let fact = yield* stored(created)
			expect(
				(yield* undoAction(yield* load(), fact).pipe(Effect.result))._tag,
			).toBe("Failure")
			let pending = yield* buildAction(
				yield* load(),
				"doc",
				"Forged birth undo",
				staged => [staged.set("doc", "type", "deleted")],
			)
			expect(
				Exit.isFailure(
					yield* commit({ ...pending, undoOf: fact.id }).pipe(Effect.exit),
				),
			).toBe(true)
			let current = yield* load()
			expect(current.fields("doc").type).toBe("document")
			expect(current.fields("comment").body).toBe("Keep this document")
		}).pipe(Effect.provide(layer("creation-undo"))),
	)
})

test("the document layer exposes no journal, SQL, crypto or ambient principal", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let context = yield* Effect.context<never>()
			expect(Option.isNone(Context.getOption(context, EventLog.EventLog))).toBe(
				true,
			)
			expect(
				Option.isNone(Context.getOption(context, EventJournal.EventJournal)),
			).toBe(true)
			expect(
				Option.isNone(Context.getOption(context, SqlClient.SqlClient)),
			).toBe(true)
			expect(Option.isNone(Context.getOption(context, Principal))).toBe(true)
			expect(Option.isNone(Context.getOption(context, Crypto.Crypto))).toBe(
				true,
			)
			expect(Option.isNone(Context.getOption(context, EventLog.Identity))).toBe(
				true,
			)
			expect(Option.isNone(Context.getOption(context, EventLog.Registry))).toBe(
				true,
			)
			expect(
				Option.isNone(Context.getOption(context, Reactivity.Reactivity)),
			).toBe(true)
			let store = yield* DocumentStore
			expect(yield* store.snapshot("missing")).toBeUndefined()
		}).pipe(
			Effect.provide(DocumentStore.layer(join(directory, "private.sqlite"))),
		),
	)
})

test("failed outer COMMIT publishes no notice; success and retry publish exactly one durable position", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* DocumentStore
			let subscription = yield* store.changes
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TABLE commit_parent (id INTEGER PRIMARY KEY)`
			yield* sql`CREATE TABLE commit_child (parent INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED)`
			yield* sql`CREATE TRIGGER reject_commit AFTER INSERT ON effect_event_journal BEGIN INSERT INTO commit_child VALUES (123); END`
			let action = yield* initial()
			expect(
				yield* commit(action).pipe(Effect.catchTag("SqlError", Effect.succeed)),
			).toMatchObject({ _tag: "SqlError" })
			expect(yield* readSnapshot("doc")).toBeUndefined()
			for (let table of [
				"document_tips",
				"document_actions",
				"document_operation_ids",
				"document_targets",
				"document_actor_subjects",
				"effect_event_journal",
			])
				expect(yield* sql`SELECT * FROM ${sql(table)}`).toEqual([])
			yield* sql`DROP TRIGGER reject_commit`
			let position = yield* commit(action)
			expect(yield* commit(action)).toBe(position)
			let notices = yield* PubSub.takeAll(subscription)
			expect(notices).toHaveLength(1)
			expect(notices[0]?.position).toBe(position)
			let snapshot = yield* readSnapshot("doc")
			if (!snapshot) return yield* Effect.die("Missing committed snapshot")
			expect(notices[0]?.log).toBe(snapshot.log)
		}).pipe(Effect.scoped, Effect.provide(layer("commit-notices"))),
	)
})

test("one authenticated principal can authorize distinct device actors and independent document streams", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			for (let document of ["doc-a", "doc-b"]) {
				let actor = document + "-owner"
				let proposal = yield* buildAction(
					new Replica(actor),
					document,
					"Create",
					staged =>
						newDocument(staged, document, "Untitled", "Body " + document),
				)
				yield* commit(proposal).pipe(
					Effect.provideService(Principal, {
						subject: "owner",
						actors: [actor],
						role: "owner",
					}),
				)
			}
			expect((yield* load("doc-a")).text("doc-a")).toBe("Body doc-a")
			expect((yield* load("doc-b")).text("doc-b")).toBe("Body doc-b")
			for (let actor of ["owner-device-a", "owner-device-b"]) {
				let replica = yield* load("doc-a", actor)
				yield* commit(
					yield* buildAction(replica, "doc-a", "Device edit", staged => [
						staged.edit("doc-a", staged.text("doc-a") + "\n" + actor),
					]),
				).pipe(
					Effect.provideService(Principal, {
						subject: "owner",
						actors: ["owner-device-a", "owner-device-b"],
						role: "writer",
					}),
				)
			}
			expect((yield* load("doc-a")).text("doc-a")).toContain("owner-device-b")
			expect(yield* readHistory("doc-b")).toHaveLength(1)
		}).pipe(Effect.provide(layer("multiple-documents"))),
	)
})

test("a stalled subscriber retains one wake-up hint and recovers every document from durable history", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* DocumentStore
			let subscription = yield* store.changes
			for (let document of ["doc-a", "doc-b"]) {
				let actor = document + "-owner"
				let replica = new Replica(actor)
				yield* commit(
					yield* buildAction(replica, document, "Create", staged =>
						newDocument(staged, document, "Untitled", "Body"),
					),
				).pipe(
					Effect.provideService(Principal, {
						subject: "owner",
						actors: [actor],
						role: "owner",
					}),
				)
			}
			let replica = yield* load("doc-b")
			for (let index = 0; index < 100; index++) {
				let proposal = yield* buildAction(replica, "doc-b", "Edit", staged => [
					staged.set("doc-b", "setting", String(index)),
				])
				yield* commit(proposal)
				yield* applyAction(replica, yield* stored(proposal))
			}
			expect(yield* PubSub.takeAll(subscription)).toHaveLength(1)
			expect(yield* readHistory("doc-a")).toHaveLength(1)
			expect(yield* readHistory("doc-b")).toHaveLength(101)
			expect((yield* load("doc-b")).fields("doc-b").setting).toBe("99")
		}).pipe(Effect.scoped, Effect.provide(layer("slow-subscriber"))),
	)
})

test("the server rejects an actor reused in another document even when both proposals are otherwise authorized", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let created = yield* initial()
			yield* commit(created)
			let other = yield* buildAction(
				new Replica("owner"),
				"other",
				"Create",
				staged => newDocument(staged, "other", "Untitled", "Other document"),
			)
			expect(
				yield* commit(other).pipe(
					Effect.catchTag("DocumentConflict", Effect.succeed),
				),
			).toMatchObject({
				_tag: "DocumentConflict",
				message: "Actor identity is not authorized",
			})
			expect(yield* readSnapshot("other")).toBeUndefined()
			expect(yield* readHistory("doc")).toHaveLength(1)
			expect(yield* commit(created)).toBe(1)
		}).pipe(Effect.provide(layer("actor-document-binding"))),
	)
})

test("undo fetches only its requested action even when unrelated old history is unavailable", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let created = yield* initial()
			yield* commit(created)
			let replica = yield* load()
			yield* commit(
				yield* buildAction(replica, "doc", "Discuss", staged =>
					newComment(staged, "comment", "doc", "Quote", "Original", "Owner"),
				),
			)
			replica = yield* load()
			let edited = yield* buildAction(
				replica,
				"doc",
				"Edit discussion",
				staged => [staged.set("comment", "body", "Updated")],
			)
			yield* commit(edited)
			let sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM effect_event_journal WHERE id IN (SELECT entry FROM document_actions WHERE document='doc' AND action=${created.id})`
			expect(Exit.isFailure(yield* readHistory("doc").pipe(Effect.exit))).toBe(
				true,
			)
			let fact = yield* stored(edited)
			yield* commit(yield* undoAction(yield* load(), fact))
			expect((yield* load()).fields("comment").body).toBe("Original")
		}).pipe(Effect.provide(layer("direct-undo"))),
	)
})

test("writers undo their own account's action from another device; actor identity cannot be claimed by another account", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let device = yield* load("doc", "device-a")
			let created = yield* buildAction(device, "doc", "Discuss", staged =>
				newComment(staged, "comment", "doc", "Quote", "My comment", "Owner"),
			)
			yield* commit(created).pipe(
				Effect.provideService(Principal, {
					subject: "owner",
					actors: ["device-a"],
					role: "writer",
				}),
			)
			let fact = yield* stored(created)
			expect(fact.subject).toBe("owner")
			let otherDevice = yield* load("doc", "device-b")
			let undo = yield* undoAction(otherDevice, fact)
			yield* commit(undo).pipe(
				Effect.provideService(Principal, {
					subject: "owner",
					actors: ["device-b"],
					role: "writer",
				}),
			)
			expect((yield* load()).fields("comment").type).toBe("deleted")
			device = yield* load("doc", "device-a")
			let impersonation = yield* buildAction(
				device,
				"doc",
				"Impersonate",
				staged => [staged.edit("doc", staged.text("doc") + "\nForged edit")],
			)
			expect(
				Exit.isFailure(
					yield* commit(impersonation).pipe(
						Effect.provideService(Principal, {
							subject: "impostor",
							actors: ["device-a"],
							role: "writer",
						}),
						Effect.exit,
					),
				),
			).toBe(true)
			expect((yield* load()).text("doc")).not.toContain("Forged edit")
		}).pipe(Effect.provide(layer("account-undo"))),
	)
})

test("document-native producers have independent clocks and namespace identities across one workspace", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let a = yield* documentReplica("doc-a", "browser-session")
			let b = yield* documentReplica("doc-b", "browser-session")
			expect(a.actor).not.toBe(b.actor)
			let principal = {
				subject: "owner",
				actors: [a.actor, b.actor],
				role: "owner",
			} satisfies typeof Principal.Service
			for (let [document, replica] of [
				["doc-a", a],
				["doc-b", b],
			] satisfies [string, Replica][]) {
				let proposal = yield* buildAction(replica, document, "Create", staged =>
					newDocument(staged, document, "Untitled", "Body " + document),
				)
				yield* commit(proposal).pipe(
					Effect.provideService(Principal, principal),
				)
				yield* applyAction(replica, yield* stored(proposal))
				if (document === "doc-a") {
					for (let index = 0; index < 100; index++) {
						let edit = yield* buildAction(replica, document, "Type", staged => [
							staged.edit(document, staged.text(document) + "."),
						])
						yield* commit(edit).pipe(
							Effect.provideService(Principal, principal),
						)
						yield* applyAction(replica, yield* stored(edit))
					}
				}
			}
			expect(a.clock).toBeGreaterThan(100)
			expect(b.clock).toBeLessThan(10)
			let combined = new Replica("readonly-workspace")
			for (let document of ["doc-a", "doc-b"])
				for (let entry of yield* readHistory(document))
					yield* applyAction(combined, entry.action)
			expect(combined.text("doc-a")).toBe(a.text("doc-a"))
			expect(combined.text("doc-b")).toBe(b.text("doc-b"))
			let snapshot = yield* readSnapshot("doc-b")
			if (!snapshot) return yield* Effect.die("Missing document snapshot")
			let reopened = yield* documentReplica(
				"doc-b",
				"browser-session",
				snapshot,
			)
			expect(reopened.actor).toBe(b.actor)
			expect(reopened.clock).toBe(b.clock)
		}).pipe(
			Effect.provide(layer("document-producers")),
			Effect.provide(webCryptoLayer),
		),
	)
})

test("undo and redo compensate a mixed source and attachment action atomically", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let replica = yield* load()
			let action = yield* buildAction(
				replica,
				"doc",
				"Attach image",
				staged => [
					...setFields(staged, "asset", {
						type: "asset",
						document: "doc",
						digest: "image-blob",
					}),
					staged.edit("doc", staged.text("doc") + "\n![Image](asset:asset)"),
				],
			)
			let position = yield* commit(action)
			let current = yield* load()
			let before = current.checkpoint()
			let undo = yield* undoAction(current, yield* stored(action))
			expect(undo.changes.some(change => change.kind === "cancel")).toBe(true)
			expect(current.checkpoint()).toEqual(before)
			let compensated = yield* commit(undo)
			let restored = yield* load()
			expect(restored.text("doc")).toBe(replica.text("doc"))
			expect(restored.fields("asset").type).toBe("deleted")
			let snapshot = yield* readSnapshot("doc")
			if (!snapshot) return yield* Effect.die("Missing document snapshot")
			expect(snapshot.position).toBe(compensated)
			expect(compensated).toBeGreaterThan(position)
			let redo = yield* undoAction(
				yield* restoreSnapshot(snapshot, "owner"),
				yield* stored(undo),
			)
			yield* commit(redo)
			let redone = yield* load()
			expect(redone.text("doc")).toBe(current.text("doc"))
			expect(redone.fields("asset").type).toBe("asset")
			expect(redone.fields("asset").digest).toBe("image-blob")
			let replayed = new Replica("replayed")
			for (let entry of yield* readHistory("doc"))
				yield* applyAction(replayed, entry.action)
			expect(replayed.revision("doc")).toBe(redone.revision("doc"))
			expect(replayed.revision("asset")).toBe(redone.revision("asset"))
			expect(
				(yield* commit(yield* undoAction(redone, yield* stored(action))).pipe(
					Effect.result,
				))._tag,
			).toBe("Failure")
			yield* commit(yield* undoAction(redone, yield* stored(redo)))
			expect((yield* load()).fields("asset").type).toBe("deleted")
		}).pipe(Effect.provide(layer("mixed-undo"))),
	)
})

test("concurrent device undos accept one compensation and require the latest chain action after redo", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let changed = yield* buildAction(
				yield* load(),
				"doc",
				"Text and mode",
				staged => [
					staged.edit("doc", staged.text("doc") + "\nOwn"),
					staged.set("doc", "mode", "slideshow"),
				],
			)
			yield* commit(changed)
			let original = yield* stored(changed)
			let proposals = yield* Effect.all(
				["device-a", "device-b"].map(actor =>
					load("doc", actor).pipe(
						Effect.flatMap(replica => undoAction(replica, original)),
					),
				),
			)
			let outcomes = yield* Effect.all(
				proposals.map(action =>
					commit(action).pipe(
						Effect.provideService(Principal, {
							subject: "owner",
							actors: [action.actor],
							role: "writer",
						}),
						Effect.result,
					),
				),
				{ concurrency: "unbounded" },
			)
			expect(
				outcomes.filter(outcome => outcome._tag === "Success"),
			).toHaveLength(1)
			let failed = outcomes.find(outcome => outcome._tag === "Failure")
			expect(failed?._tag === "Failure" && failed.failure._tag).toBe(
				"UndoUnavailable",
			)
			let history = yield* readHistory("doc"),
				undo = history.at(-1)?.action
			if (!undo) throw new Error("Missing compensation")
			expect(history).toHaveLength(3)
			expect((yield* load()).fields("doc").mode).toBe("")
			let redo = yield* undoAction(yield* load(), undo)
			yield* commit(redo)
			let reused = yield* commit(
				yield* undoAction(yield* load(), original),
			).pipe(Effect.result)
			expect(reused._tag).toBe("Failure")
			if (reused._tag === "Failure")
				expect(reused.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "Superseded",
				})
			yield* commit(yield* undoAction(yield* load(), yield* stored(redo)))
			expect((yield* load()).fields("doc").mode).toBe("")
		}).pipe(Effect.provide(layer("concurrent-undo"))),
	)
})

test("indexed chain lookup survives history pruning and restart, and rejects broken edges", async () => {
	let name = "indexed-action-chain"
	let saved = await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* DocumentStore
			let sql = yield* SqlClient.SqlClient
			yield* commit(yield* initial())
			let original = yield* buildAction(
				yield* load(),
				"doc",
				"Present",
				staged => [staged.set("doc", "mode", "slideshow")],
			)
			let position = yield* commit(original)
			let start = yield* store.chain("doc", original.id)
			if (!start) throw new Error("Missing original chain receipt")
			expect(start).toMatchObject({
				document: "doc",
				from: original.id,
				latest: original.id,
				position,
				depth: 0,
			})
			expect(yield* store.chain("doc", "absent")).toBeUndefined()
			expect(yield* store.chain("other", original.id)).toBeUndefined()
			let latest = original
			for (let index = 0; index < 32; index++) {
				latest = yield* undoAction(yield* load(), yield* stored(latest))
				position = yield* commit(latest)
			}
			let expected = {
				document: "doc",
				from: original.id,
				latest: latest.id,
				position,
				depth: 32,
				log: start.log,
			}
			expect(yield* store.chain("doc", original.id)).toEqual(expected)
			yield* sql`INSERT INTO document_undo_boundaries VALUES('doc',${start.position})`
			expect(yield* store.chain("doc", original.id)).toEqual(expected)
			yield* sql`DELETE FROM effect_event_journal WHERE id IN (SELECT entry FROM document_actions WHERE document='doc')`
			expect(yield* store.chain("doc", original.id)).toEqual(expected)
			return { original, latest, expected }
		}).pipe(Effect.provide(layer(name))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* DocumentStore
			let sql = yield* SqlClient.SqlClient
			expect(yield* store.chain("doc", saved.original.id)).toEqual(
				saved.expected,
			)
			for (let successor of ["missing", saved.original.id, saved.latest.id]) {
				yield* sql`INSERT INTO document_compensations(document,original,action) VALUES('doc',${saved.latest.id},${successor})`
				let broken = yield* store
					.chain("doc", saved.original.id)
					.pipe(Effect.result)
				expect(broken._tag).toBe("Failure")
				if (broken._tag === "Failure")
					expect(broken.failure).toMatchObject({ _tag: "DocumentConflict" })
				yield* sql`DELETE FROM document_compensations WHERE document='doc' AND original=${saved.latest.id}`
			}
			expect(yield* store.chain("doc", saved.original.id)).toEqual(
				saved.expected,
			)
		}).pipe(Effect.provide(layer(name))),
	)
})

test("compensation migration reconstructs retained chain edges and conservatively refuses unknown pruned provenance", async () => {
	let name = "undo-migration"
	let identities = await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let eligible = yield* buildAction(
				yield* load(),
				"doc",
				"Independent field",
				staged => [staged.set("doc", "retained", "value")],
			)
			yield* commit(eligible)
			let changed = yield* buildAction(
				yield* load(),
				"doc",
				"Change",
				staged => [
					staged.edit("doc", "Changed"),
					staged.set("doc", "mode", "slideshow"),
				],
			)
			yield* commit(changed)
			let original = yield* stored(changed)
			let undo = yield* undoAction(yield* load(), original)
			yield* commit(undo)
			let redo = yield* undoAction(yield* load(), yield* stored(undo))
			yield* commit(redo)
			let sql = yield* SqlClient.SqlClient
			yield* sql`DROP TABLE document_compensations`
			yield* sql`DROP TABLE document_undo_boundaries`
			yield* sql`DROP TABLE document_action_migrations`
			return { original, redo, eligible }
		}).pipe(Effect.provide(layer(name))),
	)
	let migrated = await Effect.runPromise(
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			let edge =
				yield* sql`SELECT action FROM document_compensations WHERE document='doc' AND original=${identities.original.id}`
			expect(edge).toHaveLength(1)
			let duplicate = yield* commit(
				yield* undoAction(yield* load(), identities.original),
			).pipe(Effect.result)
			expect(duplicate._tag).toBe("Failure")
			if (duplicate._tag === "Failure")
				expect(duplicate.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "Superseded",
				})
			let undo = yield* undoAction(
				yield* load(),
				yield* stored(identities.redo),
			)
			let cutoff = yield* commit(undo)
			let latest = yield* buildAction(
				yield* load(),
				"doc",
				"Latest",
				staged => [staged.set("doc", "other", "value")],
			)
			yield* commit(latest)
			let current = yield* readSnapshot("doc")
			if (!current) throw new Error("Missing state before retention")
			yield* sql`UPDATE document_heads SET position=${current.position},state=${current.state},version=(SELECT version FROM document_tips WHERE document='doc') WHERE document='doc'`
			yield* sql`DELETE FROM effect_event_journal WHERE id=(SELECT entry FROM document_actions WHERE document='doc' AND action=${undo.id})`
			yield* sql`DROP TABLE document_compensations`
			yield* sql`DROP TABLE document_undo_boundaries`
			yield* sql`DROP TABLE document_action_migrations`
			return { latest, cutoff }
		}).pipe(Effect.provide(layer(name))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			let boundaries =
				yield* sql`SELECT position FROM document_undo_boundaries WHERE document='doc'`
			expect(boundaries).toEqual([{ position: migrated.cutoff }])
			let store = yield* DocumentStore
			let uncertain = yield* store
				.chain("doc", identities.original.id)
				.pipe(Effect.result)
			expect(uncertain._tag).toBe("Failure")
			if (uncertain._tag === "Failure")
				expect(uncertain.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "BelowFloor",
				})
			expect(yield* store.chain("doc", migrated.latest.id)).toMatchObject({
				latest: migrated.latest.id,
				depth: 0,
			})
			let replica = yield* load()
			let below = yield* undoAction(replica, yield* stored(identities.eligible))
			let result = yield* commit(below).pipe(Effect.result)
			expect(result._tag).toBe("Failure")
			if (result._tag === "Failure")
				expect(result.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "BelowFloor",
				})
			yield* commit(
				yield* undoAction(yield* load(), yield* stored(migrated.latest)),
			)
			expect((yield* load()).fields("doc").other).toBe("")
		}).pipe(Effect.provide(layer(name))),
	)
})

test("the verification migration disables ambiguous legacy double compensations across pages on an already indexed store", async () => {
	let name = "legacy-double-compensation"
	let saved = await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let original = yield* buildAction(
				yield* load(),
				"doc",
				"Text",
				staged => [staged.edit("doc", staged.text("doc") + "\nOwn")],
			)
			yield* commit(original)
			let fact = yield* stored(original)
			let undo = yield* undoAction(yield* load(), fact)
			yield* commit(undo)
			let redo = yield* undoAction(yield* load(), yield* stored(undo))
			yield* commit(redo)
			for (let index = 0; index < 100; index++)
				yield* commit(
					yield* buildAction(
						yield* load(),
						"doc",
						"Retained change",
						staged => [staged.set("doc", "padding", String(index))],
					),
				)
			let before = yield* load()
			let duplicate = yield* undoAction(before, fact)
			let legacy = yield* committedAction(before, duplicate, "owner", fact)
			let proper = yield* undoAction(before, yield* stored(redo))
			expect(duplicate.id).toBe(proper.id)
			let cutoff = yield* commit(proper)
			let latest = yield* buildAction(
				yield* load(),
				"doc",
				"Independent",
				staged => [staged.set("doc", "later", "value")],
			)
			yield* commit(latest)
			let current = yield* readSnapshot("doc")
			if (!current) throw new Error("Missing legacy current state")
			let sql = yield* SqlClient.SqlClient
			let bytes = yield* Schema.encodeEffect(
				SchemaBinary.toCodec(CommittedActionSchema),
			)(legacy)
			yield* sql`UPDATE effect_event_journal SET payload=${bytes} WHERE id=(SELECT entry FROM document_actions WHERE document='doc' AND action=${duplicate.id})`
			yield* sql`UPDATE document_heads SET position=${current.position},state=${current.state},version=(SELECT version FROM document_tips WHERE document='doc') WHERE document='doc'`
			yield* sql`DELETE FROM document_compensations WHERE document='doc'`
			yield* sql`INSERT INTO document_compensations VALUES('doc',${original.id},${duplicate.id})`
			yield* sql`INSERT INTO document_compensations VALUES('doc',${undo.id},${redo.id})`
			yield* sql`DELETE FROM document_action_migrations WHERE migration_id=2`
			return { original, undo, duplicate, latest, cutoff, current }
		}).pipe(Effect.provide(layer(name))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			let store = yield* DocumentStore
			expect(yield* readSnapshot("doc")).toEqual(saved.current)
			expect(
				yield* sql`SELECT position FROM document_undo_boundaries WHERE document='doc'`,
			).toEqual([{ position: saved.cutoff }])
			for (let action of [saved.original, saved.duplicate]) {
				let discovered = yield* store
					.chain("doc", action.id)
					.pipe(Effect.result)
				expect(discovered._tag).toBe("Failure")
				if (discovered._tag === "Failure")
					expect(discovered.failure).toMatchObject({
						_tag: "UndoUnavailable",
						reason: "BelowFloor",
					})
			}
			expect(
				yield* sql`SELECT action FROM document_compensations WHERE document='doc' AND original=${saved.original.id}`,
			).toEqual([{ action: saved.duplicate.id }])
			yield* commit(
				yield* undoAction(yield* load(), yield* stored(saved.latest)),
			)
			expect((yield* load()).fields("doc").later).toBe("")
		}).pipe(Effect.provide(layer(name))),
	)
})

test("a failure after compensation indexing rolls back the edge, receipt, journal and current state", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let changed = yield* buildAction(
				yield* load(),
				"doc",
				"Change",
				staged => [
					staged.edit("doc", "Changed"),
					staged.set("doc", "mode", "slideshow"),
				],
			)
			yield* commit(changed)
			let undo = yield* undoAction(yield* load(), yield* stored(changed))
			let sql = yield* SqlClient.SqlClient,
				before = yield* readSnapshot("doc")
			yield* sql`CREATE TRIGGER reject_compensation_tip BEFORE UPDATE ON document_tips BEGIN SELECT RAISE(ABORT,'Injected failure after compensation indexing'); END`
			expect((yield* commit(undo).pipe(Effect.result))._tag).toBe("Failure")
			expect(yield* sql`SELECT * FROM document_compensations`).toEqual([])
			expect(
				yield* sql`SELECT * FROM document_actions WHERE action=${undo.id}`,
			).toEqual([])
			expect(yield* readSnapshot("doc")).toEqual(before)
			expect(yield* readHistory("doc")).toHaveLength(2)
			yield* sql`DROP TRIGGER reject_compensation_tip`
			yield* commit(undo)
			expect(yield* sql`SELECT * FROM document_compensations`).toHaveLength(1)
			expect((yield* load()).text("doc")).toBe(
				"---\ntitle: Source title\n---\nQuote",
			)
		}).pipe(Effect.provide(layer("undo-index-rollback"))),
	)
})

test("undecodable covered history raises the undo boundary without blocking current snapshots during migration", async () => {
	let name = "damaged-undo-migration"
	let saved = await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let eligible = yield* buildAction(
				yield* load(),
				"doc",
				"Old setting",
				staged => [staged.set("doc", "setting", "value")],
			)
			yield* commit(eligible)
			let damaged = yield* buildAction(
				yield* load(),
				"doc",
				"Covered action",
				staged => [staged.set("doc", "covered", "value")],
			)
			yield* commit(damaged)
			let latest = yield* buildAction(
				yield* load(),
				"doc",
				"Above damaged action",
				staged => [staged.set("doc", "latest", "value")],
			)
			yield* commit(latest)
			let snapshot = yield* readSnapshot("doc")
			if (!snapshot) throw new Error("Missing snapshot")
			let sql = yield* SqlClient.SqlClient
			yield* sql`UPDATE document_heads SET position=${snapshot.position},state=${snapshot.state},version=(SELECT version FROM document_tips WHERE document='doc') WHERE document='doc'`
			yield* sql`UPDATE effect_event_journal SET payload=${new Uint8Array([255])} WHERE id=(SELECT entry FROM document_actions WHERE action=${damaged.id})`
			yield* sql`DROP TABLE document_compensations`
			yield* sql`DROP TABLE document_undo_boundaries`
			yield* sql`DROP TABLE document_action_migrations`
			return { snapshot, eligible, latest }
		}).pipe(Effect.provide(layer(name))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* readSnapshot("doc")).toEqual(saved.snapshot)
			let result = yield* commit(
				yield* undoAction(yield* load(), yield* stored(saved.eligible)),
			).pipe(Effect.result)
			expect(result._tag).toBe("Failure")
			if (result._tag === "Failure")
				expect(result.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "BelowFloor",
				})
			let sql = yield* SqlClient.SqlClient
			expect(
				yield* sql`SELECT position FROM document_undo_boundaries WHERE document='doc'`,
			).toEqual([{ position: 3 }])
			yield* commit(
				yield* undoAction(yield* load(), yield* stored(saved.latest)),
			)
			expect((yield* load()).fields("doc").latest).toBe("")
		}).pipe(Effect.provide(layer(name))),
	)
})

function withdraw(action: DocumentAction) {
	return DocumentStore.use(store => store.withdraw(action))
}
function own<A, E, R>(
	action: DocumentAction,
	operation: Effect.Effect<A, E, R>,
) {
	return operation.pipe(
		Effect.provideService(Principal, {
			subject: "owner",
			actors: [action.actor],
			role: "owner",
		}),
	)
}
test("withdrawals admit exact later proposals across fresh actors without changing content or history", async () => {
	let name = "withdrawal-gap"
	let saved = await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let snapshot = yield* readSnapshot("doc")
			let history = yield* readHistory("doc")
			let staged = yield* load()
			let first = yield* buildAction(
				staged,
				"doc",
				"Withdraw first",
				value => [value.set("doc", "note", "rejected")],
				"withdraw-first",
			)
			staged.apply(first.changes.map(parseOperation))
			let second = yield* buildAction(
				staged,
				"doc",
				"Withdraw second",
				value => [value.set("doc", "note", "dependent")],
				"withdraw-second",
			)
			staged.apply(second.changes.map(parseOperation))
			let healthy = yield* buildAction(
				staged,
				"doc",
				"Healthy",
				value => [value.set("doc", "healthy", "kept")],
				"withdraw-healthy",
			)
			let refused = yield* own(healthy, commit(healthy)).pipe(Effect.result)
			expect(refused._tag).toBe("Failure")
			let outOfOrder = yield* own(second, withdraw(second)).pipe(Effect.result)
			expect(outOfOrder._tag).toBe("Failure")
			yield* own(first, withdraw(first))
			yield* own(second, withdraw(second))
			yield* own(first, withdraw(first))
			expect(yield* readSnapshot("doc")).toEqual(snapshot)
			expect(yield* readHistory("doc")).toEqual(history)
			let forbiddenCommit = yield* own(first, commit(first)).pipe(Effect.result)
			expect(forbiddenCommit._tag).toBe("Failure")
			let changed = { ...first, label: "Different bytes" }
			expect(
				(yield* own(changed, withdraw(changed)).pipe(Effect.result))._tag,
			).toBe("Failure")
			let changedGuard = {
				...first,
				accessGuards: [{ field: "access:reader", observed: "different" }],
			}
			expect(
				(yield* own(changedGuard, withdraw(changedGuard)).pipe(Effect.result))
					._tag,
			).toBe("Failure")
			return { snapshot, history, healthy }
		}).pipe(Effect.provide(layer(name))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* readSnapshot("doc")).toEqual(saved.snapshot)
			expect(yield* readHistory("doc")).toEqual(saved.history)
			yield* own(saved.healthy, commit(saved.healthy))
			let replica = yield* load()
			expect(replica.fields("doc").healthy).toBe("kept")
			expect(replica.fields("doc").note).toBeUndefined()
			expect(replica.clock).toBe(saved.healthy.changes[0].clock)
			expect((yield* readHistory("doc")).map(item => item.action.id)).toEqual([
				...saved.history.map(item => item.action.id),
				saved.healthy.id,
			])
			expect(
				(yield* own(saved.healthy, withdraw(saved.healthy)).pipe(Effect.result))
					._tag,
			).toBe("Failure")
		}).pipe(Effect.provide(layer(name))),
	)
})

test("withdrawal admission rejects inflated clocks, forged identities and reused operation IDs atomically", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let snapshot = yield* readSnapshot("doc")
			let normal = yield* buildAction(
				yield* load(),
				"doc",
				"Normal",
				staged => [staged.set("doc", "note", "kept")],
			)
			let inflatedReplica = yield* load()
			inflatedReplica.clock = Number.MAX_SAFE_INTEGER - 1
			let inflated = yield* buildAction(
				inflatedReplica,
				"doc",
				"Inflated",
				staged => [staged.set("doc", "note", "poison")],
			)
			for (let action of [
				inflated,
				{ ...normal, id: "wrong" },
				{ ...normal, actor: "foreign" },
			])
				expect((yield* withdraw(action).pipe(Effect.result))._tag).toBe(
					"Failure",
				)
			expect(yield* readSnapshot("doc")).toEqual(snapshot)
			yield* commit(normal)
			let overlapping = yield* buildAction(
				yield* load(),
				"doc",
				"Reuse",
				staged => [staged.set("doc", "extra", "burn")],
			)
			let reused = Schema.decodeUnknownSync(DocumentActionSchema)({
				...overlapping,
				changes: [...normal.changes, ...overlapping.changes],
			})
			expect((yield* withdraw(reused).pipe(Effect.result))._tag).toBe("Failure")
			let sql = yield* SqlClient.SqlClient
			expect(yield* sql`SELECT * FROM document_withdrawals`).toEqual([])
			expect(yield* sql`SELECT * FROM document_clock_reservations`).toEqual([])
			yield* commit(overlapping)
			expect((yield* load()).fields("doc").extra).toBe("burn")
		}).pipe(Effect.provide(layer("withdrawal-invalid"))),
	)
})

test("withdrawal journal and identity reservations roll back together on projection failure", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let action = yield* buildAction(
				yield* load(),
				"doc",
				"Withdraw",
				staged => [staged.set("doc", "note", "burn")],
				"rollback-withdraw",
			)
			let sql = yield* SqlClient.SqlClient
			let before =
				yield* sql`SELECT COUNT(*) AS count FROM effect_event_journal`
			yield* sql`CREATE TRIGGER fail_withdrawal BEFORE INSERT ON document_clock_reservations BEGIN SELECT RAISE(ABORT,'fixture'); END`
			expect(
				(yield* own(action, withdraw(action)).pipe(Effect.result))._tag,
			).toBe("Failure")
			expect(
				yield* sql`SELECT COUNT(*) AS count FROM effect_event_journal`,
			).toEqual(before)
			expect(yield* sql`SELECT * FROM document_withdrawals`).toEqual([])
			expect(
				yield* sql`SELECT * FROM document_operation_ids WHERE action=${action.id}`,
			).toEqual([])
			expect(
				yield* sql`SELECT * FROM document_actor_subjects WHERE actor=${action.actor}`,
			).toEqual([])
			yield* sql`DROP TRIGGER fail_withdrawal`
			yield* own(action, withdraw(action))
			expect((yield* sql`SELECT * FROM document_withdrawals`).length).toBe(1)
		}).pipe(Effect.provide(layer("withdrawal-rollback"))),
	)
})

test("withdrawals require a current writer and cannot claim another account or document's actor", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let action = yield* buildAction(
				yield* load(),
				"doc",
				"Withdraw",
				staged => [staged.set("doc", "note", "burn")],
			)
			let reader = yield* withdraw(action).pipe(
				Effect.provideService(Principal, {
					subject: "owner",
					actors: [action.actor],
					role: "reader",
				}),
				Effect.result,
			)
			expect(reader._tag).toBe("Failure")
			if (reader._tag === "Failure")
				expect(reader.failure).toMatchObject({ _tag: "PermissionDenied" })
			let foreign = yield* withdraw(action).pipe(
				Effect.provideService(Principal, {
					subject: "foreign",
					actors: [action.actor],
					role: "writer",
				}),
				Effect.result,
			)
			expect(foreign._tag).toBe("Failure")
			let otherDocument = { ...action, document: "another-doc" }
			expect((yield* withdraw(otherDocument).pipe(Effect.result))._tag).toBe(
				"Failure",
			)
			yield* withdraw(action)
			let next = yield* buildAction(
				yield* load(),
				"doc",
				"New actor",
				staged => [staged.set("doc", "other", "burn")],
				"fresh-withdrawal",
			)
			let other = yield* buildAction(
				yield* load(),
				"doc",
				"Other document",
				staged => [staged.set("doc", "other", "burn")],
				"fresh-withdrawal",
			)
			yield* own(next, withdraw(next))
			expect(
				(yield* own(
					other,
					withdraw({ ...other, document: "another-doc" }),
				).pipe(Effect.result))._tag,
			).toBe("Failure")
		}).pipe(Effect.provide(layer("withdrawal-authority"))),
	)
})

test("withdrawals interleave with healthy actions in their original order", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let staged = yield* load()
			let first = yield* buildAction(
				staged,
				"doc",
				"Withdraw first",
				value => [value.set("doc", "note", "burn")],
				"interleaved-first",
			)
			staged.apply(first.changes.map(parseOperation))
			let healthy = yield* buildAction(
				staged,
				"doc",
				"Healthy first",
				value => [value.set("doc", "healthy", "kept")],
				"interleaved-healthy",
			)
			staged.apply(healthy.changes.map(parseOperation))
			let dependent = yield* buildAction(
				staged,
				"doc",
				"Withdraw later",
				value => [value.set("doc", "note", "burn later")],
				"interleaved-dependent",
			)
			staged.apply(dependent.changes.map(parseOperation))
			let last = yield* buildAction(
				staged,
				"doc",
				"Healthy later",
				value => [value.set("doc", "last", "kept")],
				"interleaved-last",
			)
			yield* own(first, withdraw(first))
			expect(
				(yield* own(dependent, withdraw(dependent)).pipe(Effect.result))._tag,
			).toBe("Failure")
			let foreign = yield* withdraw(healthy).pipe(
				Effect.provideService(Principal, {
					subject: "foreign",
					actors: [healthy.actor],
					role: "writer",
				}),
				Effect.result,
			)
			expect(foreign._tag).toBe("Failure")
			yield* own(healthy, commit(healthy))
			yield* own(dependent, withdraw(dependent))
			yield* own(last, commit(last))
			expect(
				(yield* readHistory("doc")).map(item => item.action.label),
			).toEqual(["Create document", "Healthy first", "Healthy later"])
			expect((yield* load()).fields("doc").note).toBeUndefined()
		}).pipe(Effect.provide(layer("withdrawal-interleaving"))),
	)
})

test("withdrawn clocks remain isolated from another subject until an actual content action commits", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* commit(yield* initial())
			let accepted = yield* load()
			let staged = yield* load()
			for (let index = 0; index < 3; index++) {
				let action = yield* buildAction(
					staged,
					"doc",
					"Burn",
					value => [value.set("doc", "note", "burn")],
					"isolation-" + index,
				)
				staged.apply(action.changes.map(parseOperation))
				yield* own(action, withdraw(action))
			}
			let foreign = new Replica("foreign-device")
			foreign.restore(accepted.checkpoint())
			foreign.clock++
			let inflated = yield* buildAction(
				foreign,
				"doc",
				"Foreign lead",
				value => [value.set("doc", "foreign", "blocked")],
			)
			let principal: typeof Principal.Service = {
				subject: "foreign",
				actors: [foreign.actor],
				role: "writer",
			}
			expect(
				(yield* commit(inflated).pipe(
					Effect.provideService(Principal, principal),
					Effect.result,
				))._tag,
			).toBe("Failure")
			let normal = new Replica(foreign.actor)
			normal.restore(accepted.checkpoint())
			let allowed = yield* buildAction(
				normal,
				"doc",
				"Foreign normal",
				value => [value.set("doc", "foreign", "allowed")],
			)
			yield* commit(allowed).pipe(Effect.provideService(Principal, principal))
			expect((yield* load()).clock).toBe(accepted.clock + 1)
			let healthy = yield* buildAction(
				staged,
				"doc",
				"Owner healthy",
				value => [value.set("doc", "healthy", "kept")],
				"isolation-healthy",
			)
			yield* own(healthy, commit(healthy))
			expect((yield* load()).clock).toBe(accepted.clock + 4)
		}).pipe(Effect.provide(layer("withdrawal-isolation"))),
	)
})

for (let warm of [0, 34])
	test(
		"concurrent commit and withdrawal admit exactly one identity after warming " +
			warm +
			" documents",
		async () => {
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* commit(yield* initial())
					let action = yield* buildAction(
						yield* load(),
						"doc",
						"Race",
						staged => [staged.set("doc", "note", "kept")],
					)
					for (let index = 0; index < warm; index++) {
						let document = "warm-" + index
						let create = yield* buildAction(
							new Replica(document),
							document,
							"Create",
							staged => newDocument(staged, document, "Untitled", "Warm"),
						)
						yield* own(create, commit(create))
					}
					let results = yield* Effect.all(
						[
							commit(action).pipe(Effect.result),
							withdraw(action).pipe(Effect.result),
						],
						{ concurrency: "unbounded" },
					)
					expect(
						results.filter(result => result._tag === "Success").length,
					).toBe(1)
					let sql = yield* SqlClient.SqlClient
					let accepted =
						yield* sql`SELECT * FROM document_actions WHERE document='doc' AND action=${action.id}`
					let withdrawn =
						yield* sql`SELECT * FROM document_withdrawals WHERE document='doc' AND action=${action.id}`
					expect(accepted.length + withdrawn.length).toBe(1)
					expect(
						(yield* sql`SELECT * FROM document_operation_ids WHERE document='doc' AND action=${action.id}`)
							.length,
					).toBe(action.changes.length)
					expect((yield* load()).fields("doc").note).toBe(
						accepted.length ? "kept" : undefined,
					)
				}).pipe(Effect.provide(layer("withdrawal-race-" + warm))),
			)
		},
	)
