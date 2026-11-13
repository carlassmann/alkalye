export {
	getDocumentTitle,
	addCopyToTitle,
	isDocumentPinned,
	formatRelativeDate,
	countContentMatches,
} from "./lib/title"
export { codeMirrorSync } from "./lib/codemirror-sync"

export { LibraryProvider, useLibrary, app } from "./lib/library"
export type { Database, SettingsRow } from "./lib/library"
export type { MarkdownSync } from "./lib/codemirror-sync"
export { DocScreen } from "./screens/doc-screen"
export { DocPreviewScreen } from "./screens/doc-preview-screen"
export { HomeScreen } from "./screens/home-screen"
export { NewDocScreen } from "./screens/new-doc-screen"

export { LocalDocScreen } from "./screens/local-doc-screen"

export { Preview } from "./widgets/preview"
export type { ResolvedDoc } from "./lib/wikilink-titles"
export { createDocument, updateContent } from "./lib/library"
export type { LibraryDocument } from "./lib/library"
