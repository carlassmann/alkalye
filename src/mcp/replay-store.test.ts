import { beforeEach, describe, expect, test, vi } from "vitest"
let redisMocks = vi.hoisted(() => ({
	incr: vi.fn(),
	pttl: vi.fn(),
	pexpire: vi.fn(),
}))

vi.mock("@upstash/redis", () => ({
	Redis: class {
		incr = redisMocks.incr
		pttl = redisMocks.pttl
		pexpire = redisMocks.pexpire
	},
}))

import {
	createInMemoryReplayStore,
	createRedisReplayStore,
} from "./replay-store"

describe("MCP replay store", () => {
	beforeEach(() => vi.clearAllMocks())

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

	test("allows a small provisioning burst and resets the window", async () => {
		vi.useFakeTimers()
		let store = createInMemoryReplayStore()

		for (let request = 0; request < 5; request++) {
			expect(await store.allow("address", 5, 60_000)).toBe(true)
		}
		expect(await store.allow("address", 5, 60_000)).toBe(false)
		vi.advanceTimersByTime(60_001)
		expect(await store.allow("address", 5, 60_000)).toBe(true)
		vi.useRealTimers()
	})

	test("repairs a missing Redis rate-limit expiry on the next request", async () => {
		redisMocks.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2)
		redisMocks.pttl.mockResolvedValueOnce(-1)
		redisMocks.pexpire
			.mockRejectedValueOnce(new Error("Redis interruption"))
			.mockResolvedValueOnce(1)
		let store = createRedisReplayStore({
			url: "https://redis.test",
			token: "test",
		})

		await expect(store.allow("address", 5, 60_000)).rejects.toThrow(
			"Redis interruption",
		)
		expect(await store.allow("address", 5, 60_000)).toBe(true)
		expect(redisMocks.pexpire).toHaveBeenCalledTimes(2)
	})

	test("does not extend an active Redis rate-limit window", async () => {
		redisMocks.incr.mockResolvedValueOnce(2)
		redisMocks.pttl.mockResolvedValueOnce(30_000)
		let store = createRedisReplayStore({
			url: "https://redis.test",
			token: "test",
		})

		expect(await store.allow("address", 5, 60_000)).toBe(true)
		expect(redisMocks.pexpire).not.toHaveBeenCalled()
	})
})
