import { useEffect, useRef, useState } from "react"
import React from "react"
import type { Extension } from "@codemirror/state"
import { Link } from "@tanstack/react-router"
import { useAccount } from "jazz-tools/react"
import { UserAccount } from "@/schema"
import {
	MarkdownEditor,
	useMarkdownEditorRef,
	SidebarEditorNavigation,
} from "@/app/features/editor"
import {
	getPresentationMode,
	presentationExtensions,
} from "@/app/features/presentation"
import { useEditorSettings } from "@/app/features/editor"
import { getDocumentTitle } from "../lib/title"
import { EditorToolbar } from "@/app/features/editor"
import { DocumentSidebar } from "../widgets/document-sidebar"
import { ListSidebar } from "../widgets/list-sidebar"
import { WorkspaceSelector } from "@/app/components/workspace-selector"
import { SidebarSearchFilterBar } from "../widgets/sidebar-search-filter-bar"
import { SidebarFileRowContent } from "../widgets/sidebar-file-row-content"
import { SidebarFolderButton } from "../widgets/sidebar-folder-button"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/app/components/ui/context-menu"
import { useLocalSidebarState } from "../widgets/local-sidebar-state"
import {
	Empty,
	EmptyHeader,
	EmptyTitle,
	EmptyDescription,
} from "@/app/components/ui/empty"
import { Button } from "@/app/components/ui/button"
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuAction,
	SidebarSeparator,
} from "@/app/components/ui/sidebar"
import { SidebarProvider, useSidebar } from "@/app/components/ui/sidebar"
import {
	HelpCircle,
	FileUp,
	Settings,
	Check,
	AlertCircle,
	FileText,
	Plus,
	Download,
	Cloud,
	Eye,
	Pencil,
	EllipsisIcon,
	X,
	FolderOpen,
	RefreshCw,
} from "lucide-react"
import {
	ThemeToggle,
	useTheme,
	type Theme,
	useResolvedTheme,
	ThemeSubmenu,
} from "@/app/components/appearance"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import { HelpMenu } from "@/app/components/help-menu"
import { SidebarEditMenu } from "@/app/features/editor"
import { SidebarFormatMenu } from "@/app/features/editor"
import {
	useLocalFileStore,
	openLocalFile,
	saveLocalFile,
	saveLocalFileAs,
	consumeLaunchQueue,
	isFileSystemAccessSupported,
	closeLocalFile,
	resolveLocalFileConflict,
	restoreLocalFileRecovery,
	type LocalFileEntry,
	getHandleFromDB,
	openLocalDirectory,
	selectLocalWorkspace,
	refreshLocalDirectory,
	openDirectoryFile,
	readDirectoryFile,
	refreshLocalFile,
} from "@/app/lib/local-file"
import { CopyToSyncedDialog } from "@/app/features/spaces"
import {
	imageExtensions,
	SidebarAssets,
	useTldrawEditor,
	type EditorAsset,
	type SidebarAsset,
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
	type LocalAsset,
} from "@/app/features/assets"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import {
	getShortcutLabel,
	isShortcutEvent,
	isShortcutTargetBlocked,
} from "@/app/lib/shortcut-registry"
import { Preview } from "../widgets/preview"
import { writeStorageMode } from "@/app/lib/storage-mode"
import { type ResolvedDoc } from "../lib/wikilink-titles"
import { toast } from "sonner"
import { tryCatch } from "@/app/lib/try-catch"
import { useIntl } from "@/shared/intl/setup"
import { exitFocusMode, toggleFocusMode } from "@/app/lib/focus-mode"

export { LocalDocScreen }

function LocalDocScreen() {
	let t = useIntl()
	let store = useLocalFileStore()
	let [initialized, setInitialized] = useState(false)
	let [isPreview, setIsPreview] = useState(false)

	useEffect(() => {
		async function init() {
			let result = await tryCatch(consumeLaunchQueue())
			if (!result.ok) {
				toast.error(
					t("doc.localFile.failedToOpen") + " " + result.error.message,
				)
				setInitialized(true)
				return
			}
			if (result.value) {
				let currentState = useLocalFileStore.getState()
				let activeFile = currentState.getActiveFile()

				if (activeFile && activeFile.hasUnsavedChanges) {
					let confirmed = window.confirm(t("doc.localFile.confirmUnsaved"))
					if (!confirmed) {
						setInitialized(true)
						return
					}
				}

				if (activeFile) {
					await saveCurrentFile(activeFile.id, t)
				}

				currentState.addFile({
					id: result.value.id,
					filename: result.value.filename,
					lastOpened: Date.now(),
					lastModified: result.value.lastModified,
					content: result.value.content,
					lastSavedContent: result.value.content,
					hasUnsavedChanges: false,
					isActive: true,
				})
			}
			setInitialized(true)
		}
		void init()
	}, [t])

	useEffect(() => {
		if (!initialized) return
		function refresh() {
			if (document.visibilityState === "visible")
				void refreshFilesystemWorkspace()
		}
		refresh()
		window.addEventListener("focus", refresh)
		document.addEventListener("visibilitychange", refresh)
		return () => {
			window.removeEventListener("focus", refresh)
			document.removeEventListener("visibilitychange", refresh)
		}
	}, [initialized])

	if (!initialized) {
		return (
			<Empty className="h-screen">
				<EmptyHeader>
					<EmptyTitle>Loading...</EmptyTitle>
				</EmptyHeader>
			</Empty>
		)
	}

	let activeFile = store.getActiveFile()

	return (
		<SidebarProvider>
			{activeFile ? (
				<LocalEditorContent
					isPreview={isPreview}
					setIsPreview={setIsPreview}
					activeFile={activeFile}
				/>
			) : (
				<LocalFileEmptyState />
			)}
		</SidebarProvider>
	)
}

async function saveCurrentFile(
	fileId: string,
	t: ReturnType<typeof useIntl>,
): Promise<boolean> {
	let state = useLocalFileStore.getState()
	let file = state.getFileById(fileId)
	if (!file) return false

	if (!file.hasUnsavedChanges) return true

	let handle = await getHandleFromDB(fileId)
	if (!handle) return false

	state.setSaveStatus("saving")
	let success = await saveLocalFile(fileId, file.content)
	if (success) {
		state.setSaveStatus("saved")
		setTimeout(() => state.setSaveStatus("idle"), 1500)
	} else {
		state.setSaveStatus("error")
		state.setErrorMessage(t("doc.localFile.saveFailed"))
	}
	return success
}

