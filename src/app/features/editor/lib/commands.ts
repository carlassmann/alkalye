import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown"
import { syntaxTree } from "@codemirror/language"
import {
	EditorSelection,
	type Line,
	type SelectionRange,
} from "@codemirror/state"
import {
	indentLess,
	indentMore,
	moveLineDown,
	moveLineUp,
} from "@codemirror/commands"
import { EditorView } from "@codemirror/view"
import { sortTaskLists } from "./sort-tasks"
import { getLastCodeLanguage } from "./code-language-autocomplete"
import { renumberOrderedLists as normalizeOrderedLists } from "./ordered-list-renumbering"

export {
	insertCodeBlock,
	insertImage,
	insertMarkdownLineBreak,
	insertBlankLineAbove,
	indentMarkdown,
	insertMarkdownBlock,
	insertLink,
	insertNewlineContinueMarkupTight,
	moveLineDown,
	moveLineUp,
	outdentMarkdown,
	clearFormatting,
	demoteHeading,
	promoteHeading,
	renumberOrderedLists,
	setBody,
	setHeadingLevel,
	sortTasks,
	toggleBlockquote,
	toggleBold,
	toggleBulletList,
	toggleInlineCode,
	toggleItalic,
	toggleLinePrefix,
	toggleOrderedList,
	toggleStrikethrough,
	toggleTaskComplete,
	toggleTaskCompleteWithSort,
	toggleTaskList,
	wrapSelection,
}
export type { Command }

type Command = (view: EditorView) => boolean

let markdownCodeNodes = new Set(["CodeBlock", "CodeText", "FencedCode"])

function wrapSelection(marker: string): Command {
	return view => {
		let markerLen = marker.length
		let transaction = view.state.changeByRange(range => {
			let target = range.empty ? formattingTarget(view, range, marker) : range
			let from = target.from
			let to = target.to
			let before = view.state.sliceDoc(from - markerLen, from)
			let after = view.state.sliceDoc(to, to + markerLen)

			if (before === marker && after === marker) {
				return {
					changes: [
						{ from: from - markerLen, to: from, insert: "" },
						{ from: to, to: to + markerLen, insert: "" },
					],
					range: EditorSelection.range(from - markerLen, to - markerLen),
				}
			}

			let enclosing = range.empty
				? findEnclosingMarker(view, range.head, marker)
				: null
			if (enclosing) {
				let text = view.state.sliceDoc(
					enclosing.from + markerLen,
					enclosing.to - markerLen,
				)
				return {
					changes: { from: enclosing.from, to: enclosing.to, insert: text },
					range: EditorSelection.range(
						enclosing.from,
						enclosing.from + text.length,
					),
				}
			}

			let selectedText = view.state.sliceDoc(from, to)
			return {
				changes: { from, to, insert: marker + selectedText + marker },
				range: target.empty
					? EditorSelection.cursor(from + markerLen)
					: EditorSelection.range(from + markerLen, to + markerLen),
			}
		})

		view.dispatch(transaction)
		return true
	}
}

let indentMarkdown: Command = view => {
	if (view.composing || view.compositionStarted) return false
	if (!shouldIndentWithTab(view)) return moveFocusFromEditor(view, 1)
	return indentMore(view)
}

let outdentMarkdown: Command = view => {
	if (view.composing || view.compositionStarted) return false
	if (!shouldIndentWithTab(view)) return moveFocusFromEditor(view, -1)
	return indentLess(view)
}

function toggleLinePrefix(prefix: string): Command {
	return view => {
		let prefixTrimmed = prefix.trimStart()
		let lines = selectedLines(view)
		let allHavePrefix = lines.every(line => {
			let { textAfterIndent } = getIndentAndText(line.text)
			return textAfterIndent.startsWith(prefixTrimmed)
		})
		let changes = lines.map(line => {
			let { indent, textAfterIndent } = getIndentAndText(line.text)
			let prefixStart = line.from + indent.length

			if (allHavePrefix) {
				return {
					from: line.from + indent.length,
					to: line.from + indent.length + prefixTrimmed.length,
					insert: "",
				}
			}
			let existingPrefix = blockPrefix(textAfterIndent)
			return {
				from: prefixStart,
				to: prefixStart + (existingPrefix?.length ?? 0),
				insert: prefix,
			}
		})

		view.dispatch({ changes })
		return true
	}
}

function setHeadingLevel(level: number): Command {
	return view => {
		let prefix = "#".repeat(level) + " "
		let lines = selectedLines(view)
		let remove = lines.every(line => line.text.startsWith(prefix))
		let changes = lines.map(line => {
			let indent = line.text.match(/^\s*/)?.[0] ?? ""
			let text = line.text.slice(indent.length)
			let existing = blockPrefix(text)
			return {
				from: line.from + indent.length,
				to: line.from + indent.length + (existing?.length ?? 0),
				insert: remove ? "" : prefix,
			}
		})
		view.dispatch({ changes })
		return true
	}
}

