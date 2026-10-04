import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as EventJournal from "effect/eventlog/EventJournal"
import { StoreId } from "effect/eventlog/EventLogMessage"
import { makeIndexedDbJournal } from "../src/platform/indexeddb-journal"
import { runJournalContracts } from "./browser-journal-contracts"
import { runBrowserEventLog } from "./browser-native-eventlog-client"
import { testJournalPositions } from "./browser-journal-positions"

let results: string[] = []
let prefix = "native-journal-" + Date.now()
let storeId = StoreId.make("workspace")
function check(condition: unknown, message: string) {
	if (!condition) throw new Error(message)
	results.push(message)
}
function write(journal: EventJournal.EventJournal["Service"]) {
	return journal
		.write({
			event: "DocumentChanged",
			primaryKey: "document",
			payload: new TextEncoder().encode("Durable content"),
			effect: entry => Effect.succeed(entry),
		})
		.pipe(journal.withLock(storeId))
}

async function run() {
	await Effect.runPromise(testJournalPositions(prefix, check))

	await Effect.runPromise(runJournalContracts(prefix, check))
	await Effect.runPromise(runBrowserEventLog(prefix, check))

	let saved = await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let journal = yield* EventJournal.makeIndexedDb({
					database: prefix + "-restart",
				})
				return yield* write(journal)
			}),
		),
	)
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let journal = yield* EventJournal.makeIndexedDb({
					database: prefix + "-restart",
				})
				let entries = yield* journal.entries
				check(
					entries.length === 1,
					"native IndexedDB journal survives reopening",
				)
				check(
					entries[0]?.idString === saved.idString,
					"reopened native entry retains its identity",
				)
				let remoteId = EventJournal.makeRemoteIdUnsafe()
				let sent = yield* journal.withRemoteUncommited(remoteId, entries =>
					Effect.succeed(entries.length),
				)
				check(
					Option.isSome(sent) && sent.value === 1,
					"native browser journal offers a local entry for upload",
				)
				check(
					(yield* journal.nextRemoteSequence(remoteId)) === 0,
					"a successful send alone does not advance the receive cursor",
				)
				let repeated = yield* journal.withRemoteUncommited(remoteId, entries =>
					Effect.succeed(entries.length),
				)
				check(
					Option.isSome(repeated) && repeated.value === 1,
					"native browser journal keeps sent entries pending until echoed",
				)
				let echo = new EventJournal.RemoteEntry({
					entry: saved,
					remoteSequence: 8,
				})
				let receipt = yield* journal
					.writeFromRemote({
						remoteId,
						entries: [echo],
						effect: () => Effect.die("Duplicate echo must not replay"),
					})
					.pipe(journal.withLock(storeId))
				check(
					receipt.duplicateEntries.length === 1,
					"native browser journal deduplicates an echoed entry",
				)
				check(
					(yield* journal.nextRemoteSequence(remoteId)) === 9,
					"native browser receive cursor advances after an echo",
				)
				let confirmed = yield* journal.withRemoteUncommited(remoteId, entries =>
					Effect.succeed(entries.length),
				)
				check(
					Option.isNone(confirmed),
					"native browser journal clears echoed entries from its outbox",
				)
			}),
		),
	)
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let journal = yield* EventJournal.makeIndexedDb({
					database: prefix + "-abort",
				})
				let original = IDBObjectStore.prototype.put
				IDBObjectStore.prototype.put = function (
					value: unknown,
					key?: IDBValidKey,
				) {
					let request = original.call(this, value, key)
					if (this.name === "entries")
						request.addEventListener(
							"success",
							() => this.transaction.abort(),
							{
								once: true,
							},
						)
					return request
				}
				let outcome = yield* write(journal).pipe(
					Effect.exit,
					Effect.ensuring(
						Effect.sync(() => {
							IDBObjectStore.prototype.put = original
						}),
					),
				)
				check(
					Exit.isSuccess(outcome),
					"native IndexedDB reports local write success before transaction completion",
				)
				check(
					(yield* journal.entries).length === 0,
					"aborting that transaction leaves the supposedly saved entry absent",
				)
			}),
		),
	)
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let journal = yield* makeIndexedDbJournal(prefix + "-safe")
				let notifications = yield* journal.changes
				let original = IDBObjectStore.prototype.add
				IDBObjectStore.prototype.add = function (
					value: unknown,
					key?: IDBValidKey,
				) {
					let request = original.call(this, value, key)
					if (this.name === "entries")
						request.addEventListener(
							"success",
							() => this.transaction.abort(),
							{
								once: true,
							},
						)
					return request
				}
				let aborted = yield* write(journal).pipe(
					Effect.timeout("1 second"),
					Effect.exit,
					Effect.ensuring(
						Effect.sync(() => {
							IDBObjectStore.prototype.add = original
						}),
					),
				)
				check(
					Exit.isFailure(aborted),
					"safe journal rejects an aborted local write",
				)
				if (Exit.isFailure(aborted))
					check(
						aborted.cause.reasons.some(
							reason =>
								reason._tag === "Fail" &&
								reason.error instanceof EventJournal.EventJournalError,
						),
						"abort returns a typed journal error instead of hanging",
					)
				check(
					(yield* journal.entries).length === 0,
					"safe journal keeps aborted entries out of storage",
				)
				let premature = yield* PubSub.take(notifications).pipe(
					Effect.timeout("25 millis"),
					Effect.exit,
				)
				check(
					Exit.isFailure(premature),
					"safe journal emits no save notification after abort",
				)
				let entry = yield* write(journal)
				check(
					(yield* PubSub.take(notifications)).idString === entry.idString,
					"safe journal publishes a local change after its commit",
				)
				let remoteId = EventJournal.makeRemoteIdUnsafe()
				for (let attempt = 0; attempt < 2; attempt++) {
					let pending = yield* journal.withRemoteUncommited(remoteId, entries =>
						Effect.succeed(entries.length),
					)
					check(
						Option.isSome(pending) && pending.value === 1,
						`safe journal retains unconfirmed upload on attempt ${attempt + 1}`,
					)
				}
				let receipt = yield* journal
					.writeFromRemote({
						remoteId,
						entries: [
							new EventJournal.RemoteEntry({ entry, remoteSequence: 4 }),
						],
						effect: () => Effect.die("Duplicate must not project"),
					})
					.pipe(journal.withLock(storeId))
				check(
					receipt.duplicateEntries.length === 1,
					"safe journal deduplicates an echoed local entry",
				)
				let confirmed = yield* journal.withRemoteUncommited(remoteId, entries =>
					Effect.succeed(entries.length),
				)
				check(
					Option.isNone(confirmed),
					"safe journal confirms only the committed remote echo",
				)
				check(
					(yield* journal.nextRemoteSequence(remoteId)) === 5,
					"safe journal persists the next unused remote sequence",
				)
				let remote = new EventJournal.RemoteEntry({
					entry: new EventJournal.Entry({
						id: EventJournal.makeEntryIdUnsafe(),
						event: "DocumentChanged",
						primaryKey: "document",
						payload: new Uint8Array([1]),
					}),
					remoteSequence: 5,
				})
				let put = IDBObjectStore.prototype.put
				IDBObjectStore.prototype.put = function (
					value: unknown,
					key?: IDBValidKey,
				) {
					let request = put.call(this, value, key)
					if (this.name === "remotes")
						request.addEventListener(
							"success",
							() => this.transaction.abort(),
							{
								once: true,
							},
						)
					return request
				}
				let rejected = yield* journal
					.writeFromRemote({
						remoteId,
						entries: [remote],
						effect: () => Effect.void,
					})
					.pipe(
						journal.withLock(storeId),
						Effect.timeout("1 second"),
						Effect.exit,
						Effect.ensuring(
							Effect.sync(() => {
								IDBObjectStore.prototype.put = put
							}),
						),
					)
				check(
					Exit.isFailure(rejected) &&
						rejected.cause.reasons.some(
							reason =>
								reason._tag === "Fail" &&
								reason.error instanceof EventJournal.EventJournalError,
						),
					"safe remote abort fails promptly with a typed error",
				)
				check(
					(yield* journal.entries).length === 1 &&
						(yield* journal.nextRemoteSequence(remoteId)) === 5,
					"remote abort rolls back both entry and receive cursor",
				)
				yield* journal
					.writeFromRemote({
						remoteId,
						entries: [remote],
						effect: () => Effect.void,
					})
					.pipe(journal.withLock(storeId))
				check(
					(yield* journal.entries).length === 2 &&
						(yield* journal.nextRemoteSequence(remoteId)) === 6,
					"a failed remote batch remains retryable",
				)
				let second = yield* makeIndexedDbJournal(prefix + "-safe")
				let entered = yield* Deferred.make<void>()
				let release = yield* Deferred.make<void>()
				let first = yield* journal
					.withLock(storeId)(
						Deferred.succeed(entered, undefined).pipe(
							Effect.andThen(Deferred.await(release)),
						),
					)
					.pipe(Effect.forkScoped)
				yield* Deferred.await(entered)
				let started = false
				let waiting = yield* second
					.withLock(storeId)(Effect.sync(() => (started = true)))
					.pipe(Effect.forkScoped)
				yield* Effect.sleep("25 millis")
				check(!started, "independent journal services share the browser lock")
				yield* Fiber.interrupt(waiting)
				yield* Deferred.succeed(release, undefined)
				yield* Fiber.join(first)
				yield* second
					.withLock(storeId)(Effect.void)
					.pipe(Effect.timeout("1 second"))
				check(
					!started,
					"cancelling a queued browser lock never runs its effect",
				)
				let held = yield* Deferred.make<void>()
				let holding = yield* journal
					.withLock(storeId)(
						Deferred.succeed(held, undefined).pipe(
							Effect.andThen(Effect.never),
						),
					)
					.pipe(Effect.forkScoped)
				yield* Deferred.await(held)
				yield* Fiber.interrupt(holding)
				yield* second
					.withLock(storeId)(Effect.void)
					.pipe(Effect.timeout("1 second"))
				check(true, "cancelling a held browser lock releases the lease")
				yield* journal.destroy
				check(
					(yield* second.entries).length === 0 &&
						(yield* second.nextRemoteSequence(remoteId)) === 0,
					"destroy clears entries and cursors through an existing journal scope",
				)
			}),
		),
	)
	let receipt = await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let journal = yield* makeIndexedDbJournal(prefix + "-integrity")
				let local = yield* write(journal)
				let remoteId = EventJournal.makeRemoteIdUnsafe()
				let forged = new EventJournal.Entry({
					id: local.id,
					event: local.event,
					primaryKey: local.primaryKey,
					payload: new Uint8Array([99]),
				})
				let mismatch = yield* journal
					.writeFromRemote({
						remoteId,
						entries: [
							new EventJournal.RemoteEntry({
								entry: forged,
								remoteSequence: 9,
							}),
						],
						effect: () => Effect.die("Mismatched content must not project"),
					})
					.pipe(journal.withLock(storeId), Effect.exit)
				check(
					Exit.isFailure(mismatch),
					"changed entry bytes cannot masquerade as an echo",
				)
				let pending = yield* journal.withRemoteUncommited(remoteId, entries =>
					Effect.succeed(entries.length),
				)
				check(
					Option.isSome(pending) && pending.value === 1,
					"a forged echo cannot confirm a local entry",
				)
				check(
					(yield* journal.nextRemoteSequence(remoteId)) === 0,
					"rejected content cannot move the receive cursor",
				)
				let fresh = new EventJournal.Entry({
					id: EventJournal.makeEntryIdUnsafe(),
					event: "DocumentChanged",
					primaryKey: "document",
					payload: new Uint8Array([1]),
				})
				let projections = 0
				yield* journal
					.writeFromRemote({
						remoteId,
						entries: [
							new EventJournal.RemoteEntry({ entry: fresh, remoteSequence: 2 }),
							new EventJournal.RemoteEntry({ entry: fresh, remoteSequence: 3 }),
						],
						effect: () =>
							Effect.sync(() => {
								projections++
							}),
					})
					.pipe(journal.withLock(storeId))
				check(projections === 1, "duplicate ids inside a batch project once")
				check(
					(yield* journal.nextRemoteSequence(remoteId)) === 4,
					"duplicate batch receipts keep the highest sequence",
				)
				yield* journal
					.writeFromRemote({
						remoteId,
						entries: [
							new EventJournal.RemoteEntry({ entry: fresh, remoteSequence: 1 }),
						],
						effect: () => Effect.die("A repeated receipt must not project"),
					})
					.pipe(journal.withLock(storeId))
				check(
					(yield* journal.nextRemoteSequence(remoteId)) === 4,
					"a lower repeated receipt cannot regress the cursor",
				)
				let sameSequence = new EventJournal.Entry({
					id: EventJournal.makeEntryIdUnsafe(),
					event: "DocumentChanged",
					primaryKey: "document",
					payload: new Uint8Array([2]),
				})
				yield* journal
					.writeFromRemote({
						remoteId,
						entries: [
							new EventJournal.RemoteEntry({
								entry: sameSequence,
								remoteSequence: 3,
							}),
						],
						effect: () => Effect.void,
					})
					.pipe(journal.withLock(storeId))
				check(
					(yield* journal.entries).length === 3,
					"equal remote sequences do not wedge distinct entries",
				)
				let otherRemote = EventJournal.makeRemoteIdUnsafe()
				let forwarded = yield* journal.withRemoteUncommited(
					otherRemote,
					entries => Effect.succeed(entries.length),
				)
				check(
					Option.isSome(forwarded) && forwarded.value === 3,
					"entries received from one remote remain pending for another",
				)
				let failedSend = yield* journal
					.withRemoteUncommited(otherRemote, () => Effect.fail("offline"))
					.pipe(Effect.exit)
				check(Exit.isFailure(failedSend), "a failed send retains its failure")
				let retry = yield* journal.withRemoteUncommited(otherRemote, entries =>
					Effect.succeed(entries.length),
				)
				check(
					Option.isSome(retry) && retry.value === 3,
					"failed uploads remain retryable without a watermark",
				)
				let rejected = yield* journal
					.write({
						event: "DocumentChanged",
						primaryKey: "document",
						payload: new Uint8Array([3]),
						effect: () => Effect.fail("read-only"),
					})
					.pipe(journal.withLock(storeId), Effect.exit)
				check(
					Exit.isFailure(rejected) && (yield* journal.entries).length === 3,
					"a failed command effect never enters the journal",
				)
				let isolated = yield* makeIndexedDbJournal(prefix + "-other-workspace")
				check(
					(yield* isolated.entries).length === 0 &&
						(yield* isolated.nextRemoteSequence(remoteId)) === 0,
					"workspace databases isolate entries and receive cursors",
				)
				return remoteId
			}),
		),
	)
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let journal = yield* makeIndexedDbJournal(prefix + "-integrity")
				check(
					(yield* journal.entries).length === 3,
					"safe journal entries survive scope closure and reopening",
				)
				check(
					(yield* journal.nextRemoteSequence(receipt)) === 4,
					"safe receive cursor survives scope closure and reopening",
				)
			}),
		),
	)
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let started = yield* Deferred.make<void>()
				let grant: (() => Promise<void>) | undefined
				function request<A>(
					_name: string,
					options: LockOptions | LockGrantedCallback<A>,
					callback?: LockGrantedCallback<A>,
				) {
					let selected = typeof options === "function" ? options : callback
					if (!selected) return Promise.reject<A>(new Error("Missing callback"))
					return new Promise<A>((resolve, reject) => {
						grant = () => Promise.resolve(selected(null)).then(resolve, reject)
						Deferred.doneUnsafe(started, Effect.void)
					})
				}
				let descriptor = Object.getOwnPropertyDescriptor(navigator, "locks")
				Object.defineProperty(navigator, "locks", {
					configurable: true,
					value: { request },
				})
				yield* Effect.gen(function* () {
					let journal = yield* makeIndexedDbJournal(prefix + "-late-grant")
					let ran = false
					let waiting = yield* journal
						.withLock(storeId)(
							Effect.sync(() => {
								ran = true
							}),
						)
						.pipe(Effect.forkScoped)
					yield* Deferred.await(started)
					yield* Fiber.interrupt(waiting)
					if (!grant) return yield* Effect.die("No queued grant")
					yield* Effect.promise(grant).pipe(Effect.timeout("1 second"))
					check(
						!ran,
						"a lock granted after cancellation never starts its effect",
					)
					check(
						true,
						"late granted locks release without leaving a suspended promise",
					)
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							if (descriptor)
								Object.defineProperty(navigator, "locks", descriptor)
							else Reflect.deleteProperty(navigator, "locks")
						}),
					),
				)
			}),
		),
	)
}

run()
	.then(() => {
		document.body.dataset.results = JSON.stringify(results)
	})
	.catch(error => {
		document.body.dataset.failure = String(error)
		document.body.dataset.results = JSON.stringify(results)
	})
	.finally(() => {
		document.body.dataset.done = "true"
	})
