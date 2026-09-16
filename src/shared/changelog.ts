export { readChangelog, entriesSince, countNotes, prependedEntryCount }
export type { ChangelogEntry }

type ChangelogEntry = {
	id: number
	date: string
	title: string
	notes: string[]
}

// public/changelog.json is hand-written, so entries are validated rather than
// trusted, and numbered by position from the oldest: appending at the top leaves
// every published id untouched, which is what makes a stored id keep its meaning
// across releases.
function readChangelog(value: unknown): ChangelogEntry[] {
	if (!Array.isArray(value)) return []
	let newestFirst = value.filter(isEntrySource)
	return newestFirst.map((entry, index) => ({
		...entry,
		id: newestFirst.length - index,
	}))
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
// they were prepended to no longer match.
function prependedEntryCount(previous: unknown, next: unknown): number | null {
	let before = readChangelog(previous)
	let after = readChangelog(next)
	let added = after.length - before.length
	if (added < 0) return null
	let kept = after.slice(added)
	let unchanged = kept.every(
		(entry, index) => fingerprint(entry) === fingerprint(before[index]),
	)
	return unchanged ? added : null
}

function fingerprint(entry: ChangelogEntry | undefined): string {
	if (!entry) return ""
	return JSON.stringify([entry.date, entry.title, entry.notes])
}

function isEntrySource(value: unknown): value is Omit<ChangelogEntry, "id"> {
	if (typeof value !== "object" || value === null) return false
	let entry: Record<string, unknown> = { ...value }
	return (
		typeof entry.date === "string" &&
		typeof entry.title === "string" &&
		Array.isArray(entry.notes) &&
		entry.notes.every(note => typeof note === "string")
	)
}
