import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import type { DocumentSessionOptions } from "../src/client/document-session"
import { DocumentConflict } from "../src/shared/document-actions"

type Check = (value: unknown, message: string) => void

export function verifyDocumentSessionClosing(
	options: DocumentSessionOptions,
	check: Check,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let transaction = IDBDatabase.prototype.transaction
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					IDBDatabase.prototype.transaction = transaction
				}),
			)
			let opened = yield* openSession(options)
			let appends = 0
			IDBDatabase.prototype.transaction = function (names, mode, options) {
				if (isAppend(this, names, mode) && ++appends <= 2)
					throw new DOMException("Final flush interrupted", "UnknownError")
				return transaction.call(this, names, mode, options)
			}
			opened.session.edit(
				opened.session.replica.text(options.document) + "\nRetried final flush",
			)
			yield* Scope.close(opened.scope, Exit.void).pipe(
				Effect.timeout("3 seconds"),
			)
			check(
				appends === 3 &&
					opened.session.unsaved() === 0 &&
					!opened.session.failures.current().save,
				"closing retries a transient final append before releasing the document",
			)
			IDBDatabase.prototype.transaction = transaction
			let closing = yield* openSession(options)
			yield* closing.session.edit(
				closing.session.replica.text(options.document) + "\nClosing snapshot",
			).saved
			let completed = yield* Deferred.make<void>()
			let acknowledge: (() => void) | undefined
			IDBDatabase.prototype.transaction = function (names, mode, options) {
				let tx = transaction.call(this, names, mode, options)
				if (
					this.name.startsWith("alkalye-document-v1:") &&
					mode === "readwrite" &&
					includesStore(names, "cache") &&
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
			let releasing = yield* Scope.close(closing.scope, Exit.void).pipe(
				Effect.forkScoped,
			)
			yield* Deferred.await(completed).pipe(Effect.timeout("3 seconds"))
			let source = closing.session.replica.text(options.document)
			let late = closing.session.edit(source + "\nToo late to append")
			let rejected = yield* late.saved.pipe(Effect.result)
			check(
				!late.operation &&
					rejected._tag === "Failure" &&
					closing.session.replica.text(options.document) === source,
				"closing ends editor intake before awaiting its final snapshot copy",
			)
			let builders = 0
			let command = yield* closing.session
				.change("Too late to stage", staged => {
					builders++
					return [staged.set(options.document, "mode", "slideshow")]
				})
				.pipe(Effect.result)
			check(
				command._tag === "Failure" && builders === 0,
				"closing refuses new whole-document commands before executing their builders",
			)
			IDBDatabase.prototype.transaction = transaction
			acknowledge?.()
			acknowledge = undefined
			yield* Fiber.join(releasing)
			let proposal = closing.session.pending()[0]
			if (!proposal) return yield* Effect.die("Missing saved closing proposal")
			let committed = yield* closing.session
				.commit(proposal)
				.pipe(Effect.result)
			let synced = yield* closing.session.sync.pipe(Effect.result)
			check(
				committed._tag === "Failure" &&
					committed.failure instanceof DocumentConflict &&
					synced._tag === "Failure" &&
					synced.failure instanceof DocumentConflict,
				"closed commit and sync reject use before touching the journal or remote transport",
			)
			let damaged = yield* openSession(options)
			appends = 0
			IDBDatabase.prototype.transaction = function (names, mode, options) {
				if (isAppend(this, names, mode)) {
					appends++
					throw new DOMException(
						"Persistent final flush failure",
						"UnknownError",
					)
				}
				return transaction.call(this, names, mode, options)
			}
			damaged.session.edit(
				damaged.session.replica.text(options.document) +
					"\nInspectable failed draft",
			)
			let failed = yield* Scope.close(damaged.scope, Exit.void).pipe(
				Effect.exit,
				Effect.timeout("3 seconds"),
			)
			check(
				Exit.isFailure(failed) &&
					appends === 4 &&
					damaged.session.unsaved() === 1 &&
					!!damaged.session.failures.current().save &&
					hasUnloadGuard(),
				"an exhausted final flush fails release observably and retains its queued draft for inspection",
			)
			IDBDatabase.prototype.transaction = transaction
			let restored = yield* openSession(options)
			check(
				restored.session.replica.text(options.document) === source &&
					damaged.session.replica
						.text(options.document)
						.endsWith("Inspectable failed draft"),
				"failed close cannot publish an unsaved draft as durable and leaves its source available for recovery",
			)
		}),
	)
}
function hasUnloadGuard() {
	let event = new Event("beforeunload", { cancelable: true })
	window.dispatchEvent(event)
	return event.defaultPrevented
}

function openSession(options: DocumentSessionOptions) {
	return Effect.gen(function* () {
		let scope = yield* Scope.make()
		yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
		let context = yield* Layer.build(browserDocumentSessionLayer(options)).pipe(
			Effect.provideService(Scope.Scope, scope),
		)
		return { scope, session: Context.get(context, DocumentSession) }
	})
}
function isAppend(
	db: IDBDatabase,
	names: string | Iterable<string>,
	mode?: IDBTransactionMode,
) {
	return (
		db.name.startsWith("alkalye-document-v1:") &&
		mode === "readwrite" &&
		includesStore(names, "entries")
	)
}
function includesStore(names: string | Iterable<string>, store: string) {
	return (typeof names === "string" ? [names] : Array.from(names)).includes(
		store,
	)
}
