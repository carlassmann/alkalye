import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { DocumentSession } from "../src/client/document-session"

type Check = (value: unknown, message: string) => void

export function verifyDocumentSessionRecovery(check: Check) {
	return Effect.scoped(
		Effect.gen(function* () {
			let session = yield* DocumentSession
			let transaction = IDBDatabase.prototype.transaction
			let postMessage = BroadcastChannel.prototype.postMessage
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					IDBDatabase.prototype.transaction = transaction
					BroadcastChannel.prototype.postMessage = postMessage
				}),
			)
			let failSnapshot = true
			IDBDatabase.prototype.transaction = function (names, mode, options) {
				if (
					failSnapshot &&
					this.name.startsWith("alkalye-document-v1:") &&
					mode === "readwrite" &&
					includesStore(names, "cache")
				)
					throw new DOMException(
						"Persistent snapshot quota",
						"QuotaExceededError",
					)
				return transaction.call(this, names, mode, options)
			}
			yield* session.edit(
				session.replica.text("browser-document") +
					"\nPersistent snapshot recovery",
			).saved
			yield* waitForFailure(session, value => !!value.snapshot)
			yield* session.replay
			check(
				!!session.failures.current().snapshot &&
					!session.failures.current().projection &&
					!session.failures.current().save,
				"successful replay preserves a persistent snapshot quota error without labeling source unsaved",
			)
			failSnapshot = false
			IDBDatabase.prototype.transaction = transaction
			yield* waitForFailure(session, value => !value.snapshot)
			check(
				!session.failures.current().snapshot,
				"a failed snapshot copy retries and heals without another editor input",
			)
			IDBDatabase.prototype.transaction = function (names, mode, options) {
				if (
					this.name.startsWith("alkalye-document-v1:") &&
					mode === "readwrite" &&
					includesStore(names, "entries")
				)
					throw new DOMException("Transient typed save", "UnknownError")
				return transaction.call(this, names, mode, options)
			}
			let draft = session.edit(
				session.replica.text("browser-document") + "\nIdle draft recovery",
			)
			let unsaved = yield* draft.saved.pipe(Effect.result)
			check(
				unsaved._tag === "Failure" &&
					session.unsaved() === 1 &&
					!!session.failures.current().save &&
					hasUnloadGuard(),
				"a failed typed append retains its draft, save error and navigation guard",
			)
			IDBDatabase.prototype.transaction = transaction
			yield* waitForFailure(session, value => !value.save)
			check(
				session.unsaved() === 0 &&
					!hasUnloadGuard() &&
					session.replica
						.text("browser-document")
						.endsWith("Idle draft recovery"),
				"typed source automatically becomes durable while idle after storage recovers",
			)
			let afterAppend = false
			IDBDatabase.prototype.transaction = function (names, mode, options) {
				if (this.name.startsWith("alkalye-document-v1:")) {
					if (mode === "readwrite" && includesStore(names, "entries"))
						afterAppend = true
					else if (
						afterAppend &&
						mode === "readonly" &&
						includesStore(names, "positions")
					) {
						afterAppend = false
						throw new DOMException(
							"Transient post-append replay",
							"UnknownError",
						)
					}
				}
				return transaction.call(this, names, mode, options)
			}
			let command = yield* session.change(
				"Recover projection automatically",
				staged => [staged.set("mixed-comment", "resolved", "false")],
			)
			check(
				!!session.failures.current().projection &&
					!session.failures.current().snapshot,
				"post-append replay failure reports projection lag independently of snapshot copies",
			)
			IDBDatabase.prototype.transaction = transaction
			yield* waitForFailure(session, value => !value.projection)
			check(
				session.pending().some(action => action.id === command.id) &&
					session.replica.fields("mixed-comment").resolved === "false",
				"a committed action automatically reaches the visible projection without manual replay or another command",
			)
			let failNotice = true
			BroadcastChannel.prototype.postMessage = function (message) {
				if (failNotice)
					throw new DOMException(
						"Closed notification channel",
						"InvalidStateError",
					)
				return postMessage.call(this, message)
			}
			let notified = yield* session.change(
				"Save despite notification failure",
				staged => [staged.set("mixed-comment", "resolved", "true")],
			)
			check(
				!!session.failures.current().notification &&
					!session.failures.current().projection &&
					session.pending().some(action => action.id === notified.id),
				"a failed cross-tab hint cannot turn a durable visible action into a projection or save failure",
			)
			failNotice = false
			BroadcastChannel.prototype.postMessage = postMessage
			yield* session.change("Publish recovered hint", staged => [
				staged.set("mixed-comment", "resolved", "true"),
			])
			check(
				!session.failures.current().notification,
				"a later successful hint clears only the notification failure",
			)
			let atoms = session.replica.visible("browser-document")
			let before = session.replica.text("browser-document")
			let mutated = false
			try {
				Object.assign(atoms[0] ?? {}, { value: "Corrupted" })
			} catch {
				mutated = true
			}
			check(
				mutated &&
					Object.isFrozen(atoms) &&
					session.replica.text("browser-document") === before,
				"the native read facade protects tracked atom arrays and atom values from mutation",
			)
			let version = session.version()
			let edit = session.edit(before + "\nDraft navigation guard")
			check(
				session.version() > version && hasUnloadGuard(),
				"optimistic input publishes a view revision and synchronously protects an unsaved draft",
			)
			yield* edit.saved
			check(
				!hasUnloadGuard(),
				"the navigation guard clears after the draft is durably saved",
			)
			yield* verifySnapshotGate(session, check)
			yield* session.sync
		}),
	)
}

