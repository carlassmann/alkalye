import { beforeEach, describe, expect, test } from "vitest"
import {
	clearReloadDiagnostics,
	readReloadDiagnostics,
	recordStartupTrace,
	recordStartupTraceOnce,
	reloadDiagnosticsReport,
	startStartupSpan,
} from "./reload-diagnostics"

describe("startup diagnostics", () => {
	beforeEach(() => {
		clearReloadDiagnostics()
		window.__alkalyeStartupTraceId = "test-run"
	})

	test("records bounded, session-scoped timing entries", () => {
		recordStartupTrace("booted", { documentCount: 12 })

		expect(readReloadDiagnostics()).toEqual([
			expect.objectContaining({
				runId: "test-run",
				event: "booted",
				details: { documentCount: 12 },
				elapsedMs: expect.any(Number),
			}),
		])
	})

	test("records once per run", () => {
		recordStartupTraceOnce("editor-ready")
		recordStartupTraceOnce("editor-ready")

		expect(readReloadDiagnostics()).toHaveLength(1)
	})

	test("records span duration", () => {
		let finish = startStartupSpan("document-load")
		finish({ documentCount: 3 })

		let entries = readReloadDiagnostics()
		expect(entries.map(entry => entry.event)).toEqual([
			"document-load:start",
			"document-load:complete",
		])
		expect(entries[1]?.details.durationMs).toEqual(expect.any(Number))
	})

	test("includes environment and entries in copyable report", () => {
		recordStartupTrace("router-mounted")

		let report: unknown = JSON.parse(reloadDiagnosticsReport())
		expect(report).toEqual(
			expect.objectContaining({
				currentRunId: "test-run",
				environment: expect.objectContaining({
					userAgent: expect.any(String),
				}),
				entries: expect.arrayContaining([
					expect.objectContaining({ event: "router-mounted" }),
				]),
			}),
		)
	})
})
