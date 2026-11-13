import { leavePersonalDocument } from "@/app/features/sharing"
import {
	useState,
	useRef,
	useEffect,
	useDeferredValue,
	useImperativeHandle,
	type Ref,
	type ChangeEvent,
	type FormEvent,
	type DragEvent,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { Link } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useDb } from "jazz-tools/react"
import { type LibraryDocument, useLibrary, app } from "../lib/library"
import { formatRelativeDate } from "../lib/title"
import { setPinned } from "../lib/library"
import {
	emptySidebarSelection,
	extendSidebarSelection,
	pruneSidebarSelection,
	toggleSidebarSelection,
} from "../lib/sidebar-selection"
import { useHasFinePointer } from "@/app/hooks/use-fine-pointer"
import { cn } from "@/app/lib/cn"
import {
	SidebarBulkDialogs,
	SidebarBulkMenuItems,
	notifySkippedDocuments,
	type SidebarBulkDialog,
} from "./sidebar-bulk-actions"
import { setSidebarDragPreview } from "./sidebar-drag-preview"
import {
	getSidebarDropAction,
	type SidebarDropAction,
} from "../lib/sidebar-drop"
import { getSidebarKeyboardAction } from "../lib/sidebar-keyboard-navigation"
import { getDaysUntilPermanentDelete } from "../lib/documents"
import { permanentlyDeletePersonalDocument } from "../lib/documents"
import { Button } from "@/app/components/ui/button"
import { Input } from "@/app/components/ui/input"
import {
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarGroup,
	SidebarGroupContent,
} from "@/app/components/ui/sidebar"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/app/components/ui/context-menu"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import {
	FileText,
	Users,
	Globe,
	Presentation,
	Eye,
	Download,
	Trash2,
	LogOut,
	ScrollText,
	Copy,
	RotateCcw,
	Pin,
	Folder,
	FolderInput,
	ArrowRightLeft,
	Plus,
	FolderPlus,
} from "lucide-react"
import {
	TextHighlight,
	parseSearchTerms,
} from "@/app/components/ui/text-highlight"
import { Spinner } from "@/app/components/ui/spinner"
import { NativeShareIcon } from "@/app/components/native-share-icon"
import {
	getSharingStatus,
	isDocumentPublic,
	hasIndividualShares,
	canEdit,
	getDocumentGroup,
} from "@/app/features/sharing"
import { useFolderStore, FolderRow } from "./folder"
import {
	SidebarSearchFilterBar,
	type SortMode,
	type TypeFilter,
} from "./sidebar-search-filter-bar"
import { SidebarFileRowContent } from "./sidebar-file-row-content"
import {
	exportDocument,
	canShareDocument,
	shareDocument,
	importMarkdownFiles,
	ImportProgressDialog,
	type ImportedFile,
	type ImportOptions,
	type ImportProgress,
} from "@/app/features/import-export"
import { ShareDialog } from "@/app/features/sharing"
import { MoveToFolderDialog } from "./move-to-folder-dialog"
import { MoveToSpaceDialog } from "@/app/features/spaces"
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog"
import { testIds } from "@/app/lib/test-ids"
import { useIntl } from "@/shared/intl/setup"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { Label } from "@/app/components/ui/label"
import { moveDocumentsToFolder } from "../lib/folders"
import { Checkbox } from "@/app/components/ui/checkbox"

export { SidebarDocumentList, matchesSearchTerms, matchesTypeFilter }
export type { SidebarDoc }

type SidebarDoc = LibraryDocument
type FilterableSidebarDoc = {
	title?: string
	tags?: string[]
	pinned?: boolean
	isPresentation?: boolean
	contentUpdatedAt?: Date
	metadataUpdatedAt?: Date
	updatedAt?: Date
	deletedAt?: Date
}

interface SidebarDocumentListProps {
	docs: SidebarDoc[]
	currentDocId: string | undefined
	isLoading: boolean
	onDocClick: () => void
	onDuplicate: (doc: SidebarDoc) => void
	onDelete: (doc: SidebarDoc) => void
	onCreateFolder: (path: string) => Promise<void>
	onImport: (files: ImportedFile[], options?: ImportOptions) => Promise<void>
	spaceId?: string
	spaceGroupId?: string
}

let sidebarDocumentsMimeType = "application/x-alkalye-documents"

type DocumentListHandle = { focusFirstRow: () => boolean }

type ListItem =
	| { type: "doc"; doc: SidebarDoc; depth: number }
	| { type: "folder"; path: string; depth: number; docCount: number }

function matchesTypeFilter(
	doc: SidebarDoc | FilterableSidebarDoc,
	typeFilter: TypeFilter,
) {
	if (typeFilter === "deleted") return Boolean(doc.deletedAt)
	if (doc.deletedAt) return false
	if (typeFilter === "all") return true
	if (typeFilter === "presentation") return doc.isPresentation === true
	if (typeFilter === "document") return doc.isPresentation !== true
	return false
}

function matchesSearchTerms(
	doc: SidebarDoc | FilterableSidebarDoc,
	search: string,
) {
	let terms = parseSearchTerms(search).map(t => t.toLowerCase())
	if (terms.length === 0) return true

	let searchable = [doc.title ?? "Untitled", ...(doc.tags ?? [])]
		.join(" ")
		.toLowerCase()
	return terms.every(q => searchable.includes(q))
}

