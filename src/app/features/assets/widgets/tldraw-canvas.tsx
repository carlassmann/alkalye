import { useEffect, useRef, useState } from "react"
import {
	Tldraw,
	serializeTldrawJson,
	type Editor,
	type TLUiOverrides,
	type TldrawOptions,
} from "tldraw"
import "tldraw/tldraw.css"
import { PUBLIC_TLDRAW_LICENSE_KEY } from "astro:env/client"
import { useResolvedTheme } from "@/app/components/appearance"
import { useLocale } from "@/shared/intl/setup"
import type { TldrawSave } from "../lib/tldraw"
import { localTldrawAssetUrls } from "../lib/tldraw-static-assets"
import { createTldrawStore } from "../lib/tldraw-file"

export { TldrawCanvas }
export type { TldrawCanvasHandle }

interface TldrawCanvasHandle {
	save: () => Promise<TldrawSave>
	hasShapes: () => boolean
}

interface TldrawCanvasProps {
	initialJson?: string
	onReady: (handle: TldrawCanvasHandle) => void
	onDirty: () => void
	onEditorMount?: (editor: Editor) => void
}

let components = {
	MainMenu: null,
	PageMenu: null,
	SharePanel: null,
}

let options: Partial<TldrawOptions> = {
	maxPages: 1,
	onBeforePasteFromClipboard({ content }) {
		if (content.type === "files") return false
		if (content.type === "tldraw" && content.content.assets.length > 0)
			return false
	},
	experimental__onDropOnCanvas({ event }) {
		return event.dataTransfer.files.length > 0
	},
}

let overrides: TLUiOverrides = {
	tools(_editor, tools) {
		let drawingTools = { ...tools }
		delete drawingTools.asset
		delete drawingTools.embed
		return drawingTools
	},
	actions(_editor, actions) {
		let drawingActions = { ...actions }
		delete drawingActions["insert-media"]
		delete drawingActions["toggle-dark-mode"]
		return drawingActions
	},
}

function TldrawCanvas({
	initialJson,
	onReady,
	onDirty,
	onEditorMount,
}: TldrawCanvasProps) {
	let [store] = useState(() => createTldrawStore(initialJson))
	let locale = useLocale()
	let colorScheme = useResolvedTheme()
	let editorRef = useRef<Editor | null>(null)
	let onDirtyRef = useRef(onDirty)
	useEffect(() => {
		onDirtyRef.current = onDirty
	}, [onDirty])
	useEffect(() => {
		editorRef.current?.setColorMode(colorScheme)
	}, [colorScheme])

	function handleMount(editor: Editor) {
		editorRef.current = editor
		editor.setColorMode(colorScheme)
		editor.registerExternalAssetHandler("file", null)
		editor.registerExternalAssetHandler("url", null)
		editor.registerExternalContentHandler("files", null)
		editor.registerExternalContentHandler("file-replace", null)
		editor.registerExternalContentHandler("embed", null)
		editor.registerExternalContentHandler("url", null)
		let stopListening = editor.store.listen(() => onDirtyRef.current(), {
			source: "user",
			scope: "document",
		})
		onReady({
			save: () => saveEditor(editor),
			hasShapes: () => editor.getCurrentPageShapeIds().size > 0,
		})
		onEditorMount?.(editor)
		return () => {
			if (editorRef.current === editor) editorRef.current = null
			stopListening()
		}
	}

	return (
		<Tldraw
			store={store}
			colorScheme={colorScheme}
			licenseKey={PUBLIC_TLDRAW_LICENSE_KEY}
			locale={locale}
			assetUrls={localTldrawAssetUrls}
			components={components}
			options={options}
			overrides={overrides}
			onMount={handleMount}
		/>
	)
}

async function saveEditor(editor: Editor): Promise<TldrawSave> {
	let shapeIds = [...editor.getCurrentPageShapeIds()]
	if (shapeIds.length === 0) throw new Error("Add something before saving")

	let [json, light, dark] = await Promise.all([
		serializeTldrawJson(editor),
		editor.toImage(shapeIds, {
			format: "png",
			background: true,
			darkMode: false,
			pixelRatio: 2,
		}),
		editor.toImage(shapeIds, {
			format: "png",
			background: true,
			darkMode: true,
			pixelRatio: 2,
		}),
	])

	return {
		json,
		lightPreview: light.blob,
		darkPreview: dark.blob,
	}
}
