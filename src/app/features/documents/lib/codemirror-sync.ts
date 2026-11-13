import { Annotation, Transaction, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { diff } from "fast-myers-diff"

export { codeMirrorSync, minimalChanges }
export type { MarkdownSync }

type MarkdownSync = ReturnType<typeof codeMirrorSync>
let remoteChange = Annotation.define<boolean>()

function codeMirrorSync(
	initial: string,
	write: (text: string, editedFrom: string) => void,
) {
	let base = initial
	let pending: string[] = []
	let held: string | null = null
	let composing = false
	let view: EditorView | undefined

	function changed(text: string) {
		if (text === base) return
		let editedFrom = base
		let before = pending
		base = text
		pending = [...pending, text]
		try {
			write(text, editedFrom)
		} catch (error) {
			base = editedFrom
			pending = before
			throw error
		}
		held = null
	}

	function apply(value: string) {
		if (!view) return
		if (composing || view.composing) {
			held = value
			return
		}
		let shown = view.state.doc.toString()
		if (shown !== base) {
			changed(shown)
			return
		}
		let echoed =
			value === pending.at(-1) ? pending.length - 1 : pending.indexOf(value)
		if (echoed >= 0) {
			pending = pending.slice(echoed + 1)
			return
		}
		pending = []
		base = value
		if (value === shown) return
		view.dispatch({
			changes: minimalChanges(shown, value),
			annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)],
		})
	}

	let extension: Extension = [
		EditorView.updateListener.of(update => {
			view = update.view
			if (
				update.docChanged &&
				!update.transactions.every(transaction =>
					transaction.annotation(remoteChange),
				)
			)
				changed(update.state.doc.toString())
		}),
		EditorView.domEventHandlers({
			compositionstart() {
				composing = true
			},
			compositionend(_event, editor) {
				// CodeMirror finishes the composed transaction after the DOM event.
				queueMicrotask(() => {
					if (!view) return
					composing = false
					changed(editor.state.doc.toString())
					if (held !== null) {
						let value = held
						held = null
						apply(value)
					}
				})
			},
		}),
	]
	return {
		extension,
		apply,
		attach(editor: EditorView) {
			view = editor
		},
		destroy() {
			view = undefined
		},
	}
}

function minimalChanges(before: string, after: string) {
	return Array.from(diff(before, after), ([from, to, start, end]) => ({
		from,
		to,
		insert: after.slice(start, end),
	}))
}
