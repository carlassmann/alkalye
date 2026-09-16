import changelogSource from "../../../public/changelog.json"
import {
	readChangelog,
	entriesSince,
	type ChangelogEntry,
} from "@/shared/changelog"

export { bundledReleaseNotes, markReleaseNotesSeen, fetchPendingReleaseNotes }

let LAST_SEEN_KEY = "changelog-last-seen-entry"
let FETCH_TIMEOUT_MS = 5_000

let bundledReleaseNotes = readChangelog(changelogSource)

// Survives a localStorage that refuses writes (private browsing, blocked
// cookies). Without it the marker reads 0 forever and every update dumps the
// entire backlog.
let lastSeenFallback = 0

// Called on startup so a reader only ever sees notes written after the build
// they last ran, and a fresh install never opens on a backlog.
function markReleaseNotesSeen(): void {
	let newest = bundledReleaseNotes[0]?.id ?? 0
	if (newest > readLastSeenId()) writeLastSeenId(newest)
}

// The update prompt runs in the outgoing build, which cannot know what the
// incoming one added, so the notes come from the network. The marker is read
// before the request: a second tab on the newer build can advance it mid-flight,
// which would blank out these notes for good.
async function fetchPendingReleaseNotes(): Promise<ChangelogEntry[]> {
	let lastSeenId = readLastSeenId()
	try {
		let response = await fetch("/changelog.json", {
			cache: "no-store",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		})
		if (!response.ok) return []
		return entriesSince(readChangelog(await response.json()), lastSeenId)
	} catch {
		return []
	}
}

function readLastSeenId(): number {
	try {
		let stored = Number(localStorage.getItem(LAST_SEEN_KEY))
		if (Number.isFinite(stored)) return Math.max(stored, lastSeenFallback)
	} catch {
		// Ignore localStorage errors (e.g. in private browsing)
	}
	return lastSeenFallback
}

function writeLastSeenId(id: number): void {
	lastSeenFallback = id
	try {
		localStorage.setItem(LAST_SEEN_KEY, String(id))
	} catch {
		// Ignore localStorage errors (e.g. in private browsing)
	}
}
