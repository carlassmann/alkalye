import { Redis } from "@upstash/redis"

export { createInMemoryReplayStore, createRedisReplayStore }
export type { TokenReplayStore }

interface TokenReplayStore {
	consume(id: string, ttlMs: number): Promise<boolean>
}

function createRedisReplayStore(args: {
	url: string
	token: string
}): TokenReplayStore {
	let redis = new Redis(args)
	return {
		async consume(id, ttlMs) {
			let result = await redis.set(`alkalye:mcp:used:${id}`, "1", {
				nx: true,
				px: ttlMs,
			})
			return result === "OK"
		},
	}
}

function createInMemoryReplayStore(): TokenReplayStore {
	let consumed = new Map<string, number>()
	return {
		async consume(id, ttlMs) {
			let now = Date.now()
			for (let [consumedId, expiresAt] of consumed) {
				if (expiresAt <= now) consumed.delete(consumedId)
			}
			if (consumed.has(id)) return false
			consumed.set(id, now + ttlMs)
			return true
		},
	}
}
