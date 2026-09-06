import { type Extension, RangeSetBuilder } from "@codemirror/state"
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view"

export { wrappedIndent }
export { getLeadingIndentColumns }
export { getWrapIndentColumns }

let indentDecorationCache = new Map<number, Decoration>()

function getLeadingIndentColumns(text: string, tabSize: number): number {
	return getColumns(text, 0, getLeadingWhitespaceEnd(text), tabSize)
}

function getWrapIndentColumns(text: string, tabSize: number): number {
	let leadingWhitespaceEnd = getLeadingWhitespaceEnd(text)
	let listTextStart = getListTextStart(text, leadingWhitespaceEnd)
	if (listTextStart === null) {
		return getColumns(text, 0, leadingWhitespaceEnd, tabSize)
	}

	return getColumns(text, 0, listTextStart, tabSize)
}

function getColumns(
	text: string,
	start: number,
	end: number,
	tabSize: number,
	columns = 0,
): number {
	let result = columns

	for (let i = start; i < end; i += 1) {
		let char = text[i]
		if (char === " ") {
			result += 1
			continue
		}

		if (char === "\t") {
			let remainder = result % tabSize
			result += remainder === 0 ? tabSize : tabSize - remainder
			continue
		}

		result += 1
	}

	return result
}

function getLeadingWhitespaceEnd(text: string): number {
	let i = 0
	while (i < text.length) {
		let char = text[i]
		if (char !== " " && char !== "\t") {
			break
		}
		i += 1
	}
	return i
}

function consumeWhitespace(text: string, start: number): number {
	let i = start
	while (i < text.length) {
		let char = text[i]
		if (char !== " " && char !== "\t") {
			break
		}
		i += 1
	}
	return i
}

function getUnorderedListTextStart(text: string, start: number): number | null {
	if (start >= text.length) return null
	let marker = text[start]
	if (marker !== "-" && marker !== "+" && marker !== "*") return null

	let afterMarker = consumeWhitespace(text, start + 1)
	if (afterMarker === start + 1) return null

	if (
		afterMarker + 2 < text.length &&
		text[afterMarker] === "[" &&
		text[afterMarker + 2] === "]"
	) {
		let afterTaskMarker = consumeWhitespace(text, afterMarker + 3)
		if (afterTaskMarker > afterMarker + 3) {
			return afterTaskMarker
		}
	}

	return afterMarker
}

function getOrderedListTextStart(text: string, start: number): number | null {
	let i = start
	while (i < text.length && text[i] >= "0" && text[i] <= "9") {
		i += 1
	}
	if (i === start || i >= text.length) return null

	if (text[i] !== "." && text[i] !== ")") return null

	let afterMarker = consumeWhitespace(text, i + 1)
	if (afterMarker === i + 1) return null

	return afterMarker
}

function getListTextStart(text: string, start: number): number | null {
	let unorderedStart = getUnorderedListTextStart(text, start)
	if (unorderedStart !== null) {
		return unorderedStart
	}

	return getOrderedListTextStart(text, start)
}

function getIndentDecoration(columns: number): Decoration {
	let cached = indentDecorationCache.get(columns)
	if (cached) {
		return cached
	}

	let decoration = Decoration.line({
		attributes: {
			class: "cm-hanging-indent-line",
			style: `--cm-hanging-indent-columns:${columns}`,
		},
	})

	indentDecorationCache.set(columns, decoration)
	return decoration
}

function buildWrappedIndentDecorations(view: EditorView): DecorationSet {
	let builder = new RangeSetBuilder<Decoration>()
	let doc = view.state.doc
	let tabSize = view.state.tabSize
	let seen = new Set<number>()

	for (let { from, to } of view.visibleRanges) {
		let line = doc.lineAt(from)

		while (true) {
			if (!seen.has(line.number)) {
				seen.add(line.number)
				let columns = getWrapIndentColumns(line.text, tabSize)
				if (columns > 0) {
					builder.add(line.from, line.from, getIndentDecoration(columns))
				}
			}

			if (line.to >= to || line.number >= doc.lines) {
				break
			}

			line = doc.line(line.number + 1)
		}
	}

	return builder.finish()
}

let wrappedIndentPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet

		constructor(view: EditorView) {
			this.decorations = buildWrappedIndentDecorations(view)
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = buildWrappedIndentDecorations(update.view)
			}
		}
	},
	{ decorations: value => value.decorations },
)

let wrappedIndentTheme = EditorView.baseTheme({
	".cm-line.cm-hanging-indent-line": {
		paddingInlineStart: "calc(var(--cm-hanging-indent-columns) * 1ch)",
		textIndent: "calc(var(--cm-hanging-indent-columns) * -1ch)",
	},
})

let wrappedIndent: Extension = [wrappedIndentPlugin, wrappedIndentTheme]
