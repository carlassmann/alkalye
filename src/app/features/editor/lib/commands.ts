import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown"
import { syntaxTree } from "@codemirror/language"
import { indentLess, indentMore } from "@codemirror/commands"
import { EditorView } from "@codemirror/view"
import { sortTaskLists } from "./sort-tasks"

export {
	insertCodeBlock,
	insertImage,
	indentMarkdown,
	insertMarkdownBlock,
	insertLink,
	insertNewlineContinueMarkupTight,
	moveLineDown,
	moveLineUp,
	outdentMarkdown,
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
		let { from, to } = view.state.selection.main
		let markerLen = marker.length

		if (from === to) {
			let before = view.state.sliceDoc(from - markerLen, from)
			let after = view.state.sliceDoc(from, from + markerLen)

			if (before === marker && after === marker) {
				view.dispatch({
					changes: [
						{ from: from - markerLen, to: from, insert: "" },
						{ from: from, to: from + markerLen, insert: "" },
					],
					selection: { anchor: from - markerLen },
				})
			} else {
				view.dispatch({
					changes: { from, to, insert: marker + marker },
					selection: { anchor: from + markerLen },
				})
			}
			return true
		}

		let selectedText = view.state.sliceDoc(from, to)
		let before = view.state.sliceDoc(from - markerLen, from)
		let after = view.state.sliceDoc(to, to + markerLen)

		if (before === marker && after === marker) {
			view.dispatch({
				changes: [
					{ from: from - markerLen, to: from, insert: "" },
					{ from: to, to: to + markerLen, insert: "" },
				],
				selection: { anchor: from - markerLen, head: to - markerLen },
			})
		} else {
			view.dispatch({
				changes: { from, to, insert: marker + selectedText + marker },
				selection: { anchor: from + markerLen, head: to + markerLen },
			})
		}
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
		let { from, to } = view.state.selection.main
		let startLine = view.state.doc.lineAt(from)
		let endLine = view.state.doc.lineAt(to)

		let prefixTrimmed = prefix.trimStart()

		if (startLine.number === endLine.number) {
			let lineText = startLine.text
			let { indent, textAfterIndent } = getIndentAndText(lineText)

			if (textAfterIndent.startsWith(prefixTrimmed)) {
				view.dispatch({
					changes: {
						from: startLine.from + indent.length,
						to: startLine.from + indent.length + prefixTrimmed.length,
						insert: "",
					},
					selection: {
						anchor: Math.max(
							startLine.from + indent.length,
							from - prefixTrimmed.length,
						),
					},
				})
			} else {
				let existingPrefix = textAfterIndent.match(
					/^(#{1,6}\s|[-*+]\s(\[[ x]\]\s)?|\d+\.\s)/,
				)
				if (existingPrefix) {
					let existingMarker = existingPrefix[0]
					let diff = prefixTrimmed.length - existingMarker.length
					let prefixStart = startLine.from + indent.length
					view.dispatch({
						changes: {
							from: prefixStart,
							to: prefixStart + existingMarker.length,
							insert: prefix,
						},
						selection: { anchor: from + diff },
					})
				} else {
					let prefixStart = startLine.from + indent.length
					view.dispatch({
						changes: { from: prefixStart, insert: prefix },
						selection: { anchor: from + prefix.length },
					})
				}
			}
			return true
		}

		let changes: { from: number; to: number; insert: string }[] = []
		let allHavePrefix = true

		for (let i = startLine.number; i <= endLine.number; i++) {
			let line = view.state.doc.line(i)
			let { textAfterIndent } = getIndentAndText(line.text)
			if (!textAfterIndent.startsWith(prefixTrimmed)) {
				allHavePrefix = false
				break
			}
		}

		for (let i = startLine.number; i <= endLine.number; i++) {
			let line = view.state.doc.line(i)
			let { indent, textAfterIndent } = getIndentAndText(line.text)

			if (allHavePrefix) {
				changes.push({
					from: line.from + indent.length,
					to: line.from + indent.length + prefixTrimmed.length,
					insert: "",
				})
			} else {
				let existingPrefix = textAfterIndent.match(
					/^(#{1,6}\s|[-*+]\s(\[[ x]\]\s)?|\d+\.\s)/,
				)
				let prefixStart = line.from + indent.length
				if (existingPrefix) {
					let existingMarker = existingPrefix[0]
					changes.push({
						from: prefixStart,
						to: prefixStart + existingMarker.length,
						insert: prefix,
					})
				} else {
					changes.push({
						from: prefixStart,
						to: prefixStart,
						insert: prefix,
					})
				}
			}
		}

		view.dispatch({ changes })
		return true
	}
}

function setHeadingLevel(level: number): Command {
	return view => {
		let { from } = view.state.selection.main
		let line = view.state.doc.lineAt(from)
		let lineText = line.text

		let prefix = "#".repeat(level) + " "
		let existingPrefix = lineText.match(/^#{1,6}\s/)?.[0]

		if (existingPrefix === prefix) {
			view.dispatch({
				changes: {
					from: line.from,
					to: line.from + existingPrefix.length,
					insert: "",
				},
				selection: {
					anchor: Math.max(line.from, from - existingPrefix.length),
				},
			})
		} else if (existingPrefix) {
			let diff = prefix.length - existingPrefix.length
			view.dispatch({
				changes: {
					from: line.from,
					to: line.from + existingPrefix.length,
					insert: prefix,
				},
				selection: { anchor: from + diff },
			})
		} else {
			view.dispatch({
				changes: { from: line.from, insert: prefix },
				selection: { anchor: from + prefix.length },
			})
		}
		return true
	}
}

let insertLink: Command = view => {
	let { from, to } = view.state.selection.main

	let lineFrom = view.state.doc.lineAt(from).from
	let lineTo = view.state.doc.lineAt(to).to
	let lineText = view.state.sliceDoc(lineFrom, lineTo)

	let linkRegex = /\[([^\]]*)\]\(([^)]*)\)/g
	let match
	while ((match = linkRegex.exec(lineText)) !== null) {
		let linkStart = lineFrom + match.index
		let linkEnd = lineFrom + match.index + match[0].length

		if (from >= linkStart && to <= linkEnd) {
			let linkText = match[1]
			view.dispatch({
				changes: { from: linkStart, to: linkEnd, insert: linkText },
				selection: { anchor: linkStart, head: linkStart + linkText.length },
			})
			return true
		}
	}

	let selectedText = view.state.sliceDoc(from, to)
	let text = selectedText || "link"
	let linkMarkup = `[${text}](url)`
	let urlStart = from + text.length + 3
	let urlEnd = urlStart + 3

	view.dispatch({
		changes: { from, to, insert: linkMarkup },
		selection: { anchor: urlStart, head: urlEnd },
	})
	return true
}

