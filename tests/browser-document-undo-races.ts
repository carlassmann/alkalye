import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"

import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import { makeDocumentTransport } from "../src/client/document-transport"
import { buildAction, restoreSnapshot } from "../src/shared/document-actions"
import { UndoUnavailable } from "../src/shared/document-errors"

type Check = (value: unknown, message: string) => void

export function verifyUndoRaces(
	subject: string,
	transport: Effect.Success<ReturnType<typeof makeDocumentTransport>>,
	check: Check,
) {
	return Effect.gen(function* () {
		let options = { document: "native-undo-tabs", subject, transport }
		yield* Effect.scoped(
			DocumentSession.use(left =>
				Effect.gen(function* () {
					let first = yield* left.change("First", staged => [
						staged.set(options.document, "first", "alpha"),
					])
					let second = yield* left.change("Second", staged => [
						staged.set(options.document, "second", "beta"),
					])
					let right = Context.get(
						yield* Layer.build(browserDocumentSessionLayer(options)),
						DocumentSession,
					)
					let release = yield* holdJournalLock(database(options))
					let undoLeft = yield* left
						.undo()
						.pipe(Effect.result, Effect.forkScoped)
					let undoRight = yield* right
						.undo()
						.pipe(Effect.result, Effect.forkScoped)
					yield* Effect.tryPromise(() => navigator.locks.query()).pipe(
						Effect.repeat({
							while: state =>
								(state.pending?.filter(lock => lock.name === database(options))
									.length ?? 0) < 1,
							schedule: Schedule.spaced("10 millis"),
						}),
						Effect.timeout("5 seconds"),
						Effect.ensuring(Effect.sync(release)),
					)
					let results = yield* Effect.all([
						Fiber.join(undoLeft),
						Fiber.join(undoRight),
					])
					yield* left.replay
					check(
						results.every(
							result =>
								result._tag === "Success" ||
								isUnavailable(result.failure, "Superseded"),
						) &&
							left.pending().filter(action => action.undoOf === second.id)
								.length === 1,
						"two tabs selecting the same undo cannot append a fork through the shared journal lock",
					)
					let remaining =
						results.filter(result => result._tag === "Success").length === 1
					let next = remaining ? yield* left.undo() : undefined
					yield* left.sync
					check(
						(!remaining || next?.undoOf === first.id) &&
							!left.pending().length &&
							left.replica.fields(options.document).first === "" &&
							left.replica.fields(options.document).second === "",
						"after a cross-tab undo conflict the next invocation continues the stack and the server accepts both tips",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		options = { document: "native-undo-input", subject, transport }
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					yield* session.change("Setting", staged => [
						staged.set(options.document, "note", "Keep"),
					])
					let getAll = IDBObjectStore.prototype.getAll
					let draft: ReturnType<typeof session.edit> | undefined
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => {
							IDBObjectStore.prototype.getAll = getAll
						}),
					)
					IDBObjectStore.prototype.getAll = function (query, count) {
						if (
							!draft &&
							count === 100 &&
							this.name === "positions" &&
							this.transaction.db.name === database(options)
						)
							draft = session.edit("ABx")
						return getAll.call(this, query, count)
					}
					let result = yield* session.undo().pipe(Effect.result)
					IDBObjectStore.prototype.getAll = getAll
					if (draft) yield* draft.saved
					check(
						result._tag === "Failure" &&
							isUnavailable(result.failure, "Stale") &&
							session.replica.text(options.document) === "ABx" &&
							session.replica.fields(options.document).note === "Keep" &&
							session.pending().every(action => !action.undoOf),
						"text typed during lazy undo indexing survives and makes the waiting command stale before any compensation append",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		options = { document: "native-undo-exhausted", subject, transport }
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let older = yield* session.change("Older", staged => [
						staged.set(options.document, "first", "alpha"),
					])
					yield* session.change("Newer", staged => [
						staged.set(options.document, "second", "beta"),
					])
					yield* session.sync
					yield* transport.commit(
						yield* buildAction(
							yield* restoreSnapshot(
								yield* transport.snapshot(options.document),
								subject + "-exhausted-peer",
							),
							options.document,
							"Peer setting",
							staged => [staged.set(options.document, "second", "peer")],
						),
					)
					yield* session.sync
					let undo = yield* session.undo()
					yield* session.sync
					check(
						undo.undoOf === older.id &&
							session.replica.fields(options.document).first === "" &&
							session.replica.fields(options.document).second === "peer",
						"a completely peer-overwritten newest action cannot block undo of an older independent contribution",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		let attempts = 0
		let floorOptions = {
			document: "native-undo-floor",
			subject,
			transport: {
				...transport,
				commit: (action: Parameters<typeof transport.commit>[0]) =>
					Effect.suspend(() => {
						attempts++
						return action.undoOf
							? Effect.fail(
									new UndoUnavailable({
										reason: "BelowFloor",
										message: "The action lacks retained undo provenance",
									}),
								)
							: transport.commit(action)
					}),
			},
		}
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					yield* session.change("Setting", staged => [
						staged.set(floorOptions.document, "note", "Keep"),
					])
					yield* session.sync
					yield* session.undo()
					yield* session.sync
					let count = attempts
					let result = yield* session.undo().pipe(Effect.result)
					check(
						result._tag === "Failure" &&
							isUnavailable(result.failure, "Exhausted") &&
							attempts === count &&
							!session.pending().length,
						"a definite undo-floor rejection excludes its root without repeatedly proposing or withdrawing the same unavailable undo",
					)
					yield* session.save
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(floorOptions))),
		)
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let result = yield* session.undo().pipe(Effect.result)
					check(
						result._tag === "Failure" &&
							isUnavailable(result.failure, "Exhausted") &&
							!session.pending().length &&
							session.replica.fields(floorOptions.document).note === "Keep",
						"cold undo derives the unavailable-root boundary from retained rejection facts",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(floorOptions))),
		)
	})
}

function holdJournalLock(name: string) {
	return Effect.acquireRelease(
		Effect.callback<() => void>((resume, signal) => {
			navigator.locks
				.request(
					name,
					{ signal },
					() => new Promise<void>(finish => resume(Effect.succeed(finish))),
				)
				.catch(cause => resume(Effect.die(cause)))
		}),
		finish => Effect.sync(finish),
	)
}
function isUnavailable(value: unknown, reason: string) {
	return Schema.is(
		Schema.Struct({
			_tag: Schema.Literal("UndoUnavailable"),
			reason: Schema.Literal(reason),
		}),
	)(value)
}
function database(options: { subject: string; document: string }) {
	return (
		"alkalye-document-v1:" + JSON.stringify([options.subject, options.document])
	)
}
