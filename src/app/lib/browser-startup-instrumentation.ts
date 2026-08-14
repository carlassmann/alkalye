export {
	finishBrowserStartupInstrumentation,
	startBrowserStartupInstrumentation,
}

type StartupTraceValue = string | number | boolean | null
type StartupTraceDetails = Record<string, StartupTraceValue>
type TraceRecorder = (event: string, details?: StartupTraceDetails) => void
type DatabaseKey = Parameters<IDBObjectStore["get"]>[0]
type TransactionMode = Parameters<IDBDatabase["transaction"]>[1]
type TransactionOptions = Parameters<IDBDatabase["transaction"]>[2]

type RequestMetric = {
	calls: number
	rows: number
	errors: number
	totalDurationMs: number
	maximumDurationMs: number
}

type SlowRequest = {
	operation: string
	durationMs: number
	rows: number
}

type StartupInstrumentation = {
	finish: () => void
}

declare global {
	interface Window {
		__alkalyeStartupInstrumentation?: StartupInstrumentation
	}
}

function startBrowserStartupInstrumentation(record: TraceRecorder): void {
	if (window.__alkalyeStartupInstrumentation) return

	let restorers: (() => void)[] = []
	let requestMetrics = new Map<string, RequestMetric>()
	let slowRequests: SlowRequest[] = []
	let eventLoop = startEventLoopProbe()
	let finished = false

	instrumentIndexedDb(record, requestMetrics, slowRequests, restorers)
	instrumentWebLocks(record, restorers)
	instrumentWebSockets(record, restorers)

	window.__alkalyeStartupInstrumentation = {
		finish() {
			if (finished) return
			finished = true
			for (let restore of restorers.reverse()) restore()
			eventLoop.finish(record)
			recordIndexedDbSummary(record, requestMetrics, slowRequests)
			recordStartupResources(record)
		},
	}
}

function finishBrowserStartupInstrumentation(): void {
	window.__alkalyeStartupInstrumentation?.finish()
}

function instrumentIndexedDb(
	record: TraceRecorder,
	metrics: Map<string, RequestMetric>,
	slowRequests: SlowRequest[],
	restorers: (() => void)[],
): void {
	try {
		instrumentDatabaseOpen(record, restorers)
		instrumentTransactions(metrics, slowRequests, restorers)
		instrumentObjectStores(metrics, slowRequests, restorers)
		instrumentIndexes(metrics, slowRequests, restorers)
	} catch {
		record("jazz-indexeddb-instrumentation-unavailable")
	}
}

function instrumentDatabaseOpen(
	record: TraceRecorder,
	restorers: (() => void)[],
): void {
	let originalOpen = indexedDB.open.bind(indexedDB)
	indexedDB.open = function tracedIndexedDbOpen(
		name: string,
		version?: number,
	) {
		let request =
			version === undefined ? originalOpen(name) : originalOpen(name, version)
		if (name !== "jazz-storage") return request

		let startedAt = performance.now()
		record("jazz-indexeddb-open:start", { version: version ?? null })
		request.addEventListener("upgradeneeded", event => {
			record("jazz-indexeddb-open:upgrade", {
				oldVersion: event.oldVersion,
				newVersion: event.newVersion,
			})
		})
		request.addEventListener("blocked", () =>
			record("jazz-indexeddb-open:blocked"),
		)
		request.addEventListener("success", () => {
			record("jazz-indexeddb-open:complete", {
				durationMs: millisecondsSince(startedAt),
				databaseVersion: request.result.version,
				storeCount: request.result.objectStoreNames.length,
			})
		})
		request.addEventListener("error", () => {
			record("jazz-indexeddb-open:error", {
				durationMs: millisecondsSince(startedAt),
				error: request.error?.name ?? "UnknownError",
			})
		})
		return request
	}
	restorers.push(() => {
		indexedDB.open = originalOpen
	})
}

