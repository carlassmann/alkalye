import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
	BrowserJournal,
	indexedDbJournalLayer,
} from "../src/platform/indexeddb-journal"

export function testJournalPositions(
	prefix: string,
	check: (value: unknown, message: string) => void,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let database = prefix + "-positions"
			let old = makeEntry(200)
			let newer = makeEntry(300)
			yield* createVersionOne(database, [old, newer])
			let services = yield* Layer.build(indexedDbJournalLayer(database))
			let storage = Context.get(services, BrowserJournal)
			let journal = storage.journal
			let migrated = yield* storage.readAfter(0)
			check(
				migrated.position === 2 &&
					migrated.entries.map(entry => entry.idString).join() ===
						[old.idString, newer.idString].join(),
				"a version-one journal upgrades without losing entries or their bytes",
			)
			let original = IDBObjectStore.prototype.add
			IDBObjectStore.prototype.add = function (
				value: unknown,
				key?: IDBValidKey,
			) {
				let request = original.call(this, value, key)
				if (this.name === "positions" && this.transaction.db.name === database)
					request.addEventListener("success", () => this.transaction.abort(), {
						once: true,
					})
				return request
			}
			let aborted = yield* journal
				.write({
					event: "DocumentChanged",
					primaryKey: "document",
					payload: new Uint8Array([9]),
					effect: () => Effect.void,
				})
				.pipe(
					Effect.exit,
					Effect.ensuring(
						Effect.sync(() => {
							IDBObjectStore.prototype.add = original
						}),
					),
				)
			check(
				Exit.isFailure(aborted) &&
					(yield* journal.entries).length === 2 &&
					(yield* storage.readAfter(0)).position === 2,
				"aborting a position insert rolls back the journal entry in the same transaction",
			)
			let older = makeEntry(100)
			let remote = EventJournal.makeRemoteIdUnsafe()
			let receive = journal.writeFromRemote({
				remoteId: remote,
				entries: [
					new EventJournal.RemoteEntry({ entry: older, remoteSequence: 7 }),
				],
				effect: () => Effect.void,
			})
			yield* receive
			let tail = yield* storage.readAfter(2)
			check(
				tail.entries.length === 1 &&
					tail.entries[0]?.idString === older.idString &&
					tail.position > 2,
				"a later commit with an older UUID appears after the saved position",
			)
			yield* receive
			check(
				(yield* storage.readAfter(tail.position)).entries.length === 0 &&
					(yield* storage.readAfter(0)).position === tail.position,
				"duplicate remote echoes never allocate another local position",
			)
			let invalid = yield* storage
				.readAfter(tail.position + 1)
				.pipe(Effect.exit)
			check(
				Exit.isFailure(invalid),
				"a cache cursor beyond the journal head cannot skip replay",
			)
			check(
				yield* storage.saveCache(tail.position, "newest"),
				"a cache publishes only after its covered journal position exists",
			)
			check(
				!(yield* storage.saveCache(2, "stale")) &&
					(yield* storage.cache)?.value === "newest",
				"an older cache cannot replace a newer durable projection",
			)
			check(
				!(yield* storage.saveCache(tail.position + 100, "future")),
				"a cache cannot cover an uncommitted position",
			)
			let put = IDBObjectStore.prototype.put
			let interrupt: (() => void) | undefined
			IDBObjectStore.prototype.put = function (
				value: unknown,
				key?: IDBValidKey,
			) {
				let request = put.call(this, value, key)
				if (this.name === "cache" && this.transaction.db.name === database)
					request.addEventListener("success", () => interrupt?.(), {
						once: true,
					})
				return request
			}
			yield* Effect.gen(function* () {
				let writing = yield* storage
					.saveCache(tail.position, "interrupted")
					.pipe(Effect.forkScoped)
				interrupt = () => {
					Effect.runFork(Fiber.interrupt(writing))
				}
				let cancelled = yield* Fiber.await(writing)
				check(
					Exit.isFailure(cancelled) &&
						(yield* storage.cache)?.value === "newest",
					"interrupting a cache after request success aborts its transaction and preserves the previous projection",
				)
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						IDBObjectStore.prototype.put = put
					}),
				),
			)
			yield* journal.destroy
			check(
				!(yield* storage.saveCache(tail.position, "deleted")) &&
					(yield* storage.cache) === undefined,
				"a late stale cache cannot resurrect a destroyed journal",
			)
			yield* journal.write({
				event: "DocumentChanged",
				primaryKey: "document",
				payload: new Uint8Array([10]),
				effect: () => Effect.void,
			})
			check(
				(yield* storage.readAfter(0)).position > tail.position,
				"destroy preserves the position generator so deleted positions never return",
			)
			check(
				Exit.isFailure(
					yield* storage.readAfter(tail.position).pipe(Effect.exit),
				),
				"a deleted position stays invalid even after the new journal grows beyond it",
			)
		}),
	)
}
function makeEntry(msecs: number) {
	return new EventJournal.Entry({
		id: EventJournal.makeEntryIdUnsafe({ msecs }),
		event: "DocumentChanged",
		primaryKey: "document",
		payload: new Uint8Array([msecs % 256]),
	})
}
function createVersionOne(database: string, entries: EventJournal.Entry[]) {
	return Effect.callback<void, Error>(resume => {
		let request = indexedDB.open(database, 1)
		request.onupgradeneeded = () => {
			let db = request.result
			let store = db.createObjectStore("entries", { keyPath: "id" })
			store.createIndex("conflicts", ["data.event", "data.primaryKey", "id"])
			let remotes = db.createObjectStore("remotes", {
				keyPath: ["remote", "entry"],
			})
			remotes.createIndex("remote", "remote")
			remotes.createIndex("sequence", ["remote", "sequence"])
			for (let entry of entries)
				store.add({
					id: entry.idString,
					data: Schema.encodeSync(EventJournal.Entry)(entry),
				})
		}
		request.onsuccess = () => {
			request.result.close()
			resume(Effect.void)
		}
		request.onerror = () =>
			resume(Effect.fail(new Error("Version-one fixture failed")))
	})
}
