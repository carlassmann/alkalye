import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"

// Sonner's unconfigured <Toaster /> defaults.
export let toastLifetime = 4000
export let visibleToasts = 3
export let toastGap = 14
export let unmountDelay = 200
export let swipeThreshold = 45
export let swipeVelocity = 0.11

export type StackEntry = {
	height: number
	removed: boolean
	offsetBeforeRemove: number
}
export type StackPlacement = {
	index: number
	front: boolean
	visible: boolean
	zIndex: number
	offset: number
}

// Entries are newest first. Removing toasts keep their slot index while they
// animate out but stop contributing height, so the rest close the gap at once.
export function stackLayout(entries: StackEntry[]): StackPlacement[] {
	let heights = entries
		.filter(entry => !entry.removed)
		.map(entry => entry.height)
	let heightIndex = 0
	let heightBefore = 0
	return entries.map((entry, index) => {
		let offset = entry.removed
			? entry.offsetBeforeRemove
			: heightIndex * toastGap + heightBefore
		if (!entry.removed) {
			heightBefore += heights[heightIndex] ?? 0
			heightIndex++
		}
		return {
			index,
			front: index === 0,
			visible: index < visibleToasts,
			zIndex: entries.length - index,
			offset,
		}
	})
}

export type SwipeAxis = "x" | "y"
export type SwipeDirection = "left" | "right" | "up" | "down"

// A bottom-right toaster lets toasts leave downward or rightward; movement the
// other way follows the pointer with growing resistance.
export function swipeAmount(delta: number) {
	if (delta > 0) return delta
	let dampened = delta / (1.5 + Math.abs(delta) / 20)
	return Math.abs(dampened) < Math.abs(delta) ? dampened : delta
}
export function swipeAxis(dx: number, dy: number): SwipeAxis | undefined {
	if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return
	return Math.abs(dx) > Math.abs(dy) ? "x" : "y"
}
export function swipeOut(
	axis: SwipeAxis,
	amount: number,
	elapsed: number,
): SwipeDirection | undefined {
	let velocity = Math.abs(amount) / Math.max(elapsed, 1)
	if (Math.abs(amount) < swipeThreshold && velocity <= swipeVelocity) return
	if (axis === "x") return amount > 0 ? "right" : "left"
	return amount > 0 ? "down" : "up"
}

// Completes after `duration` of unpaused time. Pausing banks the elapsed time
// so hovering, focusing or hiding the page never shortens a toast's life.
export function countdown(
	paused: SubscriptionRef.SubscriptionRef<boolean>,
	duration: number,
) {
	return Effect.gen(function* () {
		let remaining = duration
		while (remaining > 0) {
			yield* until(paused, false)
			let started = yield* Clock.currentTimeMillis
			let finished = yield* Effect.raceFirst(
				Effect.as(Effect.sleep(remaining), true),
				Effect.as(until(paused, true), false),
			)
			if (finished) return
			remaining -= (yield* Clock.currentTimeMillis) - started
		}
	})
}

function until(ref: SubscriptionRef.SubscriptionRef<boolean>, value: boolean) {
	return SubscriptionRef.changes(ref).pipe(
		Stream.filter(current => current === value),
		Stream.runHead,
		Effect.map(Option.isSome),
	)
}
