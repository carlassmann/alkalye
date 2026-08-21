import { afterEach, describe, expect, it, vi } from "vitest"
import { isMac } from "@/app/lib/platform"
import { setupKeyboardShortcuts } from "./keyboard-shortcuts"

let { toast } = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock("sonner", () => ({ toast }))

let cleanups: (() => void)[] = []

afterEach(() => {
	for (let cleanup of cleanups) cleanup()
	cleanups = []
	toast.mockReset()
	document.documentElement.dataset.focusMode = "false"
})

describe("document keyboard shortcuts", () => {
	it("uses the preview shortcut as a toggle action", () => {
		let onPreview = vi.fn()
		cleanups.push(setup({ onPreview }))

		document.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "r",
				altKey: true,
				...modifiers(),
				cancelable: true,
			}),
		)

		expect(onPreview).toHaveBeenCalledOnce()
	})

	it("Escape exits focus mode", () => {
		document.documentElement.dataset.focusMode = "true"
		cleanups.push(setup({}))

		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
		)

		expect(document.documentElement.dataset.focusMode).toBe("false")
	})

	it("acknowledges autosave and keeps save copy separate", () => {
		let onDownload = vi.fn()
		cleanups.push(setup({ onDownload }))

		document.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "s",
				...modifiers(),
				cancelable: true,
			}),
		)
		expect(toast).toHaveBeenCalledWith(
			"Alkalye saves automatically",
			expect.objectContaining({ id: "editor-save-shortcut" }),
		)
		expect(onDownload).not.toHaveBeenCalled()

		document.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "s",
				...modifiers(),
				shiftKey: true,
				cancelable: true,
			}),
		)
		expect(onDownload).toHaveBeenCalledOnce()
	})
})

function modifiers() {
	return isMac ? { metaKey: true } : { ctrlKey: true }
}

function setup({
	onPreview,
	onDownload,
}: {
	onPreview?: () => void
	onDownload?: () => void
}) {
	return setupKeyboardShortcuts({
		toggleLeft: vi.fn(),
		toggleRight: vi.fn(),
		toggleFocusMode: vi.fn(),
		onPreview,
		onDownload,
	})
}