let insertImage: Command = view => {
	let { from, to } = view.state.selection.main
	let selectedText = view.state.sliceDoc(from, to)
	let altText = selectedText || "alt"
	let imageMarkup = `![${altText}](url)`
	let urlStart = from + altText.length + 4
	let urlEnd = urlStart + 3

	view.dispatch({
		changes: { from, to, insert: imageMarkup },
		selection: { anchor: urlStart, head: urlEnd },
	})
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
	let { from, to } = view.state.selection.main
	let selectedText = view.state.sliceDoc(from, to)

	if (from === to) {
		let codeBlock = "```\n\n```"
		view.dispatch({
			changes: { from, to, insert: codeBlock },
			selection: { anchor: from + 4 },
		})
	} else {
		let codeBlock = "```\n" + selectedText + "\n```"
		view.dispatch({
			changes: { from, to, insert: codeBlock },
			selection: { anchor: from + 4, head: from + 4 + selectedText.length },
		})
	}
	return true
}

let moveLineUp: Command = view => {
	let { from, to } = view.state.selection.main
	let line = view.state.doc.lineAt(from)
	if (line.number === 1) return false

	let prevLine = view.state.doc.line(line.number - 1)
	let lineText = line.text
	let prevText = prevLine.text
	let anchorOffset = Math.min(from - line.from, lineText.length)
	let headOffset = Math.min(to - line.from, lineText.length)

	view.dispatch({
		changes: [
			{ from: prevLine.from, to: prevLine.to, insert: lineText },
			{ from: line.from, to: line.to, insert: prevText },
		],
		selection: {
			anchor: prevLine.from + anchorOffset,
			head: prevLine.from + headOffset,
		},
	})
	return true
}

