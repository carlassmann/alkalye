export {
	useDocumentAssets,
	uploadAsset,
	readAssetBlob,
	copyDocumentAssets,
	bytesBlob,
} from "./lib/data"
export { createTldrawAsset, updateTldrawAsset } from "./lib/tldraw"
export type { TldrawSave } from "./lib/tldraw"
export { useTldrawEditor } from "./widgets/use-tldraw-editor"
export {
	TldrawEditorDialog,
	CanvasErrorBoundary,
} from "./widgets/tldraw-editor-dialog"
export { SidebarAssets } from "./widgets/sidebar-assets"
export type {
	SidebarAsset,
	EditorAsset,
	PrintableAsset,
} from "./lib/asset-view-models"
export * from "./lib/asset-transfer"
export {
	compressVideo,
	canEncodeVideo,
	VideoCompressionError,
} from "./lib/video-conversion"
export { imageExtensions } from "./lib/editor-extension"
export {
	loadLocalAssets,
	writeLocalAsset,
	writeLocalWhiteboard,
	readLocalWhiteboard,
	removeLocalAsset,
	copyLocalAssetForRename,
	localEditorContent,
	localDiskContent,
	updateLocalAssetReferences,
	createLocalAssetArchive,
	isLocalAssetReferencedElsewhere,
	referencedLocalAssetIds,
	assertLocalAssetReferencesAvailable,
	MissingLocalAssetError,
	type LocalAsset,
} from "./lib/local-assets"
export { loadTldrawCanvas } from "./widgets/load-tldraw-canvas"
export type { TldrawCanvasHandle } from "./widgets/tldraw-canvas"

export { validateDrawingSnapshot }
async function validateDrawingSnapshot(snapshot: string) {
	let { validateTldrawFile } = await import("./lib/tldraw-file")
	validateTldrawFile(snapshot)
}
