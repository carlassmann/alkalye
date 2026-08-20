import { describe, expect, it, vi } from "vitest"
import {
	getCodeMirrorShortcut,
	getAriaShortcut,
	getShortcutDefinitions,
	getShortcutLabel,
	isShortcutEvent,
	isShortcutTargetBlocked,
	replaceShortcutTokens,
} from "./shortcut-registry"

describe("shortcut registry", () => {
	it("has no default-platform conflicts", () => {
		let bindings = getShortcutDefinitions().map(definition => ({
			id: definition.id,
			key: getCodeMirrorShortcut(definition.id).key,
		}))

		expect(conflicts(bindings)).toEqual([])
	})

	it("has no macOS conflicts", () => {
		let bindings = getShortcutDefinitions().map(definition => {
			let binding = getCodeMirrorShortcut(definition.id)
			return { id: definition.id, key: binding.mac ?? binding.key }
		})

		expect(conflicts(bindings)).toEqual([])
	})

	it("derives platform labels", () => {
		expect(getShortcutLabel("preview", "mac")).toBe("⌥⌘R")
		expect(getShortcutLabel("preview", "other")).toBe("Ctrl+Alt+R")
		expect(getShortcutLabel("redo", "mac")).toBe("⌘⇧Z")
		expect(getShortcutLabel("redo", "other")).toBe("Ctrl+Y")
	})

	it("derives aria-keyshortcuts values", () => {
		expect(getAriaShortcut("commandPalette", "mac")).toBe("Meta+Shift+P")
		expect(getAriaShortcut("commandPalette", "other")).toBe("Control+Shift+P")
	})

	it("requires exact modifiers", () => {
		let exact = keyboardEvent("b", { ctrlKey: true })
		let extra = keyboardEvent("b", { ctrlKey: true, shiftKey: true })

		expect(isShortcutEvent(exact, "bold", "other")).toBe(true)
		expect(isShortcutEvent(extra, "bold", "other")).toBe(false)
	})

	it("ignores composition and AltGraph", () => {
		let composing = keyboardEvent("b", { ctrlKey: true, isComposing: true })
		let altGraph = keyboardEvent("b", { ctrlKey: true })
		vi.spyOn(altGraph, "getModifierState").mockReturnValue(true)

		expect(isShortcutEvent(composing, "bold", "other")).toBe(false)
		expect(isShortcutEvent(altGraph, "bold", "other")).toBe(false)
	})

	it("blocks globals in forms and dialogs but allows CodeMirror", () => {
		let input = document.createElement("input")
		let dialog = document.createElement("div")
		dialog.setAttribute("role", "dialog")
		let button = document.createElement("button")
		dialog.appendChild(button)
		let editor = document.createElement("div")
		editor.className = "cm-editor"
		let content = document.createElement("div")
		content.contentEditable = "true"
		editor.appendChild(content)

		expect(isShortcutTargetBlocked(input)).toBe(true)
		expect(isShortcutTargetBlocked(button)).toBe(true)
		expect(isShortcutTargetBlocked(content)).toBe(false)
	})

	it("renders help tokens from the same definitions", () => {
		let content = "`{{shortcut:saveAs:mac}}` / `{{shortcut:saveAs:other}}`"

		expect(replaceShortcutTokens(content)).toBe("`⌘⇧S` / `Ctrl+Shift+S`")
	})
})

interface Binding {
	id: string
	key: string
}

function conflicts(bindings: Binding[]): string[] {
	let counts = new Map<string, number>()
	for (let binding of bindings) {
		counts.set(binding.key, (counts.get(binding.key) ?? 0) + 1)
	}
	return bindings
		.filter(binding => (counts.get(binding.key) ?? 0) > 1)
		.map(binding => binding.id)
}

function keyboardEvent(key: string, init: ShortcutEventInit): KeyboardEvent {
	return new KeyboardEvent("keydown", { key, ...init })
}

interface ShortcutEventInit {
	altKey?: boolean
	ctrlKey?: boolean
	isComposing?: boolean
	metaKey?: boolean
	shiftKey?: boolean
}
