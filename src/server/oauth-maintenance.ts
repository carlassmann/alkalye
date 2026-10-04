import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"

export function startOAuthMaintenance<E>(cleanup: Effect.Effect<void, E>) {
	return Effect.gen(function* () {
		let sweep = cleanup.pipe(
			Effect.catchCause(cause =>
				Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.logError(cause),
			),
		)
		yield* sweep
		return yield* sweep.pipe(
			Effect.schedule(Schedule.spaced("1 hour")),
			Effect.forkScoped,
		)
	})
}