let insertLink: Command = view => {
	let transaction = view.state.changeByRange(range => {
		let existing = linkAtRange(view, range)
		if (existing) {
			return {
				range: EditorSelection.range(existing.urlFrom, existing.urlTo),
			}
		}

		let selectedText = view.state.sliceDoc(range.from, range.to)
		let text = selectedText || "link"
		let linkMarkup = `[${text}](url)`
		let urlStart = range.from + text.length + 3
		return {
			changes: { from: range.from, to: range.to, insert: linkMarkup },
			range: EditorSelection.range(urlStart, urlStart + 3),
		}
	})
	view.dispatch(transaction)
	return true
}

let insertImage: Command = view => {
	let transaction = view.state.changeByRange(range => {
		let selectedText = view.state.sliceDoc(range.from, range.to)
		let altText = selectedText || "alt"
		let imageMarkup = `![${altText}](url)`
		let urlStart = range.from + altText.length + 4
		return {
			changes: { from: range.from, to: range.to, insert: imageMarkup },
			range: EditorSelection.range(urlStart, urlStart + 3),
		}
	})
	view.dispatch(transaction)
	return true
}

function insertMarkdownBlock(text: string): Command {
	return view => {
		let { from, to } = view.state.selection.main
		let before = view.state.sliceDoc(0, from)
		let after = view.state.sliceDoc(to)
		let prefix =
			before && !before.endsWith("\n\n")
				? before.endsWith("\n")
					? "\n"
					: "\n\n"
				: ""
		let suffix =
			after && !after.startsWith("\n\n")
				? after.startsWith("\n")
					? "\n"
					: "\n\n"
				: ""
		let insertion = `${prefix}${text}${suffix}`

		view.dispatch({
			changes: { from, to, insert: insertion },
			selection: { anchor: from + prefix.length + text.length },
		})
		return true
	}
}

let insertCodeBlock: Command = view => {
	let transaction = view.state.changeByRange(range => {
		let selectedText = view.state.sliceDoc(range.from, range.to)
		let fence = "`".repeat(Math.max(3, longestRun(selectedText, "`") + 1))
		let rememberedLanguage = getLastCodeLanguage()
		let language = rememberedLanguage || "language"
		let codeBlock = `${fence}${language}\n${selectedText}\n${fence}`
		return {
			changes: { from: range.from, to: range.to, insert: codeBlock },
			range: EditorSelection.range(
				range.from + fence.length,
				range.from + fence.length + language.length,
			),
		}
	})
	view.dispatch(transaction)
	return true
}

let toggleTaskComplete: Command = view => {
	return toggleTaskCompleteWithSort(false)(view)
}

let setBody: Command = view => {
	let changes = selectedLines(view).flatMap(line => {
		let indent = line.text.match(/^\s*/)?.[0] ?? ""
		let existingPrefix = blockPrefix(line.text.slice(indent.length))
		return existingPrefix
			? [
					{
						from: line.from + indent.length,
						to: line.from + indent.length + existingPrefix.length,
						insert: "",
					},
				]
			: []
	})
	if (changes.length) view.dispatch({ changes })
	return true
}

let toggleBold = wrapSelection("**")
let toggleItalic = wrapSelection("*")
let toggleStrikethrough = wrapSelection("~~")
let toggleInlineCode = wrapSelection("`")
let toggleBulletList = toggleLinePrefix("- ")
let toggleOrderedList = toggleLinePrefix("1. ")
let toggleTaskList = toggleLinePrefix("- [ ] ")
let toggleBlockquote = toggleLinePrefix("> ")

let sortTasks: Command = view => {
	let content = view.state.doc.toString()
	let sorted = sortTaskLists(content)
	if (sorted === content) return false
	let cursorPos = view.state.selection.main.head
	view.dispatch({
		changes: { from: 0, to: view.state.doc.length, insert: sorted },
		selection: { anchor: Math.min(cursorPos, sorted.length) },
	})
	return true
}

