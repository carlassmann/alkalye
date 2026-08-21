import { EditorSelection } from "@codemirror/state"
import { type EditorView } from "@codemirror/view"
import { htmlToMarkdown } from "./html-to-markdown"

export { insertPastedHtml, insertPastedText, insertRawPastedText, isUrl }

function insertPastedHtml(view: EditorView, html: string): boolean {
	let markdown = htmlToMarkdown(html)
	if (!markdown) return false
	return insertPastedText(view, markdown)
}

function insertPastedText(view: EditorView, text: string): boolean {
	if (view.state.readOnly) return false
	return insertPaste(view, text, true)
}

function insertRawPastedText(view: EditorView, text: string): boolean {
	if (view.state.readOnly) return false
	return insertPaste(view, text, false)
}

function insertPaste(view: EditorView, text: string, linkSelection: boolean) {
	let pastedUrl = isUrl(text)
	let transaction = view.state.changeByRange(range => {
		let selectedText = view.state.sliceDoc(range.from, range.to)
		let insert =
			linkSelection && pastedUrl && selectedText
				? `[${selectedText}](${text.trim()})`
				: text
		return {
			changes: { from: range.from, to: range.to, insert },
			range: EditorSelection.cursor(range.from + insert.length),
		}
	})
	view.dispatch(transaction, { userEvent: "input.paste", scrollIntoView: true })
	return true
}

function isUrl(value: string): boolean {
	let trimmed = value.trim()
	if (!trimmed || /\s/.test(trimmed)) return false
	try {
		let url = new URL(trimmed)
		return url.protocol === "http:" || url.protocol === "https:"
	} catch {
		return false
	}
}
