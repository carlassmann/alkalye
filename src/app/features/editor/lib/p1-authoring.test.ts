import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorSelection, EditorState, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { currentCompletions } from "@codemirror/autocomplete"
import { afterEach, describe, expect, it } from "vitest"
import {
	clearFormatting,
	demoteHeading,
	insertCodeBlock,
	insertBlankLineAbove,
	insertLink,
	insertMarkdownLineBreak,
	promoteHeading,
	setBody,
	setHeadingLevel,
	toggleBold,
	toggleBulletList,
	toggleTaskComplete,
} from "./commands"
import { moveMarkdownBlockDown, moveMarkdownBlockUp } from "./block-movement"
import { setLastCodeLanguage } from "./code-language-autocomplete"
import {
	findExtension,
	getFindState,
	replaceAllMatches,
	setFindQuery,
} from "./find-extension"
import { htmlToMarkdown } from "./html-to-markdown"
import { renumberOrderedLists } from "./ordered-list-renumbering"
import { insertPastedText, insertRawPastedText } from "./paste-commands"
import {
	expandMarkdownSelection,
	shrinkMarkdownSelection,
} from "./selection-commands"
import { createSpellcheckExtension } from "./spellcheck"
import { createSlashCommands } from "./slash-commands"
import { insertTable, insertTableRow, moveTableCell } from "./table-commands"
import { combinedAutocompletion } from "@/app/lib/completion-sources"

let views: EditorView[] = []

afterEach(() => {
	for (let view of views) view.destroy()
	views = []
	document.body.innerHTML = ""
	setLastCodeLanguage("")
})

