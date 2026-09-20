import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { expect, it } from "vitest"
import { selectNextOccurrence } from "./multiple-selections"

it("returns to the original range after selecting all matches without dropping cursors", () => {
	let view = new EditorView({
		state: EditorState.create({
			doc: "web web web",
			selection: EditorSelection.range(4, 7),
			extensions: EditorState.allowMultipleSelections.of(true),
		}),
	})
	try {
		expect(selectNextOccurrence(view)).toBe(true)
		expect(selectNextOccurrence(view)).toBe(true)
		expect(view.state.selection.ranges).toHaveLength(3)
		let selection = view.state.selection
		let effects: unknown[] = []
		view.dispatch = transaction => {
			if ("effects" in transaction) effects.push(transaction.effects)
		}
		expect(selectNextOccurrence(view)).toBe(true)
		expect(effects).toHaveLength(1)
		expect(view.state.selection.eq(selection)).toBe(true)
		expect(view.state.selection.main.from).toBe(4)
	} finally {
		view.destroy()
	}
})

it("still selects the word when starting with a collapsed cursor", () => {
	let view = new EditorView({
		state: EditorState.create({ doc: "web web", selection: { anchor: 1 } }),
	})
	try {
		expect(selectNextOccurrence(view)).toBe(true)
		expect(view.state.selection.main.from).toBe(0)
		expect(view.state.selection.main.to).toBe(3)
	} finally {
		view.destroy()
	}
})
