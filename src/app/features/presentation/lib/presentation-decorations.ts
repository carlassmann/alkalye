import { RangeSetBuilder } from "@codemirror/state"
import {
	EditorView,
	Decoration,
	type DecorationSet,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view"
import type { Extension } from "@codemirror/state"
import { getPresentationMode, parsePresentation } from "./presentation"

export { createPresentationDecorations }

function createPresentationDecorations(): Extension {
	return presentationDecorations
}

let slideLine = Decoration.line({ class: "cm-presentation-slide-line" })

function buildPresentationDecorations(view: EditorView): DecorationSet {
	let builder = new RangeSetBuilder<Decoration>()
	let doc = view.state.doc
	let firstLine = doc.line(1)
	if (firstLine.text !== "---") return builder.finish()

	let frontmatterEnd: number | undefined
	for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber++) {
		let line = doc.line(lineNumber)
		if (line.text === "---") {
			frontmatterEnd = line.to
			break
		}
	}

	if (frontmatterEnd === undefined) return builder.finish()
	if (!getPresentationMode(doc.sliceString(0, frontmatterEnd))) {
		return builder.finish()
	}

	let content = doc.toString()
	let items = parsePresentation(content)
	let ranges: { start: number; end: number }[] = []

	for (let item of items) {
		if (item.type === "block") {
			ranges.push({ start: item.block.startLine, end: item.block.endLine })
		}
	}

	for (let range of ranges) {
		for (let i = range.start; i <= range.end; i++) {
			let lineNum = i + 1
			if (lineNum <= doc.lines) {
				let line = doc.line(lineNum)
				builder.add(line.from, line.from, slideLine)
			}
		}
	}

	return builder.finish()
}

let presentationPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet

		constructor(view: EditorView) {
			this.decorations = buildPresentationDecorations(view)
		}

		update(update: ViewUpdate) {
			if (update.docChanged) {
				this.decorations = buildPresentationDecorations(update.view)
			}
		}
	},
	{ decorations: v => v.decorations },
)

let presentationTheme = EditorView.baseTheme({
	".cm-presentation-slide-line": {
		backgroundColor: "var(--brand-subtle)",
	},
})

let presentationDecorations: Extension = [presentationPlugin, presentationTheme]
