import * as Duration from "effect/Duration"

export function transferBudget(byteLength = 0) {
	// Allow 128 kbit/s uploads while bounding stalled requests.
	return Duration.millis(5_000 + Math.ceil(byteLength / 16_384) * 1_000)
}
