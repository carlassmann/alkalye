import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { TextReplacement } from "./src/shared/crdt"
import type { createWorkerSessionClient } from "./worker-client"
import { WorkerDocumentFailure } from "./worker-rpc"

type WorkerClient = Effect.Success<ReturnType<typeof createWorkerSessionClient>>
function queueMethods(client: WorkerClient) {
	return {
		UndoQueued: client.UndoQueued<false, false>,
		MergeCandidate: client.MergeCandidate<false, false>,
		Adopt: client.Adopt<false, false>,
	}
}
type QueueClient = Omit<
	WorkerClient,
	"UndoQueued" | "MergeCandidate" | "Adopt"
> &
	ReturnType<typeof queueMethods>
interface PendingEdit {
	kind: "edit"
	epoch: string
	sequence: number
	delivery:
		"queued" | "sending" | "unsaved" | "rejected" | "unknown" | "blocked"
	ranges: readonly TextReplacement[]
	saved: Deferred.Deferred<void, unknown>
	expectedSource: string
}

export interface EditorSelection {
	ranges?: {
		start: number
		end: number
		direction: "forward" | "backward" | "none"
	}[]
	source: string
	busy: boolean
	start: number
	end: number
	direction: "forward" | "backward" | "none"
	generation: number
	composing: boolean
}
interface MergeRequest {
	phase: "queued" | "requested" | "adopting"
	requested: Deferred.Deferred<void, unknown>
	kind: "merge"
	epoch: string
	sequence: number
	source: string
	selection: EditorSelection
	readSelection: () => EditorSelection
	accept: (source: string, selection: EditorSelection) => boolean
	saved: Deferred.Deferred<boolean, unknown>
}
interface Adoption {
	kind: "adopt"
	epoch: string
	sequence: number
	candidate: string
	saved: Deferred.Deferred<boolean, unknown>
}
interface UndoRequest {
	phase: "queued" | "sending"
	kind: "undo"
	request: string
	epoch: string
	sequence: number
	redo: boolean
	saved: Deferred.Deferred<
		{
			status: "applied" | "not-applied" | "unknown"
			action?: string
			failure?: string
		},
		unknown
	>
}
type EditorCommand = PendingEdit | MergeRequest | Adoption | UndoRequest

