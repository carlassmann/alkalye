import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	createInteractionWork,
	interactionWork,
	trackInteractions,
} from "./interaction-work"

describe("interaction work", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => {
		interactionWork.release()
		vi.useRealTimers()
	})

	test("opens after 100 ms of quiet and cancels an abandoned wait", async () => {
		let work = createInteractionWork()
		let ready = vi.fn()
		work.interact()
		void work.waitForIdle().then(ready)
		await vi.advanceTimersByTimeAsync(80)
		work.interact()
		await vi.advanceTimersByTimeAsync(99)
		expect(ready).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(ready).toHaveBeenCalledOnce()
		work.interact()
		let abort = new AbortController()
		let waiting = work.waitForIdle(10_000, abort.signal)
		abort.abort()
		await waiting
		work.release()
		expect(vi.getTimerCount()).toBe(0)
	})

	test.each([500, 10_000])(
		"cannot starve a %i ms wait during continuous input",
		async maximumWait => {
			let work = createInteractionWork()
			let ready = vi.fn()
			work.interact()
			void work.waitForIdle(maximumWait).then(ready)
			for (let elapsed = 0; elapsed < maximumWait - 50; elapsed += 50) {
				await vi.advanceTimersByTimeAsync(50)
				work.interact()
			}
			expect(ready).not.toHaveBeenCalled()
			await vi.advanceTimersByTimeAsync(50)
			expect(ready).toHaveBeenCalledOnce()
			work.release()
		},
	)

	test("coalesces to newest work without resetting its starvation cap", async () => {
		let work = createInteractionWork()
		let old = vi.fn(),
			newest = vi.fn(),
			cancelled = vi.fn()
		work.interact()
		work.schedule("derived", old)
		work.schedule("cancel", cancelled)
		work.cancel("cancel")
		for (let i = 0; i < 10; i++) {
			await vi.advanceTimersByTimeAsync(50)
			work.interact()
			work.schedule("derived", newest)
		}
		await vi.advanceTimersByTimeAsync(1)
		expect(old).not.toHaveBeenCalled()
		expect(cancelled).not.toHaveBeenCalled()
		expect(newest).toHaveBeenCalledOnce()
		work.release()
	})

	test("tracks input once across editor lifetimes, releases pagehide and removes listeners", async () => {
		let first = trackInteractions(),
			second = trackInteractions()
		document.dispatchEvent(new KeyboardEvent("keydown"))
		let ready = vi.fn()
		void interactionWork.waitForIdle().then(ready)
		first()
		await Promise.resolve()
		expect(ready).not.toHaveBeenCalled()
		window.dispatchEvent(new Event("pagehide"))
		await Promise.resolve()
		expect(ready).toHaveBeenCalledOnce()
		second()
		document.dispatchEvent(new KeyboardEvent("keydown"))
		await interactionWork.waitForIdle()
		expect(vi.getTimerCount()).toBe(0)
	})
})
