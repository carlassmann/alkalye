import { z } from "zod"

export { readChangelog, isChangelogEntry, entriesSince, countNotes }
export { prependedEntryCount, sourceUrl, sourceLabel }
export { REPOSITORY_URL }
export type { ChangelogEntry }

type ChangelogEntry = z.infer<typeof entrySchema> & { id: number }

// An unparseable date would reach the changelog page as "Invalid Date", and an
// entry with no notes as an empty bullet list under "Update available".
let entrySchema = z.object({
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

function isChangelogEntry(value: unknown): boolean {
	return entrySchema.safeParse(value).success
}

// public/changelog.json is hand-written, so entries are validated rather than
// trusted. Ids are positions counted from the oldest RAW entry, never from the
// surviving ones: renumbering on a malformed entry would shift every id above
// it and silently swallow a release for readers whose marker sits in between.
function readChangelog(value: unknown): ChangelogEntry[] {
	if (!Array.isArray(value)) return []
	return value.flatMap((entry, index) => {
		let parsed = entrySchema.safeParse(entry)
		return parsed.success ? [{ ...parsed.data, id: value.length - index }] : []
	})
}

let REPOSITORY_URL = "https://github.com/carlassmann/alkalye"

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
	if (!next.every(isChangelogEntry)) return null
	let added = next.length - previous.length
	if (added < 0) return null
	let kept = next.slice(added)
	let unchanged = kept.every(
		(entry, index) => fingerprint(entry) === fingerprint(previous[index]),
	)
	return unchanged ? added : null
}

function fingerprint(entry: unknown): string {
	let parsed = entrySchema.safeParse(entry)
	if (!parsed.success) return ""
	return JSON.stringify([
		parsed.data.date,
		parsed.data.title,
		parsed.data.notes,
	])
}