function SidebarDocumentList({
	docs,
	currentDocId,
	isLoading,
	onDocClick,
	onDuplicate,
	onDelete,
	onCreateFolder,
	onImport,
	spaceId,
	spaceGroupId,
}: SidebarDocumentListProps) {
	useLibrary()
	let t = useIntl()
	let [search, setSearch] = useState("")
	let [sort, setSort] = useState<SortMode>("latest")
	let [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
	let { viewMode, setViewMode } = useFolderStore()
	let searchInputRef = useRef<HTMLInputElement>(null)
	let listHandleRef = useRef<DocumentListHandle>(null)

	function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key !== "ArrowDown") return
		if (!listHandleRef.current?.focusFirstRow()) return
		event.preventDefault()
	}

	let deferredSearch = useDeferredValue(search)
	let deferredSort = useDeferredValue(sort)
	let deferredType = useDeferredValue(typeFilter)

	let deletedDocs = docs.filter(d => d.deletedAt)

	let typeFilteredDocs = docs.filter(doc =>
		matchesTypeFilter(doc, deferredType),
	)

	let sortedDocs =
		deferredType === "deleted"
			? [...typeFilteredDocs].sort(
					(a, b) =>
						new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime(),
				)
			: deferredSort === "alphabetical"
				? [...typeFilteredDocs].sort((a, b) => {
						if (a.pinned !== b.pinned) return b.pinned ? 1 : -1
						return (a.title ?? "")
							.toLowerCase()
							.localeCompare((b.title ?? "").toLowerCase())
					})
				: [...typeFilteredDocs].sort((a, b) => {
						if (a.pinned !== b.pinned) return b.pinned ? 1 : -1
						return (
							new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
						)
					})

	let filteredDocs = deferredSearch.trim()
		? sortedDocs.filter(d => matchesSearchTerms(d, deferredSearch))
		: sortedDocs

	return (
		<>
			<SidebarSearchFilterBar
				search={search}
				onSearchChange={setSearch}
				sort={sort}
				onSortChange={setSort}
				typeFilter={typeFilter}
				onTypeChange={setTypeFilter}
				deletedCount={deletedDocs.length}
				onDeletedSelect={() => setTypeFilter("deleted")}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				searchTestId={testIds.doc.searchInput}
				searchInputRef={searchInputRef}
				onSearchKeyDown={handleSearchKeyDown}
			/>
			<SidebarGroup
				className="flex-1"
				data-testid={testIds.sidebar.documentList}
				aria-busy={isLoading}
			>
				<SidebarGroupContent className="flex min-h-0 flex-1 flex-col">
					<DocumentListContent
						docs={filteredDocs}
						currentDocId={currentDocId}
						searchQuery={deferredSearch}
						typeFilter={deferredType}
						isLoading={isLoading}
						onDocClick={onDocClick}
						onDuplicate={onDuplicate}
						onDelete={onDelete}
						onCreateFolder={onCreateFolder}
						onImport={onImport}
						spaceId={spaceId}
						spaceGroupId={spaceGroupId}
						onLeaveTop={() => searchInputRef.current?.focus()}
						ref={listHandleRef}
						t={t}
					/>
				</SidebarGroupContent>
			</SidebarGroup>
		</>
	)
}

