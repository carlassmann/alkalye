import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as EventJournal from "effect/eventlog/EventJournal"
import { StoreId } from "effect/eventlog/EventLogMessage"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as PubSub from "effect/PubSub"
import { makeIndexedDbJournal } from "../src/platform/indexeddb-journal"

type Check = (condition: unknown, message: string) => void
type Journal = EventJournal.EventJournal["Service"]
let storeId = StoreId.make("workspace")

export function runJournalContracts(prefix: string, check: Check) {
	return Effect.scoped(
		Effect.gen(function* () {
			yield* conflictContract(prefix, check)
			yield* compactionContract(prefix, check)
			yield* interruptionContract(prefix, check)
			yield* racingInsertContract(prefix, check)
			yield* committedCancellationContract(prefix, check)
			yield* destroyContract(prefix, check)
			yield* closedConnectionContract(prefix, check)
		}),
	)
}

function entry(msecs: number, event = "DocumentChanged", key = "document") {
	return new EventJournal.Entry({
		id: EventJournal.makeEntryIdUnsafe({ msecs }),
		event,
		primaryKey: key,
		payload: new Uint8Array([msecs % 256]),
	})
}
function receive(
	journal: Journal,
	remoteId: EventJournal.RemoteId,
	entries: ReadonlyArray<EventJournal.Entry>,
) {
	return journal.writeFromRemote({
		remoteId,
		entries: entries.map(
			(entry, index) =>
				new EventJournal.RemoteEntry({ entry, remoteSequence: index + 1 }),
		),
		effect: () => Effect.void,
	})
}
function journalFailure(exit: Exit.Exit<unknown, unknown>) {
	return (
		Exit.isFailure(exit) &&
		exit.cause.reasons.some(
			reason =>
				reason._tag === "Fail" &&
				reason.error instanceof EventJournal.EventJournalError,
		)
	)
}
function conflictContract(prefix: string, check: Check) {
	return Effect.gen(function* () {
		let journal = yield* makeIndexedDbJournal(prefix + "-conflicts")
		let remoteId = EventJournal.makeRemoteIdUnsafe()
		let older = entry(100)
		let incoming = entry(200)
		let newer = entry(300)
		let anotherKey = entry(400, "DocumentChanged", "another-document")
		let anotherEvent = entry(500, "WorkspaceCheckpoint")
		yield* receive(journal, remoteId, [older, newer, anotherKey, anotherEvent])
		let conflicts: ReadonlyArray<EventJournal.Entry> = []
		yield* journal.writeFromRemote({
			remoteId,
			entries: [
				new EventJournal.RemoteEntry({ entry: incoming, remoteSequence: 5 }),
			],
			effect: options =>
				Effect.sync(() => {
					conflicts = options.conflicts
				}),
		})
		check(
			conflicts.length === 1 && conflicts[0]?.idString === newer.idString,
			"conflicts include only newer entries with the same event and primary key",
		)
		let first = entry(600)
		let second = entry(700)
		let order: string[] = []
		yield* journal.writeFromRemote({
			remoteId,
			entries: [
				new EventJournal.RemoteEntry({ entry: second, remoteSequence: 6 }),
				new EventJournal.RemoteEntry({ entry: first, remoteSequence: 7 }),
			],
			effect: options =>
				Effect.sync(() => {
					order.push(options.entry.idString)
					check(
						options.conflicts.length === 0,
						"incoming batch entries are not existing conflicts",
					)
				}),
		})
		check(
			order.join() === [second.idString, first.idString].join(),
			"remote projection preserves bracket order rather than UUID order",
		)
		let saved = yield* journal.entries
		check(
			saved.every((value, index) => {
				let previous = saved[index - 1]
				return !previous || EventJournal.Entry.Order(previous, value) < 0
			}),
			"journal reads retain deterministic UUID order",
		)
	})
}
function compactionContract(prefix: string, check: Check) {
	return Effect.gen(function* () {
		let journal = yield* makeIndexedDbJournal(prefix + "-compaction")
		let remoteId = EventJournal.makeRemoteIdUnsafe()
		let raw = [entry(100), entry(200)]
		let replacement = entry(300)
		let projected: string[] = []
		let compacted: string[] = []
		yield* journal.writeFromRemote({
			remoteId,
			entries: raw.map(
				(entry, remoteSequence) =>
					new EventJournal.RemoteEntry({ entry, remoteSequence }),
			),
			compact: entries =>
				Effect.sync(() => {
					compacted = entries.map(value => value.entry.idString)
					return [replacement]
				}),
			effect: options =>
				Effect.sync(() => {
					projected.push(options.entry.idString)
				}),
		})
		check(
			compacted.join() === raw.map(entry => entry.idString).join(),
			"compaction receives every fresh raw entry",
		)
		check(
			projected.join() === replacement.idString,
			"projection uses the compaction replacement",
		)
		check(
			(yield* journal.entries).map(entry => entry.idString).join() ===
				raw.map(entry => entry.idString).join(),
			"compaction retains raw journal entries rather than its synthetic replacement",
		)
		check(
			(yield* journal.nextRemoteSequence(remoteId)) === 2,
			"compaction confirms all original remote receipts",
		)
		let failed = yield* journal
			.writeFromRemote({
				remoteId,
				entries: [
					new EventJournal.RemoteEntry({
						entry: entry(400),
						remoteSequence: 2,
					}),
				],
				compact: () =>
					Effect.fail(
						new EventJournal.EventJournalError({
							method: "compact",
							cause: "invalid batch",
						}),
					),
				effect: () => Effect.die("Failed compaction must not project"),
			})
			.pipe(Effect.exit)
		check(
			journalFailure(failed) &&
				(yield* journal.entries).length === 2 &&
				(yield* journal.nextRemoteSequence(remoteId)) === 2,
			"failed compaction commits neither entries nor receipts",
		)
	})
}
function interruptionContract(prefix: string, check: Check) {
	return Effect.gen(function* () {
		let journal = yield* makeIndexedDbJournal(prefix + "-interruption")
		let remoteId = EventJournal.makeRemoteIdUnsafe()
		let raw = [entry(100), entry(200), entry(300)]
		let entered = yield* Deferred.make<void>()
		let projected: string[] = []
		let replay = yield* journal
			.writeFromRemote({
				remoteId,
				entries: raw.map(
					(entry, remoteSequence) =>
						new EventJournal.RemoteEntry({ entry, remoteSequence }),
				),
				effect: options =>
					Effect.sync(() => {
						projected.push(options.entry.idString)
					}).pipe(
						Effect.andThen(Deferred.succeed(entered, undefined)),
						Effect.andThen(Effect.never),
					),
			})
			.pipe(journal.withLock(storeId), Effect.forkScoped)
		yield* Deferred.await(entered)
		yield* Fiber.interrupt(replay)
		check(
			projected.length === 1 &&
				(yield* journal.entries).length === 0 &&
				(yield* journal.nextRemoteSequence(remoteId)) === 0,
			"interrupted replay leaves journal and cursor unchanged after a partial projection",
		)
		projected = []
		yield* journal
			.writeFromRemote({
				remoteId,
				entries: raw.map(
					(entry, remoteSequence) =>
						new EventJournal.RemoteEntry({ entry, remoteSequence }),
				),
				effect: options =>
					Effect.sync(() => {
						projected.push(options.entry.idString)
					}),
			})
			.pipe(journal.withLock(storeId))
		check(
			projected.length === 3 &&
				(yield* journal.entries).length === 3 &&
				(yield* journal.nextRemoteSequence(remoteId)) === 3,
			"retry after interrupted replay projects every uncommitted entry",
		)
		let localEntered = yield* Deferred.make<void>()
		let notifications = yield* journal.changes
		let local = yield* journal
			.write({
				event: "DocumentChanged",
				primaryKey: "document",
				payload: new Uint8Array([4]),
				effect: () =>
					Deferred.succeed(localEntered, undefined).pipe(
						Effect.andThen(Effect.never),
					),
			})
			.pipe(journal.withLock(storeId), Effect.forkScoped)
		yield* Deferred.await(localEntered)
		yield* Fiber.interrupt(local)
		check(
			(yield* journal.entries).length === 3,
			"interrupting the local handler prevents its journal commit",
		)
		let notified = yield* PubSub.take(notifications).pipe(
			Effect.timeout("25 millis"),
			Effect.exit,
		)
		check(
			Exit.isFailure(notified),
			"interrupted local handlers emit no save notification",
		)
	})
}
function racingInsertContract(prefix: string, check: Check) {
	return Effect.gen(function* () {
		let journal = yield* makeIndexedDbJournal(prefix + "-race")
		let remoteId = EventJournal.makeRemoteIdUnsafe()
		let original = entry(100)
		let changed = new EventJournal.Entry({
			...original,
			payload: new Uint8Array([99]),
		})
		let paused = yield* Deferred.make<void>()
		let release = yield* Deferred.make<void>()
		let racing = yield* journal
			.writeFromRemote({
				remoteId,
				entries: [
					new EventJournal.RemoteEntry({ entry: original, remoteSequence: 1 }),
				],
				effect: () =>
					Deferred.succeed(paused, undefined).pipe(
						Effect.andThen(Deferred.await(release)),
					),
			})
			.pipe(Effect.forkScoped)
		yield* Deferred.await(paused)
		yield* receive(journal, EventJournal.makeRemoteIdUnsafe(), [changed])
		yield* Deferred.succeed(release, undefined)
		let outcome = yield* Fiber.await(racing)
		check(
			journalFailure(outcome),
			"an unlocked racing remote insert fails rather than overwriting existing bytes",
		)
		check(
			(yield* journal.entries)[0]?.payload[0] === 99 &&
				(yield* journal.nextRemoteSequence(remoteId)) === 0,
			"racing insert rollback preserves the winner and rejects the losing receipt",
		)
	})
}
function closedConnectionContract(prefix: string, check: Check) {
	return Effect.gen(function* () {
		let database = prefix + "-version"
		let journal = yield* makeIndexedDbJournal(database)
		yield* Effect.callback<void, Error>(resume => {
			let request = indexedDB.open(database, 3)
			request.onsuccess = () => {
				request.result.close()
				resume(Effect.void)
			}
			request.onerror = () => resume(Effect.fail(new Error("Upgrade failed")))
			request.onblocked = () =>
				resume(Effect.fail(new Error("Upgrade remained blocked")))
		}).pipe(Effect.timeout("1 second"))
		let outcome = yield* journal.entries.pipe(
			Effect.timeout("1 second"),
			Effect.exit,
		)
		check(
			journalFailure(outcome),
			"a version change closes the old connection and returns a typed error without hanging",
		)
	})
}

