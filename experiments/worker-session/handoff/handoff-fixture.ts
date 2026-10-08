import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import type { BrowserAccount } from "../../../src/client/browser-account"
import {
	buildAction,
	restoreSnapshot,
} from "../../../src/shared/document-actions"
import { createWorkerSessionClient } from "./worker-client"
import { makeEditorQueue, type EditorSelection } from "./editor-queue"

export function verifyWorkerHandoff(
	account: Context.Service.Shape<typeof BrowserAccount>,
	document: string,
	source: string,
	check: (value: unknown, message: string) => void,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let worker = yield* createWorkerSessionClient(
				new URL("/worker.js", location.origin).href,
			)
			yield* Effect.addFinalizer(() =>
				worker.Close().pipe(Effect.catch(() => Effect.void)),
			)
			yield* worker.Open({
				document,
				subject: account.subject,
				origin: location.origin,
			})
			let basis = yield* worker.Begin()
			check(basis.source === source, "handoff begins from exact durable source")
			let textarea = documentElement()
			yield* Effect.addFinalizer(() => Effect.sync(() => textarea.remove()))
			textarea.value = source
			textarea.setSelectionRange(source.length, source.length)
			let generation = 0
			let composing = false
			let editor = yield* makeEditorQueue(worker, basis)
			function selection(): EditorSelection {
				return {
					start: textarea.selectionStart,
					end: textarea.selectionEnd,
					direction: textarea.selectionDirection,
					generation,
					composing,
					source: textarea.value,
					busy: false,
				}
			}
			function accept(value: string, mapped: EditorSelection) {
				textarea.value = value
				textarea.setSelectionRange(mapped.start, mapped.end, mapped.direction)
				return true
			}
			function edit(start: number, remove: number, text: string) {
				let request = editor.replace([{ start, remove, text }])
				textarea.value = request.source
				textarea.setSelectionRange(start + text.length, start + text.length)
				generation++
				return request
			}
			let snapshot = yield* account.api.documents.snapshot({
				params: { document },
				query: { encoding: "compact" },
			})
			let peer = yield* restoreSnapshot(
				snapshot,
				account.subject + "-handoff-peer",
			)
			let peerSource = source.replace("A😀", "HANDOFF PEER A😀")
			let action = yield* buildAction(
				peer,
				document,
				"Handoff peer",
				staged => [staged.edit(document, peerSource)],
			)
			yield* account.api.documents.commit({
				params: { document },
				payload: action,
			})
			yield* worker.Sync()
			let offset = source.length
			let requests = [
				edit(offset, 0, "ab"),
				edit(offset, 1, "A"),
				edit(offset + 1, 1, "B"),
				edit(offset + 2, 0, "c"),
				edit(offset, 1, "x"),
				edit(offset + 3, 0, "d"),
				edit(offset + 2, 1, "C"),
				edit(offset + 4, 0, "e"),
			]
			check(
				editor.state().pending.length === 8 &&
					!textarea.value.includes("HANDOFF PEER"),
				"handoff adapter retains eight optimistic edits against unseen peer basis",
			)
			for (let request of requests) yield* request.saved
			let priorEpoch = editor.state().epoch
			let stale = editor.merge(selection, accept)
			yield* stale.requested
			let racing = edit(textarea.value.length, 0, "RACING")
			check(
				!(yield* stale.saved),
				"input during merge RPC rejects stale candidate without painting peer reply",
			)
			yield* racing.saved
			check(
				editor.state().epoch === priorEpoch &&
					editor.state().acknowledged === 9 &&
					textarea.value === editor.state().source &&
					textarea.value.endsWith("xBCdeRACING"),
				"stale candidate release retains old basis and ninth queued edit exactly",
			)
			let selectionRace = editor.merge(selection, accept)
			yield* selectionRace.requested
			textarea.setSelectionRange(0, 0)
			generation++
			check(
				!(yield* selectionRace.saved) && editor.state().epoch === priorEpoch,
				"selection change during merge refuses handoff and preserves active basis",
			)
			let compositionRace = editor.merge(selection, accept)
			yield* compositionRace.requested
			composing = true
			generation++
			check(
				!(yield* compositionRace.saved) && editor.state().epoch === priorEpoch,
				"composition starting during merge refuses candidate without replacing local source",
			)
			composing = false
			generation++
			textarea.setSelectionRange(textarea.value.length, textarea.value.length)
			let acceptedSource = textarea.value.replace("A😀", "HANDOFF PEER A😀")
			let refused = editor.merge(selection, () => false)
			yield* refused.requested
			check(
				!(yield* refused.saved) && editor.state().epoch === priorEpoch,
				"native editor refusal releases candidate before epoch or Adopt mutation",
			)
			let painted = Deferred.makeUnsafe<void>()
			let handoff = editor.merge(selection, (value, mapped) => {
				accept(value, mapped)
				check(
					textarea.selectionStart === value.length &&
						textarea.selectionEnd === value.length,
					"handoff maps native textarea caret using retained atom identities",
				)
				queueMicrotask(() => Deferred.doneUnsafe(painted, Effect.void))
				return true
			})
			yield* handoff.requested
			yield* Deferred.await(painted)
			let following = edit(textarea.value.length, 0, "AFTER ADOPT")
			check(
				yield* handoff.saved,
				"unchanged source and selection adopt peer candidate through FIFO handshake",
			)
			yield* following.saved
			check(
				editor.state().epoch !== priorEpoch &&
					editor.state().sequence === 1 &&
					editor.state().acknowledged === 1 &&
					textarea.value === acceptedSource + "AFTER ADOPT",
				"next input after main acceptance executes after Adopt against new basis",
			)
			yield* worker.Sync()
			let accepted = yield* account.api.documents.snapshot({
				params: { document },
				query: { encoding: "compact" },
			})
			let final = yield* restoreSnapshot(accepted, "handoff-final-reader")
			check(
				final.text(document) === textarea.value &&
					editor.state().pending.length === 0,
				"handoff eight edits, racing input, peer and post-adopt input accept exactly once",
			)
			yield* worker.Close()
		}),
	)
}
function documentElement() {
	let textarea = document.createElement("textarea")
	document.body.append(textarea)
	return textarea
}
