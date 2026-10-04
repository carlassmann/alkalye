import * as Effect from "effect/Effect"
import { promise, run } from "../platform/effects"

export function cancelOnSignal<A, E, R>(
	work: Effect.Effect<A, E, R>,
	signal: AbortSignal,
) {
	return Effect.suspend(() => {
		if (signal.aborted) return Effect.interrupt
		return Effect.raceFirst(
			work,
			Effect.callback<never>(resume => {
				function cancel() {
					resume(Effect.interrupt)
				}
				signal.addEventListener("abort", cancel, { once: true })
				if (signal.aborted) cancel()
				return Effect.sync(() => signal.removeEventListener("abort", cancel))
			}),
		)
	})
}
export function untilCancelled<A>(
	work: Promise<A>,
	signal: AbortSignal,
): Promise<A> {
	return run(
		promise("cancellation", () => work),
		signal,
	)
}