function instrumentTransactions(
	metrics: Map<string, RequestMetric>,
	slowRequests: SlowRequest[],
	restorers: (() => void)[],
): void {
	let originalTransaction = IDBDatabase.prototype.transaction
	IDBDatabase.prototype.transaction = function tracedTransaction(
		storeNames: string | string[],
		mode?: TransactionMode,
		options?: TransactionOptions,
	) {
		let transaction = createTransaction(
			originalTransaction,
			this,
			storeNames,
			mode,
			options,
		)
		if (this.name !== "jazz-storage") return transaction

		let startedAt = performance.now()
		let operation = `transaction.${mode ?? "readonly"}`
		transaction.addEventListener(
			"complete",
			() => addMetric(metrics, slowRequests, operation, startedAt, 0, false),
			{ once: true },
		)
		transaction.addEventListener(
			"abort",
			() => addMetric(metrics, slowRequests, operation, startedAt, 0, true),
			{ once: true },
		)
		return transaction
	}
	restorers.push(() => {
		IDBDatabase.prototype.transaction = originalTransaction
	})
}

function instrumentObjectStores(
	metrics: Map<string, RequestMetric>,
	slowRequests: SlowRequest[],
	restorers: (() => void)[],
): void {
	let originalGet = IDBObjectStore.prototype.get
	let originalGetAll = IDBObjectStore.prototype.getAll
	let originalCount = IDBObjectStore.prototype.count

	IDBObjectStore.prototype.get = function tracedGet(query: DatabaseKey) {
		return traceRequest(
			this.transaction.db.name,
			`${this.name}.get`,
			originalGet.call(this, query),
			metrics,
			slowRequests,
		)
	}
	IDBObjectStore.prototype.getAll = function tracedGetAll(
		query?: DatabaseKey | null,
		count?: number,
	) {
		return traceRequest(
			this.transaction.db.name,
			`${this.name}.getAll`,
			getAllFromObjectStore(originalGetAll, this, query, count),
			metrics,
			slowRequests,
		)
	}
	IDBObjectStore.prototype.count = function tracedCount(
		query?: DatabaseKey | null,
	) {
		return traceRequest(
			this.transaction.db.name,
			`${this.name}.count`,
			originalCount.call(this, query ?? undefined),
			metrics,
			slowRequests,
		)
	}

	restorers.push(() => {
		IDBObjectStore.prototype.get = originalGet
		IDBObjectStore.prototype.getAll = originalGetAll
		IDBObjectStore.prototype.count = originalCount
	})
}

function instrumentIndexes(
	metrics: Map<string, RequestMetric>,
	slowRequests: SlowRequest[],
	restorers: (() => void)[],
): void {
	let originalGet = IDBIndex.prototype.get
	let originalGetAll = IDBIndex.prototype.getAll
	let originalCount = IDBIndex.prototype.count

	IDBIndex.prototype.get = function tracedGet(query: DatabaseKey) {
		return traceRequest(
			this.objectStore.transaction.db.name,
			`${this.objectStore.name}.${this.name}.get`,
			originalGet.call(this, query),
			metrics,
			slowRequests,
		)
	}
	IDBIndex.prototype.getAll = function tracedGetAll(
		query?: DatabaseKey | null,
		count?: number,
	) {
		return traceRequest(
			this.objectStore.transaction.db.name,
			`${this.objectStore.name}.${this.name}.getAll`,
			getAllFromIndex(originalGetAll, this, query, count),
			metrics,
			slowRequests,
		)
	}
	IDBIndex.prototype.count = function tracedCount(query?: DatabaseKey | null) {
		return traceRequest(
			this.objectStore.transaction.db.name,
			`${this.objectStore.name}.${this.name}.count`,
			originalCount.call(this, query ?? undefined),
			metrics,
			slowRequests,
		)
	}

	restorers.push(() => {
		IDBIndex.prototype.get = originalGet
		IDBIndex.prototype.getAll = originalGetAll
		IDBIndex.prototype.count = originalCount
	})
}

function createTransaction(
	originalTransaction: IDBDatabase["transaction"],
	database: IDBDatabase,
	storeNames: string | string[],
	mode?: TransactionMode,
	options?: TransactionOptions,
): IDBTransaction {
	if (options !== undefined)
		return originalTransaction.call(database, storeNames, mode, options)
	if (mode !== undefined)
		return originalTransaction.call(database, storeNames, mode)
	return originalTransaction.call(database, storeNames)
}

