// schema
export {
	Document,
	CursorEntry,
	CursorFeed,
	HighlightRange,
	ArchivedDocumentContent,
} from "./lib/schema"
export { createSpaceDocument } from "./lib/create-space-document"

// lib — document CRUD
export {
	createPersonalDocument,
	deletePersonalDocument,
	restorePersonalDocument,
	permanentlyDeletePersonalDocument,
	copyDocumentToMyList,
} from "./lib/documents"
export type { PersonalDocumentOperation } from "./lib/documents"

export { moveDocumentToSpace } from "./lib/document-move"
export type {
	MoveDocumentDestination,
	MoveDocumentOptions,
} from "./lib/document-move"

export {
	permanentlyDeleteDocument,
	permanentlyDeleteSpace,
	permanentlyDeleteTheme,
	getDaysUntilPermanentDelete,
	PERMANENT_DELETE_DAYS,
} from "./lib/delete-covalue"
export type { Deletable } from "./lib/delete-covalue"

// lib — wikilinks
export { useBacklinkSync } from "./lib/backlink-sync"

export {
	resolveDocTitle,
	resolveDocTitles,
	useDocTitle,
	useDocTitles,
} from "./lib/wikilink-titles"
export type { ResolvedDoc } from "./lib/wikilink-titles"

export { useWikilinkResolver } from "./lib/use-wikilink-resolver"

// lib — metadata
export {
	getDocumentTitle,
	addCopyToTitle,
	isDocumentPinned,
	formatRelativeDate,
	countContentMatches,
} from "./lib/title"

export { isWelcomeDoc } from "./lib/welcome-doc"

export { handleSaveCopy } from "./lib/save-copy"

// lib — queries
export {
	loaderResolve,
	resolve,
	settingsResolve,
	meResolve,
} from "./lib/queries"
export type {
	LoadedDocument,
	LoaderDocument,
	MaybeDocWithContent,
	LoadedMe,
} from "./lib/queries"

// hooks
export { useTrackLastOpened } from "./hooks/use-track-last-opened"
export { useCleanupDeleted } from "./hooks/use-cleanup-deleted"

// widgets
export { FolderRow, useFolderStore } from "./widgets/folder"
export type { FolderState } from "./widgets/folder"
export {
	DuplicateDocDialog,
	duplicateDocument,
} from "./widgets/duplicate-doc-dialog"
export type {
	DuplicateDocDialogProps,
	DuplicateProgress,
} from "./widgets/duplicate-doc-dialog"
export { DocumentSidebar } from "./widgets/document-sidebar"
export { DocumentFinderButton } from "./widgets/document-finder-button"
export { ListSidebar } from "./widgets/list-sidebar"
export { Preview } from "./widgets/preview"
export { SidebarDocumentList } from "./widgets/sidebar-document-list"
export type { SidebarDoc } from "./widgets/sidebar-document-list"

export {
	syncDocumentMetadata,
	extractDocumentMetadata,
	createDocumentMetadata,
} from "./lib/metadata"
export { SidebarFileMenu } from "./widgets/sidebar-file-menu"
export { SidebarViewLinks } from "./widgets/sidebar-view-links"
export { MoveToFolderDialog } from "./widgets/move-to-folder-dialog"

// screens
export { DocScreen } from "./screens/doc-screen"
export {
	SpaceDocScreen,
	spaceResolve,
	spaceLoaderResolve,
} from "./screens/space-doc-screen"
export { DocPreviewScreen, previewResolve } from "./screens/doc-preview-screen"
export { LocalDocScreen } from "./screens/local-doc-screen"
export { newDocLoader } from "./screens/new-doc-screen"
export { homeLoader } from "./screens/home-screen"
