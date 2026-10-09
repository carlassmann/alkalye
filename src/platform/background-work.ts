import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Duration from "effect/Duration"
import * as Latch from "effect/Latch"
import * as Queue from "effect/Queue"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import type * as Scope from "effect/Scope"

export class BackgroundWork extends Context.Reference<{
	beforeSnapshot: Effect.Effect<void>
	beforeDerived: Effect.Effect<void>
	betweenChunks: Effect.Effect<void>
	snapshotInput?: Effect.Effect<Effect.Effect<void>, never, Scope.Scope>
}>("alkalye/BackgroundWork", {
	defaultValue: () => ({
		beforeSnapshot: Effect.void,
		beforeDerived: Effect.void,
		betweenChunks: Effect.void,
	}),
}) {}

export function makeBackgroundWork() {
	return Effect.gen(function* () {
		let idle = yield* Latch.make(true)
		let activity = yield* Queue.sliding<void>(1)
		let snapshotActivity = yield* PubSub.unbounded<"input" | "closed">()
		let closed = false
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				closed = true
			}).pipe(
				Effect.andThen(Queue.shutdown(activity)),
				Effect.andThen(PubSub.end(snapshotActivity, "closed")),
				Effect.andThen(idle.open),
			),
		)
		yield* Stream.fromQueue(activity).pipe(
			Stream.debounce("100 millis"),
			Stream.runForEach(() => idle.open),
			Effect.forkScoped({ startImmediately: true }),
		)
		return {
			beforeSnapshot: waitForIdle("10 seconds"),
			snapshotInput: Effect.suspend(() =>
				closed
					? Effect.succeed(Effect.never)
					: PubSub.subscribe(snapshotActivity).pipe(
							Effect.map(subscription =>
								PubSub.take(subscription).pipe(
									Effect.flatMap(event =>
										event === "input" ? Effect.void : Effect.never,
									),
								),
							),
						),
			),
			beforeDerived: waitForIdle("500 millis"),
			betweenChunks: waitForIdle("16 millis"),
			interact() {
				if (closed) return
				idle.closeUnsafe()
				Queue.offerUnsafe(activity, undefined)
				PubSub.publishUnsafe(snapshotActivity, "input")
			},
			release() {
				idle.openUnsafe()
			},
		}
		function waitForIdle(duration: Duration.Input) {
			let waiting = idle.await.pipe(
				Effect.timeoutOption(duration),
				Effect.asVoid,
			)
			return Effect.suspend(() => (idle.isOpen() ? Effect.void : waiting))
		}
	})
}