export function makeEditorQueue(
	client: QueueClient,
	initial: { epoch: string; sequence: number; source: string },
) {
	return Effect.gen(function* () {
		let queue = yield* Queue.unbounded<EditorCommand>()
		let epoch = initial.epoch
		let source = initial.source
		let sequence = initial.sequence
		let acknowledged = initial.sequence
		let applied = initial.sequence
		let pending: PendingEdit[] = []
		let failure: unknown
		let closed = false
		let accepting = false
		let commandFrozen = false
		let commandOwner: { epoch: string; sequence: number } | undefined
		let undoRequests = new Set<UndoRequest>()
		let merges = new Set<MergeRequest>()
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
				for (let request of undoRequests)
					yield* Deferred.fail(
						request.saved,
						request.phase === "sending"
							? new WorkerDocumentFailure({
									reason: "AppliedUnknown",
									category: "failure",
								})
							: blocked(),
					)
				undoRequests.clear()
				for (let merge of merges) {
					yield* Deferred.fail(merge.requested, blocked())
					yield* Deferred.fail(
						merge.saved,
						merge.phase === "adopting"
							? new WorkerDocumentFailure({
									reason: "AppliedUnknown",
									category: "failure",
								})
							: blocked(),
					)
				}
				merges.clear()
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
			Stream.runForEach(command =>
				Effect.gen(function* () {
					if (command.kind === "undo") {
						if (failure !== undefined || closed) {
							yield* Deferred.fail(command.saved, blocked())
							undoRequests.delete(command)
							return
						}
						command.phase = "sending"
						let payload = {
							request: command.request,
							epoch: command.epoch,
							sequence: command.sequence,
							redo: command.redo,
						}
						let result = yield* client.UndoQueued(payload).pipe(
							Effect.catch(error =>
								error instanceof WorkerDocumentFailure
									? Effect.fail(error)
									: client.UndoQueued(payload),
							),
							Effect.exit,
						)
						yield* Effect.uninterruptible(
							Effect.gen(function* () {
								if (Exit.isFailure(result)) {
									failure = new WorkerDocumentFailure({
										reason: "AppliedUnknown",
										category: "failure",
									})
									yield* Deferred.fail(command.saved, failure)
								} else {
									acknowledged = command.sequence
									applied = command.sequence
									if (result.value.status === "not-applied") {
										commandFrozen = false
										commandOwner = undefined
									}
									if (result.value.status === "unknown")
										failure = new WorkerDocumentFailure({
											reason: "AppliedUnknown",
											category: result.value.failure ?? "failure",
										})
									yield* Deferred.succeed(command.saved, result.value)
								}
								undoRequests.delete(command)
							}),
						)
						return
					}
					if (command.kind === "merge") {
						let merge = command
						if (
							failure !== undefined ||
							closed ||
							merge.epoch !== epoch ||
							merge.sequence !== sequence ||
							merge.source !== source
						) {
							yield* Deferred.fail(merge.requested, blocked())
							yield* Deferred.succeed(merge.saved, false)
							merges.delete(merge)
							return
						}
						let result = yield* Effect.scoped(
							Effect.gen(function* () {
								let request = yield* client
									.MergeCandidate({
										epoch: merge.epoch,
										sequence: merge.sequence,
										start: merge.selection.start,
										end: merge.selection.end,
										...(merge.selection.ranges
											? { ranges: merge.selection.ranges }
											: {}),
									})
									.pipe(
										Effect.exit,
										Effect.forkScoped({ startImmediately: true }),
									)
								merge.phase = "requested"
								yield* Deferred.succeed(merge.requested, undefined)
								return yield* Fiber.join(request)
							}),
						)
						if (Exit.isFailure(result)) {
							let error = Cause.squash(result.cause)
							if (
								!(error instanceof WorkerDocumentFailure) ||
								error.reason !== "SelectionUnavailable"
							)
								failure = error
							yield* Deferred.failCause(merge.saved, result.cause)
							merges.delete(merge)
							return
						}
						let candidate = result.value
						let accepted = yield* Effect.try(() => {
							let selection = merge.readSelection()
							if (
								closed ||
								failure !== undefined ||
								epoch !== merge.epoch ||
								sequence !== merge.sequence ||
								source !== merge.source ||
								selection.generation !== merge.selection.generation ||
								selection.start !== merge.selection.start ||
								selection.end !== merge.selection.end ||
								selection.direction !== merge.selection.direction ||
								selection.composing ||
								merge.selection.composing ||
								selection.busy ||
								merge.selection.busy ||
								selection.source !== merge.source
							)
								return false
							accepting = true
							let accepted: boolean
							try {
								accepted = merge.accept(candidate.source, {
									...selection,
									start: candidate.start,
									end: candidate.end,
									...(candidate.ranges
										? { ranges: [...candidate.ranges] }
										: {}),
								})
							} finally {
								accepting = false
							}
							if (!accepted) return false
							if (failure !== undefined) throw failure
							merge.phase = "adopting"
							if (
								!Queue.offerUnsafe(queue, {
									kind: "adopt",
									epoch,
									sequence,
									candidate: candidate.candidate,
									saved: merge.saved,
								})
							) {
								source = candidate.source
								throw blocked()
							}
							epoch = candidate.candidate
							sequence = 0
							acknowledged = 0
							applied = 0
							source = candidate.source
							return true
						}).pipe(Effect.exit)
						if (Exit.isFailure(accepted)) {
							failure = Cause.squash(accepted.cause)
							yield* Deferred.failCause(merge.saved, accepted.cause)
						} else if (!accepted.value) {
							let released = yield* client
								.ReleaseCandidate({ candidate: candidate.candidate })
								.pipe(Effect.exit)
							if (Exit.isFailure(released)) {
								failure = Cause.squash(released.cause)
								yield* Deferred.failCause(merge.saved, released.cause)
							} else yield* Deferred.succeed(merge.saved, false)
							merges.delete(merge)
						}
						return
					}
					if (command.kind === "adopt") {
						let result = yield* client
							.Adopt({
								epoch: command.epoch,
								sequence: command.sequence,
								candidate: command.candidate,
							})
							.pipe(Effect.exit)
						if (Exit.isFailure(result)) {
							let reconciled = yield* client.Read().pipe(Effect.exit)
							if (Exit.isSuccess(reconciled))
								yield* client
									.Release({ handle: reconciled.value.handle })
									.pipe(Effect.catch(() => Effect.void))
							if (
								Exit.isSuccess(reconciled) &&
								reconciled.value.epoch === command.candidate &&
								reconciled.value.sequence === 0 &&
								failure === undefined
							) {
								if (
									commandOwner?.epoch === command.epoch &&
									commandOwner.sequence === command.sequence
								) {
									commandFrozen = false
									commandOwner = undefined
								}
								yield* Deferred.succeed(command.saved, true)
							} else {
								failure = Cause.squash(result.cause)
								yield* Deferred.failCause(command.saved, result.cause)
							}
						} else {
							if (
								commandOwner?.epoch === command.epoch &&
								commandOwner.sequence === command.sequence
							) {
								commandFrozen = false
								commandOwner = undefined
							}
							yield* Deferred.succeed(command.saved, true)
						}
						for (let merge of merges)
							if (merge.saved === command.saved) merges.delete(merge)
						return
					}
					let edit = command
					if (failure !== undefined) {
						edit.delivery = "blocked"
						yield* Deferred.fail(edit.saved, blocked())
						return
					}
					edit.delivery = "sending"
					let result = yield* client
						.ReplaceQueued({
							epoch: edit.epoch,
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
					if (result.value.source !== edit.expectedSource) {
						failure = new WorkerDocumentFailure({
							reason: "AppliedUnknown",
							category: "conflict",
						})
						edit.delivery = "unknown"
						yield* Deferred.fail(edit.saved, failure)
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
			undo(redo: boolean) {
				let saved = Deferred.makeUnsafe<
					{
						status: "applied" | "not-applied" | "unknown"
						action?: string
						failure?: string
					},
					unknown
				>()
				if (closed || failure !== undefined || commandFrozen) {
					Deferred.doneUnsafe(saved, Effect.fail(blocked()))
					return Deferred.await(saved)
				}
				commandFrozen = true
				sequence++
				commandOwner = { epoch, sequence }
				let command: UndoRequest = {
					phase: "queued",
					kind: "undo",
					request: crypto.randomUUID(),
					epoch,
					sequence,
					redo,
					saved,
				}
				undoRequests.add(command)
				if (!Queue.offerUnsafe(queue, command)) {
					Deferred.doneUnsafe(saved, Effect.fail(blocked()))
					undoRequests.delete(command)
				}
				return Deferred.await(saved)
			},
			replace(
				ranges: readonly TextReplacement[],
				expectedSource?: string,
				fallback?: () => readonly TextReplacement[],
			) {
				if (commandFrozen || failure !== undefined || closed) throw blocked()
				let changes = ranges.map(change => Object.freeze({ ...change }))
				let pieces: string[] = []
				let offset = 0
				for (let change of changes) {
					pieces.push(source.slice(offset, change.start), change.text)
					offset = change.start + change.remove
				}
				pieces.push(source.slice(offset))
				let nextSource = pieces.join("")
				if (expectedSource !== undefined && nextSource !== expectedSource) {
					changes = fallback?.().map(change =>
						Object.freeze({ ...change }),
					) ?? [{ start: 0, remove: source.length, text: expectedSource }]
					nextSource = expectedSource
				}
				source = nextSource
				let saved = Deferred.makeUnsafe<void, unknown>()
				let edit: PendingEdit = {
					expectedSource: nextSource,
					kind: "edit",
					epoch,
					sequence: ++sequence,
					delivery: "queued",
					ranges: Object.freeze(changes),
					saved,
				}
				pending.push(edit)
				if (accepting || closed || !Queue.offerUnsafe(queue, edit)) {
					if (accepting)
						failure = new WorkerDocumentFailure({
							reason: "AppliedUnknown",
							category: "conflict",
						})
					edit.delivery = "blocked"
					Deferred.doneUnsafe(saved, Effect.fail(blocked()))
				}
				return { source, sequence: edit.sequence, saved: Deferred.await(saved) }
			},
			merge(
				readSelection: () => EditorSelection,
				accept: (source: string, selection: EditorSelection) => boolean,
			) {
				let saved = Deferred.makeUnsafe<boolean, unknown>()
				let requested = Deferred.makeUnsafe<void, unknown>()
				let command: MergeRequest = {
					phase: "queued",
					requested,
					kind: "merge",
					epoch,
					sequence,
					source,
					selection: { ...readSelection() },
					readSelection,
					accept,
					saved,
				}
				if (
					closed ||
					failure !== undefined ||
					pending.length ||
					!Queue.offerUnsafe(queue, command)
				) {
					Deferred.doneUnsafe(saved, Effect.succeed(false))
					Deferred.doneUnsafe(requested, Effect.fail(blocked()))
				} else merges.add(command)
				return {
					requested: Deferred.await(requested),
					saved: Deferred.await(saved),
				}
			},
			state() {
				return {
					source,
					epoch,
					sequence,
					acknowledged,
					applied,
					failure,
					closed,
					commandFrozen,
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