function LocalFileEmptyState() {
	let t = useIntl()
	let store = useLocalFileStore()
	let workspace = store.directoryWorkspaces.find(
		item => item.id === store.selectedWorkspaceId,
	)
	let { toggleLeft } = useSidebar()
	async function handleOpenFile() {
		let result = await openLocalFile()
		if (result) {
			let state = useLocalFileStore.getState()
			let activeFile = state.getActiveFile()

			if (activeFile && activeFile.hasUnsavedChanges) {
				let confirmed = window.confirm(t("doc.localFile.confirmNewFile"))
				if (!confirmed) return
			}

			if (activeFile) {
				await saveCurrentFile(activeFile.id, t)
			}

			state.addFile({
				id: result.id,
				filename: result.filename,
				lastOpened: Date.now(),
				lastModified: result.lastModified,
				content: result.content,
				lastSavedContent: result.content,
				hasUnsavedChanges: false,
				isActive: true,
			})
		}
	}

	async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
		let file = e.target.files?.[0]
		if (!file) return

		let state = useLocalFileStore.getState()
		let activeFile = state.getActiveFile()

		if (activeFile && activeFile.hasUnsavedChanges) {
			let confirmed = window.confirm(t("doc.localFile.confirmNewFile"))
			if (!confirmed) return
		}

		if (activeFile) {
			await saveCurrentFile(activeFile.id, t)
		}

		let contentResult = await tryCatch(file.text())
		if (!contentResult.ok) {
			toast.error(t("doc.localFile.failedToRead"))
			return
		}

		state.addFile({
			id: crypto.randomUUID(),
			filename: file.name,
			lastOpened: Date.now(),
			lastModified: file.lastModified,
			content: contentResult.value,
			lastSavedContent: contentResult.value,
			hasUnsavedChanges: false,
			isActive: true,
		})
	}

	let supportsFileSystem = isFileSystemAccessSupported()

	return (
		<>
			<ListSidebar>
				<LocalWorkspaceSelector />
			</ListSidebar>
			<Empty className="relative h-screen min-w-0 flex-1">
				<Button
					className="absolute top-3 left-3"
					size="sm"
					variant="outline"
					onClick={toggleLeft}
				>
					Workspaces
				</Button>
				<EmptyHeader>
					{workspace ? (
						<FolderOpen className="text-muted-foreground size-12" />
					) : (
						<FileText className="text-muted-foreground size-12" />
					)}
					<EmptyTitle>
						{workspace ? workspace.name : "Individually opened files"}
					</EmptyTitle>
				</EmptyHeader>
				<EmptyDescription className="max-w-md">
					{workspace
						? "Choose a file in the sidebar. Changes save directly to the folder."
						: "Open a Markdown or text file from your computer. Changes save directly to the file."}
				</EmptyDescription>
				<div className="mt-6 flex flex-col gap-3">
					{workspace && (
						<Button
							onClick={() => void refreshFilesystemWorkspace(true)}
							variant="outline"
						>
							<RefreshCw className="size-4" />
							Refresh folder
						</Button>
					)}
					{supportsFileSystem ? (
						<Button onClick={handleOpenFile} size="lg" nativeButton>
							<FileUp className="mr-2 size-4" />
							Open File
						</Button>
					) : (
						<>
							<label className="cursor-pointer">
								<span className="bg-primary text-primary-foreground inline-flex h-11 items-center justify-center gap-1.5 rounded-none border border-transparent px-3 text-sm font-medium transition-all active:scale-97 md:h-9 md:px-2.5 md:text-xs">
									<FileUp className="mr-2 size-4" />
									Upload File
								</span>
								<input
									type="file"
									accept=".md,.markdown,.txt"
									className="hidden"
									onChange={handleUploadFile}
								/>
							</label>
							<EmptyDescription>
								For auto-save support, use Chrome or Edge
							</EmptyDescription>
						</>
					)}
				</div>
				<div className="mt-8 flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						nativeButton={false}
						render={
							<Link
								to="/"
								search={{ personal: true }}
								onClick={() => writeStorageMode("synced")}
							/>
						}
					>
						<Cloud className="mr-1.5 size-4" />
						Go to synced documents
					</Button>
				</div>
			</Empty>
		</>
	)
}

interface LocalTreeNode {
	name: string
	path: string
	lastModified?: number
	folders: LocalTreeNode[]
	files: { id: string; name: string; path: string; lastModified?: number }[]
}

function buildLocalTree(
	files: { id: string; name: string; path: string; lastModified?: number }[],
	sort: "latest" | "alphabetical",
): LocalTreeNode {
	let root: LocalTreeNode = { name: "", path: "", folders: [], files: [] }
	for (let file of files) {
		let parts = file.path.split("/")
		let node = root
		for (let folder of parts.slice(0, -1)) {
			let path = node.path ? `${node.path}/${folder}` : folder
			let child = node.folders.find(item => item.name === folder)
			if (!child) {
				child = { name: folder, path, folders: [], files: [] }
				node.folders.push(child)
			}
			node = child
			node.lastModified = Math.max(
				node.lastModified ?? 0,
				file.lastModified ?? 0,
			)
		}
		node.files.push(file)
	}
	function sortNode(node: LocalTreeNode) {
		node.folders.sort((a, b) =>
			sort === "latest"
				? (b.lastModified ?? 0) - (a.lastModified ?? 0) ||
					a.name.localeCompare(b.name)
				: a.name.localeCompare(b.name),
		)
		node.files.sort((a, b) =>
			sort === "latest"
				? (b.lastModified ?? 0) - (a.lastModified ?? 0) ||
					a.name.localeCompare(b.name)
				: a.name.localeCompare(b.name),
		)
		for (let child of node.folders) sortNode(child)
	}
	sortNode(root)
	return root
}

