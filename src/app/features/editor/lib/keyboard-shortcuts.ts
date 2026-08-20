import { toast } from "sonner"
import {
	isShortcutEvent,
	isShortcutTargetBlocked,
} from "@/app/lib/shortcut-registry"

export { setupKeyboardShortcuts }

function setupKeyboardShortcuts(opts: {
	toggleLeft: () => void
	toggleRight: () => void
	toggleFocusMode: () => void
	openFind?: () => void
	onPrintPdf?: () => void
	onPreview?: () => void
	onDownload?: () => void
	labels?: {
		autosaveTitle: string
		autosaveDescription: string
		download: string
	}
}) {
	function showAutosaveToast() {
		toast(opts.labels?.autosaveTitle ?? "Alkalye saves automatically", {
			description:
				opts.labels?.autosaveDescription ??
				"Changes are saved locally and synced to the cloud while you type.",
			action: opts.onDownload
				? {
						label: opts.labels?.download ?? "Download",
						onClick: opts.onDownload,
					}
				: undefined,
			id: "editor-save-shortcut",
		})
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.defaultPrevented || isShortcutTargetBlocked(e.target)) return

		if (isShortcutEvent(e, "preview")) {
			e.preventDefault()
			opts.onPreview?.()
			return
		}
		if (isShortcutEvent(e, "leftSidebar")) {
			e.preventDefault()
			opts.toggleLeft()
			return
		}
		if (isShortcutEvent(e, "rightSidebar")) {
			e.preventDefault()
			opts.toggleRight()
			return
		}
		if (isShortcutEvent(e, "focusMode")) {
			e.preventDefault()
			opts.toggleFocusMode()
			return
		}
		if (isShortcutEvent(e, "find")) {
			e.preventDefault()
			opts.openFind?.()
			return
		}
		if (isShortcutEvent(e, "print")) {
			e.preventDefault()
			opts.onPrintPdf?.()
			return
		}
		if (isShortcutEvent(e, "saveAs")) {
			e.preventDefault()
			opts.onDownload?.()
			return
		}
		if (isShortcutEvent(e, "save")) {
			e.preventDefault()
			showAutosaveToast()
		}
	}

	document.addEventListener("keydown", handleKeyDown)
	return () => document.removeEventListener("keydown", handleKeyDown)
}
