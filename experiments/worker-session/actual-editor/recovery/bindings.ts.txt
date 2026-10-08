import * as Effect from "effect/Effect"
import { sourceDifference } from "./src/client/source-textarea"
import type {
	EditorElement,
	EditorOptions,
	MergedEditorSelection,
} from "./src/client/components/editor"
import type { makeEditorQueue } from "./editor-queue"
import { WorkerDocumentFailure } from "./worker-rpc"

type EditorQueue = Effect.Success<ReturnType<typeof makeEditorQueue>>

export function workerEditorBindings(
	editor: EditorElement,
	queue: EditorQueue,
	fork: (effect: Effect.Effect<void, unknown>) => void,
	report: (error: unknown) => void,
) {
	let runningUndo = false
	let failed = false
	let adoptionAttempts = 0
	let needsAdoption = false
	let postponedUndo: boolean | undefined
	function fail(error: unknown) {
		if (failed) return
		failed = true
		postponedUndo = undefined
		needsAdoption = false
		editor.failAuthority()
		fork(Effect.sync(() => report(error)))
	}
	let change: EditorOptions["change"] = (content, _base, replacements) => {
		let previous = queue.state().source
		let ranges = replacements ?? [sourceDifference(previous, content)]
		try {
			let pending = queue.replace(ranges, content, () => [
				sourceDifference(previous, content),
			])
			fork(
				pending.saved.pipe(
					Effect.catch(error => Effect.sync(() => fail(error))),
				),
			)
		} catch (error) {
			fail(error)
		}
		return { kind: "pending" }
	}
	function selection(): MergedEditorSelection {
		let selected = editor.mergeSelection()
		if (!selected)
			return {
				start: 0,
				end: 0,
				direction: "none",
				generation: 0,
				composing: false,
				busy: true,
				source: queue.state().source,
			}
		return selected
	}
	function merge() {
		if (runningUndo || needsAdoption)
			return {
				requested: Effect.fail(
					new WorkerDocumentFailure({
						reason: "QueuedBlocked",
						category: "conflict",
					}),
				),
				saved: Effect.succeed(false),
			}
		let requested = queue.merge(selection, (source, selected) =>
			editor.adoptMerged(source, selected),
		)
		return {
			...requested,
			saved: requested.saved.pipe(
				Effect.tapError(error => Effect.sync(() => fail(error))),
			),
		}
	}
	function resumeUndo() {
		if (runningUndo || failed) return
		let selected = editor.commandSelection()
		if (!selected || selected.busy || selected.composing) return
		if (!needsAdoption) {
			let redo = postponedUndo
			if (redo !== undefined) {
				postponedUndo = undefined
				undo(redo)
			}
			return
		}
		let state = queue.state()
		if (state.closed || state.failure !== undefined) {
			fail(
				state.failure ??
					new WorkerDocumentFailure({ reason: "Closed", category: "failure" }),
			)
			return
		}
		adoptionAttempts++
		if (adoptionAttempts > 3) {
			fail(
				new WorkerDocumentFailure({
					reason: "AppliedUnknown",
					category: "conflict",
				}),
			)
			return
		}
		runningUndo = true
		fork(
			queue
				.merge(
					() => editor.commandSelection() ?? selection(),
					(source, selected) => editor.adoptMerged(source, selected),
				)
				.saved.pipe(
					Effect.tap(adopted =>
						Effect.sync(() => {
							if (adopted) {
								needsAdoption = false
								editor.freezeCommands(false)
							}
						}),
					),
					Effect.catch(error => Effect.sync(() => fail(error))),
					Effect.ensuring(
						Effect.sync(() => {
							runningUndo = false
							if (needsAdoption && !failed) resumeUndo()
						}),
					),
					Effect.asVoid,
				),
		)
	}
	function undo(redo: boolean) {
		if (runningUndo || failed) return
		if (needsAdoption) {
			resumeUndo()
			return
		}
		let selected = editor.commandSelection()
		if (!selected || !selected.editable) return
		if (selected.busy || selected.composing) {
			postponedUndo = redo
			return
		}
		runningUndo = true
		editor.freezeCommands(true)
		fork(
			queue.undo(redo).pipe(
				Effect.tap(receipt =>
					Effect.sync(() => {
						if (receipt.status === "not-applied") editor.freezeCommands(false)
						else if (receipt.status === "applied") {
							needsAdoption = true
							adoptionAttempts = 0
						} else
							fail(
								new WorkerDocumentFailure({
									reason: "AppliedUnknown",
									category: receipt.failure ?? "failure",
								}),
							)
					}),
				),
				Effect.catch(error => Effect.sync(() => fail(error))),
				Effect.ensuring(
					Effect.sync(() => {
						runningUndo = false
						if (needsAdoption) resumeUndo()
					}),
				),
				Effect.asVoid,
			),
		)
	}
	return { change, merge, undo, resumeUndo }
}
