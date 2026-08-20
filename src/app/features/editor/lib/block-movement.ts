import { type EditorState } from "@codemirror/state"
import { type EditorView } from "@codemirror/view"
import { type Command } from "./commands"

export { moveMarkdownBlockDown, moveMarkdownBlockUp }

interface BlockRange {
	from: number
	to: number
}

let moveMarkdownBlockUp: Command = view => moveMarkdownBlock(view, -1)
let moveMarkdownBlockDown: Command = view => moveMarkdownBlock(view, 1)

function moveMarkdownBlock(view: EditorView, direction: 1 | -1): boolean {
	let current = selectedBlock(view.state)
	let adjacent =
		direction === -1
			? previousBlock(view.state, current)
			: nextBlock(view.state, current)
	if (!adjacent) return false

	let first = direction === -1 ? adjacent : current
	let second = direction === -1 ? current : adjacent
	let firstText = view.state.sliceDoc(first.from, first.to)
	let separator = view.state.sliceDoc(first.to, second.from)
	let secondText = view.state.sliceDoc(second.from, second.to)
	let replacement = `${secondText}${separator}${firstText}`
	let newCurrentFrom =
		direction === -1
			? adjacent.from
			: current.from + secondText.length + separator.length
	let offset = newCurrentFrom - current.from
	let selection = view.state.selection.main

	view.dispatch({
		changes: { from: first.from, to: second.to, insert: replacement },
		selection: {
			anchor: selection.anchor + offset,
			head: selection.head + offset,
		},
		scrollIntoView: true,
	})
	return true
}

function selectedBlock(state: EditorState): BlockRange {
	let selection = state.selection.main
	if (selection.empty)
		return blockAtLine(state, state.doc.lineAt(selection.head).number)

	let first = state.doc.lineAt(selection.from)
	let last = state.doc.lineAt(selection.to)
	if (selection.to === last.from && last.number > first.number) {
		last = state.doc.line(last.number - 1)
	}
	let endBlock = blockAtLine(state, last.number)
	return { from: first.from, to: Math.max(last.to, endBlock.to) }
}

function previousBlock(
	state: EditorState,
	current: BlockRange,
): BlockRange | null {
	let line = state.doc.lineAt(current.from)
	for (let number = line.number - 1; number >= 1; number--) {
		if (!state.doc.line(number).text.trim()) continue
		return blockAtLine(state, number)
	}
	return null
}

function nextBlock(state: EditorState, current: BlockRange): BlockRange | null {
	let line = state.doc.lineAt(current.to)
	for (let number = line.number + 1; number <= state.doc.lines; number++) {
		if (!state.doc.line(number).text.trim()) continue
		return blockAtLine(state, number)
	}
	return null
}

function blockAtLine(state: EditorState, lineNumber: number): BlockRange {
	let line = state.doc.line(lineNumber)
	let list = line.text.match(/^(\s*)(?:[-*+] |\d+\. )/)
	if (list) return listItemBlock(state, lineNumber, indentationWidth(list[1]))
	if (/^\s*(`{3,}|~{3,})/.test(line.text))
		return fencedCodeBlock(state, lineNumber)
	if (/^\s*>/.test(line.text)) return matchingLines(state, lineNumber, /^\s*>/)
	if (isTableLine(line.text))
		return matchingLines(state, lineNumber, isTableLine)
	if (/^\s*(?:#{1,6}\s|(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(line.text))
		return { from: line.from, to: line.to }
	return paragraphBlock(state, lineNumber)
}

function listItemBlock(
	state: EditorState,
	lineNumber: number,
	baseIndent: number,
): BlockRange {
	let start = state.doc.line(lineNumber)
	let end = start
	for (let number = lineNumber + 1; number <= state.doc.lines; number++) {
		let line = state.doc.line(number)
		if (!line.text.trim()) {
			end = line
			continue
		}
		let indent = indentationWidth(line.text.match(/^\s*/)?.[0] ?? "")
		if (indent <= baseIndent) break
		end = line
	}
	while (end.number > start.number && !end.text.trim()) {
		end = state.doc.line(end.number - 1)
	}
	return { from: start.from, to: end.to }
}

function fencedCodeBlock(state: EditorState, lineNumber: number): BlockRange {
	let start = state.doc.line(lineNumber)
	let opening = start.text.match(/^\s*(`{3,}|~{3,})/)?.[1]
	if (!opening) return { from: start.from, to: start.to }
	let marker = opening[0]
	for (let number = lineNumber + 1; number <= state.doc.lines; number++) {
		let line = state.doc.line(number)
		let closing = line.text.trim()
		if (
			closing.startsWith(marker.repeat(opening.length)) &&
			Array.from(closing).every(character => character === marker)
		)
			return { from: start.from, to: line.to }
	}
	return { from: start.from, to: state.doc.length }
}

function matchingLines(
	state: EditorState,
	lineNumber: number,
	matches: RegExp | ((text: string) => boolean),
): BlockRange {
	function lineMatches(text: string) {
		return typeof matches === "function" ? matches(text) : matches.test(text)
	}
	let first = lineNumber
	let last = lineNumber
	while (first > 1 && lineMatches(state.doc.line(first - 1).text)) first--
	while (last < state.doc.lines && lineMatches(state.doc.line(last + 1).text))
		last++
	return { from: state.doc.line(first).from, to: state.doc.line(last).to }
}

function paragraphBlock(state: EditorState, lineNumber: number): BlockRange {
	let first = lineNumber
	let last = lineNumber
	while (first > 1) {
		let previous = state.doc.line(first - 1)
		if (!previous.text.trim() || isBlockStart(previous.text)) break
		first--
	}
	while (last < state.doc.lines) {
		let next = state.doc.line(last + 1)
		if (!next.text.trim() || isBlockStart(next.text)) break
		last++
	}
	return { from: state.doc.line(first).from, to: state.doc.line(last).to }
}

function isBlockStart(text: string): boolean {
	return (
		/^\s*(?:#{1,6}\s|>|[-*+] |\d+\. |`{3,}|~{3,})/.test(text) ||
		isTableLine(text)
	)
}

function isTableLine(text: string): boolean {
	let trimmed = text.trim()
	return trimmed.startsWith("|") && trimmed.endsWith("|")
}

function indentationWidth(indent: string): number {
	let width = 0
	for (let character of indent) width += character === "\t" ? 4 : 1
	return width
}
