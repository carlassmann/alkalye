// The original's startup diagnostics: a timing trace of the latest launch
// that someone can copy after a slow start. Browser timing entries become
// named events measured from navigation start.

export interface StartupEvent {
	readonly event: string
	readonly elapsedMs: number
}

export interface TimingEntry {
	readonly name: string
	readonly entryType: string
	readonly startTime: number
	readonly duration: number
}

export function startupEvents(entries: readonly TimingEntry[]) {
	let events: StartupEvent[] = []
	for (let entry of entries) {
		if (entry.entryType === "navigation")
			events.push({
				event: "page loaded",
				elapsedMs: Math.round(entry.startTime + entry.duration),
			})
		else if (entry.entryType === "paint" || entry.entryType === "mark")
			events.push({ event: entry.name, elapsedMs: Math.round(entry.startTime) })
	}
	return events.sort((a, b) => a.elapsedMs - b.elapsedMs)
}

export interface StartupEnvironment {
	readonly at: string
	readonly userAgent: string
	readonly online: boolean
	readonly standalone: boolean
	readonly serviceWorker: string
	readonly storage?: { readonly usage: number; readonly quota: number }
}

export function startupReport(
	events: readonly StartupEvent[],
	environment: StartupEnvironment,
) {
	let megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + " MB"
	return [
		"Alkalye startup diagnostics",
		"Captured: " + environment.at,
		"Browser: " + environment.userAgent,
		"Online: " + (environment.online ? "yes" : "no"),
		"Installed: " + (environment.standalone ? "yes" : "no"),
		"Service worker: " + environment.serviceWorker,
		environment.storage
			? "Storage: " +
				megabytes(environment.storage.usage) +
				" of " +
				megabytes(environment.storage.quota)
			: "Storage: unknown",
		"",
		...events.map(event => event.elapsedMs + " ms  " + event.event),
	].join("\n")
}
