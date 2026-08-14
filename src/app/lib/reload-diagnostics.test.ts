import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	collectStorageDiagnostics,
	clearReloadDiagnostics,
	readReloadDiagnostics,
	recordStartupTrace,
	recordStartupTraceOnce,
	reloadDiagnosticsReport,
	startStartupSpan,
} from "./reload-diagnostics"

let originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage")

describe("startup diagnostics", () => {
	beforeEach(() => {
		clearReloadDiagnostics()
		window.__alkalyeStartupTraceId = "test-run"
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		if (originalStorage) {
			Object.defineProperty(navigator, "storage", originalStorage)
		} else {
			Reflect.deleteProperty(navigator, "storage")
		}
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

	test("collects storage breakdown and Jazz record counts on demand", async () => {
		Object.defineProperty(navigator, "storage", {
			configurable: true,
			value: {
				estimate: async () => ({
					usage: 100 * 1024 * 1024,
					quota: 500 * 1024 * 1024,
					usageDetails: {
						indexedDB: 80 * 1024 * 1024,
						caches: 20 * 1024 * 1024,
					},
				}),
			},
		})

		let close = vi.fn()
		let counts = { coValues: 54, transactions: 1200 }
		let database = {
			version: 7,
			objectStoreNames: Object.keys(counts),
			transaction: () => ({
				objectStore: (name: keyof typeof counts) => ({
					count: () => successfulRequest(counts[name]),
				}),
			}),
			close,
		}
		vi.stubGlobal("indexedDB", {
			open: () => successfulRequest(database),
		})

		await collectStorageDiagnostics()

		let entries = readReloadDiagnostics()
		expect(
			entries.find(entry => entry.event === "browser-storage-breakdown")
				?.details,
		).toEqual({
			usageMegabytes: 100,
			quotaMegabytes: 500,
			"usage.indexedDBMegabytes": 80,
			"usage.cachesMegabytes": 20,
		})
		expect(
			entries.find(entry => entry.event === "jazz-indexeddb-counts")?.details,
		).toEqual(
			expect.objectContaining({
				databaseVersion: 7,
				storeCount: 2,
				"records.coValues": 54,
				"records.transactions": 1200,
				durationMs: expect.any(Number),
			}),
		)
		expect(close).toHaveBeenCalledOnce()
	})
})

function successfulRequest<T>(result: T) {
	return {
		result,
		error: null,
		addEventListener(event: string, listener: () => void) {
			if (event === "success") queueMicrotask(listener)
		},
	}
}