function verifySnapshotGate(session: DocumentSession["Service"], check: Check) {
	return Effect.scoped(
		Effect.gen(function* () {
			let transaction = IDBDatabase.prototype.transaction
			let completed = yield* Deferred.make<void>()
			let acknowledge: (() => void) | undefined
			yield* session.edit(
				session.replica.text("browser-document") +
					"\nCapture before delayed cache acknowledgement",
			).saved
			IDBDatabase.prototype.transaction = function (names, mode, options) {
				let tx = transaction.call(this, names, mode, options)
				if (
					mode === "readwrite" &&
					includesStore(names, "cache") &&
					this.name.startsWith("alkalye-document-v1:") &&
					!acknowledge
				) {
					tx.addEventListener("complete", event => {
						event.stopImmediatePropagation()
						acknowledge = () => tx.oncomplete?.call(tx, new Event("complete"))
						Effect.runSync(Deferred.succeed(completed, undefined))
					})
				}
				return tx
			}
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					IDBDatabase.prototype.transaction = transaction
					acknowledge?.()
				}),
			)
			let copying = yield* session.save.pipe(Effect.forkScoped)
			yield* Deferred.await(completed).pipe(Effect.timeout("5 seconds"))
			let edit = session.edit(
				session.replica.text("browser-document") +
					"\nSaved while cache acknowledgement waits",
			)
			yield* edit.saved.pipe(Effect.timeout("2 seconds"))
			check(
				session.unsaved() === 0 &&
					session.replica
						.text("browser-document")
						.endsWith("Saved while cache acknowledgement waits"),
				"a delayed snapshot acknowledgement releases the editing gate so a source append can finish",
			)
			IDBDatabase.prototype.transaction = transaction
			acknowledge?.()
			acknowledge = undefined
			yield* Fiber.join(copying)
		}),
	)
}

function waitForFailure(
	session: DocumentSession["Service"],
	predicate: (
		value: ReturnType<DocumentSession["Service"]["failures"]["current"]>,
	) => boolean,
) {
	return session.failures.changes.pipe(
		Stream.filter(predicate),
		Stream.take(1),
		Stream.runDrain,
		Effect.timeout("5 seconds"),
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
