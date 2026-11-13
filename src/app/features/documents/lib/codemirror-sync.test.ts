import { afterEach, expect, test, vi } from "vitest"
import { EditorState, EditorSelection } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { history, undo } from "@codemirror/commands"
import { codeMirrorSync, minimalChanges } from "./codemirror-sync"

let views: EditorView[] = []
afterEach(() => {
	for (let view of views) view.destroy()
	views = []
	document.body.replaceChildren()
})

function editor(initial: string) {
	let write = vi.fn()
	let sync = codeMirrorSync(initial, write)
	let parent = document.body.appendChild(document.createElement("div"))
	let view = new EditorView({
		parent,
		state: EditorState.create({
			doc: initial,
			extensions: [history(), sync.extension],
		}),
	})
	sync.attach(view)
	views.push(view)
	return { view, sync, write }
}

test("writes each edit against the last shown value and ignores delayed echoes", () => {
	let { view, sync, write } = editor("Hello")
	view.dispatch({ changes: { from: 5, insert: "!" } })
	view.dispatch({ changes: { from: 6, insert: "!" } })
	expect(write.mock.calls).toEqual([
		["Hello!", "Hello"],
		["Hello!!", "Hello!"],
	])
	sync.apply("Hello!")
	expect(view.state.doc.toString()).toBe("Hello!!")
	sync.apply("Hello!!")
	sync.apply("Hello!! Remote")
	expect(view.state.doc.toString()).toBe("Hello!! Remote")
	expect(write).toHaveBeenCalledTimes(2)
})

test("maps selections through incoming changes and keeps them out of undo", () => {
	let { view, sync, write } = editor("alpha middle omega")
	view.dispatch({ selection: EditorSelection.range(6, 12) })
	sync.apply("new alpha middle omega!")
	expect(
		view.state.sliceDoc(
			view.state.selection.main.from,
			view.state.selection.main.to,
		),
	).toBe("middle")
	expect(write).not.toHaveBeenCalled()
	expect(undo(view)).toBe(false)
	view.dispatch({ changes: { from: view.state.doc.length, insert: "?" } })
	expect(undo(view)).toBe(true)
	expect(view.state.doc.toString()).toBe("new alpha middle omega!")
})

test("holds incoming values during composition, then writes the composed change first", async () => {
	let { view, sync, write } = editor("A")
	view.contentDOM.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true }),
	)
	sync.apply("Remote A")
	expect(view.state.doc.toString()).toBe("A")
	view.dispatch({ changes: { from: 1, insert: "語" } })
	expect(write).toHaveBeenCalledWith("A語", "A")
	view.contentDOM.dispatchEvent(
		new CompositionEvent("compositionend", { bubbles: true }),
	)
	await Promise.resolve()
	expect(view.state.doc.toString()).toBe("A語")
	sync.apply("Remote A語")
	expect(view.state.doc.toString()).toBe("Remote A語")
})

test("diff keeps separate edits small and preserves Unicode", () => {
	expect(minimalChanges("one middle two", "ONE middle TWO")).toEqual([
		{ from: 0, to: 3, insert: "ONE" },
		{ from: 11, to: 14, insert: "TWO" },
	])
	let { view, sync } = editor("A 👩🏽‍💻 Z")
	sync.apply("B 👩🏽‍💻 Q")
	expect(view.state.doc.toString()).toBe("B 👩🏽‍💻 Q")
})

test("applies sequential UTF-16 splices and preserves the selected text", () => {
	let { view, sync, write } = editor("A 👩🏽‍💻 middle Z")
	let previous = view.state.doc.toString()
	let start = previous.indexOf("middle")
	view.dispatch({ selection: EditorSelection.range(start, start + 6) })
	sync.apply("new A 👩🏽‍💻 middle! Z", {
		previous,
		splices: [
			{ at: 0, delete: 0, insert: "new " },
			{ at: start + 10, delete: 0, insert: "!" },
		],
	})
	expect(view.state.doc.toString()).toBe("new A 👩🏽‍💻 middle! Z")
	expect(
		view.state.sliceDoc(
			view.state.selection.main.from,
			view.state.selection.main.to,
		),
	).toBe("middle")
	expect(write).not.toHaveBeenCalled()
	expect(undo(view)).toBe(false)
})

test("falls back to a diff when a render skipped a subscription update", () => {
	let { view, sync } = editor("middle")
	sync.apply("new middle!", {
		previous: "new middle",
		splices: [{ at: 10, delete: 0, insert: "!" }],
	})
	expect(view.state.doc.toString()).toBe("new middle!")
})
