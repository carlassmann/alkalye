import { describe, it, expect } from "vitest"
import shippedChangelog from "../../public/changelog.json"
import {
	readChangelog,
	entriesSince,
	countNotes,
	prependedEntryCount,
} from "./changelog"

let sample = [
	{ date: "2026-09-16", title: "Newest release", notes: ["Second", "Third"] },
	{ date: "2026-09-10", title: "Older release", notes: ["First"] },
]

describe("readChangelog", () => {
	it("reads entries newest first with their notes", () => {
		let entries = readChangelog(sample)
		expect(entries.map(entry => entry.title)).toEqual([
			"Newest release",
			"Older release",
		])
		expect(entries[0]?.notes).toEqual(["Second", "Third"])
	})

	it("numbers entries from the oldest so appending keeps ids stable", () => {
		let before = readChangelog(sample)
		let after = readChangelog([
			{ date: "2026-09-20", title: "Newer", notes: ["Fourth"] },
			...sample,
		])
		expect(after.at(-1)?.id).toBe(before.at(-1)?.id)
		expect(after[0]?.id).toBe(3)
	})

	it("drops malformed entries instead of rendering them", () => {
		expect(readChangelog("not a list")).toEqual([])
		expect(readChangelog([{ title: "no date", notes: [] }])).toEqual([])
		expect(readChangelog([{ date: "x", title: "y", notes: [1] }])).toEqual([])
	})

	it("rejects dates that would render as Invalid Date", () => {
		expect(
			readChangelog([{ date: "16.09.2026", title: "t", notes: ["n"] }]),
		).toEqual([])
		expect(
			readChangelog([{ date: "2026-13-45", title: "t", notes: ["n"] }]),
		).toEqual([])
	})

	it("rejects entries with nothing to tell the reader", () => {
		expect(
			readChangelog([{ date: "2026-09-16", title: "t", notes: [] }]),
		).toEqual([])
		expect(
			readChangelog([{ date: "2026-09-16", title: "", notes: ["n"] }]),
		).toEqual([])
	})

	it("numbers entries by raw position so a malformed entry cannot renumber the rest", () => {
		let withBroken = [
			{ date: "2026-09-20", title: "Newest", notes: ["new"] },
			{ date: "broken", title: "Malformed", notes: ["x"] },
			...sample,
		]
		expect(readChangelog(withBroken)[0]?.id).toBe(4)
		expect(
			entriesSince(readChangelog(withBroken), 3).map(e => e.title),
		).toEqual(["Newest"])
	})

	it("accepts the changelog we actually ship", () => {
		let entries = readChangelog(shippedChangelog)
		expect(entries).toHaveLength(shippedChangelog.length)
		expect(entries.every(entry => entry.notes.length > 0)).toBe(true)
	})
})

describe("entriesSince", () => {
	it("returns only entries published after the last seen id", () => {
		let entries = readChangelog(sample)
		expect(entriesSince(entries, 1).map(entry => entry.title)).toEqual([
			"Newest release",
		])
		expect(entriesSince(entries, 2)).toEqual([])
		expect(countNotes(entriesSince(entries, 0))).toBe(3)
	})
})

describe("prependedEntryCount", () => {
	let added = { date: "2026-09-20", title: "Newer", notes: ["Fourth"] }

	it("counts entries added at the top", () => {
		expect(prependedEntryCount(sample, sample)).toBe(0)
		expect(prependedEntryCount(sample, [added, ...sample])).toBe(1)
		expect(prependedEntryCount(sample, [added, added, ...sample])).toBe(2)
	})

	it("rejects edits to already published entries", () => {
		let edited = [{ ...sample[0], notes: ["Rewritten"] }, sample[1]]
		expect(prependedEntryCount(sample, edited)).toBeNull()
		expect(prependedEntryCount(sample, [added, ...edited])).toBeNull()
	})

	it("rejects removed or reordered entries", () => {
		expect(prependedEntryCount(sample, [sample[0]])).toBeNull()
		expect(prependedEntryCount(sample, [sample[1], sample[0]])).toBeNull()
	})

	it("refuses a prepended entry that readers would never see", () => {
		let malformed = { date: "not-a-date", title: "Bad", notes: ["n"] }
		expect(prependedEntryCount(sample, [malformed, ...sample])).toBeNull()
		expect(
			prependedEntryCount(sample, [malformed, added, ...sample]),
		).toBeNull()
	})
})
