export {
	UploadProgressDialog,
	type UploadPhase,
} from "./widgets/upload-progress-dialog"
export {
	ImportProgressDialog,
	type ImportProgress,
} from "./widgets/import-progress-dialog"
export { ImportDropZone } from "./widgets/import-drop-zone"
export {
	createWikilinkExtension,
	type WikilinkTitleResolver,
} from "./lib/marked-wikilink"
export type { ImportedFile, ImportOptions, ExportAsset }
export { canShareDocument, shareDocument, exportDocument, importMarkdownFiles }
type ImportedFile = { name: string; content: string; assets?: ExportAsset[] }
type ImportOptions = {
	folder?: string
	path?: string
	onProgress?: (
		progress: import("./widgets/import-progress-dialog").ImportProgress,
	) => void
	signal?: AbortSignal
}
type ExportAsset = { id: string; name: string; blob: Blob }
function canShareDocument(..._args: unknown[]) {
	return false
}
async function shareDocument(..._args: unknown[]) {
	/* v2-todo(import-export): native sharing. */
}
async function exportDocument(
	content: string,
	title: string,
	..._args: unknown[]
) {
	let url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }))
	let anchor = document.createElement("a")
	anchor.href = url
	anchor.download = title + ".md"
	anchor.click()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function importMarkdownFiles(
	_files: File[] | FileList,
): Promise<ImportedFile[]> {
	// v2-todo(import-export): assets and comments import.
	return []
}
export { exportDocument as saveDocumentAs }
export type SlideAspectRatio = "16:9" | "4:3"
export type SlidePrintLayout = "slides" | "notes"
export function printToPdf(..._args: unknown[]) {
	/* v2-todo(import-export): PDF renderer. */
}
export function printSlidesToPdf(..._args: unknown[]) {
	/* v2-todo(import-export): slide renderer. */
}

export { SidebarImportExport } from "./widgets/sidebar-import-export"
