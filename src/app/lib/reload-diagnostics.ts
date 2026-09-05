export {
	collectStorageDiagnostics,
	clearReloadDiagnostics,
	readReloadDiagnostics,
	recordStartupTrace,
	recordStartupTraceOnce,
	reloadDiagnosticsReport,
	startStartupSpan,
	type JazzCoValueLabel,
	type ReloadDiagnostic,
	type StartupTraceDetails,
}

type StartupTraceValue = string | number | boolean | null
type StartupTraceDetails = Record<string, StartupTraceValue>
type JazzCoValueLabel = { id: string; label: string }

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
		window.__alkalyeStartupTraceFlush?.()
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
		if (window.__alkalyeStartupTraceRecord) {
			window.__alkalyeStartupTraceRecord(event, details)
			return
		}
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
	details: StartupTraceDetails | (() => StartupTraceDetails) = {},
): void {
	if (hasCurrentRunEvent(event)) return
	recordStartupTrace(event, typeof details === "function" ? details() : details)
}

async function collectStorageDiagnostics(
	labels: JazzCoValueLabel[] = [],
): Promise<void> {
	await Promise.all([
		collectStorageEstimate(),
		collectJazzDatabaseDiagnostics(labels),
	])
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
	if (window.__alkalyeStartupTraceClear) {
		window.__alkalyeStartupTraceClear()
		return
	}
	window.localStorage.removeItem(storageKey)
}

