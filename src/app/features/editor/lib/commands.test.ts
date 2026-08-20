import { indentLess, indentMore } from "@codemirror/commands"
import { indentUnit } from "@codemirror/language"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import {
	indentMarkdown,
	insertMarkdownBlock,
	insertNewlineContinueMarkupTight,
	outdentMarkdown,
} from "./commands"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { afterEach, describe, expect, it } from "vitest"

let views: EditorView[] = []

function createEditorView(content: string, cursorPos?: number): EditorView {
	let parent = document.createElement("div")
	document.body.appendChild(parent)
	let state = EditorState.create({
		doc: content,
		extensions: [indentUnit.of("  ")],
	})
	let view = new EditorView({
		state,
		parent,
	})
	if (cursorPos !== undefined) {
		view.dispatch({
			selection: { anchor: cursorPos },
		})
	}
	views.push(view)
	return view
}

afterEach(() => {
	views.forEach(view => view.destroy())
	views = []
	document.body.innerHTML = ""
})

describe("insertMarkdownBlock", () => {
	it("separates a block inserted before a heading", () => {
		let view = createEditorView("# Project Notes", 0)

		insertMarkdownBlock("![Cover](asset:co_asset)")(view)

		expect(view.state.doc.toString()).toBe(
			"![Cover](asset:co_asset)\n\n# Project Notes",
		)
	})

	it("separates a block from surrounding text", () => {
		let view = createEditorView("BeforeAfter", 6)

		insertMarkdownBlock("![Cover](asset:co_asset)")(view)

		expect(view.state.doc.toString()).toBe(
			"Before\n\n![Cover](asset:co_asset)\n\nAfter",
		)
	})
})

describe("indentMore", () => {
	it("indents bullet list items", () => {
		let view = createEditorView("- Item 1\n- Item 2", 2)
		indentMore(view)

		expect(view.state.doc.toString()).toBe("  - Item 1\n- Item 2")
	})

	it("indents multiple selected bullet list items", () => {
		let view = createEditorView("- Item 1\n- Item 2\n- Item 3", 0)
		view.dispatch({ selection: { anchor: 0, head: 20 } })
		indentMore(view)

		expect(view.state.doc.toString()).toBe("  - Item 1\n  - Item 2\n  - Item 3")
	})

	it("indents ordered list items", () => {
		let view = createEditorView("1. Item 1\n2. Item 2", 2)
		indentMore(view)

		expect(view.state.doc.toString()).toBe("  1. Item 1\n2. Item 2")
	})

	it("indents task list items", () => {
		let view = createEditorView("- [ ] Task 1\n- [x] Task 2", 2)
		indentMore(view)

		expect(view.state.doc.toString()).toBe("  - [ ] Task 1\n- [x] Task 2")
	})

	it("indents already indented list items", () => {
		let view = createEditorView("  - Item 1\n  - Item 2", 4)
		indentMore(view)

		expect(view.state.doc.toString()).toBe("    - Item 1\n  - Item 2")
	})

	it("indents mixed list types", () => {
		let view = createEditorView("- Bullet\n1. Ordered\n- [ ] Task", 0)
		view.dispatch({ selection: { anchor: 0, head: 30 } })
		indentMore(view)

		expect(view.state.doc.toString()).toBe(
			"  - Bullet\n  1. Ordered\n  - [ ] Task",
		)
	})

	it("indents non-list items too", () => {
		let view = createEditorView("Just text\nMore text", 5)
		indentMore(view)

		expect(view.state.doc.toString()).toBe("  Just text\nMore text")
	})

	it("handles single space indentation", () => {
		let view = createEditorView(" - Item 1\n - Item 2", 2)
		indentMore(view)

		expect(view.state.doc.toString()).toBe("   - Item 1\n - Item 2")
	})
})

describe("indentLess", () => {
	it("outdents indented bullet list items", () => {
		let view = createEditorView("  - Item 1\n  - Item 2", 4)
		indentLess(view)

		expect(view.state.doc.toString()).toBe("- Item 1\n  - Item 2")
	})

	it("outdents multiple selected indented list items", () => {
		let view = createEditorView("  - Item 1\n  - Item 2\n  - Item 3", 2)
		view.dispatch({ selection: { anchor: 2, head: 30 } })
		indentLess(view)

		expect(view.state.doc.toString()).toBe("- Item 1\n- Item 2\n- Item 3")
	})

	it("outdents ordered list items", () => {
		let view = createEditorView("  1. Item 1\n  2. Item 2", 4)
		indentLess(view)

		expect(view.state.doc.toString()).toBe("1. Item 1\n  2. Item 2")
	})

	it("outdents task list items", () => {
		let view = createEditorView("  - [ ] Task 1\n  - [x] Task 2", 4)
		indentLess(view)

		expect(view.state.doc.toString()).toBe("- [ ] Task 1\n  - [x] Task 2")
	})

	it("outdents deeply nested list items", () => {
		let view = createEditorView("    - Item 1\n    - Item 2", 6)
		indentLess(view)

		expect(view.state.doc.toString()).toBe("  - Item 1\n    - Item 2")
	})

	it("does nothing for non-indented items", () => {
		let view = createEditorView("- Item 1\n- Item 2", 2)
		indentLess(view)

		expect(view.state.doc.toString()).toBe("- Item 1\n- Item 2")
	})

	it("does nothing for non-indented non-list items", () => {
		let view = createEditorView("Just text\nMore text", 5)
		indentLess(view)

		expect(view.state.doc.toString()).toBe("Just text\nMore text")
	})

	it("handles mixed indentation levels", () => {
		let view = createEditorView("  - Item 1\n    - Item 2\n- Item 3", 2)
		view.dispatch({ selection: { anchor: 2, head: 25 } })
		indentLess(view)

		expect(view.state.doc.toString()).toBe("- Item 1\n  - Item 2\n- Item 3")
	})
})

