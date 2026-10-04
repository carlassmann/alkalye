import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Schedule from "effect/Schedule"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import type { DocumentSessionOptions } from "../src/client/document-session"
import {
	buildAction,
	DocumentConflict,
	AccessConflict,
} from "../src/shared/document-actions"

type Check = (value: unknown, message: string) => void

export function verifyDocumentActionRecovery(
	options: DocumentSessionOptions,
	check: Check,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let session = yield* DocumentSession
			let transaction = IDBDatabase.prototype.transaction
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					IDBDatabase.prototype.transaction = transaction
				}),
			)
			let attempts = 0
			let command = session.change("Retried setting", staged => {
				attempts++
				return [staged.set(options.document, "mode", "slideshow")]
			})
			let failWrite = true
			IDBDatabase.prototype.transaction = function (names, mode, options) {
				if (
					failWrite &&
					mode === "readwrite" &&
					includesStore(names, "entries") &&
					this.name.startsWith("alkalye-document-v1:")
				) {
					failWrite = false
					throw new DOMException(
						"Injected failed command append",
						"UnknownError",
					)
				}
				return transaction.call(this, names, mode, options)
			}
			let failedTransaction = IDBDatabase.prototype.transaction
			let failed = yield* command.pipe(Effect.result)
			IDBDatabase.prototype.transaction = transaction
			let retried = yield* command
			let repeated = yield* command
			check(
				failed._tag === "Failure" &&
					attempts === 1 &&
					retried.id === repeated.id &&
					session.pending().length === 1,
				"retrying the same action effect retains its original proposal and does not repeat the builder",
			)
			let appended = false
			IDBDatabase.prototype.transaction = function (names, mode, options) {
				if (this.name.startsWith("alkalye-document-v1:")) {
					if (mode === "readwrite" && includesStore(names, "entries"))
						appended = true
					else if (
						appended &&
						mode === "readonly" &&
						includesStore(names, "positions")
					) {
						appended = false
						throw new DOMException(
							"Injected post-append replay failure",
							"UnknownError",
						)
					}
				}
				return transaction.call(this, names, mode, options)
			}
			let saved = session.change("Saved before projection failure", staged => [
				staged.set("mixed-comment", "resolved", "true"),
			])
			let accepted = yield* saved
			check(
				!!session.failures.current().projection &&
					!session.failures.current().save,
				"a projection failure after journal append preserves the successful save and reports cache recovery separately",
			)
			IDBDatabase.prototype.transaction = transaction
			let restored = yield* saved
			check(
				accepted.id === restored.id &&
					session.pending().length === 2 &&
					session.replica.fields("mixed-comment").resolved === "true",
				"retry after an uncertain projection outcome reconciles the original action without duplicating it",
			)
			yield* session.sync
			let staleAttempts = 0
			let stale = session.change("Stale grant", staged => {
				staleAttempts++
				return [staged.set(options.document, "access:browser-guest", "writer")]
			})
			failWrite = true
			IDBDatabase.prototype.transaction = failedTransaction
			let uncommitted = yield* stale.pipe(Effect.result)
			IDBDatabase.prototype.transaction = transaction
			yield* Effect.scoped(
				DocumentSession.use(peer =>
					peer.change("Peer permission revision", staged => [
						staged.set(options.document, "access:browser-guest", "reader"),
					]),
				).pipe(Effect.provide(browserDocumentSessionLayer(options))),
			)
			let rejected = yield* stale.pipe(Effect.result)
			let repeatedStale = yield* stale.pipe(Effect.result)
			check(
				uncommitted._tag === "Failure" &&
					rejected._tag === "Failure" &&
					rejected.failure instanceof AccessConflict &&
					repeatedStale._tag === "Failure" &&
					repeatedStale.failure instanceof AccessConflict &&
					staleAttempts === 1 &&
					session.pending().length === 1 &&
					session.replica.fields(options.document)["access:browser-guest"] ===
						"reader",
				"a Ref-held stale permission action returns a typed conflict on every retry without regenerating its guards",
			)
			yield* session.change("Continue after rejected grant", staged => [
				staged.set("mixed-comment", "resolved", "true"),
			])
			yield* session.sync
			check(
				session.pending().length === 0,
				"a locally rejected stale permission action cannot block later document synchronization",
			)
			let invented = yield* buildAction(
				session.replica,
				options.document,
				"Invented editor operation",
				staged => [staged.set(options.document, "mode", "slideshow")],
			)
			let invalid = yield* session.commit(invented).pipe(Effect.result)
			check(
				invalid._tag === "Failure" &&
					invalid.failure instanceof DocumentConflict &&
					session.pending().length === 0,
				"the exact-proposal retry interface cannot introduce an action using the editor's actor",
			)
			let release = yield* holdJournalLock(databaseName(options))
			let cancelAttempts = 0
			let cancellable = session.change("Interrupted before append", staged => {
				cancelAttempts++
				return [staged.set(options.document, "mode", "slideshow")]
			})
			let waiting = yield* cancellable.pipe(Effect.forkScoped)
			yield* pendingJournalLock(databaseName(options))
			check(
				hasUnloadGuard(),
				"a generic action waiting for the journal protects navigation before it becomes durable",
			)
			yield* Fiber.interrupt(waiting).pipe(Effect.timeout("1 second"))
			check(
				!hasUnloadGuard(),
				"interrupting an uncommitted action releases its navigation guard",
			)
			check(
				session.pending().length === 0,
				"an action waiting for another tab's journal lock can be interrupted without appending",
			)
			release()
			let resumed = yield* cancellable
			check(
				cancelAttempts === 1 && session.pending()[0]?.id === resumed.id,
				"retry after lock-wait interruption preserves the prepared action and executes its builder once",
			)
			yield* session.sync
		}),
	)
}

