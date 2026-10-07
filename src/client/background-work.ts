import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { BackgroundWork, makeBackgroundWork } from "../platform/background-work"

export let browserBackgroundWorkLayer = Layer.effect(
	BackgroundWork,
	Effect.gen(function* () {
		let work = yield* makeBackgroundWork()
		yield* Effect.acquireRelease(
			Effect.sync(() => {
				let listeners = new AbortController()
				let options = { capture: true, passive: true, signal: listeners.signal }
				for (let type of [
					"keydown",
					"beforeinput",
					"input",
					"pointerdown",
					"wheel",
					"scroll",
					"touchmove",
					"compositionstart",
					"compositionupdate",
				])
					document.addEventListener(type, interact, options)
				document.addEventListener(
					"pointermove",
					event => {
						if (event.buttons) interact()
					},
					options,
				)
				document.addEventListener(
					"visibilitychange",
					() => {
						if (document.visibilityState !== "visible") work.release()
					},
					options,
				)
				window.addEventListener("pagehide", () => work.release(), options)
				return listeners
			}),
			listeners => Effect.sync(() => listeners.abort()),
		)
		return work
		function interact() {
			if (document.visibilityState === "visible") work.interact()
		}
	}),
)
