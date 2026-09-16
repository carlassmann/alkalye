import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import shipped from "../../../public/changelog.json"

let LAST_SEEN_KEY = "changelog-last-seen-entry"

// The module keeps an in-memory marker for browsers that refuse storage writes,
// so each test imports it fresh rather than inheriting the previous marker.
async function freshReleaseNotes() {
	vi.resetModules()
	return import("./release-notes")
}

function respondWith(body: unknown, ok = true) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({ ok, json: async () => body }),
	)
}

let served = [
	{ date: "2026-09-17", title: "Newer", notes: ["Third"] },
	{ date: "2026-09-16", title: "Newest bundled", notes: ["Second"] },
	{ date: "2026-09-10", title: "Older", notes: ["First"] },
]

beforeEach(() => localStorage.removeItem(LAST_SEEN_KEY))
afterEach(() => vi.unstubAllGlobals())

describe("markReleaseNotesSeen", () => {
	it("marks the bundled changelog as seen so a fresh install skips the backlog", async () => {
		let { markReleaseNotesSeen, newestBundledEntryId } =
			await freshReleaseNotes()
		markReleaseNotesSeen()
		expect(localStorage.getItem(LAST_SEEN_KEY)).toBe(
			String(newestBundledEntryId()),
		)
	})

	it("never moves the marker backwards", async () => {
		let { markReleaseNotesSeen } = await freshReleaseNotes()
		localStorage.setItem(LAST_SEEN_KEY, "999")
		markReleaseNotesSeen()
		expect(localStorage.getItem(LAST_SEEN_KEY)).toBe("999")
	})
})

describe("fetchPendingReleaseNotes", () => {
	it("returns only entries published after the running build", async () => {
		let { fetchPendingReleaseNotes } = await freshReleaseNotes()
		localStorage.setItem(LAST_SEEN_KEY, "2")
		respondWith(served)
		let pending = await fetchPendingReleaseNotes()
		expect(pending.map(entry => entry.title)).toEqual(["Newer"])
	})

	it("returns the whole backlog for a reader many releases behind", async () => {
		let { fetchPendingReleaseNotes } = await freshReleaseNotes()
		localStorage.setItem(LAST_SEEN_KEY, "0")
		respondWith(served)
		expect(await fetchPendingReleaseNotes()).toHaveLength(3)
	})

	it("falls back to no notes when the changelog cannot be read", async () => {
		let { fetchPendingReleaseNotes } = await freshReleaseNotes()
		respondWith(served, false)
		expect(await fetchPendingReleaseNotes()).toEqual([])

		respondWith({ not: "an array" })
		expect(await fetchPendingReleaseNotes()).toEqual([])

		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
		expect(await fetchPendingReleaseNotes()).toEqual([])
	})

	it("drops malformed entries instead of rendering them", async () => {
		let { fetchPendingReleaseNotes } = await freshReleaseNotes()
		localStorage.setItem(LAST_SEEN_KEY, "0")
		respondWith([{ date: "nonsense", title: "ok", notes: ["a"] }, ...served])
		expect(await fetchPendingReleaseNotes()).toHaveLength(3)
	})

	it("bounds the request so a hung network cannot withhold the prompt", async () => {
		let { fetchPendingReleaseNotes } = await freshReleaseNotes()
		let fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: true, json: async () => [] })
		vi.stubGlobal("fetch", fetchMock)
		await fetchPendingReleaseNotes()
		let init = fetchMock.mock.calls[0]?.[1]
		expect(init.signal).toBeInstanceOf(AbortSignal)
	})
})

describe("when localStorage refuses writes", () => {
	it("still remembers the marker for this session", async () => {
		let { markReleaseNotesSeen, fetchPendingReleaseNotes } =
			await freshReleaseNotes()
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => {
				throw new Error("blocked")
			},
			removeItem: () => {},
		})
		markReleaseNotesSeen()
		respondWith([
			{ date: "2026-09-20", title: "New", notes: ["Fresh"] },
			...shipped,
		])
		let pending = await fetchPendingReleaseNotes()
		expect(pending.map(entry => entry.title)).toEqual(["New"])
	})
})
