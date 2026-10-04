import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { DocumentJournal } from "../src/platform/document-journal"
import { sqliteJournalLayer } from "../src/platform/sqlite-journal"

test("SQLite positions follow commits, retain immutable remote entries and never reuse deleted cursors", () =>
	withJournal(storage =>
		Effect.gen(function* () {
			let newer = makeEntry(300)
			let older = makeEntry(100)
			let remote = EventJournal.makeRemoteIdUnsafe()
			function receive(entry: EventJournal.Entry, sequence: number) {
				return storage.journal.writeFromRemote({
					remoteId: remote,
					entries: [
						new EventJournal.RemoteEntry({ entry, remoteSequence: sequence }),
					],
					effect: () => Effect.void,
				})
			}
			yield* receive(newer, 0)
			let first = yield* storage.readAfter(0)
			yield* receive(older, 1)
			let tail = yield* storage.readAfter(first.position)
			expect(tail.entries.map(entry => entry.idString)).toEqual([
				older.idString,
			])
			expect(tail.position).toBeGreaterThan(first.position)
			expect((yield* storage.entry(older.idString))?.payload).toEqual(
				older.payload,
			)
			yield* receive(older, 2)
			expect((yield* storage.readAfter(tail.position)).entries).toHaveLength(0)
			let changed = new EventJournal.Entry({
				...older,
				payload: new Uint8Array([7]),
			})
			expect((yield* receive(changed, 3).pipe(Effect.result))._tag).toBe(
				"Failure",
			)
			expect((yield* storage.entry(older.idString))?.payload).toEqual(
				older.payload,
			)
			expect(yield* storage.journal.nextRemoteSequence(remote)).toBe(3)
			yield* storage.journal.destroy
			expect(
				(yield* storage.readAfter(tail.position).pipe(Effect.result))._tag,
			).toBe("Failure")
			yield* receive(makeEntry(400), 4)
			expect((yield* storage.readAfter(0)).position).toBeGreaterThan(
				tail.position,
			)
		}),
	))

test("SQLite journal projections publish only committed coverage and retain the newest cache", () =>
	withJournal(storage =>
		Effect.gen(function* () {
			let write = storage.journal.write({
				event: "DocumentChanged",
				primaryKey: "doc",
				payload: new Uint8Array([1]),
				effect: () => Effect.void,
			})
			yield* write
			let first = (yield* storage.readAfter(0)).position
			yield* write
			let head = (yield* storage.readAfter(first)).position
			expect(
				yield* storage.saveCache(head, { checkpoint: [1, 2], pending: [] }),
			).toBe(true)
			expect(yield* storage.saveCache(first, "stale")).toBe(false)
			expect(yield* storage.saveCache(head + 10, "future")).toBe(false)
			expect((yield* storage.cache)?.value).toEqual({
				checkpoint: [1, 2],
				pending: [],
			})
			expect((yield* storage.readAfter(0, 1)).entries).toHaveLength(1)
			expect(
				(yield* storage.readAfter(first, 100, first)).entries,
			).toHaveLength(0)
			expect(
				(yield* storage.readAfter(head + 1).pipe(Effect.result))._tag,
			).toBe("Failure")
			yield* storage.journal.destroy
			expect(yield* storage.cache).toBeUndefined()
			expect(yield* storage.saveCache(head, "resurrection")).toBe(false)
		}),
	))

test("a failed SQLite journal handler commits neither entry nor position", () =>
	withJournal(storage =>
		Effect.gen(function* () {
			let failed = yield* storage.journal
				.write({
					event: "Rejected",
					primaryKey: "doc",
					payload: new Uint8Array([2]),
					effect: () => Effect.fail("rejected"),
				})
				.pipe(Effect.result)
			expect(failed._tag).toBe("Failure")
			expect(yield* storage.readAfter(0)).toEqual({ position: 0, entries: [] })
		}),
	))

