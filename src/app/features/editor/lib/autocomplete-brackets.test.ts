import { history, undo } from "@codemirror/commands"
import {
	EditorSelection,
	EditorState,
	type Extension,
	type SelectionRange,
} from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { afterEach, describe, expect, it } from "vitest"
import { insertSmartDelimiter } from "./autocomplete-brackets"

let views: EditorView[] = []

afterEach(() => {
	views.forEach(view => view.destroy())
	views = []
	document.body.innerHTML = ""
})

describe("smart delimiter input", () => {
	it("wraps a forward selection in brackets", () => {
		let view = createView("hello", EditorSelection.range(0, 5))

		expect(insertSmartDelimiter(view, "[")).toBe(true)
		expect(view.state.doc.toString()).toBe("[hello]")
		expect(selectedText(view)).toBe("hello")
	})

	it("preserves a reverse selection", () => {
		let view = createView("hello", EditorSelection.range(5, 0))

		insertSmartDelimiter(view, "[")

		expect(view.state.doc.toString()).toBe("[hello]")
		expect(view.state.selection.main.anchor).toBe(6)
		expect(view.state.selection.main.head).toBe(1)
	})

	it("wraps multiline selections", () => {
		let view = createView("one\ntwo", EditorSelection.range(0, 7))

		insertSmartDelimiter(view, "[")

		expect(view.state.doc.toString()).toBe("[one\ntwo]")
		expect(selectedText(view)).toBe("one\ntwo")
	})

	it("inserts a raw bracket at an empty cursor", () => {
		let view = createView("hello", EditorSelection.cursor(2))

		insertSmartDelimiter(view, "[")

		expect(view.state.doc.toString()).toBe("he[llo")
		expect(view.state.selection.main.head).toBe(3)
	})

	it("upgrades a bracketed selection to a complete wikilink", () => {
		let view = createView("[hello]", EditorSelection.range(1, 6))

		insertSmartDelimiter(view, "[")

		expect(view.state.doc.toString()).toBe("[[hello]]")
		expect(view.state.selection.main.head).toBe(7)
	})

	it("upgrades repeated emphasis delimiters", () => {
		let view = createView("hello", EditorSelection.range(0, 5))

		insertSmartDelimiter(view, "*")
		insertSmartDelimiter(view, "*")

		expect(view.state.doc.toString()).toBe("**hello**")
		expect(selectedText(view)).toBe("hello")
	})

	it("upgrades repeated tildes to strikethrough", () => {
		let view = createView("hello", EditorSelection.range(0, 5))

		insertSmartDelimiter(view, "~")
		insertSmartDelimiter(view, "~")

		expect(view.state.doc.toString()).toBe("~~hello~~")
		expect(selectedText(view)).toBe("hello")
	})

	it.each([
		["_", "_hello_"],
		["~", "~hello~"],
		["<", "<hello>"],
	])("wraps a selection typed with %s", (delimiter, expected) => {
		let view = createView("hello", EditorSelection.range(0, 5))

		insertSmartDelimiter(view, delimiter)

		expect(view.state.doc.toString()).toBe(expected)
		expect(selectedText(view)).toBe("hello")
	})

	it("leaves unsupported empty selections to CodeMirror", () => {
		let view = createView("hello", EditorSelection.cursor(2))

		expect(insertSmartDelimiter(view, "*")).toBe(false)
		expect(view.state.doc.toString()).toBe("hello")
	})

	it("uses a safe code-span delimiter", () => {
		let view = createView("`hello`", EditorSelection.range(0, 7))

		insertSmartDelimiter(view, "`")

		expect(view.state.doc.toString()).toBe("`` `hello` ``")
		expect(selectedText(view)).toBe("`hello`")
	})

	it("turns bracketed text into a link target", () => {
		let view = createView("[hello]", EditorSelection.range(1, 6))

		insertSmartDelimiter(view, "(")

		expect(view.state.doc.toString()).toBe("[hello](url)")
		expect(selectedText(view)).toBe("url")
	})

	it("wraps multiple selections", () => {
		let selection = EditorSelection.create([
			EditorSelection.range(0, 3),
			EditorSelection.range(4, 7),
		])
		let view = createView("one two", selection, [
			EditorState.allowMultipleSelections.of(true),
		])

		insertSmartDelimiter(view, "[")

		expect(view.state.doc.toString()).toBe("[one] [two]")
		expect(
			view.state.selection.ranges.map(range =>
				view.state.sliceDoc(range.from, range.to),
			),
		).toEqual(["one", "two"])
	})

	it("creates one undo step", () => {
		let view = createView("hello", EditorSelection.range(0, 5), [history()])

		insertSmartDelimiter(view, "[")
		undo(view)

		expect(view.state.doc.toString()).toBe("hello")
	})

	it("never changes a read-only document", () => {
		let view = createView("hello", EditorSelection.range(0, 5), [
			EditorState.readOnly.of(true),
		])

		expect(insertSmartDelimiter(view, "[")).toBe(false)
		expect(view.state.doc.toString()).toBe("hello")
	})

	it("can disable pair wrapping independently", () => {
		let view = createView("hello", EditorSelection.range(0, 5))

		expect(
			insertSmartDelimiter(view, "[", {
				smartPairs: false,
				markerWrapping: true,
			}),
		).toBe(false)
		expect(
			insertSmartDelimiter(view, "*", {
				smartPairs: false,
				markerWrapping: true,
			}),
		).toBe(true)
		expect(view.state.doc.toString()).toBe("*hello*")
	})

	it("can disable marker wrapping independently", () => {
		let view = createView("hello", EditorSelection.range(0, 5))

		expect(
			insertSmartDelimiter(view, "*", {
				smartPairs: true,
				markerWrapping: false,
			}),
		).toBe(false)
		expect(
			insertSmartDelimiter(view, "[", {
				smartPairs: true,
				markerWrapping: false,
			}),
		).toBe(true)
		expect(view.state.doc.toString()).toBe("[hello]")
	})
})

function createView(
	content: string,
	selection: EditorSelection | SelectionRange,
	extensions: Extension[] = [],
): EditorView {
	let parent = document.createElement("div")
	document.body.appendChild(parent)
	let editorSelection =
		selection instanceof EditorSelection
			? selection
			: EditorSelection.create([selection])
	let state = EditorState.create({
		doc: content,
		selection: editorSelection,
		extensions,
	})
	let view = new EditorView({ state, parent })
	views.push(view)
	return view
}

function selectedText(view: EditorView): string {
	let selection = view.state.selection.main
	return view.state.sliceDoc(selection.from, selection.to)
}
