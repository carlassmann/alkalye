import { describe, expect, it } from "vitest"
import {
	getScreenKeyboardScrollMargins,
	viewportChangeMayHideCaret,
} from "./screen-keyboard-scrolling"

describe("getScreenKeyboardScrollMargins", () => {
	it("keeps a comfortable bottom margin without a keyboard", () => {
		expect(getScreenKeyboardScrollMargins(800, 700, 800)).toEqual({
			bottom: 210,
		})
	})

	it("adds the part of the scroller hidden behind the keyboard", () => {
		expect(getScreenKeyboardScrollMargins(874, 734, 474)).toEqual({
			bottom: 400 + 334 * 0.3,
		})
	})

	it("never shrinks the margin when the scroller ends above the visible bottom", () => {
		expect(getScreenKeyboardScrollMargins(500, 400, 600)).toEqual({
			bottom: 120,
		})
	})
})

describe("viewportChangeMayHideCaret", () => {
	let full = { height: 874, offsetTop: 0, scale: 1 }

	it("reveals when the keyboard shrinks the viewport", () => {
		expect(viewportChangeMayHideCaret(full, { ...full, height: 505 })).toBe(
			true,
		)
	})

	it("reveals when iOS scrolls the window under a fixed height", () => {
		let open = { height: 505, offsetTop: 0, scale: 1 }
		expect(viewportChangeMayHideCaret(open, { ...open, offsetTop: 92 })).toBe(
			true,
		)
	})

	it("keeps the scroll position when the viewport grows", () => {
		expect(viewportChangeMayHideCaret({ ...full, height: 505 }, full)).toBe(
			false,
		)
	})

	it("keeps the scroll position while pinch-zoomed", () => {
		expect(
			viewportChangeMayHideCaret(full, {
				height: 400,
				offsetTop: 120,
				scale: 2,
			}),
		).toBe(false)
	})
})