function getAllFromObjectStore(
	originalGetAll: IDBObjectStore["getAll"],
	store: IDBObjectStore,
	query?: DatabaseKey | null,
	count?: number,
) {
	if (count !== undefined) return originalGetAll.call(store, query, count)
	if (query !== undefined) return originalGetAll.call(store, query)
	return originalGetAll.call(store)
}

function getAllFromIndex(
	originalGetAll: IDBIndex["getAll"],
	index: IDBIndex,
	query?: DatabaseKey | null,
	count?: number,
) {
	if (count !== undefined) return originalGetAll.call(index, query, count)
	if (query !== undefined) return originalGetAll.call(index, query)
	return originalGetAll.call(index)
}

function traceRequest<T>(
	databaseName: string,
	operation: string,
	request: IDBRequest<T>,
	metrics: Map<string, RequestMetric>,
	slowRequests: SlowRequest[],
): IDBRequest<T> {
	if (databaseName !== "jazz-storage") return request

	let startedAt = performance.now()
	request.addEventListener(
		"success",
		() => {
			let rows = Array.isArray(request.result) ? request.result.length : 1
			addMetric(metrics, slowRequests, operation, startedAt, rows, false)
		},
		{ once: true },
	)
	request.addEventListener(
		"error",
		() => addMetric(metrics, slowRequests, operation, startedAt, 0, true),
		{ once: true },
	)
	return request
}

function addMetric(
	metrics: Map<string, RequestMetric>,
	slowRequests: SlowRequest[],
	operation: string,
	startedAt: number,
	rows: number,
	failed: boolean,
): void {
	let durationMs = millisecondsSince(startedAt)
	let metric = metrics.get(operation) ?? {
		calls: 0,
		rows: 0,
		errors: 0,
		totalDurationMs: 0,
		maximumDurationMs: 0,
	}
	metric.calls += 1
	metric.rows += rows
	metric.errors += failed ? 1 : 0
	metric.totalDurationMs = roundMilliseconds(
		metric.totalDurationMs + durationMs,
	)
	metric.maximumDurationMs = Math.max(metric.maximumDurationMs, durationMs)
	metrics.set(operation, metric)

	slowRequests.push({ operation, durationMs, rows })
	slowRequests.sort((left, right) => right.durationMs - left.durationMs)
	slowRequests.splice(5)
}

function recordIndexedDbSummary(
	record: TraceRecorder,
	metrics: Map<string, RequestMetric>,
	slowRequests: SlowRequest[],
): void {
	let details: StartupTraceDetails = {}
	for (let [operation, metric] of metrics) {
		details[`${operation}.calls`] = metric.calls
		details[`${operation}.rows`] = metric.rows
		details[`${operation}.errors`] = metric.errors
		details[`${operation}.totalMs`] = metric.totalDurationMs
		details[`${operation}.maxMs`] = metric.maximumDurationMs
	}
	for (let [index, request] of slowRequests.entries()) {
		let rank = index + 1
		details[`slowest.${rank}.operation`] = request.operation
		details[`slowest.${rank}.durationMs`] = request.durationMs
		details[`slowest.${rank}.rows`] = request.rows
	}
	record("jazz-startup-indexeddb-summary", details)
}

function startEventLoopProbe() {
	let intervalMs = 50
	let expectedAt = performance.now() + intervalMs
	let sampleCount = 0
	let delayCount = 0
	let totalDelayMs = 0
	let maximumDelayMs = 0
	let interval = window.setInterval(() => {
		let now = performance.now()
		let delayMs = Math.max(0, now - expectedAt)
		sampleCount += 1
		if (delayMs >= 20) {
			delayCount += 1
			totalDelayMs += delayMs
			maximumDelayMs = Math.max(maximumDelayMs, delayMs)
		}
		expectedAt = now + intervalMs
	}, intervalMs)

	return {
		finish(record: TraceRecorder) {
			clearInterval(interval)
			record("startup-event-loop-summary", {
				sampleCount,
				delayCount,
				totalDelayMs: roundMilliseconds(totalDelayMs),
				maximumDelayMs: roundMilliseconds(maximumDelayMs),
			})
		},
	}
}

