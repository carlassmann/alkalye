import {
	Annotation,
	ChangeSet,
	Transaction,
	type Extension,
	type Text,
} from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { diff } from "fast-myers-diff"

export { codeMirrorSync, minimalChanges }
export type { MarkdownSync, TextUpdate, TextSource, TextEdit }

type TextEdit = { from: number; to: number; insert: string }

type TextUpdate = {
	previous: string
	splices: readonly { at: number; delete: number; insert: string }[]
}

type TextSource = {
	subscribe(listener: (value: string, update?: TextUpdate) => void): () => void
}

type MarkdownSync = ReturnType<typeof codeMirrorSync>
let remoteChange = Annotation.define<boolean>()

function codeMirrorSync(
	initial: string,
	write: (
		text: string,
		editedFrom: string,
		edit?: TextEdit,
	) => void | Promise<void>,
) {
	let base = initial
	let pending: string[] = []
	let pendingBase: string | null = null
	let held: string | null = null
	let composing = false
	let view: EditorView | undefined
	let knownDocument: Text | undefined
	let knownText = initial
	let writing = 0
	let heldForWrite: { value: string; update?: TextUpdate } | null = null

	function changed(text: string, edit?: TextEdit) {
		if (text === base) return
		let editedFrom = base
		let before = pending
		let previousPendingBase = pendingBase
		if (pending.length === 0) pendingBase = editedFrom
		base = text
		pending = [...pending, text]
		writing++
		try {
			let result = edit
				? write(text, editedFrom, edit)
				: write(text, editedFrom)
			if (result) void result.then(finishedWriting, finishedWriting)
			else finishedWriting()
		} catch (error) {
			base = editedFrom
			pending = before
			pendingBase = previousPendingBase
			finishedWriting()
			throw error
		}
		held = null
	}

	function finishedWriting() {
		writing--
		if (writing !== 0 || !heldForWrite) return
		let latest = heldForWrite
		heldForWrite = null
		apply(latest.value, latest.update)
	}

	function apply(value: string, update?: TextUpdate) {
		if (!view) return
		if (composing || view.composing) {
			held = value
			return
		}
		let shown =
			view.state.doc === knownDocument ? knownText : view.state.doc.toString()
		if (shown !== base) {
			changed(shown)
			return
		}
		if (writing > 0) {
			heldForWrite = { value, update }
			return
		}
		if (pending.length > 0 && value === pendingBase) return
		let echoed =
			value === pending.at(-1) ? pending.length - 1 : pending.indexOf(value)
		if (echoed >= 0) {
			pending = pending.slice(echoed + 1)
			pendingBase = pending.length > 0 ? value : null
			return
		}
		pending = []
		pendingBase = null
		base = value
		if (value === shown) return
		view.dispatch({
			changes:
				update?.previous === shown
					? spliceChanges(shown.length, update.splices)
					: minimalChanges(shown, value),
			annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)],
		})
	}

	let extension: Extension = [
		EditorView.updateListener.of(update => {
			view = update.view
			if (!update.docChanged) return
			let local = !update.transactions.every(transaction =>
				transaction.annotation(remoteChange),
			)
			knownDocument = update.state.doc
			knownText = local ? update.state.doc.toString() : base
			if (local) {
				let edit: TextEdit | undefined
				if (base.length >= 16 * 1024) {
					let from = -1
					let to = 0
					let start = 0
					let end = 0
					update.changes.iterChanges((oldFrom, oldTo, newFrom, newTo) => {
						if (from < 0) {
							from = oldFrom
							start = newFrom
						}
						to = oldTo
						end = newTo
					})
					if (from >= 0 && end - start <= base.length / 4)
						edit = { from, to, insert: knownText.slice(start, end) }
				}
				changed(knownText, edit)
			}
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
			knownDocument = editor.state.doc
			knownText = editor.state.doc.toString()
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

function spliceChanges(length: number, splices: TextUpdate["splices"]) {
	let changes = ChangeSet.empty(length)
	for (let splice of splices) {
		let next = ChangeSet.of(
			{ from: splice.at, to: splice.at + splice.delete, insert: splice.insert },
			changes.newLength,
		)
		changes = changes.compose(next)
	}
	return changes
}
