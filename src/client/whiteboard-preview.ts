import {
	Editor,
	defaultAddFontsFromNode,
	defaultBindingUtils,
	defaultShapeUtils,
	tipTapDefaultExtensions,
} from "tldraw"
import { createBoardStore, createBoardSync } from "./whiteboard-store"

export let emptyPreview =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" width="100" height="60"/>'

export let previewFonts = {
	tldraw_draw: "/fonts/geist-latin.woff2",
	tldraw_sans: "/fonts/geist-latin.woff2",
	tldraw_serif: "/fonts/geist-latin.woff2",
	tldraw_mono: "/fonts/geist-mono-latin.woff2",
}

export let textOptions = {
	addFontsFromNode: defaultAddFontsFromNode,
	tipTapConfig: { extensions: tipTapDefaultExtensions },
}

// The SVG documents and slides show in place of the board, in the page's
// appearance. Font files are left out to keep the cached register small;
// whoever shows the image embeds the Geist faces under tldraw's names.
export async function editorPreview(editor: Editor, dark: boolean) {
	let shapes = [...editor.getCurrentPageShapeIds()]
	if (!shapes.length) return emptyPreview
	let result = await editor.getSvgString(shapes, {
		background: true,
		darkMode: dark,
		padding: 16,
	})
	if (!result) return emptyPreview
	return result.svg.replace(/@font-face\s*\{[^}]*\}/g, "")
}

// Renders a board that has no cached preview, such as one restored from a
// `.tldr` file or drawn before previews were cached, without showing tldraw.
export async function renderBoardPreview(
	fields: Record<string, string>,
	dark: boolean,
) {
	let store = createBoardStore()
	let sync = createBoardSync(
		store,
		() => fields,
		() => {},
	)
	let container = document.createElement("div")
	container.style.cssText =
		"position:fixed;left:-10000px;top:0;width:800px;height:600px;contain:strict"
	document.body.append(container)
	let editor = new Editor({
		store,
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [],
		getContainer: () => container,
		fontAssetUrls: previewFonts,
		options: { text: textOptions },
	})
	try {
		return await editorPreview(editor, dark)
	} finally {
		editor.dispose()
		sync.dispose()
		container.remove()
	}
}