describe("contextual Tab", () => {
	it("leaves plain single-line text for focus navigation", () => {
		let view = createMarkdownEditorView("Plain text", 5)
		let nextButton = document.createElement("button")
		document.body.appendChild(nextButton)
		view.focus()

		expect(indentMarkdown(view)).toBe(true)
		expect(view.state.doc.toString()).toBe("Plain text")
		expect(document.activeElement).toBe(nextButton)
	})

	it("indents list items", () => {
		let view = createMarkdownEditorView("- Item", 3)

		expect(indentMarkdown(view)).toBe(true)
		expect(view.state.doc.toString()).toBe("  - Item")
	})

	it("indents code blocks", () => {
		let view = createMarkdownEditorView("```\ncode\n```", 6)

		expect(indentMarkdown(view)).toBe(true)
		expect(view.state.doc.toString()).toBe("```\n  code\n```")
	})

	it("outdents contextual content", () => {
		let list = createMarkdownEditorView("  - Item", 4)

		expect(outdentMarkdown(list)).toBe(true)
		expect(list.state.doc.toString()).toBe("- Item")
	})

	it("uses Shift-Tab for reverse focus navigation in plain text", () => {
		let previousButton = document.createElement("button")
		document.body.appendChild(previousButton)
		let plain = createMarkdownEditorView("  Plain", 4)

		plain.focus()

		expect(outdentMarkdown(plain)).toBe(true)
		expect(plain.state.doc.toString()).toBe("  Plain")
		expect(document.activeElement).toBe(previousButton)
	})
})

function createMarkdownEditorView(
	content: string,
	cursorPos?: number,
): EditorView {
	let parent = document.createElement("div")
	document.body.appendChild(parent)
	let state = EditorState.create({
		doc: content,
		extensions: [
			indentUnit.of("  "),
			markdown({ base: markdownLanguage, addKeymap: false }),
		],
	})
	let view = new EditorView({
		state,
		parent,
	})
	if (cursorPos !== undefined) {
		view.dispatch({
			selection: { anchor: cursorPos },
		})
	}
	views.push(view)
	return view
}

describe("insertNewlineContinueMarkupTight", () => {
	it("single task item - should NOT add blank line", () => {
		let content = "- [ ] First task"
		let view = createMarkdownEditorView(content, content.length)
		insertNewlineContinueMarkupTight(view)

		expect(view.state.doc.toString()).toBe("- [ ] First task\n- [ ] ")
	})

	it("two task items (tight) - should NOT add blank line", () => {
		let content = "- [ ] First task\n- [ ] Second task"
		let view = createMarkdownEditorView(content, content.length)
		insertNewlineContinueMarkupTight(view)

		expect(view.state.doc.toString()).toBe(
			"- [ ] First task\n- [ ] Second task\n- [ ] ",
		)
	})

	it("loose list - should NOT add blank line (forced tight)", () => {
		let content = "- [ ] First task\n\n- [ ] Second task"
		let view = createMarkdownEditorView(content, content.length)
		insertNewlineContinueMarkupTight(view)

		// Now forced to be tight
		expect(view.state.doc.toString()).toBe(
			"- [ ] First task\n\n- [ ] Second task\n- [ ] ",
		)
	})

	it("cursor at first item in loose list - should NOT add blank line", () => {
		// User has a loose list (blank line between items)
		// Cursor is at "Task" in first item
		let content = "- [ ] Task\n\n- [ ] another task"
		let cursorPos = 10 // end of "Task"
		let view = createMarkdownEditorView(content, cursorPos)
		insertNewlineContinueMarkupTight(view)

		// With tight enforcement: no blank line before new marker
		expect(view.state.doc.toString()).toBe(
			"- [ ] Task\n- [ ] \n\n- [ ] another task",
		)
	})

	it("bullet list - should NOT add blank line", () => {
		let content = "- First item\n\n- Second item"
		let view = createMarkdownEditorView(content, 12) // end of "First item"
		insertNewlineContinueMarkupTight(view)

		expect(view.state.doc.toString()).toBe("- First item\n- \n\n- Second item")
	})

	it("ordered list - should NOT add blank line", () => {
		let content = "1. First item\n\n2. Second item"
		let view = createMarkdownEditorView(content, 13) // end of "First item"
		insertNewlineContinueMarkupTight(view)

		// CodeMirror renumbers the list items
		expect(view.state.doc.toString()).toBe(
			"1. First item\n2. \n\n3. Second item",
		)
	})
})