describe("P1 authoring commands", () => {
	it("formats the current word and removes the whole enclosing span", () => {
		let view = createView("one two", 5)
		toggleBold(view)
		expect(text(view)).toBe("one **two**")
		view.dispatch({ selection: { anchor: 7 } })
		toggleBold(view)
		expect(text(view)).toBe("one two")
	})

	it("clears inline formatting", () => {
		let view = createView("**bold** and _italic_", { anchor: 0, head: 21 })
		clearFormatting(view)
		expect(text(view)).toBe("bold and italic")
	})

	it("promotes and demotes multiple headings", () => {
		let view = createView("## Two\n### Three", { anchor: 0, head: 15 })
		promoteHeading(view)
		expect(text(view)).toBe("# Two\n## Three")
		demoteHeading(view)
		expect(text(view)).toBe("## Two\n### Three")
	})

	it("applies and clears block formats across selected lines", () => {
		let view = createView("One\nTwo", { anchor: 0, head: 7 })
		toggleBulletList(view)
		expect(text(view)).toBe("- One\n- Two")
		setHeadingLevel(2)(view)
		expect(text(view)).toBe("## One\n## Two")
		setBody(view)
		expect(text(view)).toBe("One\nTwo")
	})

	it("toggles every selected task", () => {
		let view = createView("- [ ] One\n- [x] Two", { anchor: 0, head: 19 })
		toggleTaskComplete(view)
		expect(text(view)).toBe("- [x] One\n- [x] Two")
	})

	it("creates a safe fence and remembers the last language", () => {
		setLastCodeLanguage("ts")
		let view = createView("value ``` inside", { anchor: 0, head: 16 })
		insertCodeBlock(view)
		expect(text(view)).toBe("````ts\nvalue ``` inside\n````")
		expect(
			view.state.sliceDoc(
				view.state.selection.main.from,
				view.state.selection.main.to,
			),
		).toBe("ts")
	})

	it("inserts a Markdown hard break without continuing a list", () => {
		let view = createView("- item", 6)
		insertMarkdownLineBreak(view)
		expect(text(view)).toBe("- item  \n")
	})

	it("inserts a blank line above", () => {
		let view = createView("One\nTwo", 6)
		insertBlankLineAbove(view)
		expect(text(view)).toBe("One\n\nTwo")
		expect(view.state.selection.main.head).toBe(4)
	})

	it("formats every selection range", () => {
		let view = createView(
			"one two",
			EditorSelection.create([
				EditorSelection.range(0, 3),
				EditorSelection.range(4, 7),
			]),
		)
		toggleBold(view)
		expect(text(view)).toBe("**one** **two**")
	})

	it("edits an existing link destination and optional title", () => {
		let view = createView('[site](https://example.com "Title")', 3)
		insertLink(view)
		expect(
			view.state.sliceDoc(
				view.state.selection.main.from,
				view.state.selection.main.to,
			),
		).toBe('https://example.com "Title"')
		expect(text(view)).toBe('[site](https://example.com "Title")')
	})

	it("moves whole paragraph and nested-list blocks", () => {
		let paragraph = createView("First wrapped\nparagraph\n\nSecond", 2)
		moveMarkdownBlockDown(paragraph)
		expect(text(paragraph)).toBe("Second\n\nFirst wrapped\nparagraph")

		let list = createView("- Parent\n  - Child\n- Sibling", 2)
		moveMarkdownBlockDown(list)
		expect(text(list)).toBe("- Sibling\n- Parent\n  - Child")
		moveMarkdownBlockUp(list)
		expect(text(list)).toBe("- Parent\n  - Child\n- Sibling")
	})

	it("renumbers ordered lists including nested levels", () => {
		expect(renumberOrderedLists("4. A\n9. B\n  8. B1\n  2. B2\n7. C")).toBe(
			"1. A\n2. B\n  1. B1\n  2. B2\n3. C",
		)
	})

	it("inserts and navigates a table, then adds a row", () => {
		let view = createView("")
		insertTable(view)
		expect(text(view)).toContain("| Column 1 | Column 2 |")
		moveTableCell(view, 1)
		expect(
			view.state.sliceDoc(
				view.state.selection.main.from,
				view.state.selection.main.to,
			),
		).toBe("Column 2")
		view.dispatch({ selection: { anchor: text(view).length - 2 } })
		insertTableRow(view)
		expect(text(view).split("\n")).toHaveLength(4)
	})

	it("offers every slash block command after typing slash", async () => {
		let view = createView("", undefined, [
			createSlashCommands(),
			combinedAutocompletion(),
		])
		view.dispatch({
			changes: { from: 0, insert: "/" },
			selection: { anchor: 1 },
			userEvent: "input.type",
		})
		await waitForCompletions(view)
		expect(
			currentCompletions(view.state)
				.map(option => option.label)
				.sort(),
		).toEqual([
			"Bullet list",
			"Code block",
			"Comment",
			"Divider",
			"Heading 1",
			"Heading 2",
			"Heading 3",
			"Image",
			"Ordered list",
			"Paragraph",
			"Quote",
			"Table",
			"Task",
			"Wikilink",
		])
	})

	it("expands and shrinks selection hierarchically", () => {
		let view = createView("A **bold word** here", 8)
		expandMarkdownSelection(view)
		expect(
			view.state.sliceDoc(
				view.state.selection.main.from,
				view.state.selection.main.to,
			),
		).toBe("bold")
		expandMarkdownSelection(view)
		expect(
			view.state.selection.main.to - view.state.selection.main.from,
		).toBeGreaterThan(4)
		shrinkMarkdownSelection(view)
		expect(
			view.state.sliceDoc(
				view.state.selection.main.from,
				view.state.selection.main.to,
			),
		).toBe("bold")
	})

	it("converts rich HTML to Markdown", () => {
		expect(
			htmlToMarkdown(
				"<h2>Title</h2><p><strong>Bold</strong> and <a href='https://example.com'>link</a></p>",
			),
		).toBe("## Title\n\n**Bold** and [link](https://example.com)")
	})

	it("turns a pasted URL over every selection into links", () => {
		let view = createView(
			"one two",
			EditorSelection.create([
				EditorSelection.range(0, 3),
				EditorSelection.range(4, 7),
			]),
		)
		insertPastedText(view, "https://example.com")
		expect(text(view)).toBe(
			"[one](https://example.com) [two](https://example.com)",
		)
	})

	it("pastes URLs literally when smart paste is disabled", () => {
		let view = createView("label", EditorSelection.range(0, 5))

		insertRawPastedText(view, "https://example.com")

		expect(text(view)).toBe("https://example.com")
	})

	it("replaces only matches inside the requested selection", () => {
		let view = createView("one cat two cat three cat", undefined, [
			findExtension,
		])
		setFindQuery(view, "cat", false, false)
		expect(getFindState(view).matches).toHaveLength(3)
		replaceAllMatches(view, "dog", { from: 5, to: 20 })
		expect(text(view)).toBe("one cat two dog three cat")
	})

	it("sets language-aware spellcheck and disables code/frontmatter", () => {
		let view = createView(
			"---\ntitle: Helo\n---\nBody mispelled\n```\nconst x = nope\n```",
			undefined,
			[createSpellcheckExtension(true, "en")],
		)
		expect(view.contentDOM.getAttribute("spellcheck")).toBe("true")
		expect(view.contentDOM.getAttribute("lang")).toBe("en")
		expect(
			view.contentDOM.querySelectorAll('[spellcheck="false"]').length,
		).toBeGreaterThan(0)
	})
})

type Selection = number | { anchor: number; head: number } | EditorSelection

function createView(
	doc: string,
	selection?: Selection,
	extensions: Extension[] = [],
): EditorView {
	let parent = document.createElement("div")
	document.body.appendChild(parent)
	let state = EditorState.create({
		doc,
		selection:
			typeof selection === "number" ? { anchor: selection } : selection,
		extensions: [
			EditorState.allowMultipleSelections.of(true),
			markdown({ base: markdownLanguage, addKeymap: false }),
			...extensions,
		],
	})
	let view = new EditorView({ state, parent })
	views.push(view)
	return view
}

function text(view: EditorView): string {
	return view.state.doc.toString()
}

async function waitForCompletions(view: EditorView): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt++) {
		if (currentCompletions(view.state).length > 0) return
		await new Promise(resolve => setTimeout(resolve, 10))
	}
}
