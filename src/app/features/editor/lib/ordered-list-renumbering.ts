import {
	Annotation,
	EditorSelection,
	Text,
	Transaction,
	type Extension,
} from "@codemirror/state"
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view"

export { orderedListRenumbering, renumberOrderedLists }

let renumberAnnotation = Annotation.define<boolean>()

let orderedListRenumbering: Extension = ViewPlugin.define(view => ({
	update(update) {
		if (!update.docChanged || update.state.readOnly) return
		if (
			update.transactions.some(transaction =>
				transaction.annotation(renumberAnnotation),
			)
		)
			return
		if (!changedOrderedList(update)) return
		queueMicrotask(() => renumberView(view))
	},
}))

function changedOrderedList(update: ViewUpdate) {
	let changed = false
	update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
		changed ||=
			hasOrderedListNear(update.startState.doc, fromA, toA) ||
			hasOrderedListNear(update.state.doc, fromB, toB)
	})
	return changed
}

function hasOrderedListNear(doc: Text, from: number, to: number) {
	let startLine = Math.max(1, doc.lineAt(from).number - 1)
	let endLine = Math.min(doc.lines, doc.lineAt(to).number + 1)
	for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
		if (/^\s*\d+\.\s/.test(doc.line(lineNumber).text)) return true
	}
	return false
}

function renumberOrderedLists(content: string): string {
	let lines = content.split("\n")
	let counters = new Map<number, number>()
	let activeBaseIndent: number | null = null

	return lines
		.map(line => {
			let match = line.match(/^(\s*)(\d+)\.\s/)
			if (match) {
				let indent = indentationWidth(match[1])
				for (let level of counters.keys()) {
					if (level > indent) counters.delete(level)
				}
				let number = (counters.get(indent) ?? 0) + 1
				counters.set(indent, number)
				activeBaseIndent =
					activeBaseIndent === null
						? indent
						: Math.min(activeBaseIndent, indent)
				return `${match[1]}${number}. ${line.slice(match[0].length)}`
			}

			if (!line.trim()) return line
			let indent = indentationWidth(line.match(/^\s*/)?.[0] ?? "")
			if (activeBaseIndent === null || indent <= activeBaseIndent) {
				counters.clear()
				activeBaseIndent = null
			}
			return line
		})
		.join("\n")
}

function renumberView(view: EditorView): void {
	if (!view.contentDOM.isConnected || view.state.readOnly) return
	let content = view.state.doc.toString()
	let renumbered = renumberOrderedLists(content)
	if (content === renumbered) return

	let newDocument = Text.of(renumbered.split("\n"))
	let ranges = view.state.selection.ranges.map(range =>
		EditorSelection.range(
			mapPosition(view.state.doc, newDocument, range.anchor),
			mapPosition(view.state.doc, newDocument, range.head),
		),
	)
	view.dispatch({
		changes: { from: 0, to: view.state.doc.length, insert: renumbered },
		selection: EditorSelection.create(ranges, view.state.selection.mainIndex),
		annotations: [
			renumberAnnotation.of(true),
			Transaction.addToHistory.of(false),
		],
	})
}

function indentationWidth(indent: string): number {
	let width = 0
	for (let character of indent) width += character === "\t" ? 4 : 1
	return width
}

function mapPosition(from: Text, to: Text, position: number): number {
	let line = from.lineAt(position)
	let target = to.line(Math.min(line.number, to.lines))
	return Math.min(target.to, target.from + position - line.from)
}
