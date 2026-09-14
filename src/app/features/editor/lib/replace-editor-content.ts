import { Annotation, EditorSelection, Transaction } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { diff } from "fast-myers-diff"

export { applyContentPreservingSelection, externalContentChange }

let externalContentChange = Annotation.define<boolean>()

function applyContentPreservingSelection(
	view: EditorView,
	content: string,
	external = false,
) {
	let currentContent = view.state.doc.toString()
	let selection = view.state.selection
	let changes = Array.from(
		diff(currentContent, content),
		([from, to, start, end]) => ({
			from,
			to,
			insert: content.slice(start, end),
		}),
	)
	if (changes.length === 0) return

	let transaction = view.state.update({ changes })
	let mappedRanges = selection.ranges.map(range =>
		EditorSelection.range(
			transaction.changes.mapPos(range.anchor, 1),
			transaction.changes.mapPos(range.head, 1),
		),
	)
	view.dispatch({
		changes,
		selection: EditorSelection.create(mappedRanges, selection.mainIndex),
		annotations: external
			? [externalContentChange.of(true), Transaction.addToHistory.of(false)]
			: [],
	})
}
