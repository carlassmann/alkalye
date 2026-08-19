import { describe, expect, it } from "vitest"
import { countActiveWhiteboardSessions } from "./whiteboard-presence"

describe("countActiveWhiteboardSessions", () => {
	it("counts every other active session", () => {
		let now = Date.now()
		expect(
			countActiveWhiteboardSessions(
				{
					current: { value: { open: true }, madeAt: new Date(now) },
					otherDevice: { value: { open: true }, madeAt: new Date(now) },
					otherPerson: { value: { open: true }, madeAt: new Date(now) },
				},
				"current",
				now,
			),
		).toBe(2)
	})

	it("ignores closed and expired sessions", () => {
		let now = Date.now()
		expect(
			countActiveWhiteboardSessions(
				{
					closed: { value: { open: false }, madeAt: new Date(now) },
					expired: {
						value: { open: true },
						madeAt: new Date(now - 15_001),
					},
				},
				null,
				now,
			),
		).toBe(0)
	})
})
