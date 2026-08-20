import { syntaxTree } from "@codemirror/language"
import { EditorSelection, type SelectionRange } from "@codemirror/state"
import { type EditorView } from "@codemirror/view"

export { expandMarkdownSelection, shrinkMarkdownSelection }

interface ExpansionStep {
	before: EditorSelection
	after: EditorSelection
}

let expansionHistory = new WeakMap<EditorView, ExpansionStep[]>()

function expandMarkdownSelection(view: EditorView): boolean {
	let ranges = view.state.selection.ranges.map(range =>
		expandRange(view, range),
	)
	let next = EditorSelection.create(ranges, view.state.selection.mainIndex)
	if (next.eq(view.state.selection)) return false

	let history = expansionHistory.get(view) ?? []
	history.push({ before: view.state.selection, after: next })
	expansionHistory.set(view, history)
	view.dispatch({ selection: next, scrollIntoView: true })
	return true
}

function shrinkMarkdownSelection(view: EditorView): boolean {
	let history = expansionHistory.get(view)
	let step = history?.at(-1)
	if (!history || !step || !step.after.eq(view.state.selection)) {
		expansionHistory.delete(view)
		return false
	}

	history.pop()
	view.dispatch({ selection: step.before, scrollIntoView: true })
	return true
}

function expandRange(view: EditorView, range: SelectionRange): SelectionRange {
	let from = range.from
	let to = range.to
	let candidates: Array<{ from: number; to: number }> = []

	if (range.empty) {
		let word = view.state.wordAt(range.head)
		if (word) candidates.push(word)
	}

	let tree = syntaxTree(view.state)
	let node = tree.resolveInner(range.head, -1)
	for (
		let current: typeof node | null = node;
		current;
		current = current.parent
	) {
		if (current.from <= from && current.to >= to) {
			candidates.push({ from: current.from, to: current.to })
		}
	}

	let paragraph = paragraphRange(view, range)
	candidates.push(paragraph)
	candidates.push({ from: 0, to: view.state.doc.length })

	let next = candidates
		.filter(candidate => candidate.from < from || candidate.to > to)
		.sort((a, b) => {
			let sizeDiff = a.to - a.from - (b.to - b.from)
			return sizeDiff || a.from - b.from
		})[0]
	return next ? EditorSelection.range(next.from, next.to) : range
}

function paragraphRange(
	view: EditorView,
	range: SelectionRange,
): { from: number; to: number } {
	let start = view.state.doc.lineAt(range.from)
	let end = view.state.doc.lineAt(range.to)
	while (start.number > 1) {
		let previous = view.state.doc.line(start.number - 1)
		if (!previous.text.trim()) break
		start = previous
	}
	while (end.number < view.state.doc.lines) {
		let next = view.state.doc.line(end.number + 1)
		if (!next.text.trim()) break
		end = next
	}
	return { from: start.from, to: end.to }
}