function DocumentListContent({
	docs,
	currentDocId,
	searchQuery,
	typeFilter,
	isLoading,
	onDocClick,
	onDuplicate,
	onDelete,
	onCreateFolder,
	onImport,
	spaceId,
	spaceGroupId,
	onLeaveTop,
	ref,
	t,
}: {
	docs: SidebarDoc[]
	currentDocId: string | undefined
	searchQuery: string
	typeFilter: TypeFilter
	isLoading: boolean
	onDocClick: () => void
	onDuplicate: (doc: SidebarDoc) => void
	onDelete: (doc: SidebarDoc) => void
	onCreateFolder: (path: string) => Promise<void>
	onImport: (files: ImportedFile[], options?: ImportOptions) => Promise<void>
	spaceId?: string
	spaceGroupId?: string
	onLeaveTop: () => void
	ref: Ref<DocumentListHandle>
	t: ReturnType<typeof useIntl>
}) {
	let { db } = useLibrary()
	let parentRef = useRef<HTMLDivElement>(null)
	let fileInputRef = useRef<HTMLInputElement>(null)
	let { viewMode, isCollapsed, toggleFolder } = useFolderStore()
	let [newFolderOpen, setNewFolderOpen] = useState(false)
	let [importProgress, setImportProgress] = useState<ImportProgress | null>(
		null,
	)
	let [abortController, setAbortController] = useState<AbortController | null>(
		null,
	)
	let [selection, setSelection] = useState(emptySidebarSelection)
	// undefined: no drop target, null: the root level
	let [dropTargetPath, setDropTargetPath] = useState<string | null>()
	let [draggedDocs, setDraggedDocs] = useState<SidebarDoc[]>([])
	let [bulkDialog, setBulkDialog] = useState<SidebarBulkDialog>(null)
	// Kept while a bulk dialog is open, since the selection can change underneath it
	let [bulkDialogDocs, setBulkDialogDocs] = useState<SidebarDoc[]>([])
	let dropHintRef = useRef<HTMLDivElement>(null)
	let lastDragPointRef = useRef({ x: 0, y: 0 })
	let hasFinePointer = useHasFinePointer()

	let listItems: ListItem[] = buildListItems(docs, viewMode, isCollapsed)
	let existingFolders = getExistingFolders(docs)
	let canSelect = typeFilter !== "deleted"
	let canDrag = canSelect && viewMode === "folders" && hasFinePointer
	let visibleDocIds = listItems.flatMap(item =>
		item.type === "doc" ? [item.doc.id] : [],
	)
	let visibleSelection = pruneSidebarSelection(
		selection,
		canSelect ? visibleDocIds : [],
	)
	// Hidden documents leave the selection for good, so they can't reappear in a later bulk action
	if (visibleSelection !== selection) setSelection(visibleSelection)
	let selectedDocs = docs.filter(doc => visibleSelection.ids.includes(doc.id))

	let virtualizer = useVirtualizer({
		count: listItems.length,
		getScrollElement: () => parentRef.current,
		estimateSize: index => (listItems[index]?.type === "folder" ? 36 : 60),
		overscan: 5,
	})

	function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		let rowElement =
			event.target instanceof HTMLElement
				? event.target.closest<HTMLElement>("[data-index]")
				: null
		if (!rowElement) return
		let index = Number(rowElement.dataset.index)
		let focusedItem = listItems[index]
		let focusedDocId =
			focusedItem?.type === "doc" ? focusedItem.doc.id : currentDocId

		if (event.key === "Escape" && visibleSelection.ids.length > 0) {
			event.preventDefault()
			return setSelection(emptySidebarSelection)
		}
		if (canSelect && event.key === "a" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault()
			return setSelection({
				ids: visibleDocIds,
				anchorId: visibleDocIds[0] ?? null,
			})
		}
		if (canSelect && event.key === " " && focusedItem?.type === "doc") {
			event.preventDefault()
			return setSelection(
				toggleSidebarSelection(
					visibleSelection,
					focusedItem.doc.id,
					currentDocId,
				),
			)
		}

		let rows = listItems.map(item =>
			item.type === "folder"
				? { ...item, isCollapsed: isCollapsed(item.path) }
				: item,
		)
		let action = getSidebarKeyboardAction(event.key, index, rows)
		if (!action) return
		event.preventDefault()
		if (action.type === "leaveTop") return onLeaveTop()
		if (action.type === "focus") {
			let target = listItems[action.index]
			if (canSelect && event.shiftKey && target?.type === "doc") {
				setSelection(
					extendSidebarSelection(
						visibleSelection,
						target.doc.id,
						focusedDocId,
						visibleDocIds,
					),
				)
			}
			return focusRow(action.index)
		}
		let folder = listItems[action.index]
		if (folder?.type === "folder") toggleFolder(folder.path)
	}

	useImperativeHandle(ref, () => ({
		focusFirstRow() {
			if (listItems.length === 0) return false
			focusRow(0)
			return true
		},
	}))

	function focusRow(index: number) {
		virtualizer.scrollToIndex(index)
		focusRenderedRow(index, 5)
	}

	function handleDocClick(event: MouseEvent<HTMLAnchorElement>, docId: string) {
		if (canSelect && (event.metaKey || event.ctrlKey)) {
			event.preventDefault()
			return setSelection(
				toggleSidebarSelection(visibleSelection, docId, currentDocId),
			)
		}
		if (canSelect && event.shiftKey) {
			event.preventDefault()
			return setSelection(
				extendSidebarSelection(
					visibleSelection,
					docId,
					currentDocId,
					visibleDocIds,
				),
			)
		}
		setSelection(emptySidebarSelection)
		onDocClick()
	}

	function handleDocContextMenu(docId: string) {
		if (!visibleSelection.ids.includes(docId)) {
			setSelection(emptySidebarSelection)
		}
	}

	function openBulkDialog(dialog: SidebarBulkDialog) {
		setBulkDialogDocs(selectedDocs)
		setBulkDialog(dialog)
	}

	function handleDocDragStart(event: DragEvent<HTMLElement>, doc: SidebarDoc) {
		let isDraggingSelection = visibleSelection.ids.includes(doc.id)
		let docsToDrag = (isDraggingSelection ? selectedDocs : [doc]).filter(
			canEdit,
		)
		setDraggedDocs(docsToDrag)
		event.dataTransfer.clearData()
		event.dataTransfer.setData(
			sidebarDocumentsMimeType,
			docsToDrag.map(draggedDoc => draggedDoc.id).join(","),
		)
		event.dataTransfer.effectAllowed = "move"
		setSidebarDragPreview(
			event.nativeEvent,
			docsToDrag.map(draggedDoc => draggedDoc.title ?? "Untitled"),
			count => t("doc.sidebar.dragMore", { count: String(count) }),
		)
	}

	function handleDocDragEnd() {
		setDraggedDocs([])
		setDropTargetPath(undefined)
	}

	function positionDropHint(hint: HTMLDivElement | null) {
		dropHintRef.current = hint
		if (!hint) return
		let { x, y } = lastDragPointRef.current
		hint.style.translate = `${x + 16}px ${y - 36}px`
	}

	function handleListDragOver(event: DragEvent<HTMLDivElement>) {
		if (!event.dataTransfer.types.includes(sidebarDocumentsMimeType)) return
		event.preventDefault()
		event.dataTransfer.dropEffect = "move"
		lastDragPointRef.current = { x: event.clientX, y: event.clientY }
		positionDropHint(dropHintRef.current)
		let path = getDropPath(event.target)
		if (path !== dropTargetPath) setDropTargetPath(path)
	}

	function handleListDragLeave(event: DragEvent<HTMLDivElement>) {
		let isStillInside =
			event.relatedTarget instanceof Node &&
			event.currentTarget.contains(event.relatedTarget)
		if (!isStillInside) setDropTargetPath(undefined)
	}

	function handleListDrop(event: DragEvent<HTMLDivElement>) {
		if (!event.dataTransfer.types.includes(sidebarDocumentsMimeType)) return
		event.preventDefault()
		let docsToMove = draggedDocs
		handleDocDragEnd()
		void moveDocumentsToFolder(db, docsToMove, getDropPath(event.target)).then(
			result => notifySkippedDocuments(result, t),
		)
	}

	// Dropping on a document moves into that document's folder
	function getDropPath(target: EventTarget): string | null {
		let row =
			target instanceof Element
				? target.closest<HTMLElement>("[data-index]")
				: null
		let item = row ? listItems[Number(row.dataset.index)] : undefined
		if (item?.type === "folder") return item.path
		if (item?.type === "doc") return item.doc.path ?? null
		return null
	}

	// Rows outside the virtualized window only mount after the scroll above
	function focusRenderedRow(index: number, framesLeft: number) {
		let row = parentRef.current?.querySelector<HTMLElement>(
			`[data-index="${index}"] :is(a, button)`,
		)
		if (row) return row.focus()
		if (framesLeft > 0) {
			requestAnimationFrame(() => focusRenderedRow(index, framesLeft - 1))
		}
	}

	async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
		let files = event.target.files
		if (!files?.length) return

		let controller = new AbortController()
		setAbortController(controller)
		setImportProgress({
			phase: "reading",
			currentFile: t("importExport.progress.readingFilesInitial"),
			fileIndex: 0,
			totalFiles: files.length,
			assetIndex: 0,
			totalAssets: 0,
			compressionProgress: 0,
		})

		try {
			let imported = await importMarkdownFiles(files)
			if (!controller.signal.aborted) {
				await onImport(imported, {
					onProgress: setImportProgress,
					signal: controller.signal,
				})
			}
		} catch (error) {
			if (!(error instanceof Error && error.name === "AbortError")) {
				console.error("Import failed:", error)
			}
		} finally {
			setImportProgress(null)
			setAbortController(null)
			event.target.value = ""
		}
	}

	function handleCancelImport() {
		abortController?.abort()
		setImportProgress(null)
		setAbortController(null)
	}

	let importControls = (
		<>
			<input
				ref={fileInputRef}
				type="file"
				accept=".md,.markdown,.txt,.zip"
				multiple
				className="hidden"
				onChange={handleImportFileChange}
			/>
			{importProgress && (
				<ImportProgressDialog
					open={true}
					progress={importProgress}
					onCancel={handleCancelImport}
				/>
			)}
		</>
	)

	if (isLoading) {
		return (
			<div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-8 text-xs">
				<Spinner className="size-6" />
				<p>{t("doc.sidebar.loadingDocuments")}</p>
			</div>
		)
	}

	if (docs.length === 0) {
		return (
			<SidebarEmptyAreaContextMenu
				spaceId={spaceId}
				onNewFolder={() => setNewFolderOpen(true)}
				onImport={() => fileInputRef.current?.click()}
				t={t}
			>
				<div className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-8 text-xs">
					<FileText className="size-6 opacity-50" />
					<p>
						{searchQuery
							? t("doc.sidebar.noMatches")
							: typeFilter === "deleted"
								? t("doc.sidebar.noDeletedDocuments")
								: t("doc.sidebar.noDocuments")}
					</p>
				</div>
				<NewFolderDialog
					open={newFolderOpen}
					onOpenChange={setNewFolderOpen}
					existingFolders={existingFolders}
					docs={docs}
					onCreate={onCreateFolder}
					t={t}
				/>
				{importControls}
			</SidebarEmptyAreaContextMenu>
		)
	}

	return (
		<>
			<SidebarEmptyAreaContextMenu
				spaceId={spaceId}
				onNewFolder={() => setNewFolderOpen(true)}
				onImport={() => fileInputRef.current?.click()}
				t={t}
			>
				<div
					ref={parentRef}
					className={cn(
						"min-h-0 flex-1 overflow-auto",
						dropTargetPath === null && "bg-accent/40",
					)}
					onKeyDown={handleListKeyDown}
					onDragOver={canDrag ? handleListDragOver : undefined}
					onDragLeave={canDrag ? handleListDragLeave : undefined}
					onDrop={canDrag ? handleListDrop : undefined}
				>
					<div
						className="relative w-full"
						style={{ height: virtualizer.getTotalSize() }}
					>
						{virtualizer.getVirtualItems().map(virtualRow => {
							let item = listItems[virtualRow.index]
							if (!item) return null

							return (
								<div
									key={virtualRow.key}
									data-index={virtualRow.index}
									ref={virtualizer.measureElement}
									className="absolute top-0 left-0 w-full"
									style={{ transform: `translateY(${virtualRow.start}px)` }}
								>
									{item.type === "folder" ? (
										<FolderRow
											path={item.path}
											depth={item.depth}
											docCount={item.docCount}
											isCollapsed={isCollapsed(item.path)}
											onToggle={() => toggleFolder(item.path)}
											docsInFolder={getDocsInFolder(docs, item.path)}
											existingFolders={existingFolders}
											onDeleteDocs={deletedDocs => {
												for (let d of deletedDocs) onDelete(d)
											}}
											onNewDocument={path => void onCreateFolder(path)}
											isDropTarget={dropTargetPath === item.path}
										/>
									) : typeFilter === "deleted" ? (
										<DeletedDocumentItem
											doc={item.doc}
											searchQuery={searchQuery}
											t={t}
										/>
									) : (
										<DocumentItem
											doc={item.doc}
											isActive={
												visibleSelection.ids.length > 0
													? visibleSelection.ids.includes(item.doc.id)
													: item.doc.id === currentDocId
											}
											isSelected={visibleSelection.ids.includes(item.doc.id)}
											onClick={handleDocClick}
											onDragStart={
												canDrag && canEdit(item.doc)
													? handleDocDragStart
													: undefined
											}
											onDragEnd={handleDocDragEnd}
											onContextMenu={handleDocContextMenu}
											bulkMenu={
												selectedDocs.length > 1 &&
												visibleSelection.ids.includes(item.doc.id) ? (
													<SidebarBulkMenuItems
														docs={selectedDocs}
														onOpenDialog={openBulkDialog}
														onClear={() => setSelection(emptySidebarSelection)}
													/>
												) : null
											}
											searchQuery={searchQuery}
											onDuplicate={onDuplicate}
											onDelete={onDelete}
											showPath={viewMode === "flat"}
											existingFolders={existingFolders}
											depth={item.depth}
											spaceId={spaceId}
											spaceGroupId={spaceGroupId}
											t={t}
										/>
									)}
								</div>
							)
						})}
					</div>
				</div>
			</SidebarEmptyAreaContextMenu>
			{dropTargetPath !== undefined &&
				draggedDocs.length > 0 &&
				createPortal(
					<div
						ref={positionDropHint}
						className="bg-foreground text-background pointer-events-none fixed top-0 left-0 z-50 px-2 py-1 text-xs font-medium whitespace-nowrap shadow-md"
						data-testid={testIds.sidebar.dropHint}
					>
						{describeDropAction(
							getSidebarDropAction(
								draggedDocs.map(draggedDoc => draggedDoc.path ?? null),
								dropTargetPath,
							),
							t,
						)}
					</div>,
					document.body,
				)}
			<div aria-live="polite" className="sr-only">
				{visibleSelection.ids.length > 0 &&
					t("doc.sidebar.selectedCount", {
						count: String(visibleSelection.ids.length),
					})}
			</div>
			<SidebarBulkDialogs
				docs={bulkDialogDocs}
				dialog={bulkDialog}
				existingFolders={existingFolders}
				onDialogChange={setBulkDialog}
				onDelete={onDelete}
				onClear={() => setSelection(emptySidebarSelection)}
			/>
			<NewFolderDialog
				open={newFolderOpen}
				onOpenChange={setNewFolderOpen}
				existingFolders={existingFolders}
				docs={docs}
				onCreate={onCreateFolder}
				t={t}
			/>
			{importControls}
		</>
	)
}

