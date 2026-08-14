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
		Reflect.deleteProperty(window, "__alkalyeStartupTraceRecord")
		Reflect.deleteProperty(window, "__alkalyeStartupTraceFlush")
		Reflect.deleteProperty(window, "__alkalyeStartupTraceClear")
		Reflect.deleteProperty(window, "__alkalyeStartupTraceHasCurrentEvent")
		if (originalStorage) {
			Object.defineProperty(navigator, "storage", originalStorage)
		} else {
			Reflect.deleteProperty(navigator, "storage")
		}
	})

	test("uses the shared boot recorder without synchronous storage work", () => {
		let record = vi.fn()
		window.__alkalyeStartupTraceRecord = record

		recordStartupTrace("booted", { documentCount: 12 })

		expect(record).toHaveBeenCalledWith("booted", { documentCount: 12 })
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
				diagnosticsVersion: 2,
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
				persisted: async () => false,
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
		let rows = {
			coValues: [
				{
					rowID: 1,
					id: "co_large",
					header: {
						type: "coplaintext",
						ruleset: { type: "ownedByGroup" },
						meta: null,
					},
				},
				{
					rowID: 2,
					id: "co_small",
					header: {
						type: "comap",
						ruleset: { type: "group" },
						meta: null,
					},
				},
			],
			sessions: [
				{ coValue: 1, lastIdx: 1000 },
				{ coValue: 1, lastIdx: 100 },
				{ coValue: 2, lastIdx: 100 },
			],
			transactions: [],
		}
		let counts = { coValues: 2, sessions: 3, transactions: 1200 }
		let storeNames = Object.assign(Object.keys(counts), {
			contains: (name: string) => name in counts,
		})
		let database = {
			version: 7,
			objectStoreNames: storeNames,
			transaction: () => ({
				objectStoreNames: storeNames,
				objectStore: (name: keyof typeof rows) => ({
					count: () => successfulRequest(counts[name]),
					getAll: () => successfulRequest(rows[name]),
				}),
			}),
			close,
		}
		vi.stubGlobal("indexedDB", {
			open: () => successfulRequest(database),
		})

		await collectStorageDiagnostics([
			{ id: "co_large", label: "personal-document:0:content" },
		])

		let entries = readReloadDiagnostics()
		expect(
			entries.find(entry => entry.event === "browser-storage-breakdown")
				?.details,
		).toEqual({
			usageMegabytes: 100,
			quotaMegabytes: 500,
			persisted: false,
			"usage.indexedDBMegabytes": 80,
			"usage.cachesMegabytes": 20,
		})
		expect(
			entries.find(entry => entry.event === "jazz-indexeddb-counts")?.details,
		).toEqual(
			expect.objectContaining({
				databaseVersion: 7,
				storeCount: 3,
				"records.coValues": 2,
				"records.transactions": 1200,
				durationMs: expect.any(Number),
			}),
		)
		expect(
			entries.find(entry => entry.event === "jazz-indexeddb-distribution")
				?.details,
		).toEqual(
			expect.objectContaining({
				transactionCountFromSessions: 1200,
				top1TransactionPercent: 91.7,
				"transactionsByType.coplaintext": 1100,
			}),
		)
		expect(
			entries.find(entry => entry.event === "jazz-covalue-transaction-rank")
				?.details,
		).toEqual(
			expect.objectContaining({
				rank: 1,
				id: "co_large",
				label: "personal-document:0:content",
				transactionCount: 1100,
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
