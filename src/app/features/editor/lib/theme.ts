import { type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { HighlightStyle } from "@codemirror/language"
import { tags } from "@lezer/highlight"

export { editorTheme, markdownHighlightStyle, codeHighlightStyle }

let editorTheme: Extension = EditorView.theme({
	"&": {
		fontSize: "var(--editor-font-size, 18px)",
		lineHeight: "var(--editor-line-height, 1.8)",
		letterSpacing: "var(--editor-letter-spacing, 0em)",
		fontFamily: "var(--editor-font-family, 'Geist Mono Variable', monospace)",
		fontVariantLigatures: "common-ligatures contextual",
		WebkitFontFeatureSettings: '"liga" 1, "calt" 1',
		fontFeatureSettings: '"liga" 1, "calt" 1',
		backgroundColor: "var(--editor-background, #fafaf8)",
		color: "var(--editor-foreground, #1a1a1a)",
	},
	".cm-content": {
		fontFamily: "var(--editor-font-family, 'Geist Mono Variable', monospace)",
		fontVariantLigatures: "common-ligatures contextual",
		WebkitFontFeatureSettings: '"liga" 1, "calt" 1',
		fontFeatureSettings: '"liga" 1, "calt" 1',
		maxWidth: "var(--editor-content-width, 65ch)",
		margin: "0 auto",
		padding: "var(--editor-padding, 3rem 1.5rem)",
		caretColor: "var(--brand)",
		lineHeight: "var(--editor-line-height, 1.8)",
	},
	".cm-line": {
		padding: "0",
		lineHeight: "var(--editor-line-height, 1.8)",
	},

	".cm-scroller": {
		overflow: "auto",
	},
	"&.cm-focused": {
		outline: "none",
	},
	".cm-placeholder": {
		color: "var(--editor-muted-foreground, #999)",
		fontStyle: "italic",
	},
	".cm-selectionBackground": {
		backgroundColor: "var(--editor-selection, rgba(0, 0, 0, 0.1))",
	},
	"&.cm-focused .cm-selectionBackground": {
		backgroundColor: "var(--editor-selection-focus, rgba(0, 0, 0, 0.15))",
	},
	".cm-activeLine": {
		backgroundColor: "var(--editor-active-line-bg, transparent)",
	},
	".cm-matchingBracket": {
		backgroundColor: "color-mix(in srgb, var(--brand) 18%, transparent)",
		outline: "1px solid color-mix(in srgb, var(--brand) 55%, transparent)",
		borderRadius: "2px",
	},
	".cm-nonmatchingBracket": {
		backgroundColor: "color-mix(in srgb, var(--destructive) 18%, transparent)",
		outline:
			"1px solid color-mix(in srgb, var(--destructive) 55%, transparent)",
		borderRadius: "2px",
	},
	".cm-gutters": {
		backgroundColor: "var(--editor-background, #fafaf8)",
		color: "var(--editor-muted, #999)",
		border: "none",
	},
})

let markdownHighlightStyle = HighlightStyle.define([
	{ tag: tags.heading1, fontWeight: "600" },
	{ tag: tags.heading2, fontWeight: "600" },
	{ tag: tags.heading3, fontWeight: "600" },
	{ tag: tags.heading4, fontWeight: "600" },
	{ tag: tags.heading5, fontWeight: "600" },
	{ tag: tags.heading6, fontWeight: "600" },
	{ tag: tags.emphasis, fontStyle: "italic" },
	{ tag: tags.strong, fontWeight: "600" },
	{
		tag: tags.monospace,
		fontFamily: "var(--editor-code-font-family, 'iA Writer Mono', monospace)",
		backgroundColor: "var(--editor-code-background, rgba(0, 0, 0, 0.05))",
		borderRadius: "3px",
		padding: "0.1em 0.3em",
	},
	{ tag: tags.link, color: "var(--editor-foreground)" },
	{ tag: tags.url, color: "var(--editor-muted-foreground)" },
	{ tag: tags.quote },
	{ tag: tags.processingInstruction, color: "var(--editor-muted-foreground)" },
	{ tag: tags.list, color: "var(--editor-foreground)" },
	{ tag: tags.labelName, color: "var(--editor-muted-foreground)" },
	{ tag: tags.string, color: "var(--editor-muted-foreground)" },
	{ tag: tags.atom, color: "var(--editor-muted-foreground)" },
	{ tag: tags.contentSeparator, color: "var(--editor-syntax)" },
	{
		tag: tags.strikethrough,
		textDecoration: "line-through",
		color: "var(--editor-muted-foreground)",
	},
])

let codeFontFamily =
	"var(--editor-code-font-family, 'iA Writer Mono', monospace)"

let codeHighlightStyle = HighlightStyle.define([
	{
		tag: tags.keyword,
		color: "var(--editor-code-keyword, #555)",
		fontFamily: codeFontFamily,
	},
	{
		tag: tags.atom,
		color: "var(--editor-code-atom, #444)",
		fontFamily: codeFontFamily,
	},
	{
		tag: tags.number,
		color: "var(--editor-code-number, #666)",
		fontFamily: codeFontFamily,
	},
	{
		tag: tags.string,
		color: "var(--editor-code-string, #333)",
		fontFamily: codeFontFamily,
	},
	{
		tag: tags.variableName,
		color: "var(--editor-code-variable, #222)",
		fontFamily: codeFontFamily,
	},
	{
		tag: tags.typeName,
		color: "var(--editor-code-type, #444)",
		fontStyle: "italic",
		fontFamily: codeFontFamily,
	},
	{
		tag: tags.comment,
		color: "var(--editor-code-comment, #999)",
		fontStyle: "italic",
		fontFamily: codeFontFamily,
	},
	{
		tag: tags.propertyName,
		color: "var(--editor-code-property, #333)",
		fontFamily: codeFontFamily,
	},
	{
		tag: tags.operator,
		color: "var(--editor-code-operator, #666)",
		fontFamily: codeFontFamily,
	},
	{
		tag: tags.function(tags.variableName),
		color: "var(--editor-code-function, #222)",
		fontWeight: "600",
		fontFamily: codeFontFamily,
	},
	{
		tag: tags.definition(tags.variableName),
		color: "var(--editor-code-definition, #222)",
		fontWeight: "600",
		fontFamily: codeFontFamily,
	},
])
