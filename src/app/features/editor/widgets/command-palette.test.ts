import React from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CommandPalette } from "./command-palette"

vi.mock("@/app/hooks/use-fine-pointer", () => ({
	useHasFinePointer: () => true,
}))

afterEach(() => {
	document.body.replaceChildren()
})

describe("CommandPalette", () => {
	it("selects the first result and runs it with Enter", () => {
		let onRun = vi.fn()
		let onOpenChange = vi.fn()
		let container = document.createElement("div")
		document.body.append(container)
		let root = createRoot(container)

		flushSync(() => {
			root.render(
				React.createElement(CommandPalette, {
					open: true,
					onOpenChange,
					onRun,
				}),
			)
		})

		let input = document.querySelector<HTMLInputElement>(
			'input[aria-label="Search commands"]',
		)
		expect(input).not.toBeNull()
		expect(
			document.querySelector('[role="option"]')?.getAttribute("aria-selected"),
		).toBe("true")

		let setInputValue = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set
		flushSync(() => {
			setInputValue?.call(input, "outline")
			input?.dispatchEvent(new Event("input", { bubbles: true }))
		})

		let filteredResult = document.querySelector('[role="option"]')
		expect(filteredResult?.textContent).toContain("Document Outline")
		expect(filteredResult?.getAttribute("aria-selected")).toBe("true")

		flushSync(() => {
			input?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			)
		})

		expect(onRun).toHaveBeenCalledWith("documentOutline")
		expect(onOpenChange).toHaveBeenCalledWith(false)

		flushSync(() => root.unmount())
	})
})
