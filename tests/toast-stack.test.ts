import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { TestClock } from "effect/testing"
import {
	countdown,
	stackLayout,
	swipeAmount,
	swipeAxis,
	swipeOut,
	toastLifetime,
} from "../src/client/toast-stack"

function run<A>(effect: Effect.Effect<A>) {
	return Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())))
}

test("stack offsets skip removed toasts and only the newest three show", () => {
	let placements = stackLayout([
		{ height: 50, removed: false, offsetBeforeRemove: 0 },
		{ height: 70, removed: true, offsetBeforeRemove: 64 },
		{ height: 60, removed: false, offsetBeforeRemove: 0 },
		{ height: 40, removed: false, offsetBeforeRemove: 0 },
	])
	expect(placements.map(place => place.offset)).toEqual([0, 64, 64, 138])
	expect(placements.map(place => place.visible)).toEqual([
		true,
		true,
		true,
		false,
	])
	expect(placements.map(place => place.zIndex)).toEqual([4, 3, 2, 1])
	expect(placements.map(place => place.front)).toEqual([
		true,
		false,
		false,
		false,
	])
})

test("swipes dismiss past the threshold or by velocity, and resist the wrong way", () => {
	expect(swipeAxis(1, 0)).toBeUndefined()
	expect(swipeAxis(10, 3)).toBe("x")
	expect(swipeAxis(2, 9)).toBe("y")
	expect(swipeAmount(30)).toBe(30)
	expect(Math.abs(swipeAmount(-40))).toBeLessThan(40)
	expect(swipeOut("x", 45, 1000)).toBe("right")
	expect(swipeOut("y", 50, 1000)).toBe("down")
	expect(swipeOut("x", 30, 1000)).toBeUndefined()
	expect(swipeOut("x", 30, 100)).toBe("right")
	expect(swipeOut("y", -12, 50)).toBe("up")
})

test("a countdown ends after its lifetime when nothing pauses it", async () => {
	await run(
		Effect.gen(function* () {
			let paused = yield* SubscriptionRef.make(false)
			let timer = yield* Effect.forkChild(countdown(paused, toastLifetime))
			yield* TestClock.adjust(toastLifetime - 1)
			expect(timer.pollUnsafe()).toBeUndefined()
			yield* TestClock.adjust(1)
			yield* Fiber.join(timer)
		}),
	)
})

test("pausing banks remaining time and repeated pauses never shorten a countdown", async () => {
	await run(
		Effect.gen(function* () {
			let paused = yield* SubscriptionRef.make(false)
			let timer = yield* Effect.forkChild(countdown(paused, 4000))
			yield* TestClock.adjust(1000)
			for (let pause = 0; pause < 3; pause++) {
				yield* SubscriptionRef.set(paused, true)
				yield* TestClock.adjust(10000)
				expect(timer.pollUnsafe()).toBeUndefined()
				yield* SubscriptionRef.set(paused, false)
				yield* TestClock.adjust(500)
			}
			yield* TestClock.adjust(1499)
			expect(timer.pollUnsafe()).toBeUndefined()
			yield* TestClock.adjust(1)
			yield* Fiber.join(timer)
		}),
	)
})

test("a countdown that starts while paused waits for resumption", async () => {
	await run(
		Effect.gen(function* () {
			let paused = yield* SubscriptionRef.make(true)
			let timer = yield* Effect.forkChild(countdown(paused, 4000))
			yield* TestClock.adjust(60000)
			expect(timer.pollUnsafe()).toBeUndefined()
			yield* SubscriptionRef.set(paused, false)
			yield* TestClock.adjust(4000)
			yield* Fiber.join(timer)
		}),
	)
})

test("interrupting a countdown releases its timer", async () => {
	await run(
		Effect.gen(function* () {
			let paused = yield* SubscriptionRef.make(false)
			let timer = yield* Effect.forkChild(countdown(paused, 4000))
			yield* TestClock.adjust(10)
			yield* Fiber.interrupt(timer)
			let exit = timer.pollUnsafe()
			expect(exit?._tag).toBe("Failure")
		}),
	)
})
