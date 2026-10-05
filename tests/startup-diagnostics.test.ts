import { describe, expect, test } from "bun:test"
import { startupEvents, startupReport } from "../src/shared/startup-diagnostics"

describe("startup diagnostics", () => {
	test("timing entries become ordered launch events", () => {
		let events = startupEvents([
			{ name: "/app", entryType: "navigation", startTime: 0, duration: 412.4 },
			{
				name: "first-contentful-paint",
				entryType: "paint",
				startTime: 120.6,
				duration: 0,
			},
			{ name: "library ready", entryType: "mark", startTime: 300, duration: 0 },
			{ name: "/app.js", entryType: "resource", startTime: 10, duration: 5 },
		])
		expect(events).toEqual([
			{ event: "first-contentful-paint", elapsedMs: 121 },
			{ event: "library ready", elapsedMs: 300 },
			{ event: "page loaded", elapsedMs: 412 },
		])
	})

	test("the report carries the environment and every event", () => {
		let report = startupReport([{ event: "page loaded", elapsedMs: 412 }], {
			at: "2026-10-05T09:00:00.000Z",
			userAgent: "Test",
			online: false,
			standalone: true,
			serviceWorker: "activated",
			storage: { usage: 1024 * 1024, quota: 10 * 1024 * 1024 },
		})
		expect(report.split("\n")).toEqual([
			"Alkalye startup diagnostics",
			"Captured: 2026-10-05T09:00:00.000Z",
			"Browser: Test",
			"Online: no",
			"Installed: yes",
			"Service worker: activated",
			"Storage: 1.0 MB of 10.0 MB",
			"",
			"412 ms  page loaded",
		])
	})
})
