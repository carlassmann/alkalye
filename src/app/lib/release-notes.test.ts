import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import {
	bundledReleaseNotes,
	markReleaseNotesSeen,
	fetchPendingReleaseNotes,
} from "./release-notes"

let LAST_SEEN_KEY = "changelog-last-seen-entry"

function respondWith(body: unknown, ok = true) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({ ok, json: async () => body }),
	)
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe("markReleaseNotesSeen", () => {
	it("marks the bundled changelog as seen so a fresh install skips the backlog", () => {
		markReleaseNotesSeen()
		expect(localStorage.getItem(LAST_SEEN_KEY)).toBe(
			String(bundledReleaseNotes[0]?.id),
		)
	})

	it("never moves the marker backwards", () => {
		localStorage.setItem(LAST_SEEN_KEY, "999")
		markReleaseNotesSeen()
		expect(localStorage.getItem(LAST_SEEN_KEY)).toBe("999")
	})
})

describe("fetchPendingReleaseNotes", () => {
	let served = [
		{ id: 3, date: "2026-09-17", title: "Newer", notes: ["Third"] },
		{ id: 2, date: "2026-09-16", title: "Newest bundled", notes: ["Second"] },
		{ id: 1, date: "2026-09-10", title: "Older", notes: ["First"] },
	]

	it("returns only entries published after the running build", async () => {
		localStorage.setItem(LAST_SEEN_KEY, "2")
		respondWith(served)
		let pending = await fetchPendingReleaseNotes()
		expect(pending.map(entry => entry.title)).toEqual(["Newer"])
	})

	it("returns the whole backlog for a reader many releases behind", async () => {
		localStorage.setItem(LAST_SEEN_KEY, "0")
		respondWith(served)
		expect(await fetchPendingReleaseNotes()).toHaveLength(3)
	})

	it("falls back to no notes when the changelog cannot be read", async () => {
		respondWith(served, false)
		expect(await fetchPendingReleaseNotes()).toEqual([])

		respondWith({ not: "an array" })
		expect(await fetchPendingReleaseNotes()).toEqual([])

		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
		expect(await fetchPendingReleaseNotes()).toEqual([])
	})

	it("drops malformed entries instead of rendering them", async () => {
		localStorage.setItem(LAST_SEEN_KEY, "0")
		respondWith([{ id: 3, date: "x", title: "ok", notes: [1, 2] }, ...served])
		expect(await fetchPendingReleaseNotes()).toHaveLength(3)
	})
})