function toggleTaskCompleteWithSort(autoSort: boolean): Command {
	return view => {
		let tasks = selectedLines(view).flatMap(line => {
			let match = line.text.match(/^(\s*[-*+]\s)\[([ x])\](\s)/i)
			return match
				? [
						{
							from: line.from + match[1].length,
							checked: match[2].toLowerCase() === "x",
						},
					]
				: []
		})
		if (tasks.length === 0) return false

		let checkAll = tasks.some(task => !task.checked)
		let changes = tasks.map(task => ({
			from: task.from,
			to: task.from + 3,
			insert: checkAll ? "[x]" : "[ ]",
		}))
		if (!autoSort) {
			view.dispatch({ changes })
			return true
		}

		let changed = view.state.update({ changes }).state.doc.toString()
		let sorted = sortTaskLists(changed)
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: sorted },
			selection: {
				anchor: Math.min(view.state.selection.main.head, sorted.length),
			},
		})
		return true
	}
}

let clearFormatting: Command = view => {
	let transaction = view.state.changeByRange(range => {
		let target = range.empty
			? (view.state.wordAt(range.head) ?? view.state.doc.lineAt(range.head))
			: range
		let content = view.state.sliceDoc(target.from, target.to)
		let plainText = stripInlineFormatting(content)
		if (content === plainText) return { range }
		return {
			changes: { from: target.from, to: target.to, insert: plainText },
			range: EditorSelection.range(target.from, target.from + plainText.length),
		}
	})
	if (transaction.changes.empty) return false
	view.dispatch(transaction)
	return true
}

let promoteHeading: Command = view => changeHeadingDepth(view, -1)
let demoteHeading: Command = view => changeHeadingDepth(view, 1)
let insertMarkdownLineBreak: Command = view => insertMarkdownLineBreakImpl(view)
let insertBlankLineAbove: Command = view => insertBlankLineAboveImpl(view)
let renumberOrderedLists: Command = view => renumberOrderedListsImpl(view)
let insertNewlineContinueMarkupTight: Command = view =>
	insertNewlineContinueMarkupTightImpl(view)

