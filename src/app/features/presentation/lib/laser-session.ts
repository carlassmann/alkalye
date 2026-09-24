import type { LaserMessage } from "./laser-schema"

export { createLaserLease, laserLayoutKey, laserTiming }
export type { LaserDisplay, LaserPoint }

type LaserDisplay = Extract<LaserMessage, { type: "display" }>
type LaserPoint = Extract<LaserMessage, { type: "point" }>

let laserTiming = {
	announce: 500,
	disconnect: 5000,
	pointHeartbeat: 100,
	pointThrottle: 50,
	pointExpiry: 1200,
	leaseRotation: 750,
	leaseExpiry: 2000,
}

function laserLayoutKey(
	display: Pick<
		LaserDisplay,
		"slideNumber" | "width" | "height" | "appearance"
	>,
) {
	return `${display.slideNumber}:${display.width}:${display.height}:${display.appearance}`
}

function createLaserLease(now = () => performance.now()) {
	let leases = new Map<string, { layout: string; issuedAt: number }>()
	let current: { token: string; layout: string; issuedAt: number } | undefined
	return {
		issue(layout: string) {
			let time = now()
			for (let [token, lease] of leases) {
				if (time - lease.issuedAt >= laserTiming.leaseExpiry)
					leases.delete(token)
			}
			if (
				!current ||
				current.layout !== layout ||
				time - current.issuedAt >= laserTiming.leaseRotation
			) {
				if (current?.layout !== layout) leases.clear()
				current = { token: crypto.randomUUID(), layout, issuedAt: time }
				leases.set(current.token, current)
			}
			return current.token
		},
		accepts(token: string, layout: string) {
			let lease = leases.get(token)
			return Boolean(
				lease &&
				lease.layout === layout &&
				now() - lease.issuedAt < laserTiming.leaseExpiry,
			)
		},
	}
}
