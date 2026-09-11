import { describe, expect, test, vi } from "vitest"
import { createEphemeralReplayStore } from "./replay-store"

describe("MCP replay store", () => {
	test("tracks replay consumption for the lifetime of one server instance", async () => {
		vi.useFakeTimers()
		let store = createEphemeralReplayStore()

		expect(await store.consume("code", 1_000)).toBe(true)
		expect(await store.consume("code", 1_000)).toBe(false)
		vi.advanceTimersByTime(1_001)
		expect(await store.consume("code", 1_000)).toBe(true)
		vi.useRealTimers()
	})

	test("allows a small provisioning burst and resets the window", async () => {
		vi.useFakeTimers()
		let store = createEphemeralReplayStore()

		for (let request = 0; request < 5; request++) {
			expect(await store.allow("address", 5, 60_000)).toBe(true)
		}
		expect(await store.allow("address", 5, 60_000)).toBe(false)
		vi.advanceTimersByTime(60_001)
		expect(await store.allow("address", 5, 60_000)).toBe(true)
		vi.useRealTimers()
	})
})
