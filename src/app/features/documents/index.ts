export {
	getDocumentTitle,
	addCopyToTitle,
	isDocumentPinned,
	formatRelativeDate,
	countContentMatches,
} from "./lib/title"
export { codeMirrorSync } from "./lib/codemirror-sync"

export {
	LibraryProvider,
	useLibrary,
	app,
	createDocument,
	canEdit,
} from "./lib/library"
export type { Database, SettingsRow, LibraryDocument } from "./lib/library"
export type { MarkdownSync } from "./lib/codemirror-sync"
export { DocScreen } from "./screens/doc-screen"
export { DocPreviewScreen } from "./screens/doc-preview-screen"
export { HomeScreen } from "./screens/home-screen"
export { NewDocScreen } from "./screens/new-doc-screen"
