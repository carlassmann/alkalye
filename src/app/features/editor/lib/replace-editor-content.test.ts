import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { history, undo } from "@codemirror/commands"
import { expect, test } from "vitest"
import { applyContentPreservingSelection } from "./replace-editor-content"

test("external edits map the cursor and survive undoing local typing", () => {
	let view = new EditorView({
		state: EditorState.create({ doc: "Title\nBody", extensions: [history()] }),
	})
	try {
		view.dispatch({
			changes: { from: 10, insert: " local" },
			selection: { anchor: 16 },
		})
		applyContentPreservingSelection(view, "New Title\nBody local", true)
		expect(view.state.selection.main.head).toBe(20)
		expect(undo(view)).toBe(true)
		expect(view.state.doc.toString()).toBe("New Title\nBody")
		expect(undo(view)).toBe(false)
	} finally {
		view.destroy()
	}
})