export function verifyConcurrentDocumentActions(
	options: DocumentSessionOptions,
	check: Check,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let session = yield* DocumentSession
			yield* Effect.scoped(
				Effect.gen(function* () {
					let peer = yield* DocumentSession
					let actions = yield* Effect.all(
						[
							session.change("Rename asset", staged => [
								staged.set("mixed-asset", "name", "Peer photo.png"),
							]),
							peer.change("Continue discussion", staged => [
								staged.set(
									"mixed-comment",
									"body",
									"Discussion from another tab",
								),
							]),
						],
						{ concurrency: "unbounded" },
					)
					yield* session.replay
					yield* peer.replay
					check(
						actions[0].actor !== actions[1].actor &&
							session.pending().length === 2 &&
							peer.pending().length === 2 &&
							session.replica.fields("mixed-comment").body ===
								"Discussion from another tab" &&
							peer.replica.fields("mixed-asset").name === "Peer photo.png",
						"two sessions serialize independent comment and asset actions through the real journal lock",
					)
					yield* session.sync
					yield* peer.sync
					check(
						session.pending().length === 0 && peer.pending().length === 0,
						"both sessions reconcile concurrent whole-document actions without identity collisions",
					)
				}).pipe(Effect.provide(browserDocumentSessionLayer(options))),
			)
			let source = session.replica.text(options.document)
			let database = databaseName(options)
			let release = yield* holdJournalLock(database)
			let action = yield* session
				.change("Present attached image", staged => [
					staged.set(options.document, "mode", "slideshow"),
					staged.edit(
						options.document,
						staged.text(options.document) + "\n![Photo](asset:mixed-asset)",
					),
				])
				.pipe(Effect.forkScoped)
			yield* pendingJournalLock(database)
			let edit = session.edit(source + "\nTyped behind the journal lock")
			check(
				session.unsaved() === 1 &&
					session.replica.fields(options.document).mode !== "slideshow" &&
					session.replica
						.text(options.document)
						.endsWith("Typed behind the journal lock"),
				"a blocked journal action keeps source typing responsive without exposing uncommitted settings",
			)
			release()
			let accepted = yield* Fiber.join(action)
			yield* edit.saved
			let pending = session.pending()
			let content = session.replica.text(options.document)
			check(
				pending[0]?.id === accepted.id &&
					pending[1]?.id === edit.operation?.id &&
					session.replica.fields(options.document).mode === "slideshow" &&
					content.endsWith("Typed behind the journal lock") &&
					content.split("![Photo](asset:mixed-asset)").length === 2 &&
					content.split("Typed behind the journal lock").length === 2,
				"releasing the real journal lock persists the action before queued typing and preserves both",
			)
			yield* session.sync
		}),
	)
}

export function verifyColdDocumentReplay(
	options: DocumentSessionOptions,
	check: Check,
	snapshotRequests: () => number,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			yield* clearProjection(databaseName(options))
			yield* DocumentSession.use(session =>
				Effect.sync(() =>
					check(
						snapshotRequests() === 1 &&
							session.replica.fields("mixed-comment").body ===
								"Discussion from another tab" &&
							session.replica.fields("mixed-asset").name === "Peer photo.png" &&
							session.replica.fields(options.document).mode === "slideshow" &&
							session.replica
								.text(options.document)
								.endsWith("Typed behind the journal lock") &&
							session.pending().length === 0,
						"cold local journal replay reconstructs all document state without a cached projection or HTTP snapshot",
					),
				),
			).pipe(Effect.provide(browserDocumentSessionLayer(options)))
		}),
	)
}

function holdJournalLock(database: string) {
	return Effect.acquireRelease(
		Effect.callback<() => void>((resume, signal) => {
			navigator.locks
				.request(
					database,
					{ signal },
					() => new Promise<void>(finish => resume(Effect.succeed(finish))),
				)
				.catch(cause => resume(Effect.die(cause)))
		}),
		release => Effect.sync(release),
	)
}
function pendingJournalLock(database: string) {
	return Effect.tryPromise(() => navigator.locks.query()).pipe(
		Effect.repeat({
			while: state => !state.pending?.some(lock => lock.name === database),
			schedule: Schedule.spaced("10 millis"),
		}),
		Effect.timeout("5 seconds"),
	)
}

function clearProjection(database: string) {
	return Effect.acquireRelease(
		Effect.callback<IDBDatabase, DOMException>(resume => {
			let request = indexedDB.open(database)
			request.onsuccess = () => resume(Effect.succeed(request.result))
			request.onerror = () =>
				resume(
					Effect.fail(request.error ?? new DOMException("Cannot open journal")),
				)
		}),
		db => Effect.sync(() => db.close()),
	).pipe(
		Effect.flatMap(db =>
			Effect.callback<void, DOMException>(resume => {
				let transaction = db.transaction("cache", "readwrite")
				transaction.objectStore("cache").delete("projection")
				transaction.oncomplete = () => resume(Effect.void)
				transaction.onabort = () =>
					resume(
						Effect.fail(
							transaction.error ?? new DOMException("Cannot remove projection"),
						),
					)
			}),
		),
	)
}

function databaseName(options: DocumentSessionOptions) {
	return (
		"alkalye-document-v1:" + JSON.stringify([options.subject, options.document])
	)
}
function includesStore(names: string | Iterable<string>, store: string) {
	return (typeof names === "string" ? [names] : Array.from(names)).includes(
		store,
	)
}
function hasUnloadGuard() {
	let event = new Event("beforeunload", { cancelable: true })
	window.dispatchEvent(event)
	return event.defaultPrevented
}
