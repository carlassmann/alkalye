import { describe, expect, test, vi } from "vitest"
import { createInMemoryReplayStore } from "./replay-store"

describe("MCP replay store", () => {
	test("tracks replay consumption and expiring connection revocation", async () => {
		vi.useFakeTimers()
		let store = createInMemoryReplayStore()

		expect(await store.consume("code", 1_000)).toBe(true)
		expect(await store.consume("code", 1_000)).toBe(false)

		await store.revoke("connection", 1_000)
		expect(await store.isRevoked("connection")).toBe(true)
		vi.advanceTimersByTime(1_001)
		expect(await store.isRevoked("connection")).toBe(false)
		vi.useRealTimers()
	})
})
