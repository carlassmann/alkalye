import * as Effect from "effect/Effect"
import * as FiberHandle from "effect/FiberHandle"
export interface SaveState {
	unsaved: boolean
	pending: boolean
	saveFailed: boolean
	syncFailed: boolean
	file?: { status: string }
}
export interface SaveIndicator {
	text: string
	state: "quiet" | "busy" | "notice" | "error"
}
export function saveIndicator(value: SaveState): SaveIndicator {
	if (value.saveFailed)
		return { text: "Could not save on this device", state: "error" }
	if (value.unsaved) return { text: "Saving…", state: "busy" }
	if (value.file) {
		switch (value.file.status) {
			case "saved":
				return { text: "Saved to disk", state: "quiet" }
			case "saving":
				return { text: "Saving to disk…", state: "busy" }
			case "conflict":
				return { text: "Changed on disk — choose a version", state: "error" }
			case "reconnect":
				return { text: "Allow folder access to save", state: "error" }
			default:
				return { text: "Could not save to disk", state: "error" }
		}
	}
	if (value.syncFailed)
		return {
			text: "Saved on this device; sync needs attention",
			state: "error",
		}
	if (value.pending) return { text: "Saved on this device", state: "notice" }
	return { text: "Saved", state: "quiet" }
}

export function makeSaveFeedback(render: (value: SaveIndicator) => void) {
	return Effect.gen(function* () {
		let pending = yield* FiberHandle.make<void>()
		let document = ""
		let requested: SaveIndicator | undefined
		return {
			update(key: string, value: SaveIndicator) {
				return Effect.suspend(() => {
					if (document !== key) {
						document = key
						requested = undefined
						render({ text: "Saved", state: "quiet" })
					}
					if (requested?.text === value.text && requested.state === value.state)
						return Effect.void
					requested = value
					let display = Effect.sync(() => render(value))
					return FiberHandle.run(
						pending,
						value.state === "error"
							? display
							: Effect.sleep(value.state === "quiet" ? 1000 : 800).pipe(
									Effect.andThen(display),
								),
					).pipe(Effect.asVoid)
				})
			},
		}
	})
}
