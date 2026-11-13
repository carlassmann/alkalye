import { useEffect, useRef, useState } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { useDb } from "jazz-tools/react"
import { app, type DocumentRow } from "@/jazz/schema"
import { codeMirrorSync, type MarkdownSync } from "../lib/codemirror-sync"
import { combinedAutocompletion } from "@/app/lib/completion-sources"
import {
	createWikilinkAutocomplete,
	createWikilinkDecorations,
	refreshDocumentLinks,
} from "@/app/features/editor"
import { watchWrite } from "../lib/writes"

export { DocumentEditor }

function DocumentEditor({
	doc,
	documents,
	navigate,
}: {
	doc: DocumentRow
	documents: DocumentRow[]
	navigate: (id: string) => void
}) {
	let db = useDb()
	let parent = useRef<HTMLDivElement>(null)
	let editor = useRef<EditorView | null>(null)
	let links = useRef({ documents, navigate })
	useEffect(() => {
		links.current = { documents, navigate }
		editor.current?.dispatch({ effects: refreshDocumentLinks.of(null) })
	}, [documents, navigate])
	let sync = useRef<MarkdownSync | null>(null)
	let [initial] = useState(doc.content)
	useEffect(() => {
		if (!parent.current) return
		let binding = codeMirrorSync(initial, (content, editedFrom) => {
			watchWrite(
				db.update(
					app.documents,
					doc.id,
					{ content, updatedAt: new Date() },
					{ editedFrom: { content: editedFrom } },
				),
			)
		})
		let view = new EditorView({
			parent: parent.current,
			state: EditorState.create({
				doc: initial,
				extensions: [
					lineNumbers(),
					combinedAutocompletion(),
					createWikilinkAutocomplete(() => links.current.documents),
					createWikilinkDecorations(
						id => {
							let target = links.current.documents.find(
								candidate => candidate.id === id,
							)
							return {
								title: target?.title ?? "Missing document",
								exists: Boolean(target),
							}
						},
						(id, newTab) => {
							if (newTab) window.open(`/app/doc/${id}`, "_blank", "noopener")
							else links.current.navigate(id)
						},
					),
					history(),
					keymap.of([...defaultKeymap, ...historyKeymap]),
					markdown(),
					EditorView.lineWrapping,
					EditorView.contentAttributes.of({
						"aria-label": "Document content",
						spellcheck: "true",
					}),
					binding.extension,
					EditorView.theme({
						"&": { height: "100%" },
						".cm-scroller": { overflow: "auto" },
						".cm-content": {
							padding: "1rem",
							fontSize: "17px",
							lineHeight: "1.7",
						},
					}),
				],
			}),
		})
		editor.current = view
		binding.attach(view)
		sync.current = binding
		return () => {
			editor.current = null
			sync.current = null
			binding.destroy()
			view.destroy()
		}
	}, [db, doc.id, initial])
	useEffect(() => {
		sync.current?.apply(doc.content)
	}, [doc.content])
	return <div ref={parent} className="min-h-0 flex-1 overflow-hidden" />
}
