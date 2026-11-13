// v2-todo(assets): binary loading and upload are disabled.
export { imageExtensions } from "./lib/editor-extension"
export type { EditorAsset } from "./lib/asset-view-models"
export { SidebarAssets } from "./widgets/sidebar-assets"

export { validateDrawingSnapshot }
async function validateDrawingSnapshot(snapshot: string) {
	let { validateTldrawFile } = await import("./lib/tldraw-file")
	validateTldrawFile(snapshot)
}