function SidebarEmptyAreaContextMenu({
	children,
	spaceId,
	onNewFolder,
	onImport,
	t,
}: {
	children: ReactNode
	spaceId?: string
	onNewFolder: () => void
	onImport: () => void
	t: ReturnType<typeof useIntl>
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger className="flex min-h-0 flex-1 flex-col">
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent>
				<NewDocumentContextMenuItem spaceId={spaceId} t={t} />
				<ContextMenuItem onClick={onNewFolder}>
					<FolderPlus />
					{t("doc.newFolder")}
				</ContextMenuItem>
				<ContextMenuItem onClick={onImport}>
					<Download />
					{t("importExport.import")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}

function NewDocumentContextMenuItem({
	spaceId,
	t,
}: {
	spaceId?: string
	t: ReturnType<typeof useIntl>
}) {
	if (spaceId) {
		return (
			<ContextMenuItem render={<Link to="/new" search={{ spaceId }} />}>
				<Plus />
				{t("doc.new")}
			</ContextMenuItem>
		)
	}

	return (
		<ContextMenuItem render={<Link to="/new" />}>
			<Plus />
			{t("doc.new")}
		</ContextMenuItem>
	)
}

function NewFolderDialog({
	open,
	onOpenChange,
	existingFolders,
	docs,
	onCreate,
	t,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	existingFolders: string[]
	docs: SidebarDoc[]
	onCreate: (path: string) => Promise<void>
	t: ReturnType<typeof useIntl>
}) {
	let { db } = useLibrary()
	let [name, setName] = useState("")
	let [error, setError] = useState("")
	let [mode, setMode] = useState<"empty" | "move">("empty")
	let [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set())

	let path = name.trim()
	let isDuplicate = existingFolders.some(
		folder => folder.toLowerCase() === path.toLowerCase(),
	)
	let selectableDocs = docs.filter(doc => !doc.deletedAt)
	let selectedDocs = selectableDocs.filter(doc => selectedDocIds.has(doc.id))
	let needsSelection = mode === "move" && selectedDocIds.size === 0

	function handleOpenChange(nextOpen: boolean) {
		if (nextOpen) {
			setName("")
			setError("")
			setMode("empty")
			setSelectedDocIds(new Set())
		}
		onOpenChange(nextOpen)
	}

	async function handleSubmit(event: FormEvent) {
		event.preventDefault()
		if (!path) {
			setError(t("doc.folderDialog.nameRequired"))
			return
		}
		if (isDuplicate) {
			setError(t("doc.folderDialog.alreadyExists"))
			return
		}
		if (needsSelection) {
			setError(t("doc.folderDialog.selectDocuments"))
			return
		}

		if (mode === "move") {
			notifySkippedDocuments(
				await moveDocumentsToFolder(db, selectedDocs, path),
				t,
			)
		} else {
			await onCreate(path)
		}
		onOpenChange(false)
	}

	function toggleSelectedDoc(docId: string) {
		setSelectedDocIds(current => {
			let next = new Set(current)
			if (next.has(docId)) {
				next.delete(docId)
			} else {
				next.add(docId)
			}
			return next
		})
		setError("")
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-sm">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>{t("doc.folderDialog.createTitle")}</DialogTitle>
						<DialogDescription>
							{t("doc.folderDialog.createDescription")}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<Label htmlFor="new-folder-name" className="sr-only">
							{t("doc.folderDialog.createFolderName")}
						</Label>
						<Input
							id="new-folder-name"
							value={name}
							onChange={event => {
								setName(event.target.value)
								setError("")
							}}
							autoFocus
						/>

						<div className="grid grid-cols-2 border">
							<Button
								type="button"
								variant={mode === "empty" ? "secondary" : "ghost"}
								onClick={() => {
									setMode("empty")
									setError("")
								}}
								className="justify-start border-r"
							>
								<FileText className="size-4" />
								{t("doc.folderDialog.emptyDocument")}
							</Button>
							<Button
								type="button"
								variant={mode === "move" ? "secondary" : "ghost"}
								onClick={() => {
									setMode("move")
									setError("")
								}}
								className="justify-start"
							>
								<FolderInput className="size-4" />
								{t("doc.folderDialog.moveDocuments")}
							</Button>
						</div>

						{mode === "move" && (
							<div className="border-border max-h-56 overflow-auto border">
								{selectableDocs.length === 0 ? (
									<p className="text-muted-foreground px-3 py-3 text-sm">
										{t("doc.folderDialog.noDocumentsToMove")}
									</p>
								) : (
									selectableDocs.map(doc => {
										let docId = doc.id
										return (
											<label
												key={docId}
												className="hover:bg-accent flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-b-0"
											>
												<Checkbox
													checked={selectedDocIds.has(docId)}
													onCheckedChange={() => toggleSelectedDoc(docId)}
													className="mt-0.5"
												/>
												<span className="min-w-0 flex-1">
													<span className="block truncate text-sm font-medium">
														{doc.title ?? "Untitled"}
													</span>
													<span className="text-muted-foreground block truncate text-xs">
														{doc.path ??
															t("doc.moveToFolderDialog.notInFolder")}
													</span>
												</span>
											</label>
										)
									})
								)}
							</div>
						)}

						{(error || isDuplicate) && (
							<p className="text-destructive mt-2 text-sm">
								{error || t("doc.folderDialog.alreadyExists")}
							</p>
						)}
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							{t("doc.cancel")}
						</Button>
						<Button
							type="submit"
							disabled={!path || isDuplicate || needsSelection}
						>
							{t("doc.folderDialog.createTitle")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

function DocumentItem({
	doc,
	isActive,
	isSelected,
	onClick,
	onDragStart,
	onDragEnd,
	onContextMenu,
	bulkMenu,
	searchQuery,
	onDuplicate,
	onDelete,
	showPath = false,
	existingFolders,
	depth = 0,
	spaceId,
	spaceGroupId,
	t,
}: {
	doc: SidebarDoc
	isActive: boolean
	isSelected: boolean
	onClick: (event: MouseEvent<HTMLAnchorElement>, docId: string) => void
	onDragStart?: (event: DragEvent<HTMLElement>, doc: SidebarDoc) => void
	onDragEnd: () => void
	onContextMenu: (docId: string) => void
	bulkMenu: ReactNode
	searchQuery: string
	onDuplicate: (doc: SidebarDoc) => void
	onDelete: (doc: SidebarDoc) => void
	showPath?: boolean
	existingFolders: string[]
	depth?: number
	spaceId?: string
	spaceGroupId?: string
	t: ReturnType<typeof useIntl>
}) {
	let { db, ownerId } = useLibrary()
	let [collaborateOpen, setCollaborateOpen] = useState(false)
	let [deleteOpen, setDeleteOpen] = useState(false)
	let [leaveOpen, setLeaveOpen] = useState(false)
	let [moveOpen, setMoveOpen] = useState(false)
	let [moveSpaceOpen, setMoveSpaceOpen] = useState(false)

	let title = doc.title ?? "Untitled"
	let date = formatRelativeDate(doc.updatedAt, {
		today: t("doc.date.today"),
		yesterday: t("doc.date.yesterday"),
		daysAgo: days => t("doc.date.daysAgo", { days: String(days) }),
		weeksAgo: weeks => t("doc.date.weeksAgo", { weeks: String(weeks) }),
	})
	let isPublic = isDocumentPublic(doc)
	let status = getSharingStatus(doc)
	let hasIndividual = hasIndividualShares(doc, spaceGroupId)
	let hasIndicator = isPublic || (spaceId ? hasIndividual : status !== "none")
	let isPresentation = doc.isPresentation ?? false
	let isPinned = doc.pinned ?? false
	let tags = doc.tags ?? []
	let path = showPath ? (doc.path ?? null) : null
	let docGroup = getDocumentGroup(doc)
	let isAdmin = docGroup?.myRole() === "admin"
	let docId = doc.id
	let canShare = canShareDocument()

	// Build link props based on whether we're in a space context
	// Pass search query to open find panel when document loads
	let searchParam = searchQuery.trim()
		? { find: true, q: searchQuery.trim() }
		: undefined
	let docLinkProps = spaceId
		? {
				to: "/spaces/$spaceId/doc/$id" as const,
				params: { spaceId, id: docId },
				search: searchParam,
			}
		: { to: "/doc/$id" as const, params: { id: docId }, search: searchParam }

	return (
		<SidebarMenuItem
			data-testid={testIds.doc.listItem}
			data-doc-id={docId}
			data-doc-title={title}
			data-doc-tags={tags.join(",")}
			data-doc-path={path ?? ""}
			data-doc-date={doc.updatedAt}
			data-selected={isSelected || undefined}
		>
			<ContextMenu>
				<ContextMenuTrigger
					render={
						<SidebarMenuButton
							render={
								<Link
									{...docLinkProps}
									onClick={event => onClick(event, docId)}
									draggable={Boolean(onDragStart)}
									onDragStart={event => onDragStart?.(event, doc)}
									onDragEnd={onDragEnd}
									onContextMenu={() => onContextMenu(docId)}
								/>
							}
							isActive={isActive}
							className="h-auto py-2 focus-visible:ring-inset"
							style={
								depth > 0 ? { paddingLeft: `${8 + depth * 12}px` } : undefined
							}
						>
							<SidebarFileRowContent
								title={<TextHighlight text={title} query={searchQuery} />}
								metadata={
									<>
										<span
											className={
												isActive
													? "text-xs opacity-70"
													: "text-muted-foreground text-xs"
											}
										>
											{date}
										</span>
										{isPinned && (
											<span className={isActive ? "opacity-70" : "text-brand"}>
												<Pin className="size-3" />
											</span>
										)}
										{isPresentation && (
											<span className={isActive ? "opacity-70" : "text-brand"}>
												<Presentation className="size-3" />
											</span>
										)}
										{hasIndicator && (
											<span className={isActive ? "opacity-70" : "text-brand"}>
												{isPublic ? (
													<Globe className="size-3" />
												) : (
													<Users className="size-3" />
												)}
											</span>
										)}
										{path && (
											<span
												className={
													isActive
														? "bg-background/20 inline-flex items-center gap-1 rounded px-1 text-xs"
														: "bg-muted text-muted-foreground inline-flex items-center gap-1 rounded px-1 text-xs"
												}
											>
												<Folder className="size-3" />
												{path}
											</span>
										)}
									</>
								}
								description={
									tags.length > 0 && (
										<TagsRow
											tags={tags}
											isActive={isActive}
											searchQuery={searchQuery}
										/>
									)
								}
							/>
							{isSelected && (
								<span className="sr-only">{t("doc.sidebar.selected")}</span>
							)}
						</SidebarMenuButton>
					}
				/>
				<ContextMenuContent>
					{bulkMenu ?? (
						<>
							<ContextMenuItem
								render={
									<Link
										to="/doc/$id/preview"
										params={{ id: docId }}
										search={{ from: "list" }}
									/>
								}
							>
								<Eye />
								{t("doc.preview")}
							</ContextMenuItem>
							{isPresentation && (
								<>
									<ContextMenuItem
										render={
											<Link to="/doc/$id/slideshow" params={{ id: docId }} />
										}
									>
										<Presentation />
										{t("doc.sidebar.slideshow")}
									</ContextMenuItem>
									<ContextMenuItem
										render={
											<Link to="/doc/$id/teleprompter" params={{ id: docId }} />
										}
									>
										<ScrollText />
										{t("doc.sidebar.teleprompter")}
									</ContextMenuItem>
								</>
							)}
							<ContextMenuItem onClick={makeDownloadDocument(doc, title)}>
								<Download />
								{t("doc.download")}
							</ContextMenuItem>
							{canShare && (
								<ContextMenuItem
									onClick={makeShareDocument(doc, title)}
									data-testid={testIds.doc.shareButton}
								>
									<NativeShareIcon />
									{t("doc.shareCopy")}
								</ContextMenuItem>
							)}
							<ContextMenuItem
								onClick={() => setCollaborateOpen(true)}
								data-testid={testIds.doc.collaborateButton}
							>
								<Users />
								{t("doc.collaborate")}
							</ContextMenuItem>
							<ContextMenuItem
								onClick={() => onDuplicate(doc)}
								data-testid={testIds.doc.duplicateButton}
							>
								<Copy />
								{t("doc.duplicate")}
							</ContextMenuItem>
							<ContextMenuItem onClick={makeTogglePin(db, ownerId, doc)}>
								<Pin />
								{isPinned ? t("doc.unpin") : t("doc.pin")}
							</ContextMenuItem>
							<ContextMenuItem onClick={() => setMoveOpen(true)}>
								<FolderInput />
								{t("doc.moveToFolder")}
							</ContextMenuItem>
							<ContextMenuItem onClick={() => setMoveSpaceOpen(true)}>
								<ArrowRightLeft />
								{t("doc.moveToSpace")}
							</ContextMenuItem>
							{isAdmin ? (
								<ContextMenuItem
									onClick={() => setDeleteOpen(true)}
									variant="destructive"
									data-testid={testIds.doc.deleteButton}
								>
									<Trash2 />
									{t("doc.delete")}
								</ContextMenuItem>
							) : (
								<ContextMenuItem
									onClick={() => setLeaveOpen(true)}
									variant="destructive"
								>
									<LogOut />
									{t("doc.leave")}
								</ContextMenuItem>
							)}
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>
			{collaborateOpen && (
				<ShareDialog
					doc={doc}
					open={collaborateOpen}
					onOpenChange={setCollaborateOpen}
				/>
			)}
			{moveOpen && (
				<MoveToFolderDialog
					docs={[doc]}
					existingFolders={existingFolders}
					open={moveOpen}
					onOpenChange={setMoveOpen}
				/>
			)}
			{moveSpaceOpen && (
				<MoveToSpaceDialog
					doc={doc}
					open={moveSpaceOpen}
					onOpenChange={setMoveSpaceOpen}
					currentSpaceId={spaceId}
				/>
			)}
			<ConfirmDialog
				open={deleteOpen}
				onOpenChange={setDeleteOpen}
				title={t("doc.deleteDialog.title")}
				description={t("doc.deleteDialog.description")}
				confirmLabel={t("doc.deleteDialog.confirm")}
				variant="destructive"
				onConfirm={() => onDelete(doc)}
				confirmTestId={testIds.dialog.deleteConfirm}
			/>
			{leaveOpen && (
				<LeaveDocumentDialog
					doc={doc}
					open={leaveOpen}
					onOpenChange={setLeaveOpen}
					t={t}
				/>
			)}
		</SidebarMenuItem>
	)
}

function LeaveDocumentDialog({
	doc,
	open,
	onOpenChange,
	t,
}: {
	doc: SidebarDoc
	open: boolean
	onOpenChange: (open: boolean) => void
	t: ReturnType<typeof useIntl>
}) {
	let { db } = useLibrary()
	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("doc.leaveDialog.title")}
			description={t("doc.leaveDialog.description")}
			confirmLabel={t("doc.leaveDialog.confirm")}
			variant="destructive"
			onConfirm={makeLeaveDocument(db, doc)}
		>
			<LeaveDocumentPreview doc={doc} />
		</ConfirmDialog>
	)
}

function LeaveDocumentPreview({ doc }: { doc: SidebarDoc }) {
	let content = doc.content
	if (!content) return null

	return (
		<div className="bg-muted/50 text-muted-foreground max-h-32 overflow-auto rounded border p-3 text-sm whitespace-pre-wrap">
			{content.slice(0, 200)}
			{content.length > 200 ? "..." : ""}
		</div>
	)
}

function DeletedDocumentItem({
	doc,
	searchQuery,
	t,
}: {
	doc: SidebarDoc
	searchQuery: string
	t: ReturnType<typeof useIntl>
}) {
	let { db } = useLibrary()
	let [deleteOpen, setDeleteOpen] = useState(false)

	let title = doc.title ?? "Untitled"
	let daysLeft = doc.deletedAt ? getDaysUntilPermanentDelete(doc.deletedAt) : 0

	async function handlePermanentDelete() {
		await permanentlyDeletePersonalDocument(db, doc)
	}

	return (
		<SidebarMenuItem>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<SidebarMenuButton className="h-auto py-2 focus-visible:ring-inset">
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<div className="flex items-center gap-1.5">
									<span className="text-destructive text-xs">
										{daysLeft}d until deleted permanently
									</span>
								</div>
								<span className="text-muted-foreground truncate text-sm">
									<TextHighlight text={title} query={searchQuery} />
								</span>
							</div>
						</SidebarMenuButton>
					}
				/>
				<DropdownMenuContent align="center">
					<DropdownMenuItem
						onClick={() =>
							db.update(app.documents, doc.id, { deletedAt: null })
						}
					>
						<RotateCcw />
						Restore
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => setDeleteOpen(true)}
						className="text-destructive focus:text-destructive"
					>
						<Trash2 />
						{t("doc.permanentDeleteDialog.confirm")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ConfirmDialog
				open={deleteOpen}
				onOpenChange={setDeleteOpen}
				title={t("doc.permanentDeleteDialog.title")}
				description={t("doc.permanentDeleteDialog.description")}
				confirmLabel={t("doc.permanentDeleteDialog.confirm")}
				variant="destructive"
				onConfirm={handlePermanentDelete}
			></ConfirmDialog>
		</SidebarMenuItem>
	)
}

function TagsRow({
	tags,
	isActive,
	searchQuery,
}: {
	tags: string[]
	isActive: boolean
	searchQuery: string
}) {
	let containerRef = useRef<HTMLDivElement>(null)
	let [visibleCount, setVisibleCount] = useState(tags.length)

	useEffect(() => {
		let container = containerRef.current
		if (!container) return

		let measure = () => {
			let containerWidth = container.offsetWidth
			let children = Array.from(container.children).filter(
				child => child instanceof HTMLElement,
			)
			let totalWidth = 0
			let count = 0

			for (let i = 0; i < children.length; i++) {
				let child = children[i]
				let childWidth = child.offsetWidth + 4
				if (totalWidth + childWidth > containerWidth && i > 0) break
				totalWidth += childWidth
				count++
			}

			setVisibleCount(count || 1)
		}

		measure()
		let observer = new ResizeObserver(measure)
		observer.observe(container)
		return () => observer.disconnect()
	}, [tags])

	let hiddenCount = tags.length - visibleCount

	return (
		<div
			ref={containerRef}
			className="flex min-w-0 items-center gap-1 overflow-hidden"
		>
			{tags.slice(0, visibleCount).map((tag, i) => (
				<span
					key={i}
					className={
						isActive
							? "bg-background/20 shrink-0 rounded px-1 text-xs"
							: "bg-muted shrink-0 rounded px-1 text-xs"
					}
				>
					<TextHighlight text={tag} query={searchQuery} />
				</span>
			))}
			{hiddenCount > 0 && (
				<span
					className={
						isActive
							? "shrink-0 text-xs opacity-70"
							: "text-muted-foreground shrink-0 text-xs"
					}
				>
					+{hiddenCount} more
				</span>
			)}
		</div>
	)
}

function describeDropAction(
	action: SidebarDropAction,
	t: ReturnType<typeof useIntl>,
): string {
	switch (action.type) {
		case "moveToFolder":
			return action.count === 1
				? t("doc.sidebar.dropMoveOneToFolder", { folder: action.folder })
				: t("doc.sidebar.dropMoveManyToFolder", {
						count: String(action.count),
						folder: action.folder,
					})
		case "moveToRoot":
			return t("doc.sidebar.dropMoveToRoot", { count: action.count })
		case "alreadyThere":
			return action.folder
				? t("doc.sidebar.dropAlreadyInFolder", { folder: action.folder })
				: t("doc.sidebar.dropAlreadyAtRoot")
	}
}

function makeTogglePin(
	db: ReturnType<typeof useDb>,
	ownerId: string,
	doc: SidebarDoc,
) {
	return () => setPinned(db, ownerId, doc, !doc.pinned)
}
function makeDownloadDocument(doc: SidebarDoc, title: string) {
	return () => exportDocument(doc.content, title)
}
function makeShareDocument(doc: SidebarDoc, title: string) {
	return () => shareDocument(doc.content, title)
}
function makeLeaveDocument(db: ReturnType<typeof useDb>, doc: SidebarDoc) {
	return () => leavePersonalDocument(db, doc)
}

function buildListItems(
	docs: SidebarDoc[],
	viewMode: "folders" | "flat",
	isCollapsed: (path: string) => boolean,
): ListItem[] {
	if (viewMode === "flat") {
		return docs.map(doc => ({ type: "doc" as const, doc, depth: 0 }))
	}

	let rootDocs: SidebarDoc[] = []
	let folderDocs = new Map<string, SidebarDoc[]>()

	for (let doc of docs) {
		let path = doc.path ?? null
		if (!path) {
			rootDocs.push(doc)
		} else {
			let existing = folderDocs.get(path) ?? []
			existing.push(doc)
			folderDocs.set(path, existing)
		}
	}

	let allPaths = [...folderDocs.keys()].sort()
	let folderTree = buildFolderTree(allPaths)

	function getMostRecentInTree(node: FolderNode, currentPath: string): Date {
		let fullPath = currentPath ? `${currentPath}/${node.name}` : node.name
		let docsHere = folderDocs.get(fullPath) ?? []
		let mostRecent =
			docsHere.length > 0
				? Math.max(...docsHere.map(d => new Date(d.updatedAt).getTime()))
				: 0

		for (let child of node.children) {
			let childRecent = getMostRecentInTree(child, fullPath)
			mostRecent = Math.max(mostRecent, childRecent.getTime())
		}

		return new Date(mostRecent)
	}

	type SortableItem =
		| { type: "rootDoc"; doc: SidebarDoc; sortDate: Date }
		| { type: "topFolder"; node: FolderNode; sortDate: Date }

	let sortableItems: SortableItem[] = []

	for (let doc of rootDocs) {
		sortableItems.push({
			type: "rootDoc",
			doc,
			sortDate: new Date(doc.updatedAt),
		})
	}

	for (let node of folderTree) {
		let mostRecent = getMostRecentInTree(node, "")
		sortableItems.push({ type: "topFolder", node, sortDate: mostRecent })
	}

	sortableItems.sort((a, b) => {
		let aPinned = a.type === "rootDoc" && (a.doc.pinned ?? false)
		let bPinned = b.type === "rootDoc" && (b.doc.pinned ?? false)
		if (aPinned !== bPinned) return bPinned ? 1 : -1

		return b.sortDate.getTime() - a.sortDate.getTime()
	})

	let items: ListItem[] = []

	function addFolderItems(
		node: FolderNode,
		currentPath: string,
		depth: number,
	) {
		let fullPath = currentPath ? `${currentPath}/${node.name}` : node.name
		let docsInFolder = folderDocs.get(fullPath) ?? []
		let totalDocs = countDocsInTree(node, fullPath, folderDocs)

		items.push({
			type: "folder",
			path: fullPath,
			depth,
			docCount: totalDocs,
		})

		if (!isCollapsed(fullPath)) {
			for (let doc of docsInFolder) {
				items.push({ type: "doc", doc, depth: depth + 1 })
			}
			let sortedChildren = [...node.children].sort((a, b) => {
				let aRecent = getMostRecentInTree(a, fullPath)
				let bRecent = getMostRecentInTree(b, fullPath)
				return bRecent.getTime() - aRecent.getTime()
			})
			for (let child of sortedChildren) {
				addFolderItems(child, fullPath, depth + 1)
			}
		}
	}

	for (let item of sortableItems) {
		if (item.type === "rootDoc") {
			items.push({ type: "doc", doc: item.doc, depth: 0 })
		} else {
			addFolderItems(item.node, "", 0)
		}
	}

	return items
}

interface FolderNode {
	name: string
	children: FolderNode[]
}

function buildFolderTree(paths: string[]): FolderNode[] {
	let root: FolderNode[] = []

	for (let path of paths) {
		let parts = path.split("/")
		let current = root

		for (let i = 0; i < parts.length; i++) {
			let part = parts[i]
			let existing = current.find(n => n.name === part)

			if (!existing) {
				existing = { name: part, children: [] }
				current.push(existing)
			}

			current = existing.children
		}
	}

	return root
}

function countDocsInTree(
	node: FolderNode,
	fullPath: string,
	folderDocs: Map<string, SidebarDoc[]>,
): number {
	let count = folderDocs.get(fullPath)?.length ?? 0

	for (let child of node.children) {
		let childPath = `${fullPath}/${child.name}`
		count += countDocsInTree(child, childPath, folderDocs)
	}

	return count
}

function getExistingFolders(docs: SidebarDoc[]): string[] {
	let folders = new Set<string>()

	for (let doc of docs) {
		let path = doc.path
		if (path) {
			folders.add(path)
			let parts = path.split("/")
			for (let i = 1; i < parts.length; i++) {
				folders.add(parts.slice(0, i).join("/"))
			}
		}
	}

	return [...folders].sort()
}

function getDocsInFolder(docs: SidebarDoc[], folderPath: string): SidebarDoc[] {
	return docs.filter(doc => {
		let path = doc.path
		if (!path) return false
		return path === folderPath || path.startsWith(folderPath + "/")
	})
}