function instrumentWebSockets(
	record: TraceRecorder,
	restorers: (() => void)[],
): void {
	try {
		let OriginalWebSocket = window.WebSocket
		class TracedWebSocket extends OriginalWebSocket {
			constructor(url: string | URL, protocols?: string | string[]) {
				super(url, protocols)
				let startedAt = performance.now()
				let firstMessageRecorded = false
				record("jazz-websocket-created", { origin: websocketOrigin(url) })
				this.addEventListener(
					"open",
					() =>
						record("jazz-websocket-open", {
							durationMs: millisecondsSince(startedAt),
						}),
					{ once: true },
				)
				this.addEventListener("message", event => {
					if (firstMessageRecorded) return
					firstMessageRecorded = true
					record("jazz-websocket-first-message", {
						durationMs: millisecondsSince(startedAt),
						bytes: websocketMessageBytes(event.data),
					})
				})
				this.addEventListener(
					"error",
					() =>
						record("jazz-websocket-error", {
							durationMs: millisecondsSince(startedAt),
						}),
					{ once: true },
				)
			}
		}
		window.WebSocket = TracedWebSocket
		restorers.push(() => {
			window.WebSocket = OriginalWebSocket
		})
	} catch {
		record("jazz-websocket-instrumentation-unavailable")
	}
}

function instrumentWebLocks(
	record: TraceRecorder,
	restorers: (() => void)[],
): void {
	try {
		let lockManager = navigator.locks
		if (!lockManager?.request) {
			record("jazz-session-locks-unavailable")
			return
		}
		let originalRequest = lockManager.request
		let tracedRequest = new Proxy(originalRequest, {
			apply(target, thisArgument, argumentsList) {
				let name = argumentsList[0]
				let category = typeof name === "string" ? jazzLockCategory(name) : null
				let callbackIndex = typeof argumentsList[1] === "function" ? 1 : 2
				let callback = argumentsList[callbackIndex]
				if (category && typeof callback === "function") {
					let startedAt = performance.now()
					argumentsList[callbackIndex] = (...callbackArguments: unknown[]) => {
						record("jazz-session-lock-result", {
							category,
							acquired: Boolean(callbackArguments[0]),
							durationMs: millisecondsSince(startedAt),
						})
						return Reflect.apply(callback, undefined, callbackArguments)
					}
				}
				return Reflect.apply(target, thisArgument, argumentsList)
			},
		})
		lockManager.request = tracedRequest
		restorers.push(() => {
			lockManager.request = originalRequest
		})
	} catch {
		record("jazz-session-lock-instrumentation-unavailable")
	}
}

function jazzLockCategory(name: string): string | null {
	if (name.startsWith("load_session_")) return "load-session"
	if (name.startsWith("store_session_")) return "store-session"
	return null
}

function recordStartupResources(record: TraceRecorder): void {
	let resources = performance
		.getEntriesByType("resource")
		.filter(entry => entry.duration >= 10)
		.sort((left, right) => right.duration - left.duration)
		.slice(0, 5)
	for (let [index, resource] of resources.entries()) {
		let details: StartupTraceDetails = {
			rank: index + 1,
			name: resourceName(resource.name),
			durationMs: roundMilliseconds(resource.duration),
		}
		if (resource instanceof PerformanceResourceTiming) {
			details.initiatorType = resource.initiatorType
			details.transferKilobytes = roundMilliseconds(
				resource.transferSize / 1024,
			)
		}
		record("startup-resource", details)
	}
}

function websocketOrigin(url: string | URL): string {
	try {
		return new URL(String(url), location.href).origin
	} catch {
		return "unknown"
	}
}

function websocketMessageBytes(data: unknown): number {
	if (typeof data === "string") return new TextEncoder().encode(data).byteLength
	if (data instanceof Blob) return data.size
	if (data instanceof ArrayBuffer) return data.byteLength
	if (ArrayBuffer.isView(data)) return data.byteLength
	return 0
}

function resourceName(value: string): string {
	try {
		let url = new URL(value)
		return `${url.origin}${url.pathname}`
	} catch {
		return value
	}
}

function millisecondsSince(startedAt: number): number {
	return roundMilliseconds(performance.now() - startedAt)
}

function roundMilliseconds(value: number): number {
	return Math.round(value * 10) / 10
}
