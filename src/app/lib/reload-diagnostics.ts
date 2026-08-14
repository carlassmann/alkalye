export {
	collectStorageDiagnostics,
	clearReloadDiagnostics,
	readReloadDiagnostics,
	recordStartupTrace,
	recordStartupTraceOnce,
	reloadDiagnosticsReport,
	startStartupSpan,
	type ReloadDiagnostic,
	type StartupTraceDetails,
}

type StartupTraceValue = string | number | boolean | null
type StartupTraceDetails = Record<string, StartupTraceValue>

type ReloadDiagnostic = {
	runId: string
	at: string
	elapsedMs: number
	event: string
	details: StartupTraceDetails
}

let storageKey = "alkalye:reload-diagnostics"
let maximumEntries = 200
let jazzDatabaseName = "jazz-storage"

function readReloadDiagnostics(): ReloadDiagnostic[] {
	try {
		let value = window.localStorage.getItem(storageKey)
		if (!value) return []
		let parsed: unknown = JSON.parse(value)
		if (!Array.isArray(parsed)) return []
		return parsed.flatMap(parseDiagnostic)
	} catch {
		return []
	}
}

function recordStartupTrace(
	event: string,
	details: StartupTraceDetails = {},
): void {
	try {
		let entries = readReloadDiagnostics()
		entries.push({
			runId: getRunId(),
			at: new Date().toISOString(),
			elapsedMs: roundMilliseconds(performance.now()),
			event,
			details,
		})
		window.localStorage.setItem(
			storageKey,
			JSON.stringify(entries.slice(-maximumEntries)),
		)
	} catch {
		return
	}
}

function recordStartupTraceOnce(
	event: string,
	details: StartupTraceDetails = {},
): void {
	let runId = getRunId()
	let exists = readReloadDiagnostics().some(
		entry => entry.runId === runId && entry.event === event,
	)
	if (!exists) recordStartupTrace(event, details)
}

async function collectStorageDiagnostics(): Promise<void> {
	await Promise.all([collectStorageEstimate(), collectJazzDatabaseCounts()])
}

function startStartupSpan(event: string, details: StartupTraceDetails = {}) {
	let startedAt = performance.now()
	recordStartupTrace(`${event}:start`, details)

	return function finishStartupSpan(
		finishDetails: StartupTraceDetails = {},
	): void {
		recordStartupTrace(`${event}:complete`, {
			...finishDetails,
			durationMs: roundMilliseconds(performance.now() - startedAt),
		})
	}
}

function clearReloadDiagnostics(): void {
	window.localStorage.removeItem(storageKey)
}

function reloadDiagnosticsReport(): string {
	let entries = readReloadDiagnostics()
	let currentRunId = getRunId()
	let currentRun = entries.filter(entry => entry.runId === currentRunId)
	let report = {
		generatedAt: new Date().toISOString(),
		currentRunId,
		currentTraceElapsedMs: currentRun.at(-1)?.elapsedMs ?? null,
		environment: {
			userAgent: navigator.userAgent,
			online: navigator.onLine,
			standalone:
				window.matchMedia("(display-mode: standalone)").matches ||
				isNavigatorStandalone(),
			viewport: `${window.innerWidth}x${window.innerHeight}`,
		},
		entries,
	}
	return JSON.stringify(report, null, 2)
}

async function collectStorageEstimate(): Promise<void> {
	if (hasCurrentRunEvent("browser-storage-breakdown")) return

	try {
		let estimate = await navigator.storage.estimate()
		let details: StartupTraceDetails = {
			usageMegabytes: bytesToMegabytes(estimate.usage),
			quotaMegabytes: bytesToMegabytes(estimate.quota),
		}
		let rawEstimate: unknown = estimate
		if (isRecord(rawEstimate) && isRecord(rawEstimate.usageDetails)) {
			for (let [key, bytes] of Object.entries(rawEstimate.usageDetails)) {
				if (typeof bytes !== "number") continue
				details[`usage.${key}Megabytes`] = bytesToMegabytes(bytes)
			}
		}
		recordStartupTraceOnce("browser-storage-breakdown", details)
	} catch (error) {
		recordStartupTraceOnce("browser-storage-breakdown:error", {
			error: getErrorName(error),
		})
	}
}

async function collectJazzDatabaseCounts(): Promise<void> {
	if (hasCurrentRunEvent("jazz-indexeddb-counts")) return

	let startedAt = performance.now()
	let database: IDBDatabase | null = null
	try {
		database = await openDatabase(jazzDatabaseName)
		let storeNames = Array.from(database.objectStoreNames)
		let details: StartupTraceDetails = {
			databaseVersion: database.version,
			storeCount: storeNames.length,
		}
		if (storeNames.length > 0) {
			let transaction = database.transaction(storeNames, "readonly")
			let counts = await Promise.all(
				storeNames.map(async storeName => {
					let count = await requestResult(
						transaction.objectStore(storeName).count(),
					)
					return { storeName, count }
				}),
			)
			for (let { storeName, count } of counts) {
				details[`records.${storeName}`] = count
			}
		}
		details.durationMs = roundMilliseconds(performance.now() - startedAt)
		recordStartupTraceOnce("jazz-indexeddb-counts", details)
	} catch (error) {
		recordStartupTraceOnce("jazz-indexeddb-counts:error", {
			durationMs: roundMilliseconds(performance.now() - startedAt),
			error: getErrorName(error),
		})
	} finally {
		database?.close()
	}
}
function parseDiagnostic(value: unknown): ReloadDiagnostic[] {
	if (!isRecord(value)) return []
	if (typeof value.at !== "string" || typeof value.event !== "string") return []
	let details = isRecord(value.details) ? value.details : {}
	let safeDetails: StartupTraceDetails = {}
	for (let [key, detail] of Object.entries(details)) {
		if (isStartupTraceValue(detail)) safeDetails[key] = detail
	}
	return [
		{
			runId: typeof value.runId === "string" ? value.runId : "legacy",
			at: value.at,
			elapsedMs: typeof value.elapsedMs === "number" ? value.elapsedMs : 0,
			event: value.event,
			details: safeDetails,
		},
	]
}

function getRunId(): string {
	return window.__alkalyeStartupTraceId ?? "unknown"
}

function hasCurrentRunEvent(event: string): boolean {
	let runId = getRunId()
	return readReloadDiagnostics().some(
		entry => entry.runId === runId && entry.event === event,
	)
}

function openDatabase(name: string): Promise<IDBDatabase> {
	return requestResult(indexedDB.open(name))
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise(function resolveRequest(resolve, reject) {
		request.addEventListener("success", () => resolve(request.result), {
			once: true,
		})
		request.addEventListener("error", () => reject(request.error), {
			once: true,
		})
	})
}

function bytesToMegabytes(bytes: number | undefined): number {
	if (!bytes) return 0
	return roundMilliseconds(bytes / 1024 / 1024)
}

function getErrorName(error: unknown): string {
	return error instanceof Error ? error.name : "UnknownError"
}

function roundMilliseconds(value: number): number {
	return Math.round(value * 10) / 10
}

function isStartupTraceValue(value: unknown): value is StartupTraceValue {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	)
}

function isNavigatorStandalone(): boolean {
	return "standalone" in navigator && navigator.standalone === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}
