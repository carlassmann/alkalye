import { describe, it, expect } from "vitest"
import shippedChangelog from "../../public/changelog.json"
import {
	readChangelog,
	entriesSince,
	countNotes,
	addedEntryIds,
	duplicateEntryIds,
	newestEntryId,
	sourceUrl,
	sourceLabel,
} from "./changelog"

let sample = [
	{
		id: 2,
		date: "2026-09-16",
		title: "Newest release",
		notes: ["Second", "Third"],
	},
	{ id: 1, date: "2026-09-10", title: "Older release", notes: ["First"] },
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

	it("drops malformed entries instead of rendering them", () => {
		expect(readChangelog("not a list")).toEqual([])
		expect(readChangelog([{ id: 1, title: "no date", notes: [] }])).toEqual([])
		expect(
			readChangelog([{ id: 1, date: "x", title: "y", notes: [1] }]),
		).toEqual([])
		expect(
			readChangelog([{ date: "2026-09-16", title: "no id", notes: ["n"] }]),
		).toEqual([])
	})

	it("rejects dates that would render as Invalid Date", () => {
		expect(
			readChangelog([{ id: 1, date: "16.09.2026", title: "t", notes: ["n"] }]),
		).toEqual([])
		expect(
			readChangelog([{ id: 1, date: "2026-13-45", title: "t", notes: ["n"] }]),
		).toEqual([])
	})

	it("rejects entries with nothing to tell the reader", () => {
		expect(
			readChangelog([{ id: 1, date: "2026-09-16", title: "t", notes: [] }]),
		).toEqual([])
		expect(
			readChangelog([{ id: 1, date: "2026-09-16", title: "", notes: ["n"] }]),
		).toEqual([])
	})

	it("points every shipped entry at a distinct commit or pull request", () => {
		let entries = readChangelog(shippedChangelog)
		let refs = entries.map(entry => sourceLabel(entry))
		expect(refs.filter(ref => ref === undefined)).toEqual([])
		expect(new Set(refs).size).toBe(refs.length)
		expect(sourceUrl(entries[0]!)?.startsWith("https://github.com/")).toBe(true)
	})

	it("accepts the changelog we actually ship", () => {
		let entries = readChangelog(shippedChangelog)
		expect(entries).toHaveLength(shippedChangelog.length)
		expect(duplicateEntryIds(shippedChangelog)).toEqual([])
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

describe("addedEntryIds", () => {
	let added = { id: 3, date: "2026-09-20", title: "Newer", notes: ["Fourth"] }

	it("reports the ids a revision introduced", () => {
		expect(addedEntryIds(sample, sample)).toEqual([])
		expect(addedEntryIds(sample, [added, ...sample])).toEqual([3])
	})

	it("ignores a published entry that was reworded after the fact", () => {
		let reworded = [
			{ ...sample[0]!, title: "Rewritten", notes: ["Fixed typo"] },
			sample[1],
		]
		expect(addedEntryIds(sample, reworded)).toEqual([])
		expect(addedEntryIds(sample, [added, ...reworded])).toEqual([3])
	})

	it("ignores a published entry that was removed or reordered", () => {
		expect(addedEntryIds(sample, [sample[1]])).toEqual([])
		expect(addedEntryIds(sample, [sample[1], sample[0]])).toEqual([])
	})

	it("treats a missing base file as introducing everything", () => {
		expect(addedEntryIds(undefined, sample)).toEqual([2, 1])
	})
})

describe("duplicateEntryIds", () => {
	it("catches a reused id, which would hide one of the entries", () => {
		expect(duplicateEntryIds(sample)).toEqual([])
		expect(
			duplicateEntryIds([...sample, { ...sample[0]!, title: "Clash" }]),
		).toEqual([2])
	})
})

describe("newestEntryId", () => {
	it("is the highest id, not the first one", () => {
		expect(newestEntryId(sample)).toBe(2)
		expect(newestEntryId([sample[1], sample[0]])).toBe(2)
		expect(newestEntryId([])).toBe(0)
	})
})
