import { describe, expect, it } from "vitest"
import { getSidebarDropAction } from "./sidebar-drop"

describe("getSidebarDropAction", () => {
	it("counts only documents that would change folder", () => {
		expect(getSidebarDropAction(["work", null, null], "work")).toEqual({
			type: "moveToFolder",
			count: 2,
			folder: "work",
		})
	})

	it("moves to the top level", () => {
		expect(getSidebarDropAction(["work"], null)).toEqual({
			type: "moveToRoot",
			count: 1,
		})
	})

	it("reports when every document is already there", () => {
		expect(getSidebarDropAction(["work", "work"], "work")).toEqual({
			type: "alreadyThere",
			folder: "work",
		})
	})
})
