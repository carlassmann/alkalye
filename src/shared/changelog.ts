import { object } from "./model"

export interface ChangelogEntry {
	id: number
	date: string
	title: string
	notes: string[]
	pr?: number
	commit?: string
}
export function isChangelogEntry(value: unknown): value is ChangelogEntry {
	try {
		let entry = object(value)
		return (
			typeof entry.id === "number" &&
			Number.isInteger(entry.id) &&
			entry.id > 0 &&
			typeof entry.date === "string" &&
			/^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
			typeof entry.title === "string" &&
			Boolean(entry.title) &&
			Array.isArray(entry.notes) &&
			entry.notes.length > 0 &&
			entry.notes.every(note => typeof note === "string" && note.length > 0)
		)
	} catch {
		return false
	}
}
export function readChangelog(value: unknown): ChangelogEntry[] {
	return Array.isArray(value) ? value.filter(isChangelogEntry) : []
}
export function newestEntryId(value: unknown) {
	return Math.max(0, ...readChangelog(value).map(entry => entry.id))
}
export function addedEntryIds(previous: unknown, next: unknown) {
	let existing = new Set(readChangelog(previous).map(entry => entry.id))
	return readChangelog(next)
		.map(entry => entry.id)
		.filter(id => !existing.has(id))
}
export function duplicateEntryIds(value: unknown) {
	let seen = new Set<number>(),
		duplicates = new Set<number>()
	for (let entry of readChangelog(value)) {
		if (seen.has(entry.id)) duplicates.add(entry.id)
		seen.add(entry.id)
	}
	return [...duplicates]
}
