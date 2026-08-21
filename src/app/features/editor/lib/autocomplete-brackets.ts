import {
	EditorSelection,
	type Extension,
	Prec,
	type SelectionRange,
} from "@codemirror/state"
import { keymap, EditorView } from "@codemirror/view"
import {
	closeBrackets,
	closeBracketsKeymap,
	startCompletion,
} from "@codemirror/autocomplete"

export { createBracketsExtension, insertSmartDelimiter }

interface SmartDelimiterOptions {
	smartPairs: boolean
	markerWrapping: boolean
}

let defaultOptions: SmartDelimiterOptions = {
	smartPairs: true,
	markerWrapping: true,
}

function createBracketsExtension(
	options: SmartDelimiterOptions = defaultOptions,
): Extension {
	return [
		...(options.smartPairs
			? [closeBrackets(), keymap.of(closeBracketsKeymap)]
			: []),
		Prec.high(
			EditorView.inputHandler.of((view, from, to, text) => {
				let selection = view.state.selection.main
				if (from !== selection.from || to !== selection.to) return false
				return insertSmartDelimiter(view, text, options)
			}),
		),
	]
}

function insertSmartDelimiter(
	view: EditorView,
	text: string,
	options: SmartDelimiterOptions = defaultOptions,
): boolean {
	if (
		view.state.readOnly ||
		view.composing ||
		view.compositionStarted ||
		!isEnabledDelimiter(text, options)
	)
		return false
	let openWikilinkCompletion =
		text === "[" &&
		view.state.selection.ranges.every(range =>
			range.empty
				? range.from > 0 &&
					view.state.sliceDoc(range.from - 1, range.from) === "["
				: isInsideBrackets(view, range.from, range.to),
		)
	if (
		text === "(" &&
		!view.state.selection.ranges.every(range =>
			isInsideBrackets(view, range.from, range.to),
		)
	)
		return false

	let transaction = view.state.changeByRange(range => {
		if (text === "(" && isInsideBrackets(view, range.from, range.to)) {
			let url = "url"
			return {
				changes: { from: range.to + 1, insert: `(${url})` },
				range: EditorSelection.range(range.to + 2, range.to + 2 + url.length),
			}
		}

		if (text === "[" && !range.empty) {
			if (isInsideBrackets(view, range.from, range.to)) {
				let selectedText = view.state.sliceDoc(range.from, range.to)
				return {
					changes: {
						from: range.from - 1,
						to: range.to + 1,
						insert: `[[${selectedText}]]`,
					},
					range: EditorSelection.cursor(range.from + 1 + selectedText.length),
				}
			}

			return wrapRange(range, "[", "]")
		}

		if (text === "[") {
			return {
				changes: { from: range.from, to: range.to, insert: "[" },
				range: EditorSelection.cursor(range.from + 1),
			}
		}

		if (range.empty || text === "(") return { range }
		if (text === "`") {
			let selectedText = view.state.sliceDoc(range.from, range.to)
			let marker = "`".repeat(longestRun(selectedText, "`") + 1)
			if (selectedText.startsWith("`") || selectedText.endsWith("`")) {
				return wrapRange(range, marker + " ", " " + marker)
			}
			return wrapRange(range, marker, marker)
		}

		return wrapRange(range, text, closingDelimiter(text))
	})

	let changed = !transaction.changes.empty
	if (!changed) return false

	view.dispatch(
		view.state.update(transaction, {
			userEvent: "input.type",
			scrollIntoView: true,
		}),
	)
	if (openWikilinkCompletion) {
		queueMicrotask(() => {
			if (view.contentDOM.isConnected) startCompletion(view)
		})
	}
	return true
}

function isEnabledDelimiter(
	text: string,
	options: SmartDelimiterOptions,
): boolean {
	if ("`*_~".includes(text)) return options.markerWrapping
	return options.smartPairs && (text === "[" || text === "(" || text === "<")
}

function wrapRange(range: SelectionRange, before: string, after: string) {
	return {
		changes: [
			{ from: range.from, insert: before },
			{ from: range.to, insert: after },
		],
		range: EditorSelection.range(
			range.anchor + before.length,
			range.head + before.length,
		),
	}
}

function isInsideBrackets(view: EditorView, from: number, to: number): boolean {
	return (
		from > 0 &&
		to < view.state.doc.length &&
		view.state.sliceDoc(from - 1, from) === "[" &&
		view.state.sliceDoc(to, to + 1) === "]"
	)
}

function closingDelimiter(text: string): string {
	return text === "<" ? ">" : text
}

function longestRun(content: string, character: string): number {
	let longest = 0
	let current = 0
	for (let value of content) {
		if (value === character) {
			current++
			longest = Math.max(longest, current)
		} else {
			current = 0
		}
	}
	return longest
}
