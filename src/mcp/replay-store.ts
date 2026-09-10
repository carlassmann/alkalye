import { Redis } from "@upstash/redis"

export { createInMemoryReplayStore, createRedisReplayStore }
export type { TokenReplayStore }

interface TokenReplayStore {
	consume(id: string, ttlMs: number): Promise<boolean>
	revoke(id: string, ttlMs: number): Promise<void>
	isRevoked(id: string): Promise<boolean>
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
		async revoke(id, ttlMs) {
			await redis.set(`alkalye:mcp:revoked:${id}`, "1", { px: ttlMs })
		},
		async isRevoked(id) {
			return (await redis.exists(`alkalye:mcp:revoked:${id}`)) === 1
		},
	}
}

function createInMemoryReplayStore(): TokenReplayStore {
	let consumed = new Map<string, number>()
	let revoked = new Map<string, number>()
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
		async revoke(id, ttlMs) {
			revoked.set(id, Date.now() + ttlMs)
		},
		async isRevoked(id) {
			let expiresAt = revoked.get(id)
			if (!expiresAt) return false
			if (expiresAt > Date.now()) return true
			revoked.delete(id)
			return false
		},
	}
}
