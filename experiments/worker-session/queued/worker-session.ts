import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import { indexedDbJournalLayer } from "../../../src/platform/indexeddb-journal"
import { DocumentLifecycle } from "../../../src/platform/document-lifecycle"
import {
	DocumentSession,
	documentDatabaseName,
} from "../../../src/shared/document-session"
import { makeDocumentTransport } from "../../../src/shared/document-transport"
import { documentFailureCategory } from "../../../src/shared/document-observability"
import { Replica } from "../../../src/shared/crdt"
import type { Atom } from "../../../src/shared/model"
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
		let epoch = 0
		let basis: { epoch: string; sequence: number; replica: Replica } | undefined
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
						...(basis
							? {
									epoch: basis.epoch,
									sequence: basis.sequence,
									localSource: basis.replica.text(current.document),
								}
							: {}),
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
												basis = undefined
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
						if (basis) return yield* Effect.fail(fail("BasisUnavailable"))
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
			Begin: () =>
				execute(
					Effect.gen(function* () {
						let current = yield* requireSession()
						if (basis) return yield* Effect.fail(fail("BasisUnavailable"))
						let replica = yield* current.session.replica.forkEffect()
						basis = { epoch: String(++epoch), sequence: 0, replica }
						return {
							epoch: basis.epoch,
							sequence: basis.sequence,
							source: replica.text(current.document),
						}
					}),
				),
			ReplaceQueued: input =>
				execute(
					Effect.gen(function* () {
						let current = yield* requireSession()
						let local = basis
						if (!local || local.epoch !== input.epoch)
							return yield* Effect.fail(fail("BasisUnavailable"))
						if (input.sequence !== local.sequence + 1)
							return yield* Effect.fail(fail("SequenceUnavailable"))
						let edit = yield* Effect.try({
							try: () => {
								let edit = current.session.replace(
									input.ranges,
									local.replica.visible(current.document),
								)
								if (edit.operation) {
									local.replica.apply([edit.operation])
									local.sequence = input.sequence
								}
								return edit
							},
							catch: () => {
								basis = undefined
								return fail("AppliedUnknown")
							},
						})
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
						local.sequence = input.sequence
						return {
							epoch: local.epoch,
							sequence: local.sequence,
							source: local.replica.text(current.document),
							unsaved: current.session.unsaved(),
						}
					}),
				),
			End: input =>
				execute(
					Effect.gen(function* () {
						let current = yield* requireSession()
						if (!basis || basis.epoch !== input.epoch)
							return yield* Effect.fail(fail("BasisUnavailable"))
						if (input.sequence !== basis.sequence)
							return yield* Effect.fail(fail("SequenceUnavailable"))
						yield* current.session.flush
						let merged = yield* read()
						basis = undefined
						return {
							...merged,
							epoch: undefined,
							sequence: undefined,
							localSource: undefined,
						}
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
							basis = undefined
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
