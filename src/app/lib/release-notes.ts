import changelogSource from "../../../public/changelog.json"
import {
	readChangelog,
	entriesSince,
	type ChangelogEntry,
} from "@/shared/changelog"

export { bundledReleaseNotes, markReleaseNotesSeen, fetchPendingReleaseNotes }

let LAST_SEEN_KEY = "changelog-last-seen-entry"

let bundledReleaseNotes = readChangelog(changelogSource)

// Called on startup so a reader only ever sees notes written after the build
// they last ran, and a fresh install never opens on a backlog.
function markReleaseNotesSeen(): void {
	let newest = bundledReleaseNotes[0]?.id ?? 0
	if (newest > readLastSeenId()) writeLastSeenId(newest)
}

// The update prompt runs in the outgoing build, which cannot know what the
// incoming one added, so the notes come from the network.
async function fetchPendingReleaseNotes(): Promise<ChangelogEntry[]> {
	try {
		let response = await fetch("/changelog.json", { cache: "no-store" })
		if (!response.ok) return []
		return entriesSince(readChangelog(await response.json()), readLastSeenId())
	} catch {
		return []
	}
}

function readLastSeenId(): number {
	try {
		let stored = Number(localStorage.getItem(LAST_SEEN_KEY))
		return Number.isFinite(stored) ? stored : 0
	} catch {
		return 0
	}
}

function writeLastSeenId(id: number): void {
	try {
		localStorage.setItem(LAST_SEEN_KEY, String(id))
	} catch {
		// Ignore localStorage errors (e.g. in private browsing)
	}
}
