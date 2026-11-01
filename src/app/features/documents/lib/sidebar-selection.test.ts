import { describe, expect, it } from "vitest"
import {
	emptySidebarSelection,
	extendSidebarSelection,
	pruneSidebarSelection,
	toggleSidebarSelection,
} from "./sidebar-selection"

let ordered = ["a", "b", "c", "d"]

describe("toggleSidebarSelection", () => {
	it("keeps the open document when starting a selection", () => {
		expect(toggleSidebarSelection(emptySidebarSelection, "c", "a")).toEqual({
			ids: ["a", "c"],
			anchorId: "c",
		})
	})

	it("removes an already selected document", () => {
		let selection = { ids: ["a", "c"], anchorId: "c" }
		expect(toggleSidebarSelection(selection, "c", "a")).toEqual({
			ids: ["a"],
			anchorId: "a",
		})
	})
})

describe("extendSidebarSelection", () => {
	it("selects the range from the anchor in list order", () => {
		let selection = { ids: ["d"], anchorId: "d" }
		expect(extendSidebarSelection(selection, "b", undefined, ordered)).toEqual({
			ids: ["b", "c", "d"],
			anchorId: "d",
		})
	})

	it("starts the range at the open document", () => {
		expect(
			extendSidebarSelection(emptySidebarSelection, "c", "a", ordered),
		).toEqual({ ids: ["a", "b", "c"], anchorId: "a" })
	})
})

describe("pruneSidebarSelection", () => {
	it("drops documents that are no longer listed", () => {
		let selection = { ids: ["a", "c"], anchorId: "c" }
		expect(pruneSidebarSelection(selection, ["a", "b"])).toEqual({
			ids: ["a"],
			anchorId: "a",
		})
	})

	it("returns the same selection when nothing changed", () => {
		let selection = { ids: ["a"], anchorId: "a" }
		expect(pruneSidebarSelection(selection, ordered)).toBe(selection)
	})
})
