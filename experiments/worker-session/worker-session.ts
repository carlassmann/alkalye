import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import { indexedDbJournalLayer } from "../../src/platform/indexeddb-journal"
import { DocumentLifecycle } from "../../src/platform/document-lifecycle"
import {
	DocumentSession,
	documentDatabaseName,
} from "../../src/shared/document-session"
import { makeDocumentTransport } from "../../src/shared/document-transport"
import { documentFailureCategory } from "../../src/shared/document-observability"
import type { Atom } from "../../src/shared/model"
import { WorkerDocumentFailure, WorkerDocumentRpc } from "./worker-rpc"

let workerLifecycle = Layer.succeed(DocumentLifecycle, {
	changes: Stream.never,
	hidden: Stream.never,
	protect: () => Effect.succeed({ update() {} }),
})

export let workerSessionHandlers = WorkerDocumentRpc.toLayer(
	Effect.gen(function* () {
		let owner = yield* Scope.Scope
		let commands = yield* Semaphore.make(1)
		let opened:
			| {
					document: string
					scope: Scope.Closeable
					session: Context.Service.Shape<typeof DocumentSession>
			  }
			| undefined
		let handles = new Map<string, Atom[]>()
		let sequence = 0
		function fail(reason: WorkerDocumentFailure["reason"]) {
			return new WorkerDocumentFailure({ reason, category: "conflict" })
		}
		function requireSession() {
			return Effect.suspend(() =>
				opened ? Effect.succeed(opened) : Effect.fail(fail("Closed")),
			)
		}
		function requireCapacity() {
			return Effect.suspend(() =>
				handles.size < 8 ? Effect.void : Effect.fail(fail("HandleCapacity")),
			)
		}
		function read() {
			return Effect.gen(function* () {
				yield* requireCapacity()
				let current = yield* requireSession()
				return yield* Effect.try(() => {
					let handle = String(++sequence)
					let atoms = current.session.replica.visible(current.document)
					let source = current.session.replica.text(current.document)
					handles.set(handle, atoms)
					return {
						handle,
						revision: current.session.version(),
						source,
						unsaved: current.session.unsaved(),
						pending: current.session.pending().length,
						rejected: current.session.rejected().length,
					}
				})
			})
		}
		function execute<A, E, R>(work: Effect.Effect<A, E, R>) {
			return commands.withPermit(work).pipe(
				Effect.mapError(error =>
					error instanceof WorkerDocumentFailure
						? error
						: new WorkerDocumentFailure({
								reason: "SessionFailure",
								category: documentFailureCategory(error),
							}),
				),
				Effect.catchDefect(() =>
					Effect.fail(
						new WorkerDocumentFailure({
							reason: "SessionFailure",
							category: "failure",
						}),
					),
				),
			)
		}
		return WorkerDocumentRpc.of({
			Open: input =>
				execute(
					Effect.uninterruptibleMask(restore =>
						Effect.gen(function* () {
							if (opened) return yield* Effect.fail(fail("AlreadyOpen"))
							let options = {
								...input,
								transport: yield* makeDocumentTransport(
									input.origin,
									input.subject,
								),
							}
							let scope = yield* Scope.fork(owner)
							return yield* restore(
								Effect.gen(function* () {
									let context = yield* Layer.buildWithScope(
										DocumentSession.layer(options).pipe(
											Layer.provide(
												indexedDbJournalLayer(documentDatabaseName(options)),
											),
											Layer.provide(workerLifecycle),
										),
										scope,
									)
									opened = {
										document: input.document,
										scope,
										session: Context.get(context, DocumentSession),
									}
									return yield* read()
								}),
							).pipe(
								Effect.onExit(exit =>
									Exit.isSuccess(exit)
										? Effect.void
										: Effect.sync(() => {
												opened = undefined
												handles.clear()
											}).pipe(Effect.andThen(Scope.close(scope, exit))),
								),
							)
						}),
					),
				),
			Read: () => execute(read()),
			Replace: input =>
				execute(
					Effect.gen(function* () {
						yield* requireCapacity()
						let current = yield* requireSession()
						let base = handles.get(input.handle)
						if (!base) return yield* Effect.fail(fail("HandleUnavailable"))
						let edit = yield* Effect.try(() =>
							current.session.replace(input.ranges, base),
						)
						let saved: Effect.Effect<void, unknown> = edit.saved
						yield* saved.pipe(
							Effect.mapError(
								error =>
									new WorkerDocumentFailure({
										reason: edit.operation ? "Unsaved" : "Rejected",
										category: documentFailureCategory(error),
									}),
							),
						)
						return yield* read()
					}),
				),
			Release: input =>
				execute(
					Effect.sync(() => {
						handles.delete(input.handle)
					}),
				),
			Sync: () =>
				execute(
					requireSession().pipe(
						Effect.flatMap(current => current.session.sync),
					),
				),
			Flush: () =>
				execute(
					requireSession().pipe(
						Effect.flatMap(current => current.session.flush),
					),
				),
			Close: () =>
				execute(
					Effect.uninterruptible(
						Effect.gen(function* () {
							let current = yield* requireSession()
							opened = undefined
							handles.clear()
							yield* Scope.close(current.scope, Exit.void)
						}),
					).pipe(
						Effect.catchDefect(() =>
							Effect.fail(
								new WorkerDocumentFailure({
									reason: "SessionFailure",
									category: "storage",
								}),
							),
						),
					),
				),
		})
	}),
)
