import { RangeSetBuilder, type Extension } from "@codemirror/state"
import {
	Decoration,
	EditorView,
	type DecorationSet,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view"

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
	let inFence = false
	let inFrontmatter = view.state.doc.line(1).text.trim() === "---"

	for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber++) {
		let line = view.state.doc.line(lineNumber)
		let trimmed = line.text.trim()
		let disabled = inFence || inFrontmatter

		if (/^(`{3,}|~{3,})/.test(trimmed)) {
			disabled = true
			inFence = !inFence
		}
		if (inFrontmatter && lineNumber > 1 && trimmed === "---") {
			disabled = true
			inFrontmatter = false
		}
		if (disabled && line.length > 0)
			builder.add(line.from, line.to, noSpellcheck)
	}

	return builder.finish()
}
