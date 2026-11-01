import { describe, expect, it } from "vitest"
import {
	getSidebarKeyboardAction,
	type SidebarKeyboardRow,
} from "./sidebar-keyboard-navigation"

let rows: SidebarKeyboardRow[] = [
	{ type: "folder", depth: 0, isCollapsed: false },
	{ type: "doc", depth: 1 },
	{ type: "folder", depth: 0, isCollapsed: true },
	{ type: "doc", depth: 0 },
]

describe("getSidebarKeyboardAction", () => {
	it("moves between rows and leaves the list at the top", () => {
		expect(getSidebarKeyboardAction("ArrowDown", 0, rows)).toEqual({
			type: "focus",
			index: 1,
		})
		expect(getSidebarKeyboardAction("ArrowDown", 3, rows)).toBeNull()
		expect(getSidebarKeyboardAction("ArrowUp", 2, rows)).toEqual({
			type: "focus",
			index: 1,
		})
		expect(getSidebarKeyboardAction("ArrowUp", 0, rows)).toEqual({
			type: "leaveTop",
		})
	})

	it("jumps to the first and last row", () => {
		expect(getSidebarKeyboardAction("Home", 2, rows)).toEqual({
			type: "focus",
			index: 0,
		})
		expect(getSidebarKeyboardAction("End", 0, rows)).toEqual({
			type: "focus",
			index: 3,
		})
	})

	it("expands collapsed folders and enters expanded ones", () => {
		expect(getSidebarKeyboardAction("ArrowRight", 2, rows)).toEqual({
			type: "toggleFolder",
			index: 2,
		})
		expect(getSidebarKeyboardAction("ArrowRight", 0, rows)).toEqual({
			type: "focus",
			index: 1,
		})
		expect(getSidebarKeyboardAction("ArrowRight", 3, rows)).toBeNull()
	})

	it("collapses expanded folders and returns to the parent folder", () => {
		expect(getSidebarKeyboardAction("ArrowLeft", 0, rows)).toEqual({
			type: "toggleFolder",
			index: 0,
		})
		expect(getSidebarKeyboardAction("ArrowLeft", 1, rows)).toEqual({
			type: "focus",
			index: 0,
		})
		expect(getSidebarKeyboardAction("ArrowLeft", 3, rows)).toBeNull()
	})

	it("ignores other keys", () => {
		expect(getSidebarKeyboardAction("a", 0, rows)).toBeNull()
	})
})
