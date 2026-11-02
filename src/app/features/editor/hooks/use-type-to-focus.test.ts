// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorState, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { focusEditorOnTyping } from "./use-type-to-focus"

let views: EditorView[] = []

afterEach(() => {
	views.forEach(view => view.destroy())
	views = []
	document.body.replaceChildren()
	vi.restoreAllMocks()
})

describe("focusEditorOnTyping", () => {
	it("focuses the editor at the end of the document", () => {
		let view = createEditor("Hello")
		focusEditorOnTyping(view, pressKey("x"))
		expect(view.hasFocus).toBe(true)
		expect(view.state.selection.main.head).toBe(5)
	})

	it("accepts shifted and non-ASCII characters", () => {
		let view = createEditor("Hello")
		focusEditorOnTyping(view, pressKey("Ä", { shiftKey: true }))
		expect(view.hasFocus).toBe(true)
	})

	it("accepts AltGr characters, which Windows reports as Ctrl+Alt", () => {
		let view = createEditor("Hello")
		let event = pressKey("@", { ctrlKey: true, altKey: true })
		vi.spyOn(event, "getModifierState").mockImplementation(
			key => key === "AltGraph",
		)
		focusEditorOnTyping(view, event)
		expect(view.hasFocus).toBe(true)
	})

	it.each([
		["shortcuts", pressKey("k", { metaKey: true })],
		["Ctrl shortcuts", pressKey("s", { ctrlKey: true })],
		["Alt shortcuts", pressKey("x", { altKey: true })],
		["named keys", pressKey("Enter")],
		["dead keys", pressKey("Dead")],
		["keys another handler took", pressHandledKey("x")],
	])("ignores %s", (_, event) => {
		// happy-dom treats any Alt as AltGraph; browsers only report AltGr
		vi.spyOn(event, "getModifierState").mockReturnValue(false)
		let view = createEditor("Hello")
		focusEditorOnTyping(view, event)
		expect(view.hasFocus).toBe(false)
		expect(view.state.selection.main.head).toBe(0)
	})

	it("ignores read-only editors", () => {
		let view = createEditor("Hello", [EditorState.readOnly.of(true)])
		focusEditorOnTyping(view, pressKey("x"))
		expect(view.hasFocus).toBe(false)
	})

	it("ignores hidden editors", () => {
		let view = createEditor("Hello")
		vi.spyOn(view.dom, "getClientRects").mockReturnValue(emptyRects())
		focusEditorOnTyping(view, pressKey("x"))
		expect(view.hasFocus).toBe(false)
	})

	it("leaves keys typed into other fields alone", () => {
		let view = createEditor("Hello")
		let input = document.createElement("input")
		document.body.append(input)
		focusEditorOnTyping(view, pressKey("x", {}, input))
		expect(view.hasFocus).toBe(false)
	})

	it("leaves keys inside menus and dialogs alone", () => {
		let view = createEditor("Hello")
		let menu = document.createElement("div")
		menu.setAttribute("role", "menu")
		let item = document.createElement("div")
		menu.append(item)
		document.body.append(menu)
		focusEditorOnTyping(view, pressKey("x", {}, item))
		expect(view.hasFocus).toBe(false)
	})

	it("lets Space press a focused button", () => {
		let view = createEditor("Hello")
		let button = document.createElement("button")
		document.body.append(button)
		focusEditorOnTyping(view, pressKey(" ", {}, button))
		expect(view.hasFocus).toBe(false)
	})

	it("moves other keys from a focused button into the editor", () => {
		let view = createEditor("Hello")
		let button = document.createElement("button")
		document.body.append(button)
		focusEditorOnTyping(view, pressKey("x", {}, button))
		expect(view.hasFocus).toBe(true)
	})
})

function createEditor(doc: string, extensions: Extension[] = []) {
	let parent = document.createElement("div")
	document.body.append(parent)
	let view = new EditorView({
		state: EditorState.create({ doc, extensions }),
		parent,
	})
	views.push(view)
	return view
}

function pressKey(
	key: string,
	init: ConstructorParameters<typeof KeyboardEvent>[1] = {},
	target: Element = document.body,
) {
	let event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		...init,
	})
	target.dispatchEvent(event)
	return event
}

function pressHandledKey(key: string) {
	let event = new KeyboardEvent("keydown", { key, cancelable: true })
	event.preventDefault()
	return event
}

function emptyRects(): DOMRectList {
	return {
		length: 0,
		item: () => null,
		[Symbol.iterator]: [][Symbol.iterator],
	}
}
