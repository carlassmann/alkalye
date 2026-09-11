export { createEphemeralReplayStore }
export type { TokenReplayStore }

interface TokenReplayStore {
	consume(id: string, ttlMs: number): Promise<boolean>
	allow(id: string, limit: number, windowMs: number): Promise<boolean>
}

function createEphemeralReplayStore(): TokenReplayStore {
	let consumed = new Map<string, number>()
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
			for (let [rateId, rate] of rates) {
				if (rate.expiresAt <= now) rates.delete(rateId)
			}
			let rate = rates.get(id)
			if (!rate || rate.expiresAt <= now) {
				rates.set(id, { count: 1, expiresAt: now + windowMs })
				return true
			}
			rate.count++
			return rate.count <= limit
		},
	}
}
