import { RangeSetBuilder, type Extension } from "@codemirror/state"
import {
	Decoration,
	EditorView,
	type DecorationSet,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view"
import { syntaxTree } from "@codemirror/language"

export { createSpellcheckExtension }

function createSpellcheckExtension(
	enabled: boolean,
	language?: string,
): Extension {
	return [
		EditorView.contentAttributes.of({
			spellcheck: enabled ? "true" : "false",
			...(language ? { lang: language } : {}),
		}),
		disabledSpellcheckRegions,
	]
}

let noSpellcheck = Decoration.mark({ attributes: { spellcheck: "false" } })

let disabledSpellcheckRegions = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet

		constructor(view: EditorView) {
			this.decorations = buildDecorations(view)
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = buildDecorations(update.view)
			}
		}
	},
	{ decorations: plugin => plugin.decorations },
)

function buildDecorations(view: EditorView): DecorationSet {
	let builder = new RangeSetBuilder<Decoration>()
	let tree = syntaxTree(view.state)
	let frontmatterEnd = getFrontmatterEnd(view)

	for (let visibleRange of view.visibleRanges) {
		let line = view.state.doc.lineAt(visibleRange.from)
		while (true) {
			let node = tree.resolveInner(line.from, 1)
			let inCodeBlock = false
			let current: typeof node | null = node
			for (; current; current = current.parent) {
				if (current.name === "FencedCode" || current.name === "CodeBlock") {
					inCodeBlock = true
					break
				}
			}

			if ((line.to <= frontmatterEnd || inCodeBlock) && line.length > 0) {
				builder.add(line.from, line.to, noSpellcheck)
			}
			if (line.to >= visibleRange.to || line.number >= view.state.doc.lines) {
				break
			}
			line = view.state.doc.line(line.number + 1)
		}
	}

	return builder.finish()
}

function getFrontmatterEnd(view: EditorView): number {
	let doc = view.state.doc
	if (doc.line(1).text.trim() !== "---") return 0

	for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber++) {
		let line = doc.line(lineNumber)
		if (line.text.trim() === "---") return line.to
	}

	return doc.length
}
