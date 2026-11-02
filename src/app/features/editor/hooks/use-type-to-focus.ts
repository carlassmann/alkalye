import { useEffect } from "react"
import type { EditorView } from "@codemirror/view"

export { useTypeToFocus, focusEditorOnTyping }

let keyboardOwnerSelector = [
	"input",
	"textarea",
	"select",
	"[contenteditable]",
	"[role='dialog']",
	"[role='alertdialog']",
	"[role='menu']",
	"[role='listbox']",
	"[role='combobox']",
].join(",")

function useTypeToFocus(view: EditorView | null, enabled: boolean) {
	useEffect(() => {
		if (!view || !enabled) return
		let editor = view

		function handleKeyDown(event: KeyboardEvent) {
			focusEditorOnTyping(editor, event)
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [view, enabled])
}

// Focusing during keydown moves the default action (text insertion) into the
// editor, so the first keystroke lands in the document instead of being lost.
// Dead keys and IME input report no printable key yet, so they don't qualify.
function focusEditorOnTyping(view: EditorView, event: KeyboardEvent) {
	if (!shouldFocusEditor(view, event)) return
	view.dispatch({
		selection: { anchor: view.state.doc.length },
		scrollIntoView: true,
	})
	view.focus()
}

function shouldFocusEditor(view: EditorView, event: KeyboardEvent) {
	if (event.defaultPrevented || event.isComposing) return false
	if (isShortcut(event) || !isPrintableKey(event.key)) return false
	if (view.hasFocus || view.state.readOnly) return false
	if (!view.dom.getClientRects().length) return false
	if (document.querySelector("[aria-modal='true']")) return false
	if (!(event.target instanceof Element)) return true
	if (event.target.closest(keyboardOwnerSelector)) return false
	return !(event.key === " " && isActivatable(event.target))
}

// Windows reports AltGr as Ctrl+Alt, but AltGr combinations type characters
function isShortcut(event: KeyboardEvent) {
	if (event.metaKey) return true
	if (event.getModifierState("AltGraph")) return false
	return event.ctrlKey || event.altKey
}

function isPrintableKey(key: string) {
	return [...key].length === 1
}

function isActivatable(element: Element) {
	return Boolean(element.closest("button, a[href], summary, [role='button']"))
}
