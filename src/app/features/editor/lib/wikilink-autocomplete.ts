import {
	type Completion,
	type CompletionContext,
	type CompletionResult,
} from "@codemirror/autocomplete"
import { type Extension } from "@codemirror/state"
import { completionSource } from "@/app/lib/completion-sources"

export { createWikilinkAutocomplete, getWikilinkCompletions }

interface WikilinkCompletionDocument {
	id: string
	title: string
	path?: string | null
	tags?: string[]
}

function createWikilinkAutocomplete(
	getDocuments: () => WikilinkCompletionDocument[],
): Extension {
	return completionSource((context: CompletionContext) =>
		getWikilinkCompletions(context, getDocuments()),
	)
}

function getWikilinkCompletions(
	context: CompletionContext,
	documents: WikilinkCompletionDocument[],
): CompletionResult | null {
	let line = context.state.doc.lineAt(context.pos)
	let textBefore = line.text.slice(0, context.pos - line.from)
	let match = textBefore.match(/\[\[([^\][]*)$/)
	if (!match) return null

	let query = match[1]
	let normalizedQuery = query.trim().toLowerCase()
	let from = context.pos - query.length
	let options = documents
		.filter(document => matchesDocument(document, normalizedQuery))
		.map(document => createCompletion(document))

	if (options.length === 0) return null
	return {
		from,
		options,
		validFor: text => !text.includes("[") && !text.includes("]"),
	}
}

function matchesDocument(
	document: WikilinkCompletionDocument,
	query: string,
): boolean {
	if (!query) return true
	return [
		document.title,
		document.path ?? "",
		document.id,
		...(document.tags ?? []),
	].some(value => value.toLowerCase().includes(query))
}

function createCompletion(document: WikilinkCompletionDocument): Completion {
	return {
		label: document.title,
		type: "text",
		detail: document.path || "document",
		apply: (view, _completion, from, to) => {
			let hasClosingBrackets = view.state.sliceDoc(to, to + 2) === "]]"
			let insert = document.id + (hasClosingBrackets ? "" : "]]")
			view.dispatch({
				changes: { from, to, insert },
				selection: { anchor: from + document.id.length + 2 },
			})
		},
	}
}