function LocalWorkspaceSelector() {
	let t = useIntl()
	let supportsDirectories = typeof window.showDirectoryPicker === "function"
	let store = useLocalFileStore()
	let workspace = store.directoryWorkspaces.find(
		w => w.id === store.selectedWorkspaceId,
	)
	let sidebarState = useLocalSidebarState()
	let workspaceKey = workspace?.id ?? "individual-files"
	let search = sidebarState.searchByWorkspace[workspaceKey] ?? ""
	let sort = sidebarState.sortByWorkspace[workspaceKey] ?? "latest"
	let type = sidebarState.typeByWorkspace[workspaceKey] ?? "all"
	let terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
	let searching = terms.length > 0
	let matches = (value: string) =>
		terms.every(term => value.toLocaleLowerCase().includes(term))
	let files =
		workspace?.files.filter(
			file =>
				(!searching || matches(file.path)) &&
				(type === "all" ||
					(file.isPresentation === true) === (type === "presentation")),
		) ?? []
	let tree = buildLocalTree(files, sort)
	let individualFiles = store.files
		.filter(
			file =>
				!file.workspaceId &&
				(!searching || matches(file.filename)) &&
				(type === "all" ||
					(!/\.txt$/i.test(file.filename) &&
						getPresentationMode(file.content)) ===
						(type === "presentation")),
		)
		.sort((a, b) =>
			sort === "latest"
				? (b.lastModified ?? 0) - (a.lastModified ?? 0) ||
					a.filename.localeCompare(b.filename)
				: a.filename.localeCompare(b.filename),
		)

	async function handleSelectDirectory(id: string | null) {
		selectLocalWorkspace(id)
		await refreshFilesystemWorkspace(true)
	}

	function toggleFolder(path: string) {
		sidebarState.toggleFolder(workspaceKey, path)
	}

	function renderTree(node: LocalTreeNode, depth: number): React.ReactNode {
		return (
			<React.Fragment key={node.path}>
				{node.folders.map(folder => {
					let isCollapsed =
						!searching && sidebarState.isCollapsed(workspaceKey, folder.path)
					return (
						<React.Fragment key={folder.path}>
							<SidebarMenuItem>
								<ContextMenu>
									<ContextMenuTrigger
										render={
											<SidebarFolderButton
												path={folder.path}
												depth={depth}
												style={{ paddingLeft: `${8 + depth * 16}px` }}
												isCollapsed={isCollapsed}
												onClick={() => {
													if (!searching) toggleFolder(folder.path)
												}}
											/>
										}
									/>
									<ContextMenuContent>
										<ContextMenuItem
											disabled={searching}
											onClick={() => toggleFolder(folder.path)}
										>
											{isCollapsed ? "Expand" : "Collapse"}
										</ContextMenuItem>
										<ContextMenuItem
											onClick={() => void refreshFilesystemWorkspace(true)}
										>
											<RefreshCw className="size-4" />
											Refresh folder
										</ContextMenuItem>
									</ContextMenuContent>
								</ContextMenu>
							</SidebarMenuItem>
							{!isCollapsed && renderTree(folder, depth + 1)}
						</React.Fragment>
					)
				})}
				{node.files.map(file => (
					<SidebarMenuItem key={file.path}>
						<LocalFileContextMenu
							workspaceId={workspace?.id}
							path={file.path}
							onOpen={() =>
								workspace && void openDirectoryFile(workspace.id, file.path)
							}
						>
							<SidebarMenuButton
								isActive={
									store.activeFileId === `${workspace?.id}:${file.path}`
								}
								onClick={() =>
									workspace && void openDirectoryFile(workspace.id, file.path)
								}
								style={{ paddingLeft: `${8 + depth * 16}px` }}
								nativeButton
							>
								<SidebarFileRowContent
									leading={<FileText className="size-4 shrink-0" />}
									title={<span title={file.path}>{file.name}</span>}
								/>
							</SidebarMenuButton>
						</LocalFileContextMenu>
					</SidebarMenuItem>
				))}
			</React.Fragment>
		)
	}

	return (
		<>
			<WorkspaceSelector
				label={workspace?.name ?? "Individually opened files"}
				icon={workspace ? <FolderOpen /> : <FileText />}
			>
				<DropdownMenuItem onClick={() => void handleSelectDirectory(null)}>
					<FileText className="size-4" />
					<span>Individually opened files</span>
					{!workspace && <Check className="ml-auto size-4" />}
				</DropdownMenuItem>
				{store.directoryWorkspaces.map(directory => (
					<DropdownMenuItem
						key={directory.id}
						onClick={() => void handleSelectDirectory(directory.id)}
					>
						<FolderOpen className="size-4" />
						<span className="truncate">{directory.name}</span>
						{directory.status !== "ready" && (
							<AlertCircle className="size-4 text-amber-600" />
						)}
						{workspace?.id === directory.id && (
							<Check className="ml-auto size-4" />
						)}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					disabled={!supportsDirectories}
					onClick={() => void openLocalDirectory()}
				>
					<Plus className="size-4" />
					<span>Open folder…</span>
				</DropdownMenuItem>
			</WorkspaceSelector>
			<SidebarSearchFilterBar
				search={search}
				onSearchChange={value => sidebarState.setSearch(workspaceKey, value)}
				sort={sort}
				onSortChange={value => sidebarState.setSort(workspaceKey, value)}
				typeFilter={type}
				onTypeChange={value => sidebarState.setType(workspaceKey, value)}
				searchLabel="Search local files"
				searchPlaceholder="Search files"
				filterLabel="Sort and filter local files"
			/>
			<SidebarGroup className="flex-1">
				<SidebarGroupContent>
					{workspace && (
						<div className="flex items-center justify-between px-2 py-1">
							<span className="text-muted-foreground text-xs">Files</span>
							<Button
								size="icon"
								variant="ghost"
								aria-label="Refresh folder"
								onClick={() => void refreshFilesystemWorkspace(true)}
							>
								<RefreshCw className="size-4" />
							</Button>
						</div>
					)}
					{workspace?.status !== undefined && workspace.status !== "ready" && (
						<p className="text-muted-foreground px-2 text-xs">
							Folder access needs reconnecting. Reopen the folder to continue.
						</p>
					)}
					<SidebarMenu>
						{workspace
							? renderTree(tree, 0)
							: individualFiles.map(file => (
									<SidebarMenuItem key={file.id}>
										<LocalFileContextMenu
											fileId={file.id}
											onOpen={() =>
												void refreshLocalFile(file.id).then(() =>
													store.markFileActive(file.id),
												)
											}
										>
											<SidebarMenuButton
												isActive={store.activeFileId === file.id}
												onClick={() => {
													void refreshLocalFile(file.id).then(() =>
														store.markFileActive(file.id),
													)
												}}
												nativeButton
											>
												<SidebarFileRowContent
													leading={<FileText className="size-4 shrink-0" />}
													title={file.filename}
													trailing={
														file.conflict && (
															<AlertCircle className="text-destructive size-4 shrink-0" />
														)
													}
												/>
											</SidebarMenuButton>
										</LocalFileContextMenu>
										<SidebarMenuAction
											aria-label={`Close ${file.filename}`}
											onClick={() =>
												void closeFileWithUnsavedChanges(file.id, t)
											}
										>
											<X className="size-4" />
										</SidebarMenuAction>
									</SidebarMenuItem>
								))}
					</SidebarMenu>
					{(searching || type !== "all") &&
						(workspace ? files.length === 0 : individualFiles.length === 0) && (
							<p className="text-muted-foreground px-2 py-3 text-sm">
								No matching files
							</p>
						)}
				</SidebarGroupContent>
			</SidebarGroup>
		</>
	)
}

async function refreshFilesystemWorkspace(requestPermission = false) {
	let state = useLocalFileStore.getState()
	let workspaceId = state.selectedWorkspaceId
	if (
		workspaceId &&
		!(await refreshLocalDirectory(workspaceId, requestPermission))
	)
		return
	let current = useLocalFileStore.getState()
	if (current.selectedWorkspaceId !== workspaceId) return
	let file = current.getActiveFile()
	if (file) await refreshLocalFile(file.id)
}

async function closeFileWithUnsavedChanges(
	id: string,
	t: ReturnType<typeof useIntl>,
) {
	let file = useLocalFileStore.getState().getFileById(id)
	if (!file) return
	if (
		file.hasUnsavedChanges &&
		!window.confirm(t("doc.localFile.confirmCloseFile"))
	)
		return
	await closeLocalFile(id)
}

function LocalFileContextMenu({
	children,
	fileId,
	workspaceId,
	path,
	onOpen,
}: {
	children: React.ReactElement
	fileId?: string
	workspaceId?: string
	path?: string
	onOpen: () => void
}) {
	let t = useIntl()
	let [prepared, setPrepared] = useState<{
		content: string
		filename: string
	} | null>(null)
	let supportsSaveAs =
		isFileSystemAccessSupported() && !!window.showSaveFilePicker
	let exportAsZip =
		!!prepared &&
		referencedLocalAssetIds(prepared.content).size > 0 &&
		!!workspaceId

	async function readClickedFile() {
		if (fileId) {
			let file = useLocalFileStore.getState().getFileById(fileId)
			return file ? { content: file.content, filename: file.filename } : null
		}
		if (workspaceId && path) return readDirectoryFile(workspaceId, path)
		return null
	}

	function handleOpenChange(open: boolean) {
		if (!open) return
		let current = fileId
			? useLocalFileStore.getState().getFileById(fileId)
			: workspaceId && path
				? useLocalFileStore.getState().getFileById(`${workspaceId}:${path}`)
				: null
		if (current) {
			setPrepared({ content: current.content, filename: current.filename })
			return
		}
		setPrepared(null)
		void readClickedFile().then(file => {
			setPrepared(file)
			if (!file) toast.error("Unable to read this file")
		})
	}

	async function handleDownloadClicked() {
		let file = (await readClickedFile()) ?? prepared
		if (!file) {
			toast.error("Unable to read this file")
			return
		}
		let current = fileId
			? useLocalFileStore.getState().getFileById(fileId)
			: undefined
		let result = await tryCatch(
			downloadLocalCopy(file.content, file.filename, {
				workspaceId: current?.workspaceId ?? workspaceId,
				path: current?.path ?? path,
			}),
		)
		if (!result.ok) toast.error("Unable to download this file")
	}

	async function handleSaveAsClicked() {
		let current = fileId
			? useLocalFileStore.getState().getFileById(fileId)
			: workspaceId && path
				? useLocalFileStore.getState().getFileById(`${workspaceId}:${path}`)
				: null
		let file = current
			? { content: current.content, filename: current.filename }
			: prepared
		if (!file) return
		let result = await tryCatch(
			saveLocalCopy(file.content, file.filename, {
				workspaceId: current?.workspaceId ?? workspaceId,
				path: current?.path ?? path,
			}),
		)
		if (!result.ok) toast.error("Unable to save a copy of this file")
	}

	return (
		<ContextMenu onOpenChange={handleOpenChange}>
			<ContextMenuTrigger render={children} />
			<ContextMenuContent>
				<ContextMenuItem onClick={onOpen}>
					<FileText className="size-4" />
					Open
				</ContextMenuItem>
				{supportsSaveAs && (
					<ContextMenuItem
						disabled={!prepared}
						onClick={() => void handleSaveAsClicked()}
					>
						<Download className="size-4" />
						{exportAsZip ? "Export as ZIP…" : "Save As…"}
					</ContextMenuItem>
				)}
				<ContextMenuItem onClick={() => void handleDownloadClicked()}>
					<Download className="size-4" />
					Download
				</ContextMenuItem>
				{fileId && (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem
							onClick={() => void closeFileWithUnsavedChanges(fileId, t)}
						>
							<X className="size-4" />
							Close
						</ContextMenuItem>
					</>
				)}
			</ContextMenuContent>
		</ContextMenu>
	)
}

async function localCopyArchive(
	content: string,
	filename: string,
	location?: Pick<LocalFileEntry, "workspaceId" | "path">,
) {
	if (!location?.workspaceId || !location.path) return null
	let assets = await loadLocalAssets(location)
	return createLocalAssetArchive(content, filename, assets)
}

async function saveLocalCopy(
	content: string,
	filename: string,
	location?: Pick<LocalFileEntry, "workspaceId" | "path">,
) {
	let hasAssetLinks =
		location?.workspaceId &&
		location.path &&
		referencedLocalAssetIds(content).size > 0
	if (hasAssetLinks && window.showSaveFilePicker) {
		let picked = await tryCatch(
			window.showSaveFilePicker({
				suggestedName: `${filename.replace(/\.md$/i, "")}.zip`,
				types: [
					{
						description: "ZIP archive",
						accept: { "application/zip": [".zip"] },
					},
				],
			}),
		)
		if (!picked.ok) {
			if (picked.error.name === "AbortError") return
			throw picked.error
		}
		let archive = await localCopyArchive(content, filename, location)
		if (!archive) throw new Error("Unable to bundle local assets")
		let writable = await picked.value.createWritable()
		try {
			await writable.write(archive)
			await writable.close()
		} catch (error) {
			await writable.abort().catch(() => undefined)
			throw error
		}
		return
	}
	let archive = await localCopyArchive(content, filename, location)
	if (archive) {
		downloadLocalBlob(archive)
		return
	}
	let result = await saveLocalFileAs(content, filename)
	if (!result) return
	useLocalFileStore.getState().addFile({
		id: result.id,
		filename: result.handle.name,
		lastOpened: Date.now(),
		lastModified: result.lastModified,
		content,
		lastSavedContent: content,
		hasUnsavedChanges: false,
		isActive: true,
	})
}

async function downloadLocalCopy(
	content: string,
	filename: string,
	location?: Pick<LocalFileEntry, "workspaceId" | "path">,
) {
	let archive = await localCopyArchive(content, filename, location)
	if (archive) downloadLocalBlob(archive)
	else downloadLocalContent(content, filename)
}

function downloadLocalContent(content: string, filename: string) {
	let blob = new File([content], filename, {
		type: "text/markdown;charset=utf-8",
	})
	downloadLocalBlob(blob)
}

function downloadLocalBlob(blob: File) {
	let url = URL.createObjectURL(blob)
	let link = document.createElement("a")
	link.href = url
	link.download = blob.name
	link.click()
	URL.revokeObjectURL(url)
}

let meResolve = { root: { settings: true } } as const

function LocalEditorContent({
	isPreview,
	setIsPreview,
	activeFile,
}: {
	isPreview: boolean
	setIsPreview: (value: boolean) => void
	activeFile: LocalFileEntry
}) {
	let t = useIntl()
	let editor = useMarkdownEditorRef()
	let saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	let store = useLocalFileStore()
	let { theme, setTheme } = useTheme()
	let resolvedTheme = useResolvedTheme()
	let { toggleLeft, toggleRight, isMobile, setRightOpenMobile } = useSidebar()
	let [copyDialogOpen, setCopyDialogOpen] = useState(false)
	let [assetVersion, setAssetVersion] = useState(0)
	let [localAssets, setLocalAssets] = useState<LocalAssetView[]>([])
	let assetsRef = useRef(localAssets)
	let [localImageExtensions, setLocalImageExtensions] = useState<
		Extension[] | null
	>(null)
	useEffect(() => {
		assetsRef.current = localAssets
	}, [localAssets])
	useEffect(() => {
		setLocalImageExtensions(
			imageExtensions({
				resolver: id => {
					let asset = assetsRef.current.find(candidate => candidate.id === id)
					return asset ? { url: `asset:${id}`, type: asset.type } : undefined
				},
				onPreview: (url, alt) => editor.current?.showImagePreview(url, alt),
				getAssets: () =>
					assetsRef.current.map(asset => ({ id: asset.id, name: asset.name })),
			}),
		)
	}, [editor])
	let { workspaceId, path } = activeFile

	useEffect(() => {
		let cancelled = false
		void loadLocalAssets({ workspaceId, path })
			.then(assets => {
				let loaded = assets.map(toLocalAssetView)
				if (cancelled) releaseLocalAssetViews(loaded)
				else setLocalAssets(loaded)
			})
			.catch(() => {
				if (!cancelled) setLocalAssets([])
			})
		return () => {
			cancelled = true
		}
	}, [workspaceId, path, assetVersion])
	useEffect(() => () => releaseLocalAssetViews(localAssets), [localAssets])
	useEffect(() => {
		function refreshAssets() {
			if (!document.hidden) setAssetVersion(version => version + 1)
		}
		document.addEventListener("visibilitychange", refreshAssets)
		return () => document.removeEventListener("visibilitychange", refreshAssets)
	}, [])

	let editorAssets: EditorAsset[] = localAssets.map(asset => ({
		id: asset.id,
		name: asset.name,
		type: asset.type,
		previewUrl:
			asset.type === "tldraw"
				? resolvedTheme === "dark"
					? asset.darkUrl
					: asset.lightUrl
				: asset.url,
		videoUrl: asset.type === "video" ? asset.url : undefined,
	}))
	let sidebarAssets: SidebarAsset[] = localAssets.map(asset => ({
		id: asset.id,
		name: asset.name,
		type: asset.type,
		imageUrl: asset.type === "image" ? asset.url : undefined,
		lightPreviewUrl: asset.lightUrl,
		darkPreviewUrl: asset.darkUrl,
		getVideoBlob: asset.type === "video" ? () => asset.blob : undefined,
	}))

	let tldrawEditor = useTldrawEditor({
		assets: sidebarAssets,
		readOnly: !activeFile.workspaceId,
		showPresence: false,
		loadAsset: async id => readLocalWhiteboard(activeFile, id),
		createAsset: async (name, save) => {
			let id = await writeLocalWhiteboard(activeFile, name, save)
			setAssetVersion(version => version + 1)
			return { id, name }
		},
		updateAsset: async (id, save, expectedLastModified) => {
			if (expectedLastModified === undefined)
				throw new Error("Whiteboard is unavailable; reopen it before saving")
			await writeLocalWhiteboard(activeFile, "", save, id, expectedLastModified)
			setAssetVersion(version => version + 1)
		},
	})

	let me = useAccount(UserAccount, { resolve: meResolve })
	let editorSettings =
		me.$isLoaded && me.root?.settings?.$isLoaded ? me.root.settings : undefined

	useEditorSettings(editorSettings)

	let content = activeFile.content
	let editorContent = localEditorContent(content, localAssets)
	useEffect(() => {
		if (editor.current && editor.current.getContent() !== editorContent) {
			editor.current.setExternalContent(editorContent)
		}
	}, [editorContent, editor])
	let isDirty = activeFile.hasUnsavedChanges
	let docTitle = getDocumentTitle(content) || activeFile.filename || "Untitled"

	let documents: { id: string; title: string }[] = []

	function handleChange(newContent: string) {
		let originalContent = store.getFileById(activeFile.id)?.content
		store.setFileContent(
			activeFile.id,
			localDiskContent(newContent, localAssets, originalContent),
		)

		if (saveTimeoutRef.current) {
			clearTimeout(saveTimeoutRef.current)
		}

		saveTimeoutRef.current = setTimeout(async () => {
			let currentState = useLocalFileStore.getState()
			let currentFile = currentState.getFileById(activeFile.id)
			if (!currentFile || !currentFile.hasUnsavedChanges) return

			let currentHandle = await getHandleFromDB(activeFile.id)
			if (!currentHandle) return

			currentState.setSaveStatus("saving")
			let success = await saveLocalFile(activeFile.id, currentFile.content)
			if (success) {
				currentState.setSaveStatus("saved")
				setTimeout(() => currentState.setSaveStatus("idle"), 1500)
			} else {
				currentState.setSaveStatus("error")
				currentState.setErrorMessage(t("doc.localFile.saveFailed"))
			}
		}, 1000)
	}

	function handleEditorChange(readContent: () => string) {
		handleChange(readContent())
	}

	async function handleRenameAsset(id: string, name: string) {
		let next = await copyLocalAssetForRename(activeFile, id, name)
		if (next === id) return
		let updatedContent = updateLocalAssetReferences(content, id, next)
		store.setFileContent(activeFile.id, updatedContent)
		let saved = await saveLocalFile(activeFile.id, updatedContent)
		if (!saved) {
			let current = useLocalFileStore.getState().getFileById(activeFile.id)
			if (current?.content === updatedContent) {
				store.setFileContent(activeFile.id, content)
				await removeLocalAsset(activeFile, next)
			}
			setAssetVersion(version => version + 1)
			throw new Error("Save the Markdown file before completing the rename")
		}
		let latest = useLocalFileStore.getState().getFileById(activeFile.id)
		if (latest?.content.includes(`assets/${id}`))
			throw new Error("Old asset is still referenced after saving")
		if (!(await isLocalAssetReferencedElsewhere(activeFile, id)))
			await removeLocalAsset(activeFile, id)
		setAssetVersion(version => version + 1)
	}

	async function handleDeleteAsset(id: string) {
		if (await isLocalAssetReferencedElsewhere(activeFile, id))
			throw new Error("Another Markdown file in this folder uses this asset")
		let updatedContent = updateLocalAssetReferences(content, id)
		if (updatedContent !== content) {
			store.setFileContent(activeFile.id, updatedContent)
			let saved = await saveLocalFile(activeFile.id, updatedContent)
			if (!saved)
				throw new Error("Save the Markdown file before deleting the asset")
		}
		let latest = useLocalFileStore.getState().getFileById(activeFile.id)
		if (latest?.content.includes(`assets/${id}`))
			throw new Error("Asset is still referenced after saving")
		await removeLocalAsset(activeFile, id)
		setAssetVersion(version => version + 1)
	}

	useEffect(() => {
		return () => {
			if (saveTimeoutRef.current) {
				clearTimeout(saveTimeoutRef.current)
			}
		}
	}, [])

	async function handleSaveAs(file: LocalFileEntry) {
		let filename =
			file.filename || `${getDocumentTitle(file.content) || "Untitled"}.md`
		await saveLocalCopy(file.content, filename, file)
	}

	let handlersRef = useRef({
		handleSave: async () => {
			let currentFile = useLocalFileStore.getState().getActiveFile()
			if (!currentFile) return
			await saveCurrentFile(currentFile.id, t)
		},
		handleSaveAs: async () => {
			let currentFile = useLocalFileStore.getState().getActiveFile()
			if (!currentFile) return
			let result = await tryCatch(handleSaveAs(currentFile))
			if (!result.ok) toast.error("Unable to save a copy of this file")
		},
		toggleLeft,
		toggleRight,
		togglePreview: () => setIsPreview(!isPreview),
		toggleFocusMode,
	})

	useEffect(() => {
		handlersRef.current = {
			handleSave: handlersRef.current.handleSave,
			handleSaveAs: handlersRef.current.handleSaveAs,
			toggleLeft,
			toggleRight,
			togglePreview: () => setIsPreview(!isPreview),
			toggleFocusMode: handlersRef.current.toggleFocusMode,
		}
	})

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.defaultPrevented || isShortcutTargetBlocked(e.target)) return

			if (e.key === "Escape" && exitFocusMode()) return

			if (isShortcutEvent(e, "save")) {
				e.preventDefault()
				void handlersRef.current.handleSave()
				return
			}

			if (isShortcutEvent(e, "saveAs")) {
				e.preventDefault()
				void handlersRef.current.handleSaveAs()
				return
			}

			if (isShortcutEvent(e, "focusMode")) {
				e.preventDefault()
				handlersRef.current.toggleFocusMode()
				return
			}

			if (isShortcutEvent(e, "leftSidebar")) {
				e.preventDefault()
				handlersRef.current.toggleLeft()
			}

			if (isShortcutEvent(e, "rightSidebar")) {
				e.preventDefault()
				handlersRef.current.toggleRight()
			}

			if (isShortcutEvent(e, "preview")) {
				e.preventDefault()
				handlersRef.current.togglePreview()
			}
		}

		function handleRunShortcut(event: Event) {
			if (!(event instanceof CustomEvent)) return
			let id = event.detail
			if (id === "save") void handlersRef.current.handleSave()
			else if (id === "saveAs") void handlersRef.current.handleSaveAs()
			else if (id === "leftSidebar") handlersRef.current.toggleLeft()
			else if (id === "rightSidebar") handlersRef.current.toggleRight()
			else if (id === "preview") handlersRef.current.togglePreview()
			else if (id === "focusMode") handlersRef.current.toggleFocusMode()
		}

		document.addEventListener("keydown", handleKeyDown)
		document.addEventListener("alkalye:run-shortcut", handleRunShortcut)
		return () => {
			document.removeEventListener("keydown", handleKeyDown)
			document.removeEventListener("alkalye:run-shortcut", handleRunShortcut)
		}
	}, [])

	async function handleOpenFile() {
		if (isDirty) {
			let confirmed = window.confirm(t("doc.localFile.confirmNewFile"))
			if (!confirmed) return
		}

		await saveCurrentFile(activeFile.id, t)

		let result = await openLocalFile()
		if (result) {
			useLocalFileStore.getState().addFile({
				id: result.id,
				filename: result.filename,
				lastOpened: Date.now(),
				lastModified: result.lastModified,
				content: result.content,
				lastSavedContent: result.content,
				hasUnsavedChanges: false,
				isActive: true,
			})
		}
	}

	function handleDownload(file: LocalFileEntry) {
		let title = getDocumentTitle(file.content) || "Untitled"
		let filename = file.filename || title + ".md"
		void downloadLocalCopy(file.content, filename, file).catch(error =>
			toast.error(assetErrorMessage(error)),
		)
	}

	if (isPreview) {
		return (
			<LocalPreviewView
				filename={activeFile.filename}
				docTitle={docTitle}
				content={content}
				assets={localAssets}
				wikilinks={new Map<string, ResolvedDoc>()}
				theme={resolvedTheme}
				setTheme={setTheme}
				onExit={() => setIsPreview(false)}
			/>
		)
	}

	return (
		<>
			<title>{isDirty ? `* ${docTitle}` : docTitle}</title>
			<ListSidebar
				header={
					<Button
						size="sm"
						nativeButton
						onClick={handleOpenFile}
						aria-label={t("doc.new")}
					>
						<FileUp className="size-4" />
						{t("doc.new")}
					</Button>
				}
			>
				<LocalWorkspaceSelector />
			</ListSidebar>

			<div className="markdown-editor flex-1">
				{activeFile.conflict && (
					<div
						role="alert"
						className="border-destructive bg-destructive/10 flex flex-wrap items-center gap-2 border-b p-2 text-sm"
					>
						<AlertCircle className="size-4" />
						<span className="flex-1">
							This file changed on disk while you edited it. Choose which
							version to keep.
						</span>
						<Button
							size="sm"
							variant="outline"
							onClick={() => handleDownload(activeFile)}
						>
							Download draft
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() =>
								void resolveLocalFileConflict(activeFile.id, "disk")
							}
						>
							Use disk
						</Button>
						<Button
							size="sm"
							onClick={() =>
								void resolveLocalFileConflict(activeFile.id, "local")
							}
						>
							Keep mine
						</Button>
					</div>
				)}
				{activeFile.recovery && !activeFile.conflict && (
					<div className="bg-muted flex flex-wrap items-center gap-2 border-b p-2 text-sm">
						<span className="flex-1">
							Previous{" "}
							{activeFile.recovery.source === "disk" ? "disk version" : "draft"}{" "}
							available.
						</span>
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								if (
									activeFile.hasUnsavedChanges &&
									!window.confirm(t("doc.localFile.confirmUnsaved"))
								)
									return
								void restoreLocalFileRecovery(activeFile.id)
							}}
						>
							Restore as draft
						</Button>
					</div>
				)}
				{localImageExtensions && (
					<MarkdownEditor
						key={activeFile.id}
						ref={editor}
						value={editorContent}
						onChange={handleEditorChange}
						assets={editorAssets}
						onUploadImage={
							activeFile.workspaceId
								? async file => {
										let id = await writeLocalAsset(activeFile, file, file.name)
										setAssetVersion(version => version + 1)
										return { id, name: file.name.replace(/\.[^.]+$/, "") }
									}
								: undefined
						}
						onUploadVideo={
							activeFile.workspaceId
								? async (file, options) => {
										options.onProgress({ phase: "uploading", progress: 0 })
										let id = await writeLocalAsset(activeFile, file, file.name)
										options.onProgress({ phase: "done", progress: 1 })
										setAssetVersion(version => version + 1)
										return { id, name: file.name.replace(/\.[^.]+$/, "") }
									}
								: undefined
						}
						onImportTldraw={
							activeFile.workspaceId ? tldrawEditor.importFile : undefined
						}
						onCreateTldraw={
							activeFile.workspaceId ? tldrawEditor.create : undefined
						}
						onEditTldraw={
							activeFile.workspaceId ? tldrawEditor.edit : undefined
						}
						placeholder={t("doc.startWriting")}
						documents={documents}
						autoSortTasks={editorSettings?.editor?.autoSortTasks}
						spellcheck={editorSettings?.editor?.spellcheck ?? true}
						spellcheckLanguage={editorSettings?.editor?.spellcheckLanguage}
						smartPairs={editorSettings?.editor?.smartPairs ?? true}
						markerWrapping={editorSettings?.editor?.markerWrapping ?? true}
						tabIndent={editorSettings?.editor?.tabIndent ?? true}
						smartPaste={editorSettings?.editor?.smartPaste ?? true}
						autocomplete={editorSettings?.editor?.autocomplete ?? true}
						extensions={[...localImageExtensions, ...presentationExtensions()]}
					/>
				)}
				<EditorToolbar
					editor={editor}
					onToggleLeftSidebar={toggleLeft}
					onToggleRightSidebar={toggleRight}
					content={content}
					onThemeChange={handleChange}
				/>
			</div>

			<DocumentSidebar
				header={
					<>
						<ThemeToggle theme={theme} setTheme={setTheme} />
						<SettingsButton />
					</>
				}
				footer={
					<HelpMenu
						trigger={
							<Button variant="ghost" size="sm" className="w-full" nativeButton>
								<HelpCircle />
								<span>{t("help.label")}</span>
							</Button>
						}
						align={isMobile ? "center" : "end"}
						side={isMobile ? "top" : "left"}
						onNavigate={() => setRightOpenMobile(false)}
					/>
				}
			>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarEditorNavigation
								editor={editor}
								onOpen={open => setRightOpenMobile(false, open)}
							/>
							<SidebarMenuItem>
								<SidebarMenuButton
									onClick={() => setIsPreview(true)}
									nativeButton
								>
									<Eye className="size-4" />
									Preview
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarSeparator />
							<LocalFileMenu
								onOpen={handleOpenFile}
								onSaveAs={() => void handlersRef.current.handleSaveAs()}
								onDownload={() => handleDownload(activeFile)}
								onCopyToSynced={() => setCopyDialogOpen(true)}
								exportAsZip={
									!!activeFile.workspaceId &&
									referencedLocalAssetIds(content).size > 0
								}
								isMobile={isMobile}
							/>
							<SidebarEditMenu
								editor={editor}
								disabled={false}
								readOnly={false}
							/>
							<SidebarFormatMenu
								editor={editor}
								disabled={false}
								readOnly={false}
								documents={documents.map(d => ({ id: d.id, title: d.title }))}
							/>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				<SidebarSeparator />

				<SidebarGroup className="flex-1">
					<SidebarGroupContent>
						<LocalFileSaveStatus activeFile={activeFile} />
					</SidebarGroupContent>
				</SidebarGroup>
				{activeFile.workspaceId && (
					<SidebarGroup className="flex-1">
						<SidebarAssets
							assets={sidebarAssets}
							onUploadImages={files => {
								void Promise.all(
									Array.from(files)
										.filter(file => file.type.startsWith("image/"))
										.map(file => writeLocalAsset(activeFile, file, file.name)),
								)
									.then(() => setAssetVersion(version => version + 1))
									.catch(error => toast.error(assetErrorMessage(error)))
							}}
							onUploadVideo={async (file, options) => {
								if (options.signal.aborted) return
								options.onProgress({ phase: "uploading", progress: 0 })
								await writeLocalAsset(activeFile, file, file.name)
								setAssetVersion(version => version + 1)
								if (!options.signal.aborted)
									options.onProgress({ phase: "done", progress: 1 })
							}}
							canUploadVideo
							onRename={(id, name) => {
								void handleRenameAsset(id, name).catch(error =>
									toast.error(assetErrorMessage(error)),
								)
							}}
							onDelete={id => {
								void handleDeleteAsset(id).catch(error =>
									toast.error(assetErrorMessage(error)),
								)
							}}
							onDownload={id => {
								let asset = localAssets.find(candidate => candidate.id === id)
								if (asset) downloadLocalAsset(asset)
							}}
							onInsert={(id, name) =>
								editor.current?.insertBlock(`![${name}](asset:${id})`)
							}
							isAssetUsed={id => content.includes(`assets/${id}`)}
							onImportTldraw={tldrawEditor.importFile}
							onCreateTldraw={tldrawEditor.create}
							onEditTldraw={tldrawEditor.edit}
						/>
					</SidebarGroup>
				)}
			</DocumentSidebar>
			{tldrawEditor.dialog}
			<CopyToSyncedDialog
				content={content}
				localAssets={localAssets}
				filename={activeFile.filename}
				open={copyDialogOpen}
				onOpenChange={setCopyDialogOpen}
			/>
		</>
	)
}

function assetErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

interface LocalAssetView extends LocalAsset {
	url: string
	lightUrl?: string
	darkUrl?: string
}

function toLocalAssetView(asset: LocalAsset): LocalAssetView {
	return {
		...asset,
		url: URL.createObjectURL(asset.blob),
		lightUrl: asset.lightPreview
			? URL.createObjectURL(asset.lightPreview)
			: undefined,
		darkUrl: asset.darkPreview
			? URL.createObjectURL(asset.darkPreview)
			: undefined,
	}
}

function releaseLocalAssetViews(assets: LocalAssetView[]) {
	for (let asset of assets) {
		URL.revokeObjectURL(asset.url)
		if (asset.lightUrl) URL.revokeObjectURL(asset.lightUrl)
		if (asset.darkUrl) URL.revokeObjectURL(asset.darkUrl)
	}
}

function downloadLocalAsset(asset: LocalAssetView) {
	let link = document.createElement("a")
	link.href = asset.url
	link.download = asset.id
	link.click()
}

function LocalPreviewView({
	filename,
	docTitle,
	content,
	assets,
	wikilinks,
	theme,
	setTheme,
	onExit,
}: {
	filename: string | null
	docTitle: string
	content: string
	assets: LocalAssetView[]
	wikilinks: Map<string, ResolvedDoc>
	theme: Theme
	setTheme: (theme: Theme) => void
	onExit: () => void
}) {
	return (
		<div className="bg-background fixed inset-0 flex flex-col">
			<LocalPreviewTopBar
				filename={filename}
				docTitle={docTitle}
				theme={theme}
				setTheme={setTheme}
				onExit={onExit}
			/>
			<Preview content={content} localAssets={assets} wikilinks={wikilinks} />
		</div>
	)
}