test("uncached SQLite replay reads beyond one page and remote duplicates invoke a handler once", () =>
	withJournal(storage =>
		Effect.gen(function* () {
			let remote = EventJournal.makeRemoteIdUnsafe()
			let entries = Array.from(
				{ length: 1005 },
				(_, index) =>
					new EventJournal.RemoteEntry({
						entry: makeEntry(1000 + index),
						remoteSequence: index,
					}),
			)
			let first = entries[0]
			if (!first) throw new Error("Missing fixture entry")
			let handled = 0
			yield* storage.journal.writeFromRemote({
				remoteId: remote,
				entries: [
					...entries,
					new EventJournal.RemoteEntry({
						entry: first.entry,
						remoteSequence: 1005,
					}),
				],
				effect: () =>
					Effect.sync(() => {
						handled++
					}),
			})
			let replay = yield* storage.readAfter(0)
			expect(replay.entries).toHaveLength(1005)
			expect(handled).toBe(1005)
			expect(yield* storage.journal.nextRemoteSequence(remote)).toBe(1006)
			expect((yield* storage.readAfter(0, 1000)).entries).toHaveLength(1000)
		}),
	))

test("a malformed SQLite derived cache can be replaced without changing the journal", () =>
	withJournal((storage, filename) =>
		Effect.gen(function* () {
			yield* storage.journal.write({
				event: "DocumentChanged",
				primaryKey: "doc",
				payload: new Uint8Array([1]),
				effect: () => Effect.void,
			})
			let head = (yield* storage.readAfter(0)).position
			yield* Effect.sync(() => {
				let database = new Database(filename)
				try {
					database.run(
						"INSERT INTO document_cache(id,position,value) VALUES (1,?,?)",
						[head, "broken json"],
					)
				} finally {
					database.close()
				}
			})
			expect((yield* storage.cache.pipe(Effect.result))._tag).toBe("Failure")
			expect(yield* storage.saveCache(head, { rebuilt: true })).toBe(true)
			expect((yield* storage.cache)?.value).toEqual({ rebuilt: true })
			expect((yield* storage.readAfter(0)).entries).toHaveLength(1)
		}),
	))

test("an interrupted SQLite handler rolls back the durable entry and position", () =>
	withJournal(storage =>
		Effect.gen(function* () {
			let result = yield* storage.journal
				.write({
					event: "Interrupted",
					primaryKey: "doc",
					payload: new Uint8Array([1]),
					effect: () => Effect.interrupt,
				})
				.pipe(Effect.exit)
			expect(result._tag).toBe("Failure")
			expect(yield* storage.readAfter(0)).toEqual({ position: 0, entries: [] })
		}),
	))

test("SQLite adds stable positions for a journal created before the document adapter", () =>
	withJournal((storage, filename) =>
		Effect.gen(function* () {
			let newer = makeEntry(300)
			let older = makeEntry(100)
			yield* Effect.sync(() => {
				let database = new Database(filename)
				try {
					database.transaction(() => {
						database.run("DROP TRIGGER document_position_insert")
						database.run("DELETE FROM document_journal_migrations")
						for (let entry of [newer, older])
							database.run(
								"INSERT INTO effect_event_journal(id,event,primary_key,payload,timestamp) VALUES (?,?,?,?,?)",
								[
									entry.id,
									entry.event,
									entry.primaryKey,
									entry.payload,
									entry.createdAtMillis,
								],
							)
					})()
				} finally {
					database.close()
				}
			})
			let reopened = Context.get(
				yield* Layer.build(sqliteJournalLayer(filename)),
				DocumentJournal,
			)
			let replay = yield* reopened.readAfter(0)
			expect(replay.entries.map(entry => entry.idString)).toEqual([
				older.idString,
				newer.idString,
			])
			let head = replay.position
			yield* storage.journal.write({
				event: "Later",
				primaryKey: "doc",
				payload: new Uint8Array([1]),
				effect: () => Effect.void,
			})
			expect((yield* reopened.readAfter(head)).entries).toHaveLength(1)
		}),
	))

async function withJournal<A, E>(
	work: (
		storage: DocumentJournal["Service"],
		filename: string,
	) => Effect.Effect<A, E, Scope.Scope>,
) {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-sqlite-journal-"))
	try {
		return await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let services = yield* Layer.build(
						sqliteJournalLayer(join(directory, "journal.sqlite")),
					)
					return yield* work(
						Context.get(services, DocumentJournal),
						join(directory, "journal.sqlite"),
					)
				}),
			),
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}
function makeEntry(msecs: number) {
	return new EventJournal.Entry({
		id: EventJournal.makeEntryIdUnsafe({ msecs }),
		event: "DocumentChanged",
		primaryKey: "doc",
		payload: new Uint8Array([msecs % 256]),
	})
}