function reloadDiagnosticsReport(): string {
	let entries = readReloadDiagnostics()
	let currentRunId = getRunId()
	let currentRun = entries.filter(entry => entry.runId === currentRunId)
	let report = {
		diagnosticsVersion: 2,
		generatedAt: new Date().toISOString(),
		currentRunId,
		currentTraceElapsedMs: currentRun.at(-1)?.elapsedMs ?? null,
		environment: {
			userAgent: navigator.userAgent,
			platform: navigatorProperty("platform"),
			hardwareConcurrency: navigator.hardwareConcurrency,
			deviceMemoryGigabytes: navigatorProperty("deviceMemory"),
			connectionEffectiveType: connectionProperty("effectiveType"),
			connectionDownlinkMegabits: connectionProperty("downlink"),
			connectionRoundTripMs: connectionProperty("rtt"),
			online: navigator.onLine,
			visibility: document.visibilityState,
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
		let persistedPromise =
			typeof navigator.storage.persisted === "function"
				? navigator.storage.persisted()
				: Promise.resolve(null)
		let [estimate, persisted] = await Promise.all([
			navigator.storage.estimate(),
			persistedPromise,
		])
		let details: StartupTraceDetails = {
			usageMegabytes: bytesToMegabytes(estimate.usage),
			quotaMegabytes: bytesToMegabytes(estimate.quota),
			persisted,
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

async function collectJazzDatabaseDiagnostics(
	labels: JazzCoValueLabel[],
): Promise<void> {
	if (
		hasCurrentRunEvent("jazz-indexeddb-counts") &&
		hasCurrentRunEvent("jazz-indexeddb-distribution")
	)
		return

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
			let countPromise = Promise.all(
				storeNames.map(async storeName => {
					let count = await requestResult(
						transaction.objectStore(storeName).count(),
					)
					return { storeName, count }
				}),
			)
			let coValueRowsPromise = getAllFromStore(transaction, "coValues")
			let sessionRowsPromise = getAllFromStore(transaction, "sessions")
			let [counts, rawCoValueRows, rawSessionRows] = await Promise.all([
				countPromise,
				coValueRowsPromise,
				sessionRowsPromise,
			])
			for (let { storeName, count } of counts) {
				details[`records.${storeName}`] = count
			}
			recordJazzDatabaseDistribution(
				parseCoValueRows(rawCoValueRows),
				parseSessionRows(rawSessionRows),
				labels,
			)
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

type StoredCoValueDiagnostic = {
	rowId: number
	id: string
	type: string
	ruleset: string
	metaType: string | null
}

type StoredSessionDiagnostic = {
	coValueRowId: number
	transactionCount: number
}

type CoValueDistribution = StoredCoValueDiagnostic & {
	label: string | null
	sessionCount: number
	transactionCount: number
	maximumSessionTransactions: number
}

function recordJazzDatabaseDistribution(
	coValues: StoredCoValueDiagnostic[],
	sessions: StoredSessionDiagnostic[],
	labels: JazzCoValueLabel[],
): void {
	if (hasCurrentRunEvent("jazz-indexeddb-distribution")) return

	let labelsById = new Map(labels.map(label => [label.id, label.label]))
	let distributionByRow = new Map<number, CoValueDistribution>()
	for (let coValue of coValues) {
		distributionByRow.set(coValue.rowId, {
			...coValue,
			label: labelsById.get(coValue.id) ?? null,
			sessionCount: 0,
			transactionCount: 0,
			maximumSessionTransactions: 0,
		})
	}
	for (let session of sessions) {
		let coValue = distributionByRow.get(session.coValueRowId)
		if (!coValue) continue
		coValue.sessionCount += 1
		coValue.transactionCount += session.transactionCount
		coValue.maximumSessionTransactions = Math.max(
			coValue.maximumSessionTransactions,
			session.transactionCount,
		)
	}

	let distribution = Array.from(distributionByRow.values()).sort(
		(left, right) => right.transactionCount - left.transactionCount,
	)
	let totalTransactions = distribution.reduce(
		(total, coValue) => total + coValue.transactionCount,
		0,
	)
	let summary: StartupTraceDetails = {
		coValueCount: coValues.length,
		sessionCount: sessions.length,
		transactionCountFromSessions: totalTransactions,
		medianTransactionsPerCoValue: percentile(distribution, 0.5),
		p95TransactionsPerCoValue: percentile(distribution, 0.95),
		p99TransactionsPerCoValue: percentile(distribution, 0.99),
		top1TransactionPercent: transactionPercent(
			distribution.slice(0, 1),
			totalTransactions,
		),
		top10TransactionPercent: transactionPercent(
			distribution.slice(0, 10),
			totalTransactions,
		),
	}
	for (let coValue of distribution) {
		let key = `transactionsByType.${coValue.type}`
		summary[key] = Number(summary[key] ?? 0) + coValue.transactionCount
	}
	recordStartupTraceOnce("jazz-indexeddb-distribution", summary)

	for (let [index, coValue] of distribution.slice(0, 20).entries()) {
		recordStartupTrace(`jazz-covalue-transaction-rank`, {
			rank: index + 1,
			id: coValue.id,
			label: coValue.label,
			type: coValue.type,
			ruleset: coValue.ruleset,
			metaType: coValue.metaType,
			transactionCount: coValue.transactionCount,
			transactionPercent: transactionPercent([coValue], totalTransactions),
			sessionCount: coValue.sessionCount,
			maximumSessionTransactions: coValue.maximumSessionTransactions,
		})
	}
}

function parseCoValueRows(value: unknown): StoredCoValueDiagnostic[] {
	if (!Array.isArray(value)) return []
	return value.flatMap(row => {
		if (!isRecord(row) || !isRecord(row.header)) return []
		if (typeof row.rowID !== "number" || typeof row.id !== "string") return []
		let ruleset = isRecord(row.header.ruleset)
			? stringValue(row.header.ruleset.type)
			: "unknown"
		let metaType = isRecord(row.header.meta)
			? nullableStringValue(row.header.meta.type)
			: null
		return [
			{
				rowId: row.rowID,
				id: row.id,
				type: stringValue(row.header.type),
				ruleset,
				metaType,
			},
		]
	})
}

function parseSessionRows(value: unknown): StoredSessionDiagnostic[] {
	if (!Array.isArray(value)) return []
	return value.flatMap(row => {
		if (!isRecord(row)) return []
		if (typeof row.coValue !== "number" || typeof row.lastIdx !== "number")
			return []
		return [
			{
				coValueRowId: row.coValue,
				transactionCount: row.lastIdx,
			},
		]
	})
}

async function getAllFromStore(
	transaction: IDBTransaction,
	storeName: string,
): Promise<unknown> {
	if (!transaction.objectStoreNames.contains(storeName)) return []
	return requestResult(transaction.objectStore(storeName).getAll())
}

function percentile(
	distribution: CoValueDistribution[],
	value: number,
): number {
	if (distribution.length === 0) return 0
	let counts = distribution
		.map(coValue => coValue.transactionCount)
		.sort((left, right) => left - right)
	let index = Math.min(counts.length - 1, Math.floor(counts.length * value))
	return counts[index] ?? 0
}

function transactionPercent(
	coValues: CoValueDistribution[],
	totalTransactions: number,
): number {
	if (totalTransactions === 0) return 0
	let transactions = coValues.reduce(
		(total, coValue) => total + coValue.transactionCount,
		0,
	)
	return roundMilliseconds((transactions / totalTransactions) * 100)
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "unknown"
}

function nullableStringValue(value: unknown): string | null {
	return typeof value === "string" ? value : null
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
	if (window.__alkalyeStartupTraceHasCurrentEvent)
		return window.__alkalyeStartupTraceHasCurrentEvent(event)
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

function navigatorProperty(key: string): StartupTraceValue {
	let browserNavigator: unknown = navigator
	if (!isRecord(browserNavigator)) return null
	let value = browserNavigator[key]
	return isStartupTraceValue(value) ? value : null
}

function connectionProperty(key: string): StartupTraceValue {
	let browserNavigator: unknown = navigator
	if (!isRecord(browserNavigator) || !isRecord(browserNavigator.connection))
		return null
	let value = browserNavigator.connection[key]
	return isStartupTraceValue(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}