function LocalPreviewTopBar({
	filename,
	docTitle,
	theme,
	setTheme,
	onExit,
}: {
	filename: string | null
	docTitle: string
	theme: Theme
	setTheme: (theme: Theme) => void
	onExit: () => void
}) {
	let t = useIntl()
	return (
		<div
			className="border-border relative flex shrink-0 items-center justify-between border-b px-4 py-2"
			style={{
				paddingTop: "max(0.5rem, env(safe-area-inset-top))",
				paddingLeft: "max(1rem, env(safe-area-inset-left))",
				paddingRight: "max(1rem, env(safe-area-inset-right))",
			}}
		>
			<span className="text-muted-foreground">
				{filename || t("doc.localFile.title")}
			</span>
			<span className="text-muted-foreground absolute left-1/2 -translate-x-1/2 truncate text-sm font-medium">
				{docTitle}
			</span>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button variant="ghost" size="icon" nativeButton={false}>
							<EllipsisIcon className="size-4" />
						</Button>
					}
				/>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={onExit}>
						<Pencil className="size-4" />
						Editor
						<DropdownMenuShortcut>
							{getShortcutLabel("preview")}
						</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<ThemeSubmenu theme={theme} setTheme={setTheme} />
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}

function LocalFileSaveStatus({ activeFile }: { activeFile: LocalFileEntry }) {
	let t = useIntl()
	let store = useLocalFileStore()
	let supportsFileSystem = isFileSystemAccessSupported()
	let [hasHandle, setHasHandle] = useState(false)

	useEffect(() => {
		let ignore = false
		async function checkHandle() {
			let handle = await getHandleFromDB(activeFile.id)
			if (!ignore) {
				setHasHandle(Boolean(handle))
			}
		}
		checkHandle()
		return () => {
			ignore = true
		}
	}, [activeFile.id])

	return (
		<div className="px-2 py-4">
			<div className="text-muted-foreground mb-2 text-xs font-medium uppercase">
				Save Status
			</div>
			<div className="flex items-center gap-2">
				{store.saveStatus === "saving" && (
					<>
						<Check className="text-muted-foreground size-4 animate-pulse" />
						<span className="text-muted-foreground text-sm">Saving...</span>
					</>
				)}
				{store.saveStatus === "saved" && (
					<>
						<Check className="size-4 text-emerald-600" />
						<span className="text-sm text-emerald-600">Saved</span>
					</>
				)}
				{store.saveStatus === "error" && (
					<>
						<AlertCircle className="text-destructive size-4" />
						<span className="text-destructive text-sm">
							{store.errorMessage}
						</span>
					</>
				)}
				{store.saveStatus === "idle" && hasHandle && (
					<>
						<Check className="text-muted-foreground size-4" />
						<span className="text-muted-foreground text-sm">
							Auto-saving enabled
						</span>
					</>
				)}
				{store.saveStatus === "idle" && !hasHandle && (
					<>
						<AlertCircle className="text-muted-foreground size-4" />
						<span className="text-muted-foreground text-sm">
							{supportsFileSystem
								? t("doc.localFile.saveAsToEnable")
								: t("doc.localFile.downloadToSave")}
						</span>
					</>
				)}
			</div>
		</div>
	)
}

