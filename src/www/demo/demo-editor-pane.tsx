import { useEffect, useRef } from "react"
import {
	EditorToolbar,
	MarkdownEditor,
	type MarkdownEditorRef,
} from "@/app/features/editor"
import {
	remoteCursorsExtension,
	setRemoteCursorsEffect,
} from "@/app/features/sharing"
import {
	commentsExtension,
	setCommentDecorationsEffect,
} from "@/app/features/comments"
import type { DemoComment, DemoCursor } from "./demo-script"

export { DemoEditorPane }

// Comments are read-only here, so selecting one does nothing.
let editorExtensions = [remoteCursorsExtension, commentsExtension(() => {})]

function DemoEditorPane({
	content,
	cursors,
	comments,
	onType,
}: {
	content: string
	cursors: DemoCursor[]
	comments: DemoComment[]
	onType: (content: string) => void
}) {
	let editor = useRef<MarkdownEditorRef>(null)

	let typist = cursors.at(-1)

	useEffect(() => {
		let retry = 0
		function showCollaborators() {
			// The editor creates its view after its first render.
			let view = editor.current?.getEditor()
			if (!view) {
				retry = requestAnimationFrame(showCollaborators)
				return
			}
			let text = view.state.doc.toString()
			view.dispatch({
				effects: [
					setRemoteCursorsEffect.of(cursors.map(remoteCursor)),
					setCommentDecorationsEffect.of(commentRanges(comments, text)),
				],
			})
			if (!typist) return
			// Scroll only the editor; CodeMirror's scrollIntoView would also move the page.
			let line = view.lineBlockAt(Math.min(typist.position, text.length))
			view.scrollDOM.scrollTop = line.top - view.scrollDOM.clientHeight / 2
		}
		showCollaborators()
		return () => cancelAnimationFrame(retry)
	}, [cursors, comments, typist, content])

	return (
		// The app pins its toolbar and editor to the window. The transform
		// makes this pane their window. The scroller stays hidden so wheel and
		// touch scroll the page, which drives the demo.
		<div className="relative min-h-0 flex-1 [transform:translateZ(0)] overflow-hidden [&_.cm-scroller]:overflow-hidden!">
			<div className="markdown-editor">
				<MarkdownEditor
					ref={editor}
					value={content}
					onChange={readContent => {
						// Scripted updates also report a change; only the visitor focuses.
						if (!editor.current?.getEditor()?.hasFocus) return
						onType(readContent)
					}}
					extensions={editorExtensions}
					typeToFocus={false}
					spellcheck={false}
					autocomplete={false}
				/>
				<EditorToolbar
					editor={editor}
					onToggleLeftSidebar={ignoreSidebarToggle}
					onToggleRightSidebar={ignoreSidebarToggle}
				/>
			</div>
		</div>
	)
}

// The demo has no document list or settings to open.
function ignoreSidebarToggle() {}

function remoteCursor({ collaborator, position }: DemoCursor) {
	return {
		id: collaborator.name,
		sessionId: collaborator.name,
		name: collaborator.name,
		color: collaborator.color,
		position,
	}
}

function commentRanges(comments: DemoComment[], text: string) {
	return comments.flatMap(comment => {
		let from = text.indexOf(comment.quote)
		if (from === -1) return []
		return [
			{
				id: comment.id,
				from,
				to: from + comment.quote.length,
				resolved: false,
				selected: false,
				orphaned: false,
			},
		]
	})
}
