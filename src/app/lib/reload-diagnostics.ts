export {
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
