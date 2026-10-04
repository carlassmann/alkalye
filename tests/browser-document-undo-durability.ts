import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Schedule from "effect/Schedule"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"

type Check = (value: unknown, message: string) => void

export function verifyUndoDurability(
	options: Parameters<typeof DocumentSession.layer>[0],
	check: Check,
) {
	return Effect.scoped(
		DocumentSession.use(session =>
			Effect.gen(function* () {
				let first = yield* session.change("First", staged => [
					staged.set(options.document, "first", "alpha"),
				])
				let mixed = yield* session.change("Mixed", staged => [
					staged.edit(options.document, "AXB"),
					staged.set(options.document, "mode", "slideshow"),
				])
				let transaction = IDBDatabase.prototype.transaction
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						IDBDatabase.prototype.transaction = transaction
					}),
				)
				IDBDatabase.prototype.transaction = function (names, mode, config) {
					if (
						this.name === database(options) &&
						mode === "readwrite" &&
						(typeof names === "string"
							? names === "entries"
							: Array.from(names).includes("entries"))
					)
						throw new DOMException("Undo append quota", "QuotaExceededError")
					return transaction.call(this, names, mode, config)
				}
				let pending = JSON.stringify(session.pending())
				let undo = session.undo()
				let failed = yield* undo.pipe(Effect.result)
				IDBDatabase.prototype.transaction = transaction
				check(
					failed._tag === "Failure" &&
						JSON.stringify(session.pending()) === pending &&
						session.replica.text(options.document) === "AXB" &&
						session.replica.fields(options.document).mode === "slideshow",
					"a failed undo append preserves every pending action and the complete visible state",
				)
				let later = yield* session.change("Later", staged => [
					staged.set(options.document, "note", "beta"),
				])
				let retry = yield* undo
				let repeated = yield* undo
				check(
					retry.id === repeated.id &&
						retry.undoOf === mixed.id &&
						session.pending().filter(action => action.id === retry.id)
							.length === 1 &&
						session.replica.text(options.document) === "AB" &&
						session.replica.fields(options.document).note === "beta",
					"retrying the same undo retains its original target and identity after a later independent edit",
				)
				let release = yield* Effect.acquireRelease(
					Effect.callback<() => void>((resume, signal) => {
						navigator.locks
							.request(
								database(options),
								{ signal },
								() =>
									new Promise<void>(finish => resume(Effect.succeed(finish))),
							)
							.catch(cause => resume(Effect.die(cause)))
					}),
					finish => Effect.sync(finish),
				)
				pending = JSON.stringify(session.pending())
				let cancellable = session.undo()
				let waiting = yield* cancellable.pipe(Effect.forkScoped)
				yield* Effect.tryPromise(() => navigator.locks.query()).pipe(
					Effect.repeat({
						while: state =>
							!state.pending?.some(lock => lock.name === database(options)),
						schedule: Schedule.spaced("10 millis"),
					}),
					Effect.timeout("5 seconds"),
				)
				yield* Fiber.interrupt(waiting).pipe(Effect.timeout("1 second"))
				check(
					JSON.stringify(session.pending()) === pending &&
						session.replica.fields(options.document).note === "beta",
					"interrupting undo while another tab holds the journal lock appends no compensation",
				)
				release()
				let newest = yield* session.change("Newest", staged => [
					staged.set(options.document, "other", "delta"),
				])
				let resumed = yield* cancellable
				check(
					resumed.undoOf === later.id &&
						session.replica.fields(options.document).note === "" &&
						session.replica.fields(options.document).other === "delta",
					"undo interrupted after preparation retries its exact target rather than selecting a newer action",
				)
				let undos = yield* Effect.all([session.undo(), session.undo()], {
					concurrency: "unbounded",
				})
				check(
					undos[0]?.undoOf === newest.id &&
						undos[1]?.undoOf === first.id &&
						undos[0]?.id !== undos[1]?.id &&
						session.replica.fields(options.document).first === "" &&
						session.replica.fields(options.document).other === "",
					"concurrent undo invocations serialize selection and create distinct compensations",
				)
			}),
		).pipe(Effect.provide(browserDocumentSessionLayer(options))),
	)
}
function database(options: { subject: string; document: string }) {
	return (
		"alkalye-document-v1:" + JSON.stringify([options.subject, options.document])
	)
}