function LocalFileMenu({
	onOpen,
	onSaveAs,
	onDownload,
	onCopyToSynced,
	exportAsZip,
	isMobile,
}: {
	onOpen: () => void
	onSaveAs: () => void
	onDownload: () => void
	onCopyToSynced: () => void
	exportAsZip: boolean
	isMobile: boolean
}) {
	let supportsFileSystem = isFileSystemAccessSupported()

	return (
		<SidebarMenuItem>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<SidebarMenuButton nativeButton>
							<FileText className="size-4" />
							<span>File</span>
						</SidebarMenuButton>
					}
				/>
				<DropdownMenuContent
					align={isMobile ? "center" : "start"}
					side={isMobile ? "bottom" : "left"}
				>
					<DropdownMenuItem onClick={onOpen}>
						<FileUp className="size-4" />
						Open Local File
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{supportsFileSystem && (
						<DropdownMenuItem onClick={onSaveAs}>
							<Check className="size-4" />
							{exportAsZip ? "Export as ZIP..." : "Save As..."}
							<DropdownMenuShortcut>
								{getShortcutLabel("saveAs")}
							</DropdownMenuShortcut>
						</DropdownMenuItem>
					)}
					<DropdownMenuItem onClick={onDownload}>
						<Download className="size-4" />
						Download
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={onCopyToSynced}>
						<Cloud className="size-4" />
						Copy to Synced Documents
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</SidebarMenuItem>
	)
}

function SettingsButton() {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						nativeButton={false}
						render={<Link to="/settings" search={{ from: "/local" }} />}
					>
						<Settings />
					</Button>
				}
			/>
			<TooltipContent>Settings</TooltipContent>
		</Tooltip>
	)
}
