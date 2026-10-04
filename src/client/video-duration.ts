import * as Effect from "effect/Effect"
import { MediaError } from "../platform/errors"
import { cancelOnSignal } from "./cancellation"

export function readVideoDuration(
	video: HTMLVideoElement,
	signal?: AbortSignal,
) {
	let work = Effect.gen(function* () {
		if (Number.isFinite(video.duration)) return
		let position = video.currentTime
		yield* seek(video, Number.MAX_SAFE_INTEGER)
		yield* seek(video, position)
	})
	return signal ? cancelOnSignal(work, signal) : work
}
function seek(video: HTMLVideoElement, time: number) {
	return Effect.callback<void, MediaError>(resume => {
		if (Math.abs(video.currentTime - time) < 0.001) {
			resume(Effect.void)
			return
		}
		let events = new AbortController()
		video.addEventListener("seeked", () => resume(Effect.void), {
			signal: events.signal,
			once: true,
		})
		video.addEventListener(
			"error",
			() =>
				resume(
					Effect.fail(new MediaError({ message: "Cannot read this video" })),
				),
			{ signal: events.signal, once: true },
		)
		video.currentTime = time
		return Effect.sync(() => events.abort())
	})
}
