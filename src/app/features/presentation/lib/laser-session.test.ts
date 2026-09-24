import { describe, expect, test, vi } from "vitest"
import { createLaserLease, laserLayoutKey, laserTiming } from "./laser-session"

describe("laser display leases", () => {
	test("expires delayed points using the display's monotonic clock", () => {
		let now = 0
		let leases = createLaserLease(() => now)
		let token = leases.issue("slide-one")
		let date = vi.spyOn(Date, "now").mockReturnValue(100_000_000)
		expect(leases.accepts(token, "slide-one")).toBe(true)
		now = laserTiming.leaseExpiry
		expect(leases.accepts(token, "slide-one")).toBe(false)
		date.mockRestore()
	})

	test("allows brief overlap during renewal but rejects unknown tokens", () => {
		let now = 0
		let leases = createLaserLease(() => now)
		let first = leases.issue("slide-one")
		now = laserTiming.leaseRotation
		let second = leases.issue("slide-one")
		expect(second).not.toBe(first)
		expect(leases.accepts(first, "slide-one")).toBe(true)
		expect(leases.accepts(second, "slide-one")).toBe(true)
		expect(leases.accepts("other-display", "slide-one")).toBe(false)
	})

	test("invalidates old points even when returning to the previous layout", () => {
		let leases = createLaserLease()
		let first = leases.issue("slide-one")
		leases.issue("slide-two")
		leases.issue("slide-one")
		expect(leases.accepts(first, "slide-one")).toBe(false)
	})

	test("treats slide, dimensions, and appearance as part of the layout", () => {
		let display = {
			slideNumber: 1,
			width: 1920,
			height: 1080,
			appearance: "dark",
		} satisfies Parameters<typeof laserLayoutKey>[0]
		let key = laserLayoutKey(display)
		for (let changed of [
			{ ...display, slideNumber: 2 },
			{ ...display, width: 1280 },
			{ ...display, height: 720 },
			{ ...display, appearance: "light" } satisfies Parameters<
				typeof laserLayoutKey
			>[0],
		]) {
			expect(laserLayoutKey(changed)).not.toBe(key)
		}
	})
})
