import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Latch from "effect/Latch"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"

export class BackgroundWork extends Context.Reference<{
	beforeSnapshot: Effect.Effect<void>
	beforeDerived: Effect.Effect<void>
	betweenChunks: Effect.Effect<void>
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
		let closed = false
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				closed = true
			}).pipe(
				Effect.andThen(Queue.shutdown(activity)),
				Effect.andThen(idle.open),
			),
		)
		yield* Stream.fromQueue(activity).pipe(
			Stream.debounce("100 millis"),
			Stream.runForEach(() => idle.open),
			Effect.forkScoped({ startImmediately: true }),
		)
		return {
			beforeSnapshot: idle.await.pipe(
				Effect.timeoutOption("10 seconds"),
				Effect.asVoid,
			),
			beforeDerived: idle.await.pipe(
				Effect.timeoutOption("500 millis"),
				Effect.asVoid,
			),
			betweenChunks: idle.await.pipe(
				Effect.timeoutOption("16 millis"),
				Effect.asVoid,
			),
			interact() {
				if (closed) return
				idle.closeUnsafe()
				Queue.offerUnsafe(activity, undefined)
			},
			release() {
				idle.openUnsafe()
			},
		}
	})
}
