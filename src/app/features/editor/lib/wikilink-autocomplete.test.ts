import {
	closeCompletion,
	CompletionContext,
	currentCompletions,
	startCompletion,
} from "@codemirror/autocomplete"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorState, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import {
	createWikilinkAutocomplete,
	getWikilinkCompletions,
} from "./wikilink-autocomplete"
import { createImageAutocomplete } from "@/app/features/assets/lib/image-autocomplete"
import { insertSmartDelimiter } from "./autocomplete-brackets"
import { refreshDocumentLinks } from "./refresh-document-links"
import { createCodeLanguageAutocomplete } from "./code-language-autocomplete"
import { createWikilinkDecorations } from "./wikilink-decorations"
import { combinedAutocompletion } from "@/app/lib/completion-sources"

let views: EditorView[] = []

beforeAll(() => {
	window.Range.prototype.getClientRects = () => document.body.getClientRects()
})

afterEach(() => {
	views.forEach(view => view.destroy())
	views = []
	document.body.innerHTML = ""
})

describe("wikilink autocomplete", () => {
	it("keeps explicit language completion until the fence is deleted", async () => {
		let view = createView("```", 3, [
			combinedAutocompletion(),
			createCodeLanguageAutocomplete(),
		])
		startCompletion(view)
		await waitForCompletion(view)
		expect(currentCompletions(view.state).length).toBeGreaterThan(0)
		view.dispatch({
			changes: { from: 3, insert: "py" },
			selection: { anchor: 5 },
			userEvent: "input.type",
		})
		view.dispatch({
			changes: { from: 3, to: 5 },
			selection: { anchor: 3 },
			userEvent: "delete.backward",
		})
		expect(currentCompletions(view.state).length).toBeGreaterThan(0)
		view.dispatch({
			changes: { from: 2, to: 3 },
			selection: { anchor: 2 },
			userEvent: "delete.backward",
		})
		await waitForCompletion(view)
		expect(currentCompletions(view.state)).toEqual([])
	})

	it.each(["```", "~~~"])(
		"waits for a language prefix after %s",
		async fence => {
			let view = createView("", 0, [
				combinedAutocompletion(),
				createCodeLanguageAutocomplete(),
			])
			view.dispatch({
				changes: { from: 0, insert: fence },
				selection: { anchor: fence.length },
				userEvent: "input.type",
			})
			await waitForCompletion(view)
			expect(currentCompletions(view.state)).toEqual([])

			view.dispatch({
				changes: { from: fence.length, insert: "py" },
				selection: { anchor: fence.length + 2 },
				userEvent: "input.type",
			})
			await waitForCompletion(view)
			expect(
				currentCompletions(view.state).map(option => option.label),
			).toContain("python")

			view.dispatch({
				changes: { from: fence.length, to: fence.length + 2 },
				selection: { anchor: fence.length },
				userEvent: "delete.backward",
			})
			await waitForCompletion(view)
			expect(currentCompletions(view.state)).toEqual([])
		},
	)

	it.each(["[[", "![", "```"])(
		"keeps %s suggestions open when document links refresh",
		async content => {
			let view = createView(content, content.length, [
				combinedAutocompletion(),
				createWikilinkAutocomplete(() => [{ id: "co_notes", title: "Notes" }]),
				createImageAutocomplete(() => [{ id: "co_image", name: "Photo" }]),
				createCodeLanguageAutocomplete(),
			])
			startCompletion(view)
			await waitForCompletion(view)
			let suggestions = currentCompletions(view.state)
			expect(suggestions.length).toBeGreaterThan(0)

			view.dispatch({ effects: refreshDocumentLinks.of(null) })

			expect(currentCompletions(view.state)).toEqual(suggestions)
		},
	)

	it("refreshes document titles without moving the selection", () => {
		let title = "Old title"
		let view = createView("[[co_notes]]\n", 13, [
			markdown({ base: markdownLanguage, addKeymap: false }),
			createWikilinkDecorations(
				() => ({ title, exists: true }),
				() => {},
			),
		])
		expect(view.dom.querySelector(".cm-wikilink")?.textContent).toBe(title)
		title = "New title"

		view.dispatch({ effects: refreshDocumentLinks.of(null) })

		expect(view.dom.querySelector(".cm-wikilink")?.textContent).toBe(title)
		expect(view.state.selection.main.head).toBe(13)
	})

	it("searches titles, paths, ids, and tags", () => {
		let documents = [
			{
				id: "co_project",
				title: "Roadmap",
				path: "Work/Project",
				tags: ["planning"],
			},
			{ id: "co_notes", title: "Notes", tags: ["personal"] },
		]

		expect(labelsFor("[[road", documents)).toEqual(["Roadmap"])
		expect(labelsFor("[[project", documents)).toEqual(["Roadmap"])
		expect(labelsFor("[[planning", documents)).toEqual(["Roadmap"])
		expect(labelsFor("[[co_notes", documents)).toEqual(["Notes"])
	})

	it("inserts the document id and closes the wikilink", () => {
		let view = createView("[[Road")
		let context = new CompletionContext(
			view.state,
			view.state.doc.length,
			true,
			view,
		)
		let result = getWikilinkCompletions(context, [
			{ id: "co_roadmap", title: "Roadmap" },
		])

		expect(result).not.toBeNull()
		let completion = result?.options[0]
		if (completion && typeof completion.apply === "function") {
			completion.apply(view, completion, result?.from ?? 0, context.pos)
		}

		expect(view.state.doc.toString()).toBe("[[co_roadmap]]")
		expect(view.state.selection.main.head).toBe(14)
	})

	it("reuses existing closing brackets", () => {
		let view = createView("[[Road]]", 6)
		let context = new CompletionContext(view.state, 6, true, view)
		let result = getWikilinkCompletions(context, [
			{ id: "co_roadmap", title: "Roadmap" },
		])
		let completion = result?.options[0]
		if (completion && typeof completion.apply === "function") {
			completion.apply(view, completion, result?.from ?? 0, context.pos)
		}

		expect(view.state.doc.toString()).toBe("[[co_roadmap]]")
		expect(view.state.selection.main.head).toBe(14)
	})

	it("activates alongside other completion sources while typing", async () => {
		let documents = [{ id: "co_roadmap", title: "Roadmap" }]
		let view = createView("", 0, [
			markdown({ base: markdownLanguage, addKeymap: false }),
			combinedAutocompletion(),
			createWikilinkAutocomplete(() => documents),
			createImageAutocomplete(() => []),
		])

		view.dispatch({
			changes: { from: 0, insert: "[[Road" },
			selection: { anchor: 6 },
			userEvent: "input.type",
		})
		await waitForCompletion(view)

		expect(currentCompletions(view.state).map(option => option.label)).toEqual([
			"Roadmap",
		])
		closeCompletion(view)
	})

	it("opens explicitly", async () => {
		let view = createView("[[", 2, [
			markdown({ base: markdownLanguage, addKeymap: false }),
			combinedAutocompletion(),
			createWikilinkAutocomplete(() => [
				{ id: "co_roadmap", title: "Roadmap" },
			]),
		])

		startCompletion(view)
		await waitForCompletion(view)

		expect(currentCompletions(view.state).map(option => option.label)).toEqual([
			"Roadmap",
		])
		closeCompletion(view)
	})

	it("opens when the second bracket is typed", async () => {
		let view = createView("[", 1, [
			markdown({ base: markdownLanguage, addKeymap: false }),
			combinedAutocompletion(),
			createWikilinkAutocomplete(() => [
				{ id: "co_roadmap", title: "Roadmap" },
			]),
		])

		insertSmartDelimiter(view, "[")
		await waitForCompletion(view)

		expect(currentCompletions(view.state).map(option => option.label)).toEqual([
			"Roadmap",
		])
		closeCompletion(view)
	})
})

interface DocumentOption {
	id: string
	title: string
	path?: string
	tags?: string[]
}

function labelsFor(content: string, documents: DocumentOption[]): string[] {
	let state = EditorState.create({ doc: content })
	let context = new CompletionContext(state, content.length, true)
	return (
		getWikilinkCompletions(context, documents)?.options.map(
			option => option.label,
		) ?? []
	)
}

function createView(
	content: string,
	cursor = content.length,
	extensions: Extension[] = [],
): EditorView {
	let parent = document.createElement("div")
	document.body.appendChild(parent)
	let state = EditorState.create({
		doc: content,
		selection: { anchor: cursor },
		extensions,
	})
	let view = new EditorView({ state, parent })
	views.push(view)
	return view
}

async function waitForCompletion(view: EditorView): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt++) {
		if (currentCompletions(view.state).length > 0) return
		await new Promise(resolve => setTimeout(resolve, 10))
	}
}
