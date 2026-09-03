import { type Extension } from "@codemirror/state"
import { syntaxHighlighting } from "@codemirror/language"
import {
	editorTheme,
	markdownHighlightStyle,
	codeHighlightStyle,
} from "./theme"
import { lineDecorations } from "./line-decorations"
import { wrappedIndent } from "./wrapped-indent"

export { editorBaseExtensions, richMarkdownExtensions }

let editorBaseExtensions: Extension = [editorTheme]

let richMarkdownExtensions: Extension = [
	syntaxHighlighting(markdownHighlightStyle),
	lineDecorations,
	wrappedIndent,
	syntaxHighlighting(codeHighlightStyle),
]
