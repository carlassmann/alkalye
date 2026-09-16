export { readChangelog, entriesSince, countNotes, prependedEntryCount }
export type { ChangelogEntry }

type ChangelogEntry = {
	id: number
	date: string
	title: string
	notes: string[]
}

// public/changelog.json is hand-written, so entries are validated rather than
// trusted. Ids are positions counted from the oldest RAW entry, never from the
// surviving ones: renumbering on a malformed entry would shift every id above
// it and silently swallow a release for readers whose marker sits in between.
function readChangelog(value: unknown): ChangelogEntry[] {
	if (!Array.isArray(value)) return []
	return value
		.map((entry, index) => ({ entry, id: value.length - index }))
		.filter(({ entry }) => isEntrySource(entry))
		.map(({ entry, id }) => ({ ...entry, id }))
}

function entriesSince(
	entries: ChangelogEntry[],
	lastSeenId: number,
): ChangelogEntry[] {
	return entries.filter(entry => entry.id > lastSeenId)
}

function countNotes(entries: ChangelogEntry[]): number {
	return entries.reduce((total, entry) => total + entry.notes.length, 0)
}

// Ids are positions, so a published entry must never be edited, reordered or
// removed. Returns how many entries were prepended, or null when the entries
// they were prepended to no longer match. Counts raw positions so a malformed
// entry cannot slip through as an invisible release.
function prependedEntryCount(previous: unknown, next: unknown): number | null {
	if (!Array.isArray(previous) || !Array.isArray(next)) return null
	if (!next.every(isEntrySource)) return null
	let added = next.length - previous.length
	if (added < 0) return null
	let kept = next.slice(added)
	let unchanged = kept.every(
		(entry, index) => fingerprint(entry) === fingerprint(previous[index]),
	)
	return unchanged ? added : null
}

function fingerprint(entry: unknown): string {
	if (!isEntrySource(entry)) return ""
	return JSON.stringify([entry.date, entry.title, entry.notes])
}

function isEntrySource(value: unknown): value is Omit<ChangelogEntry, "id"> {
	if (typeof value !== "object" || value === null) return false
	let entry: Record<string, unknown> = { ...value }
	return (
		typeof entry.date === "string" &&
		isCalendarDate(entry.date) &&
		typeof entry.title === "string" &&
		entry.title.length > 0 &&
		Array.isArray(entry.notes) &&
		entry.notes.length > 0 &&
		entry.notes.every(note => typeof note === "string" && note.length > 0)
	)
}

// A date that does not parse would reach the changelog page as "Invalid Date".
function isCalendarDate(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}
