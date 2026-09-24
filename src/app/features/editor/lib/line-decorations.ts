import { type Extension, RangeSetBuilder } from "@codemirror/state"
import {
	EditorView,
	Decoration,
	type DecorationSet,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view"
import { syntaxTree } from "@codemirror/language"

export { lineDecorations }

let h1Line = Decoration.line({ class: "cm-heading1-line" })
let h2Line = Decoration.line({ class: "cm-heading2-line" })
let h3Line = Decoration.line({ class: "cm-heading3-line" })
let h4Line = Decoration.line({ class: "cm-heading4-line" })
let h5Line = Decoration.line({ class: "cm-heading5-line" })
let h6Line = Decoration.line({ class: "cm-heading6-line" })
let blockquoteLine = Decoration.line({ class: "cm-blockquote-line" })
let codeBlockLine = Decoration.line({ class: "cm-codeblock-line" })
let hrLine = Decoration.line({ class: "cm-hr-line" })
let listItemLine = Decoration.line({ class: "cm-listitem-line" })
let taskLine = Decoration.line({ class: "cm-task-line" })
let taskDoneLine = Decoration.line({ class: "cm-task-done-line" })

function getHeadingDecoration(name: string) {
	switch (name) {
		case "ATXHeading1":
		case "SetextHeading1":
			return h1Line
		case "ATXHeading2":
		case "SetextHeading2":
			return h2Line
		case "ATXHeading3":
			return h3Line
		case "ATXHeading4":
			return h4Line
		case "ATXHeading5":
			return h5Line
		case "ATXHeading6":
			return h6Line
		default:
			return null
	}
}

function buildLineDecorations(view: EditorView): DecorationSet {
	let builder = new RangeSetBuilder<Decoration>()
	let doc = view.state.doc

	for (let { from, to } of view.visibleRanges) {
		syntaxTree(view.state).iterate({
			from,
			to,
			enter(node): false | void {
				let headingDeco = getHeadingDecoration(node.name)
				if (headingDeco) {
					let line = doc.lineAt(node.from)
					builder.add(line.from, line.from, headingDeco)
					return
				}

				if (node.name === "Blockquote") {
					let startLine = doc.lineAt(node.from).number
					let endLine = doc.lineAt(node.to).number
					for (let i = startLine; i <= endLine; i++) {
						let line = doc.line(i)
						builder.add(line.from, line.from, blockquoteLine)
					}
					return false
				}

				if (node.name === "FencedCode" || node.name === "CodeBlock") {
					let startLine = doc.lineAt(node.from).number
					let endLine = doc.lineAt(node.to).number
					for (let i = startLine; i <= endLine; i++) {
						let line = doc.line(i)
						builder.add(line.from, line.from, codeBlockLine)
					}
					return false
				}

				if (node.name === "HorizontalRule") {
					let line = doc.lineAt(node.from)
					builder.add(line.from, line.from, hrLine)
					return
				}

				if (node.name === "ListItem") {
					let line = doc.lineAt(node.from)
					let isTask = false
					let isDone = false
					let child = node.node.firstChild
					while (child) {
						if (child.name === "Task") {
							isTask = true
							let marker = child.node.getChild("TaskMarker")
							let taskMarker = marker
								? view.state.sliceDoc(marker.from, marker.to)
								: view.state.sliceDoc(child.from, child.to)
							isDone = /\[x\]/i.test(taskMarker)
							break
						}
						child = child.nextSibling
					}
					builder.add(
						line.from,
						line.from,
						isTask ? (isDone ? taskDoneLine : taskLine) : listItemLine,
					)
				}
			},
		})
	}

	return builder.finish()
}

let lineDecorationPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet

		constructor(view: EditorView) {
			this.decorations = buildLineDecorations(view)
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = buildLineDecorations(update.view)
			}
		}
	},
	{ decorations: v => v.decorations },
)

let lineDecorationTheme = EditorView.baseTheme({
	".cm-heading1-line": {
		lineHeight: "4",
	},
	".cm-heading2-line": {
		lineHeight: "3.6",
	},
	".cm-heading3-line": {
		lineHeight: "3.2",
	},
	".cm-heading4-line, .cm-heading5-line, .cm-heading6-line": {
		lineHeight: "2.8",
	},
	".cm-blockquote-line": {},
	".cm-codeblock-line": {
		backgroundColor: "var(--editor-code-background, rgba(0, 0, 0, 0.05))",
	},
	".cm-hr-line": {},
	".cm-listitem-line": {},
	".cm-task-line": {},
	".cm-task-done-line": {},
})

let lineDecorations: Extension = [lineDecorationPlugin, lineDecorationTheme]
