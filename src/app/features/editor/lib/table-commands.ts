import { EditorSelection } from "@codemirror/state"
import { type EditorView } from "@codemirror/view"
import { insertMarkdownBlock, type Command } from "./commands"

export {
	insertTable,
	insertTableRow,
	moveTableCell,
	moveTableCellBackward,
	moveTableCellForward,
}

let tableTemplate = "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |"

let insertTable: Command = view => {
	let start = view.state.selection.main.from
	if (!insertMarkdownBlock(tableTemplate)(view)) return false
	let columnStart = view.state.doc.toString().indexOf("Column 1", start)
	if (columnStart < 0) return true
	view.dispatch({
		selection: EditorSelection.range(
			columnStart,
			columnStart + "Column 1".length,
		),
	})
	return true
}

let moveTableCellForward: Command = view => moveTableCell(view, 1)
let moveTableCellBackward: Command = view => moveTableCell(view, -1)

function moveTableCell(view: EditorView, direction: 1 | -1): boolean {
	let position = view.state.selection.main.head
	let line = view.state.doc.lineAt(position)
	if (!isTableLine(line.text)) return false

	let cells = tableCells(view, line.number)
	let currentIndex = cells.findIndex(
		cell => position >= cell.from && position <= cell.to,
	)
	if (currentIndex < 0) return false

	let target = cells[currentIndex + direction]
	if (!target && direction === 1) {
		if (!insertTableRow(view)) return false
		return true
	}
	if (!target) return false

	view.dispatch({
		selection: EditorSelection.range(target.from, target.to),
		scrollIntoView: true,
	})
	return true
}

function insertTableRow(view: EditorView): boolean {
	let position = view.state.selection.main.head
	let line = view.state.doc.lineAt(position)
	if (!isTableLine(line.text)) return false

	let pipeCount = Array.from(line.text).filter(value => value === "|").length
	if (pipeCount < 2) return false
	let row = `|${"  |".repeat(pipeCount - 1)}`
	let insertAt = line.to
	view.dispatch({
		changes: { from: insertAt, insert: `\n${row}` },
		selection: EditorSelection.cursor(insertAt + 3),
		scrollIntoView: true,
	})
	return true
}

function tableCells(
	view: EditorView,
	lineNumber: number,
): Array<{ from: number; to: number }> {
	let first = lineNumber
	let last = lineNumber
	while (first > 1 && isTableLine(view.state.doc.line(first - 1).text)) first--
	while (
		last < view.state.doc.lines &&
		isTableLine(view.state.doc.line(last + 1).text)
	)
		last++

	let cells: Array<{ from: number; to: number }> = []
	for (let number = first; number <= last; number++) {
		let line = view.state.doc.line(number)
		if (isDelimiterRow(line.text)) continue
		let pipes: number[] = []
		for (let index = 0; index < line.text.length; index++) {
			if (line.text[index] === "|") pipes.push(index)
		}
		for (let index = 0; index < pipes.length - 1; index++) {
			let from = line.from + pipes[index] + 1
			let to = line.from + pipes[index + 1]
			while (from < to && view.state.sliceDoc(from, from + 1) === " ") from++
			while (to > from && view.state.sliceDoc(to - 1, to) === " ") to--
			cells.push({ from, to })
		}
	}
	return cells
}

function isTableLine(text: string): boolean {
	let trimmed = text.trim()
	return trimmed.startsWith("|") && trimmed.endsWith("|")
}

function isDelimiterRow(text: string): boolean {
	return /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(text)
}
