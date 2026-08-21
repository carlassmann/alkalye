import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { afterEach, describe, expect, it } from "vitest"
import { deleteMarkerBackward, deleteMarkerForward } from "./marker-deletion"

let views: EditorView[] = []

afterEach(() => {
	for (let view of views) view.destroy()
	views = []
	document.body.innerHTML = ""
})

describe("marker-aware deletion", () => {
	it.each(["**", "~~", "`", "``"])(
		"backspace removes an empty %s pair",
		marker => {
			let view = createView(marker + marker, marker.length)

			expect(deleteMarkerBackward(view)).toBe(true)
			expect(view.state.doc.toString()).toBe("")
			expect(view.state.selection.main.head).toBe(0)
		},
	)

	it("delete removes an empty marker pair", () => {
		let view = createView("****", 2)

		expect(deleteMarkerForward(view)).toBe(true)
		expect(view.state.doc.toString()).toBe("")
	})

	it("delete removes a generated closer atomically", () => {
		let view = createView("**hello**", 7)

		expect(deleteMarkerForward(view)).toBe(true)
		expect(view.state.doc.toString()).toBe("**hello")
	})

	it("leaves ordinary text to the default keymap", () => {
		let view = createView("hello", 2)

		expect(deleteMarkerBackward(view)).toBe(false)
		expect(deleteMarkerForward(view)).toBe(false)
	})

	it("leaves multiple cursors to the default keymap", () => {
		let selection = EditorSelection.create([
			EditorSelection.cursor(2),
			EditorSelection.cursor(7),
		])
		let view = createView("**** ****", selection)

		expect(deleteMarkerBackward(view)).toBe(false)
		expect(deleteMarkerForward(view)).toBe(false)
		expect(view.state.selection.ranges.map(range => range.head)).toEqual([2, 7])
	})
})

function createView(
	content: string,
	selection: number | EditorSelection,
): EditorView {
	let parent = document.createElement("div")
	document.body.appendChild(parent)
	let state = EditorState.create({
		doc: content,
		extensions: [EditorState.allowMultipleSelections.of(true)],
		selection:
			typeof selection === "number"
				? EditorSelection.cursor(selection)
				: selection,
	})
	let view = new EditorView({ state, parent })
	views.push(view)
	return view
}
