import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { DocumentLifecycle } from "../platform/document-lifecycle"

export let browserDocumentLifecycle = Layer.suspend(() =>
	Layer.succeed(DocumentLifecycle, {
		changes: Stream.never,
		hidden: Stream.fromEventListener(window, "pagehide").pipe(
			Stream.merge(
				Stream.fromEventListener(document, "visibilitychange").pipe(
					Stream.filter(() => document.visibilityState !== "visible"),
				),
			),
		),
		protect: protectDocumentDrafts,
	}),
)

export function protectDocumentDrafts(hasUnsaved: () => boolean) {
	let attached = false
	return Effect.acquireRelease(
		Effect.sync(() => ({ update })),
		() =>
			Effect.sync(() => {
				if (!hasUnsaved())
					window.removeEventListener("beforeunload", preventUnload)
			}),
	)
	function update() {
		let dirty = hasUnsaved()
		if (dirty === attached) return
		if (dirty) window.addEventListener("beforeunload", preventUnload)
		else window.removeEventListener("beforeunload", preventUnload)
		attached = dirty
	}
	function preventUnload(event: BeforeUnloadEvent) {
		if (!hasUnsaved()) return
		event.preventDefault()
		event.returnValue = ""
	}
}
