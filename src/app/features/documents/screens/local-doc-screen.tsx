import { useEffect, useRef, useState } from "react"
import React from "react"
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
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { Input } from "@/app/components/ui/input"
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
	FolderPlus,
	FolderInput,
	Trash2,
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
	waitForLocalFileHydration,
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
	renameDirectoryFile,
	resolveLocalFileId,
	createDirectoryFolder,
	createDirectoryFile,
	moveDirectoryEntry,
	deleteDirectoryEntry,
	openDirectoryFile,
	readDirectoryFile,
	refreshLocalFile,
} from "@/app/lib/local-file"
import { CopyToSyncedDialog } from "@/app/features/spaces"
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
			await waitForLocalFileHydration()
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

type LocalDirectoryAction = {
	kind:
		| "create-file"
		| "create-folder"
		| "rename-folder"
		| "move-file"
		| "move-folder"
	path: string
}

function buildLocalTree(
	files: { id: string; name: string; path: string; lastModified?: number }[],
	folders: string[],
	sort: "latest" | "alphabetical",
): LocalTreeNode {
	let root: LocalTreeNode = { name: "", path: "", folders: [], files: [] }
	function addFolder(path: string): LocalTreeNode {
		let node = root
		for (let folder of path.split("/").filter(Boolean)) {
			let childPath = node.path ? `${node.path}/${folder}` : folder
			let child = node.folders.find(item => item.name === folder)
			if (!child) {
				child = { name: folder, path: childPath, folders: [], files: [] }
				node.folders.push(child)
			}
			node = child
		}
		return node
	}
	for (let folder of folders) addFolder(folder)
	for (let file of files) {
		let parts = file.path.split("/")
		let node = addFolder(parts.slice(0, -1).join("/"))
		let parent = root
		for (let folder of parts.slice(0, -1)) {
			parent = parent.folders.find(item => item.name === folder) ?? parent
			parent.lastModified = Math.max(
				parent.lastModified ?? 0,
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
	let [directoryAction, setDirectoryAction] =
		useState<LocalDirectoryAction | null>(null)
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
	let visibleFolders = searching
		? (workspace?.folders?.filter(folder => matches(folder)) ?? [])
		: (workspace?.folders ?? [])
	let tree = buildLocalTree(files, visibleFolders, sort)
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

	async function deleteEntry(path: string, kind: "file" | "folder") {
		if (!workspace) return
		let affected = store.files.filter(
			file =>
				file.workspaceId === workspace.id &&
				file.path &&
				(file.path === path ||
					(kind === "folder" && file.path.startsWith(`${path}/`))),
		)
		let warning = affected.some(file => file.hasUnsavedChanges)
			? " Unsaved edits in open files will be lost."
			: ""
		if (!window.confirm(`Delete ${kind} “${path}”?${warning}`)) return
		let result = await tryCatch(deleteDirectoryEntry(workspace.id, path, kind))
		if (!result.ok) toast.error(result.error.message)
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
										<ContextMenuSeparator />
										<ContextMenuItem
											onClick={() =>
												setDirectoryAction({
													kind: "create-file",
													path: folder.path,
												})
											}
										>
											<Plus className="size-4" />
											New file
										</ContextMenuItem>
										<ContextMenuItem
											onClick={() =>
												setDirectoryAction({
													kind: "create-folder",
													path: folder.path,
												})
											}
										>
											<FolderPlus className="size-4" />
											New folder
										</ContextMenuItem>
										<ContextMenuItem
											onClick={() =>
												setDirectoryAction({
													kind: "rename-folder",
													path: folder.path,
												})
											}
										>
											<Pencil className="size-4" />
											Rename
										</ContextMenuItem>
										<ContextMenuItem
											onClick={() =>
												setDirectoryAction({
													kind: "move-folder",
													path: folder.path,
												})
											}
										>
											<FolderInput className="size-4" />
											Move to…
										</ContextMenuItem>
										<ContextMenuItem
											onClick={() => void deleteEntry(folder.path, "folder")}
										>
											<Trash2 className="size-4" />
											Delete folder
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
							onManage={kind => {
								if (kind === "move")
									setDirectoryAction({ kind: "move-file", path: file.path })
								else void deleteEntry(file.path, "file")
							}}
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
							<div className="flex items-center">
								<Button
									size="icon"
									variant="ghost"
									aria-label="New file"
									onClick={() =>
										setDirectoryAction({ kind: "create-file", path: "" })
									}
								>
									<Plus className="size-4" />
								</Button>
								<Button
									size="icon"
									variant="ghost"
									aria-label="New folder"
									onClick={() =>
										setDirectoryAction({ kind: "create-folder", path: "" })
									}
								>
									<FolderPlus className="size-4" />
								</Button>
								<Button
									size="icon"
									variant="ghost"
									aria-label="Refresh folder"
									onClick={() => void refreshFilesystemWorkspace(true)}
								>
									<RefreshCw className="size-4" />
								</Button>
							</div>
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
			{workspace && directoryAction && (
				<LocalDirectoryActionDialog
					key={`${directoryAction.kind}:${directoryAction.path}`}
					workspaceId={workspace.id}
					folders={workspace.folders ?? []}
					action={directoryAction}
					onClose={() => setDirectoryAction(null)}
				/>
			)}
		</>
	)
}

function LocalDirectoryActionDialog({
	workspaceId,
	folders,
	action,
	onClose,
}: {
	workspaceId: string
	folders: string[]
	action: LocalDirectoryAction
	onClose: () => void
}) {
	let moving = action.kind === "move-file" || action.kind === "move-folder"
	let nameFromPath = action.path.split("/").at(-1) ?? ""
	let [name, setName] = useState(
		action.kind === "rename-folder"
			? nameFromPath
			: action.kind === "create-file"
				? "Untitled.md"
				: "",
	)
	let [destination, setDestination] = useState("")
	let [error, setError] = useState("")
	let [pending, setPending] = useState(false)
	let destinations = ["", ...folders].filter(
		folder =>
			action.kind !== "move-folder" ||
			(folder !== action.path && !folder.startsWith(`${action.path}/`)),
	)
	let title = {
		"create-file": "New file",
		"create-folder": "New folder",
		"rename-folder": "Rename folder",
		"move-file": "Move file",
		"move-folder": "Move folder",
	}[action.kind]

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault()
		setPending(true)
		let result = await tryCatch(
			(async () => {
				if (action.kind === "create-file") {
					let path = await createDirectoryFile(workspaceId, action.path, name)
					if (!(await openDirectoryFile(workspaceId, path)))
						toast.error(
							"File created, but it could not be opened. Refresh the folder.",
						)
				} else if (action.kind === "create-folder") {
					await createDirectoryFolder(workspaceId, action.path, name)
				} else if (action.kind === "rename-folder") {
					let parent = action.path.split("/").slice(0, -1).join("/")
					await moveDirectoryEntry(
						workspaceId,
						action.path,
						[parent, name.trim()].filter(Boolean).join("/"),
						"folder",
					)
				} else {
					let path = [destination, nameFromPath].filter(Boolean).join("/")
					await moveDirectoryEntry(
						workspaceId,
						action.path,
						path,
						action.kind === "move-file" ? "file" : "folder",
					)
				}
			})(),
		)
		setPending(false)
		if (!result.ok) {
			setError(result.error.message)
			return
		}
		onClose()
	}

	return (
		<Dialog
			open
			onOpenChange={open => {
				if (!open) onClose()
			}}
		>
			<DialogContent className="max-w-sm">
				<form onSubmit={event => void handleSubmit(event)}>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
					</DialogHeader>
					{moving ? (
						<div className="my-4 space-y-2">
							<label htmlFor="local-move-destination" className="text-sm">
								Destination folder
							</label>
							<select
								id="local-move-destination"
								className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
								value={destination}
								onChange={event => setDestination(event.target.value)}
							>
								{destinations.map(folder => (
									<option key={folder} value={folder}>
										{folder || "Folder root"}
									</option>
								))}
							</select>
						</div>
					) : (
						<Input
							className="my-4"
							aria-label={
								action.kind === "create-file" ? "File name" : "Folder name"
							}
							value={name}
							onChange={event => {
								setName(event.target.value)
								setError("")
							}}
							autoFocus
						/>
					)}
					{error && <p className="text-destructive text-sm">{error}</p>}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={pending || (!moving && !name.trim())}
						>
							{moving
								? "Move"
								: action.kind === "rename-folder"
									? "Rename"
									: "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
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
	onManage,
	onOpen,
}: {
	children: React.ReactElement
	fileId?: string
	workspaceId?: string
	path?: string
	onManage?: (kind: "move" | "delete") => void
	onOpen: () => void
}) {
	let t = useIntl()
	let [prepared, setPrepared] = useState<{
		content: string
		filename: string
	} | null>(null)
	let [renameOpen, setRenameOpen] = useState(false)
	let [renameName, setRenameName] = useState("")
	let [renameError, setRenameError] = useState("")
	let [renaming, setRenaming] = useState(false)
	let supportsSaveAs =
		isFileSystemAccessSupported() && !!window.showSaveFilePicker

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
		downloadLocalContent(file.content, file.filename)
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
		let result = await tryCatch(saveLocalCopy(file.content, file.filename))
		if (!result.ok) toast.error("Unable to save a copy of this file")
	}

	async function handleRename(event: React.FormEvent) {
		event.preventDefault()
		if (!workspaceId || !path) return
		setRenaming(true)
		let result = await tryCatch(
			renameDirectoryFile(workspaceId, path, renameName),
		)
		setRenaming(false)
		if (!result.ok) {
			setRenameError(result.error.message)
			return
		}
		setRenameOpen(false)
	}

	return (
		<>
			<ContextMenu onOpenChange={handleOpenChange}>
				<ContextMenuTrigger render={children} />
				<ContextMenuContent>
					<ContextMenuItem onClick={onOpen}>
						<FileText className="size-4" />
						Open
					</ContextMenuItem>
					{workspaceId && path && (
						<>
							<ContextMenuItem
								onClick={() => {
									setRenameName(path.split("/").at(-1) ?? "")
									setRenameError("")
									setRenameOpen(true)
								}}
							>
								<Pencil className="size-4" />
								Rename
							</ContextMenuItem>
							{onManage && (
								<ContextMenuItem onClick={() => onManage("move")}>
									<FolderInput className="size-4" />
									Move to…
								</ContextMenuItem>
							)}
							{onManage && (
								<ContextMenuItem onClick={() => onManage("delete")}>
									<Trash2 className="size-4" />
									Delete file
								</ContextMenuItem>
							)}
						</>
					)}
					{supportsSaveAs && (
						<ContextMenuItem
							disabled={!prepared}
							onClick={() => void handleSaveAsClicked()}
						>
							<Download className="size-4" />
							Save As…
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
			<Dialog open={renameOpen} onOpenChange={setRenameOpen}>
				<DialogContent className="max-w-sm">
					<form onSubmit={event => void handleRename(event)}>
						<DialogHeader>
							<DialogTitle>Rename file</DialogTitle>
						</DialogHeader>
						<Input
							className="my-4"
							aria-label="File name"
							value={renameName}
							onChange={event => {
								setRenameName(event.target.value)
								setRenameError("")
							}}
							autoFocus
						/>
						{renameError && (
							<p className="text-destructive text-sm">{renameError}</p>
						)}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setRenameOpen(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={renaming || !renameName.trim()}>
								Rename
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	)
}

async function saveLocalCopy(content: string, filename: string) {
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

function downloadLocalContent(content: string, filename: string) {
	let blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
	let url = URL.createObjectURL(blob)
	let link = document.createElement("a")
	link.href = url
	link.download = filename
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

	let me = useAccount(UserAccount, { resolve: meResolve })
	let editorSettings =
		me.$isLoaded && me.root?.settings?.$isLoaded ? me.root.settings : undefined

	useEditorSettings(editorSettings)

	let content = activeFile.content
	useEffect(() => {
		if (editor.current && editor.current.getContent() !== activeFile.content) {
			editor.current.setExternalContent(activeFile.content)
		}
	}, [activeFile.content, editor])
	let isDirty = activeFile.hasUnsavedChanges
	let docTitle = getDocumentTitle(content) || activeFile.filename || "Untitled"

	let documents: { id: string; title: string }[] = []

	function handleChange(newContent: string) {
		store.setFileContent(activeFile.id, newContent)

		if (saveTimeoutRef.current) {
			clearTimeout(saveTimeoutRef.current)
		}

		saveTimeoutRef.current = setTimeout(async () => {
			let currentState = useLocalFileStore.getState()
			let currentId = resolveLocalFileId(activeFile.id)
			let currentFile = currentState.getFileById(currentId)
			if (!currentFile || !currentFile.hasUnsavedChanges) return

			currentState.setSaveStatus("saving")
			let success = await saveLocalFile(currentId, currentFile.content)
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
		await saveLocalCopy(file.content, filename)
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
			await handleSaveAs(currentFile)
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
		downloadLocalContent(file.content, filename)
	}

	if (isPreview) {
		return (
			<LocalPreviewView
				filename={activeFile.filename}
				docTitle={docTitle}
				content={content}
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
				<MarkdownEditor
					key={activeFile.id}
					ref={editor}
					value={content}
					onChange={handleEditorChange}
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
					extensions={[...presentationExtensions()]}
				/>
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
			</DocumentSidebar>
			<CopyToSyncedDialog
				content={content}
				filename={activeFile.filename}
				open={copyDialogOpen}
				onOpenChange={setCopyDialogOpen}
			/>
		</>
	)
}

function LocalPreviewView({
	filename,
	docTitle,
	content,
	wikilinks,
	theme,
	setTheme,
	onExit,
}: {
	filename: string | null
	docTitle: string
	content: string
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
			<Preview content={content} wikilinks={wikilinks} />
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
	isMobile,
}: {
	onOpen: () => void
	onSaveAs: () => void
	onDownload: () => void
	onCopyToSynced: () => void
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
							Save As...
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
