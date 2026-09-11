import { Redis } from "@upstash/redis"

export { createInMemoryReplayStore, createRedisReplayStore }
export type { TokenReplayStore }

interface TokenReplayStore {
	consume(id: string, ttlMs: number): Promise<boolean>
	allow(id: string, limit: number, windowMs: number): Promise<boolean>
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
		async allow(id, limit, windowMs) {
			let key = `alkalye:mcp:rate:${id}`
			let count = await redis.incr(key)
			if (count === 1) await redis.pexpire(key, windowMs)
			return count <= limit
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
	let rates = new Map<string, { count: number; expiresAt: number }>()
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
		async allow(id, limit, windowMs) {
			let now = Date.now()
			let rate = rates.get(id)
			if (!rate || rate.expiresAt <= now) {
				rates.set(id, { count: 1, expiresAt: now + windowMs })
				return true
			}
			rate.count++
			return rate.count <= limit
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
