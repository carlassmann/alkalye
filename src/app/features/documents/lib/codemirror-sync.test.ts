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

test("ignores repeated pre-write snapshots while local text is pending", () => {
	let { view, sync } = editor("Hello")
	view.dispatch({ changes: { from: 5, insert: "!" } })
	sync.apply("Hello")
	expect(view.state.doc.toString()).toBe("Hello!")
	view.dispatch({ changes: { from: 6, insert: "!" } })
	sync.apply("Hello!")
	sync.apply("Hello!")
	expect(view.state.doc.toString()).toBe("Hello!!")
	sync.apply("Hello!!")
	sync.apply("Hello!")
	expect(view.state.doc.toString()).toBe("Hello!")
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

test("large multi-range edits carry a replacement against their exact editor base", () => {
	let original = "a😀é paragraph\n".repeat(4096)
	let { view, write } = editor(original)
	view.dispatch({
		changes: [
			{ from: 0, insert: "prefix " },
			{ from: 25, to: 28, insert: "XYZ" },
		],
	})
	let result = view.state.doc.toString()
	expect(write).toHaveBeenCalledWith(result, original, {
		from: 0,
		to: 28,
		insert: result.slice(0, 35),
	})
})

test("keeps local text visible until asynchronous writes expose their merged snapshot", async () => {
	let complete: (() => void)[] = []
	let binding = codeMirrorSync(
		"A",
		() => new Promise<void>(resolve => complete.push(resolve)),
	)
	let view = new EditorView({
		state: EditorState.create({ doc: "A", extensions: [binding.extension] }),
	})
	binding.attach(view)
	views.push(view)
	view.dispatch({ changes: { from: 1, insert: "B" } })
	binding.apply("remote A")
	expect(view.state.doc.toString()).toBe("AB")
	view.dispatch({ changes: { from: 2, insert: "C" } })
	binding.apply("remote AB")
	complete[0]!()
	await Promise.resolve()
	expect(view.state.doc.toString()).toBe("ABC")
	binding.apply("remote ABC")
	complete[1]!()
	await Promise.resolve()
	expect(view.state.doc.toString()).toBe("remote ABC")
})

test("acknowledges overlapping writes before applying a remote undo", async () => {
	let finishFirst = () => {}
	let finishSecond = () => {}
	let first = new Promise<void>(resolve => {
		finishFirst = resolve
	})
	let second = new Promise<void>(resolve => {
		finishSecond = resolve
	})
	let write = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
	let binding = codeMirrorSync("A", write)
	let view = new EditorView({
		state: EditorState.create({ doc: "A", extensions: [binding.extension] }),
	})
	binding.attach(view)
	views.push(view)
	view.dispatch({ changes: { from: 1, insert: "B" } })
	view.dispatch({ changes: { from: 2, insert: "C" } })
	let idle = vi.fn()
	let finished = binding.whenIdle().then(idle)
	binding.apply("AB")
	binding.apply("ABC")
	binding.apply("AB")
	finishFirst()
	await Promise.resolve()
	expect(idle).not.toHaveBeenCalled()
	expect(view.state.doc.toString()).toBe("ABC")
	finishSecond()
	await finished
	expect(view.state.doc.toString()).toBe("AB")
	expect(idle).toHaveBeenCalledOnce()
})
