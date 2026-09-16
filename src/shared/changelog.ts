import { z } from "zod"

export { readChangelog, isChangelogEntry, entriesSince, countNotes }
export { addedEntryIds, newestEntryId, duplicateEntryIds }
export { sourceUrl, sourceLabel, REPOSITORY_URL }
export type { ChangelogEntry }

type ChangelogEntry = z.infer<typeof entrySchema>

// The id is what a reader's "last seen" marker points at, so it belongs to the
// entry rather than to its position: entries can be rewritten, reordered or
// removed afterwards without moving anybody's marker.
let entrySchema = z.object({
	id: z.number().int().positive(),
	date: z.iso.date(),
	title: z.string().min(1),
	notes: z.array(z.string().min(1)).min(1),
	// Where the change came from. A pull request survives a squash merge; a
	// commit is how the backfilled history points at itself.
	pr: z.number().int().positive().optional(),
	commit: z
		.string()
		.regex(/^[0-9a-f]{7,40}$/)
		.optional(),
})

let REPOSITORY_URL = "https://github.com/carlassmann/alkalye"

function isChangelogEntry(value: unknown): boolean {
	return entrySchema.safeParse(value).success
}

// public/changelog.json is hand-written, so entries are validated rather than
// trusted. An entry that does not parse is dropped instead of reaching a reader
// as an empty bullet list or an "Invalid Date".
function readChangelog(value: unknown): ChangelogEntry[] {
	if (!Array.isArray(value)) return []
	return value.flatMap(entry => {
		let parsed = entrySchema.safeParse(entry)
		return parsed.success ? [parsed.data] : []
	})
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

function newestEntryId(value: unknown): number {
	if (!Array.isArray(value)) return 0
	let ids = value.map(entry => (typeof entry?.id === "number" ? entry.id : 0))
	return ids.length > 0 ? Math.max(...ids) : 0
}

// Which ids this revision introduced. Rewording or dropping an existing entry
// changes nothing here, which is the point.
function addedEntryIds(previous: unknown, next: unknown): number[] {
	let before = new Set(readChangelog(previous).map(entry => entry.id))
	return readChangelog(next)
		.map(entry => entry.id)
		.filter(id => !before.has(id))
}

function duplicateEntryIds(value: unknown): number[] {
	let seen = new Set<number>()
	let duplicates = new Set<number>()
	for (let entry of readChangelog(value)) {
		if (seen.has(entry.id)) duplicates.add(entry.id)
		seen.add(entry.id)
	}
	return [...duplicates]
}

function sourceUrl(entry: ChangelogEntry): string | undefined {
	if (entry.pr) return `${REPOSITORY_URL}/pull/${entry.pr}`
	if (entry.commit) return `${REPOSITORY_URL}/commit/${entry.commit}`
	return undefined
}

function sourceLabel(entry: ChangelogEntry): string | undefined {
	if (entry.pr) return `#${entry.pr}`
	if (entry.commit) return entry.commit.slice(0, 7)
	return undefined
}