let moveLineDown: Command = view => {
	let { from, to } = view.state.selection.main
	let line = view.state.doc.lineAt(from)
	if (line.number === view.state.doc.lines) return false

	let nextLine = view.state.doc.line(line.number + 1)
	let lineText = line.text
	let nextText = nextLine.text
	let anchorOffset = Math.min(from - line.from, lineText.length)
	let headOffset = Math.min(to - line.from, lineText.length)
	let newLineStart = line.from + nextText.length + 1

	view.dispatch({
		changes: [
			{ from: line.from, to: line.to, insert: nextText },
			{ from: nextLine.from, to: nextLine.to, insert: lineText },
		],
		selection: {
			anchor: newLineStart + anchorOffset,
			head: newLineStart + headOffset,
		},
	})
	return true
}

let toggleTaskComplete: Command = view => {
	let { from } = view.state.selection.main
	let line = view.state.doc.lineAt(from)
	let lineText = line.text

	let uncheckedMatch = lineText.match(/^(\s*[-*]\s)\[ \](\s)/)
	if (uncheckedMatch) {
		let prefixLength = uncheckedMatch[1].length
		let checkboxStart = line.from + prefixLength
		view.dispatch({
			changes: {
				from: checkboxStart,
				to: checkboxStart + 3,
				insert: "[x]",
			},
		})
		return true
	}

	let checkedMatch = lineText.match(/^(\s*[-*]\s)\[x\](\s)/i)
	if (checkedMatch) {
		let prefixLength = checkedMatch[1].length
		let checkboxStart = line.from + prefixLength
		view.dispatch({
			changes: {
				from: checkboxStart,
				to: checkboxStart + 3,
				insert: "[ ]",
			},
		})
		return true
	}

	return false
}

let setBody: Command = view => {
	let { from } = view.state.selection.main
	let line = view.state.doc.lineAt(from)
	let lineText = line.text

	let existingPrefix = lineText.match(
		/^(#{1,6}\s|[-*+]\s(\[[ x]\]\s)?|>\s|\d+\.\s)/,
	)?.[0]
	if (existingPrefix) {
		view.dispatch({
			changes: {
				from: line.from,
				to: line.from + existingPrefix.length,
				insert: "",
			},
			selection: { anchor: Math.max(line.from, from - existingPrefix.length) },
		})
	}
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
		let { from } = view.state.selection.main
		let line = view.state.doc.lineAt(from)
		let lineText = line.text

		let uncheckedMatch = lineText.match(/^(\s*[-*]\s)\[ \](\s)/)
		let checkedMatch = lineText.match(/^(\s*[-*]\s)\[x\](\s)/i)

		if (!uncheckedMatch && !checkedMatch) return false

		let prefixLength = uncheckedMatch
			? uncheckedMatch[1].length
			: checkedMatch![1].length
		let checkboxStart = line.from + prefixLength
		let newCheckbox = uncheckedMatch ? "[x]" : "[ ]"

		// Apply checkbox change
		let newDoc = view.state.doc
			.slice(0, checkboxStart)
			.toString()
			.concat(newCheckbox)
			.concat(view.state.doc.slice(checkboxStart + 3).toString())

		// Optionally sort after toggle
		let finalDoc = autoSort ? sortTaskLists(newDoc) : newDoc

		// Single transaction for both changes (one undo)
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: finalDoc },
			selection: { anchor: Math.min(from, finalDoc.length) },
		})
		return true
	}
}

// Custom newline handler that forces tight lists (no blank lines between items)
let insertNewlineContinueMarkupTight: Command = view => {
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
