import changelogSource from "../../../public/changelog.json"
import {
	readChangelog,
	entriesSince,
	newestEntryId,
	type ChangelogEntry,
} from "@/shared/changelog"
import { tryCatch } from "@/app/lib/try-catch"

export { markReleaseNotesSeen, fetchPendingReleaseNotes, newestBundledEntryId }

let LAST_SEEN_KEY = "changelog-last-seen-entry"
let FETCH_TIMEOUT_MS = 5_000

// Survives a localStorage that refuses writes (private browsing, blocked
// cookies). Without it the marker reads 0 forever and every update dumps the
// entire backlog.
let lastSeenFallback = 0

// Reads the ids only, which avoids validating every entry on the boot path.
function newestBundledEntryId(): number {
	return newestEntryId(changelogSource)
}

// Called on startup so a reader only ever sees notes written after the build
// they last ran, and a fresh install never opens on a backlog.
function markReleaseNotesSeen(): void {
	let newest = newestBundledEntryId()
	if (newest > readLastSeenId()) writeLastSeenId(newest)
}

// The update prompt runs in the outgoing build, which cannot know what the
// incoming one added, so the notes come from the network. The marker is read
// before the request: a second tab on the newer build can advance it mid-flight,
// which would blank out these notes for good.
async function fetchPendingReleaseNotes(): Promise<ChangelogEntry[]> {
	let lastSeenId = readLastSeenId()
	let response = await tryCatch(
		fetch("/changelog.json", {
			cache: "no-store",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		}),
	)
	if (!response.ok || !response.value.ok) return []
	let body = await tryCatch(response.value.json())
	if (!body.ok) return []
	return entriesSince(readChangelog(body.value), lastSeenId)
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
