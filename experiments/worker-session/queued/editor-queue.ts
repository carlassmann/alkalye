import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { TextReplacement } from "../../../src/shared/crdt"
import type { createWorkerSessionClient } from "./worker-client"
import { WorkerDocumentFailure } from "./worker-rpc"

type WorkerClient = Effect.Success<ReturnType<typeof createWorkerSessionClient>>
interface PendingEdit {
	sequence: number
	delivery:
		"queued" | "sending" | "unsaved" | "rejected" | "unknown" | "blocked"
	ranges: readonly TextReplacement[]
	saved: Deferred.Deferred<void, unknown>
}

export function makeEditorQueue(
	client: WorkerClient,
	initial: { epoch: string; sequence: number; source: string },
) {
	return Effect.gen(function* () {
		let queue = yield* Queue.unbounded<PendingEdit>()
		let source = initial.source
		let sequence = initial.sequence
		let acknowledged = initial.sequence
		let applied = initial.sequence
		let pending: PendingEdit[] = []
		let failure: unknown
		let closed = false
		function blocked() {
			return new WorkerDocumentFailure({
				reason: "QueuedBlocked",
				category: "conflict",
			})
		}
		yield* Effect.addFinalizer(() =>
			Effect.gen(function* () {
				closed = true
				yield* Queue.shutdown(queue)
				for (let edit of pending) {
					if (edit.delivery === "sending") edit.delivery = "unknown"
					else if (edit.delivery === "queued") edit.delivery = "blocked"
					yield* Deferred.fail(
						edit.saved,
						edit.delivery === "unknown"
							? new WorkerDocumentFailure({
									reason: "AppliedUnknown",
									category: "failure",
								})
							: blocked(),
					)
				}
			}),
		)
		yield* Stream.fromQueue(queue).pipe(
			Stream.runForEach(edit =>
				Effect.gen(function* () {
					if (failure !== undefined) {
						edit.delivery = "blocked"
						yield* Deferred.fail(edit.saved, blocked())
						return
					}
					edit.delivery = "sending"
					let result = yield* client
						.ReplaceQueued({
							epoch: initial.epoch,
							sequence: edit.sequence,
							ranges: edit.ranges,
						})
						.pipe(Effect.exit)
					if (Exit.isFailure(result)) {
						failure = Cause.squash(result.cause)
						if (
							failure instanceof WorkerDocumentFailure &&
							failure.reason === "Unsaved"
						) {
							edit.delivery = "unsaved"
							applied = edit.sequence
						} else if (
							failure instanceof WorkerDocumentFailure &&
							failure.reason === "Rejected"
						)
							edit.delivery = "rejected"
						else edit.delivery = "unknown"
						yield* Deferred.failCause(edit.saved, result.cause)
						return
					}
					acknowledged = result.value.sequence
					applied = result.value.sequence
					pending = pending.filter(item => item !== edit)
					yield* Deferred.succeed(edit.saved, undefined)
				}),
			),
			Effect.forkScoped({ startImmediately: true }),
		)
		return {
			replace(ranges: readonly TextReplacement[]) {
				let changes = ranges.map(change => Object.freeze({ ...change }))
				let pieces: string[] = []
				let offset = 0
				for (let change of changes) {
					pieces.push(source.slice(offset, change.start), change.text)
					offset = change.start + change.remove
				}
				pieces.push(source.slice(offset))
				source = pieces.join("")
				let saved = Deferred.makeUnsafe<void, unknown>()
				let edit: PendingEdit = {
					sequence: ++sequence,
					delivery: "queued",
					ranges: Object.freeze(changes),
					saved,
				}
				pending.push(edit)
				if (closed || !Queue.offerUnsafe(queue, edit)) {
					edit.delivery = "blocked"
					Deferred.doneUnsafe(saved, Effect.fail(blocked()))
				}
				return { source, sequence: edit.sequence, saved: Deferred.await(saved) }
			},
			state() {
				return {
					source,
					acknowledged,
					applied,
					failure,
					closed,
					pending: pending.map(edit => ({
						sequence: edit.sequence,
						delivery: edit.delivery,
						ranges: edit.ranges,
					})),
				}
			},
		}
	})
}