function changeHeadingDepth(view: EditorView, direction: 1 | -1): boolean {
	let changes = selectedLines(view).flatMap(line => {
		let match = line.text.match(/^(\s*)(#{1,6})\s/)
		if (!match) {
			return direction === -1
				? [{ from: line.from, to: line.from, insert: "# " }]
				: []
		}
		let level = match[2].length
		let nextLevel = level + direction
		let replacement = nextLevel > 6 ? "" : "#".repeat(nextLevel) + " "
		return [
			{
				from: line.from + match[1].length,
				to: line.from + match[0].length,
				insert: replacement,
			},
		]
	})
	if (changes.length === 0) return false
	view.dispatch({ changes })
	return true
}

let insertMarkdownLineBreakImpl: Command = view => {
	let transaction = view.state.changeByRange(range => {
		let line = view.state.doc.lineAt(range.from)
		let indent = line.text.match(/^\s*/)?.[0] ?? ""
		let before = view.state.sliceDoc(line.from, range.from)
		let replaceFrom = line.from + before.trimEnd().length
		let insert = `  \n${indent}`
		return {
			changes: { from: replaceFrom, to: range.to, insert },
			range: EditorSelection.cursor(replaceFrom + insert.length),
		}
	})
	view.dispatch(transaction)
	return true
}

let insertBlankLineAboveImpl: Command = view => {
	let transaction = view.state.changeByRange(range => {
		let line = view.state.doc.lineAt(range.head)
		return {
			changes: { from: line.from, insert: "\n" },
			range: EditorSelection.cursor(line.from),
		}
	})
	view.dispatch(transaction)
	return true
}

let renumberOrderedListsImpl: Command = view => {
	let content = view.state.doc.toString()
	let renumbered = normalizeOrderedLists(content)
	if (content === renumbered) return false
	view.dispatch({
		changes: { from: 0, to: view.state.doc.length, insert: renumbered },
		selection: view.state.selection,
	})
	return true
}

// Custom newline handler that forces tight lists (no blank lines between items)
let insertNewlineContinueMarkupTightImpl: Command = view => {
	let { from } = view.state.selection.main
	let line = view.state.doc.lineAt(from)

	// Check if we're in a list item
	let listMatch = line.text.match(/^(\s*)([-*+]|\d+\.)\s/)
	if (!listMatch) {
		return insertNewlineContinueMarkup(view)
	}

	let result = insertNewlineContinueMarkup(view)

	if (!result) return false

	// Check if a blank line was inserted before the new list marker
	let cursorAfter = view.state.selection.main.head
	let lineAfter = view.state.doc.lineAt(cursorAfter)

	// Look for pattern: content + \n\n + marker (loose list continuation)
	// We want: content + \n + marker (tight list)
	if (lineAfter.number >= 2) {
		let prevLine = view.state.doc.line(lineAfter.number - 1)
		// If the line before cursor is empty, it was a loose list insertion
		if (prevLine.text.trim() === "") {
			// Remove the blank line
			view.dispatch({
				changes: { from: prevLine.from, to: prevLine.to + 1, insert: "" },
			})
		}
	}

	return true
}

// Helpers

function formattingTarget(
	view: EditorView,
	range: SelectionRange,
	marker: string,
): SelectionRange {
	let enclosing = findEnclosingMarker(view, range.head, marker)
	if (enclosing) {
		return EditorSelection.range(
			enclosing.from + marker.length,
			enclosing.to - marker.length,
		)
	}
	return view.state.wordAt(range.head) ?? range
}

function findEnclosingMarker(
	view: EditorView,
	position: number,
	marker: string,
): { from: number; to: number } | null {
	let line = view.state.doc.lineAt(position)
	let offset = position - line.from
	let before = line.text.lastIndexOf(marker, Math.max(0, offset - 1))
	if (before < 0) return null
	let after = line.text.indexOf(
		marker,
		Math.max(offset, before + marker.length),
	)
	if (after < 0 || before + marker.length > offset) return null
	return {
		from: line.from + before,
		to: line.from + after + marker.length,
	}
}

function linkAtRange(
	view: EditorView,
	range: SelectionRange,
): { urlFrom: number; urlTo: number } | null {
	let lineFrom = view.state.doc.lineAt(range.from).from
	let lineTo = view.state.doc.lineAt(range.to).to
	let lineText = view.state.sliceDoc(lineFrom, lineTo)
	let linkPattern = /\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g
	for (let match of lineText.matchAll(linkPattern)) {
		if (match.index === undefined) continue
		let linkStart = lineFrom + match.index
		let linkEnd = linkStart + match[0].length
		if (range.from < linkStart || range.to > linkEnd) continue
		let urlOffset = match[0].indexOf("](") + 2
		return {
			urlFrom: linkStart + urlOffset,
			urlTo: linkEnd - 1,
		}
	}
	return null
}

function selectedLines(view: EditorView): Line[] {
	let numbers = new Set<number>()
	for (let range of view.state.selection.ranges) {
		let start = view.state.doc.lineAt(range.from)
		let end = view.state.doc.lineAt(range.to)
		let lastNumber =
			range.to > range.from && range.to === end.from
				? Math.max(start.number, end.number - 1)
				: end.number
		for (let number = start.number; number <= lastNumber; number++) {
			numbers.add(number)
		}
	}
	return [...numbers]
		.sort((a, b) => a - b)
		.map(number => view.state.doc.line(number))
}

function blockPrefix(text: string): string | null {
	return (
		text.match(/^(?:#{1,6}\s|[-*+]\s(?:\[[ x]\]\s)?|>\s|\d+\.\s)/i)?.[0] ?? null
	)
}

function stripInlineFormatting(content: string): string {
	let result = content
	result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
	result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
	result = result.replace(/(\*\*|__|~~|`+)([\s\S]*?)\1/g, "$2")
	result = result.replace(/\*([^*\n]+)\*/g, "$1")
	result = result.replace(/_([^_\n]+)_/g, "$1")
	return result
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

function getIndentAndText(lineText: string): {
	indent: string
	textAfterIndent: string
} {
	let indentMatch = lineText.match(/^(\s*)/)
	let indent = indentMatch ? indentMatch[1] : ""
	let textAfterIndent = lineText.slice(indent.length)
	return { indent, textAfterIndent }
}

function shouldIndentWithTab(view: EditorView): boolean {
	if (view.state.readOnly) return false

	let selection = view.state.selection.main
	let startLine = view.state.doc.lineAt(selection.from)
	let endLine = view.state.doc.lineAt(selection.to)
	if (startLine.number !== endLine.number) return true
	if (/^\s*(?:[-*+]\s|\d+\.\s)/.test(startLine.text)) return true

	let node = syntaxTree(view.state).resolveInner(selection.head, -1)
	let current: typeof node | null = node
	for (; current; current = current.parent) {
		if (markdownCodeNodes.has(current.name)) return true
	}
	return false
}

function moveFocusFromEditor(view: EditorView, direction: 1 | -1): boolean {
	let elements = Array.from(
		document.querySelectorAll<HTMLElement>(
			'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[contenteditable="true"],[tabindex]',
		),
	).filter(element => {
		if (element.tabIndex < 0 && element !== view.contentDOM) return false
		return !element.closest('[hidden],[inert],[aria-hidden="true"]')
	})
	let activeElement = document.activeElement
	let currentIndex = elements.findIndex(
		element =>
			element === activeElement ||
			(activeElement instanceof Node && element.contains(activeElement)),
	)
	let target = elements[currentIndex + direction]
	if (target) target.focus()
	else if (activeElement instanceof HTMLElement) activeElement.blur()
	return true
}
