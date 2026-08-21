import { beforeEach, describe, expect, it } from "vitest"
import {
	exitFocusMode,
	isFocusMode,
	setFocusMode,
	toggleFocusMode,
} from "./focus-mode"

beforeEach(() => {
	delete document.documentElement.dataset.focusMode
})

describe("focus mode", () => {
	it("toggles through a shared state boundary", () => {
		expect(isFocusMode()).toBe(false)
		toggleFocusMode()
		expect(isFocusMode()).toBe(true)
		toggleFocusMode()
		expect(isFocusMode()).toBe(false)
	})

	it("reports whether Escape has exited focus mode", () => {
		expect(exitFocusMode()).toBe(false)
		setFocusMode(true)
		expect(exitFocusMode()).toBe(true)
		expect(isFocusMode()).toBe(false)
	})
})
