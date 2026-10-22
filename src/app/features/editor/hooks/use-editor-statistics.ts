import { useEffect, useState, type RefObject } from "react"
import type { EditorView } from "@codemirror/view"
import { editorStatisticsExtension } from "../lib/editor-statistics-extension"
import type { EditorStatistics } from "../lib/editor-statistics-protocol"

export { useEditorStatistics }

type EditorReference = RefObject<{ getEditor(): EditorView | null } | null>

function useEditorStatistics(editor: EditorReference, enabled: boolean) {
	let [stats, setStats] = useState<EditorStatistics | null>(null)
	useEffect(() => {
		if (!enabled) return
		let frame: number
		let unsubscribe: (() => void) | undefined
		function subscribe() {
			let view = editor.current?.getEditor()
			if (!view) {
				frame = requestAnimationFrame(subscribe)
				return
			}
			unsubscribe = view
				.plugin(editorStatisticsExtension)
				?.statistics.subscribe(setStats)
		}
		// The editor publishes its imperative ref after its mount effect creates CodeMirror.
		frame = requestAnimationFrame(subscribe)
		return () => {
			cancelAnimationFrame(frame)
			unsubscribe?.()
		}
	}, [editor, enabled])
	return stats ?? { words: "…", sentences: "…", tasks: "…" }
}