function committedCancellationContract(prefix: string, check: Check) {
	return Effect.gen(function* () {
		let journal = yield* makeIndexedDbJournal(prefix + "-commit-interruption")
		let notifications = yield* journal.changes
		let original = IDBObjectStore.prototype.add
		let interrupt: (() => void) | undefined
		let interrupted = false
		IDBObjectStore.prototype.add = function (
			value: unknown,
			key?: IDBValidKey,
		) {
			let request = original.call(this, value, key)
			if (this.name === "entries")
				request.addEventListener(
					"success",
					() => {
						interrupted = true
						interrupt?.()
					},
					{ once: true },
				)
			return request
		}
		yield* Effect.gen(function* () {
			let writing = yield* journal
				.write({
					event: "DocumentChanged",
					primaryKey: "document",
					payload: new Uint8Array([1]),
					effect: entry => Effect.succeed(entry),
				})
				.pipe(journal.withLock(storeId), Effect.forkScoped)
			interrupt = () => {
				Effect.runFork(Fiber.interrupt(writing))
			}
			yield* Fiber.await(writing)
			check(
				interrupted && (yield* journal.entries).length === 1,
				"cancellation after insert success lets the durable local transaction finish",
			)
			let notification = yield* PubSub.take(notifications).pipe(
				Effect.timeout("1 second"),
			)
			check(
				notification.idString === (yield* journal.entries)[0]?.idString,
				"a commit interrupted during completion still publishes its durable save",
			)
		}).pipe(
			Effect.ensuring(
				Effect.sync(() => {
					IDBObjectStore.prototype.add = original
				}),
			),
		)
	})
}
function destroyContract(prefix: string, check: Check) {
	return Effect.gen(function* () {
		let journal = yield* makeIndexedDbJournal(prefix + "-destroy-race")
		let remoteId = EventJournal.makeRemoteIdUnsafe()
		let entered = yield* Deferred.make<void>()
		let release = yield* Deferred.make<void>()
		let replay = yield* journal
			.writeFromRemote({
				remoteId,
				entries: [
					new EventJournal.RemoteEntry({
						entry: entry(100),
						remoteSequence: 0,
					}),
				],
				effect: () =>
					Deferred.succeed(entered, undefined).pipe(
						Effect.andThen(Deferred.await(release)),
					),
			})
			.pipe(journal.withLock(storeId), Effect.forkScoped)
		yield* Deferred.await(entered)
		let destroyed = false
		let clearing = yield* journal.destroy.pipe(
			Effect.tap(
				Effect.sync(() => {
					destroyed = true
				}),
			),
			Effect.forkScoped,
		)
		yield* Effect.sleep("25 millis")
		check(!destroyed, "destroy waits for a locked remote replay to finish")
		yield* Deferred.succeed(release, undefined)
		yield* Fiber.join(replay)
		yield* Fiber.join(clearing)
		check(
			(yield* journal.entries).length === 0 &&
				(yield* journal.nextRemoteSequence(remoteId)) === 0,
			"a completed replay cannot resurrect entries after destroy",
		)
	})
}
