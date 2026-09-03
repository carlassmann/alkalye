import { useEffect, useRef, useState } from "react"
import React from "react"
import { Link, useBlocker, useNavigate } from "@tanstack/react-router"
import { useAccount } from "jazz-tools/react"
import { UserAccount } from "@/schema"
import {
	MarkdownEditor,
	useMarkdownEditorRef,
	SidebarEditorNavigation,
	type WikilinkDoc,
} from "@/app/features/editor"
import { presentationExtensions } from "@/app/features/presentation"
import { useEditorSettings } from "@/app/features/editor"
import { getDocumentTitle } from "../lib/title"
import { EditorToolbar } from "@/app/features/editor"
import { DocumentSidebar } from "../widgets/document-sidebar"
import { ListSidebar } from "../widgets/list-sidebar"
import { SidebarSyncStatus } from "@/app/components/sidebar-sync-status"
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
	SidebarSeparator,
} from "@/app/components/ui/sidebar"
import { SidebarProvider, useSidebar } from "@/app/components/ui/sidebar"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/app/components/ui/context-menu"
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
	ChevronRight,
	Eye,
	Pencil,
	EllipsisIcon,
	X,
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
	readFileFromHandle,
	consumeLaunchQueue,
	isFileSystemAccessSupported,
	closeLocalFile,
	type LocalFileEntry,
	getHandleFromDB,
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
import { parseWikiLinks } from "@/app/features/editor"
import { useDocTitles, type ResolvedDoc } from "../lib/wikilink-titles"
import { useWikilinkResolver } from "../lib/use-wikilink-resolver"
import { toast } from "sonner"
import { tryCatch } from "@/app/lib/try-catch"
import { useIntl } from "@/shared/intl/setup"
import { useHasFinePointer } from "@/app/hooks/use-fine-pointer"
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

	if (!activeFile) {
		return <LocalFileEmptyState />
	}

	return (
		<SidebarProvider>
			<LocalEditorContent
				isPreview={isPreview}
				setIsPreview={setIsPreview}
				activeFile={activeFile}
			/>
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
		state.setFileSavedContent(fileId, file.content)
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
			content: contentResult.value,
			lastSavedContent: contentResult.value,
			hasUnsavedChanges: false,
			isActive: true,
		})
	}

	let supportsFileSystem = isFileSystemAccessSupported()

	return (
		<Empty className="h-screen">
			<EmptyHeader>
				<FileText className="text-muted-foreground size-12" />
				<EmptyTitle>Open a Local File</EmptyTitle>
			</EmptyHeader>
			<EmptyDescription className="max-w-md">
				Edit a markdown file from your computer without syncing it to cloud.
				Changes are saved directly to the file.
			</EmptyDescription>
			<div className="mt-6 flex flex-col gap-3">
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
					render={<Link to="/" />}
				>
					<Cloud className="mr-1.5 size-4" />
					Go to synced documents
				</Button>
			</div>
		</Empty>
	)
}

let meResolve = {
	root: {
		documents: { $each: { content: true } },
		settings: true,
	},
} as const

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
	let navigate = useNavigate()

	let store = useLocalFileStore()
	let { theme, setTheme } = useTheme()
	let resolvedTheme = useResolvedTheme()
	let {
		toggleLeft,
		toggleRight,
		isMobile,
		setLeftOpenMobile,
		setRightOpenMobile,
	} = useSidebar()
	let [copyDialogOpen, setCopyDialogOpen] = useState(false)

	let me = useAccount(UserAccount, { resolve: meResolve })
	let editorSettings =
		me.$isLoaded && me.root?.settings?.$isLoaded ? me.root.settings : undefined

	useEditorSettings(editorSettings)

	let content = activeFile.content
	let isDirty = activeFile.hasUnsavedChanges
	let docTitle = getDocumentTitle(content) || activeFile.filename || "Untitled"

	let documents: WikilinkDoc[] = []
	if (me.$isLoaded && me.root?.documents?.$isLoaded) {
		documents = Array.from(me.root.documents.values()).flatMap(d => {
			if (!d?.$isLoaded || !d.content?.$isLoaded || d.deletedAt) return []
			return [
				{
					id: d.$jazz.id,
					title: getDocumentTitle(d.content.toString()),
				},
			]
		})
	}

	let resolveWikilink = useWikilinkResolver(content, documents)
	let handleWikilinkClick = (id: string, newTab: boolean) => {
		if (newTab) {
			window.open(`/app/doc/${id}`, "_blank")
		} else {
			navigate({ to: "/doc/$id", params: { id } })
		}
	}

	useBlocker({
		shouldBlockFn: () => isDirty,
		enableBeforeUnload: isDirty,
	})

	function handleChange(newContent: string) {
		store.setFileContent(activeFile.id, newContent)

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
				currentState.setFileSavedContent(activeFile.id, currentFile.content)
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
		let title = getDocumentTitle(file.content) || file.filename || "Untitled"
		let suggestedName = file.filename || title + ".md"
		let result = await saveLocalFileAs(file.content, suggestedName)
		if (!result) return

		useLocalFileStore.getState().addFile({
			id: result.id,
			filename: suggestedName,
			lastOpened: Date.now(),
			content: file.content,
			lastSavedContent: file.content,
			hasUnsavedChanges: false,
			isActive: true,
		})
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
		let blob = new Blob([file.content], {
			type: "text/markdown;charset=utf-8",
		})
		let url = URL.createObjectURL(blob)
		let a = document.createElement("a")
		a.href = url
		a.download = filename
		a.click()
		URL.revokeObjectURL(url)
	}

	async function handleSwitchFile(fileId: string) {
		if (isDirty) {
			let confirmed = window.confirm(t("doc.localFile.confirmSwitchFile"))
			if (!confirmed) return
		}

		await saveCurrentFile(activeFile.id, t)

		let handle = await getHandleFromDB(fileId)
		if (!handle) {
			toast.error(t("doc.localFile.fileHandleNotFound"))
			return
		}

		let result = await readFileFromHandle(handle)
		if (!result) {
			toast.error(t("doc.localFile.failedToRead"))
			return
		}

		let state = useLocalFileStore.getState()
		state.markFileActive(fileId)
		state.setFileContent(fileId, result.content)
		state.setFileSavedContent(fileId, result.content)
	}

	async function handleCloseFile(fileId: string) {
		if (activeFile.id === fileId && isDirty) {
			let confirmed = window.confirm(t("doc.localFile.confirmCloseFile"))
			if (!confirmed) return
		}

		await closeLocalFile(fileId)
	}

	let wikilinkIds = parseWikiLinks(content).map(w => w.id)
	let wikilinkCache = useDocTitles(wikilinkIds)

	if (isPreview) {
		return (
			<LocalPreviewView
				filename={activeFile.filename}
				docTitle={docTitle}
				content={content}
				wikilinks={wikilinkCache}
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
						variant="ghost"
						nativeButton
						onClick={handleOpenFile}
					>
						<Plus className="size-4" />
						{t("doc.sidebar.newLocalFile")}
					</Button>
				}
				footer={<SidebarSyncStatus />}
			>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton
									nativeButton={false}
									render={<Link to="/" />}
									onClick={() => isMobile && setLeftOpenMobile(false)}
								>
									<Cloud className="size-4" />
									Synced Documents
									<ChevronRight className="ml-auto size-4" />
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
				<SidebarSeparator />
				<SidebarGroup className="flex-1">
					<SidebarGroupContent>
						<LocalFilesList
							files={store.files}
							activeFileId={activeFile.id}
							onSwitchFile={handleSwitchFile}
							onCloseFile={handleCloseFile}
							onSaveAs={file => void handleSaveAs(file)}
							onDownload={handleDownload}
							isMobile={isMobile}
							setLeftOpenMobile={setLeftOpenMobile}
						/>
					</SidebarGroupContent>
				</SidebarGroup>
			</ListSidebar>

			<div className="markdown-editor flex-1">
				<MarkdownEditor
					key={activeFile.id}
					ref={editor}
					value={content}
					onChange={handleEditorChange}
					placeholder={t("doc.startWriting")}
					documents={documents}
					resolveWikilink={resolveWikilink}
					onWikilinkClick={handleWikilinkClick}
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

function LocalFilesList({
	files,
	activeFileId,
	onSwitchFile,
	onCloseFile,
	onSaveAs,
	onDownload,
	isMobile,
	setLeftOpenMobile,
}: {
	files: LocalFileEntry[]
	activeFileId: string
	onSwitchFile: (fileId: string) => void
	onCloseFile: (fileId: string) => void
	onSaveAs: (file: LocalFileEntry) => void
	onDownload: (file: LocalFileEntry) => void
	isMobile: boolean
	setLeftOpenMobile: (open: boolean) => void
}) {
	let t = useIntl()
	let hasFinePointer = useHasFinePointer()
	let sortedFiles = [...files].sort((a, b) => b.lastOpened - a.lastOpened)
	let supportsFileSystem = isFileSystemAccessSupported()

	return (
		<SidebarMenu>
			{sortedFiles.map(file => (
				<ContextMenu key={file.id} disabled={!hasFinePointer}>
					<ContextMenuTrigger
						onTouchStart={event => event.preventBaseUIHandler()}
						render={
							<SidebarMenuButton
								isActive={file.id === activeFileId}
								nativeButton
								onClick={() => {
									if (file.id !== activeFileId) {
										void onSwitchFile(file.id)
									}
									if (isMobile) {
										setLeftOpenMobile(false)
									}
								}}
							>
								<FileText
									className={`size-4 ${
										file.id === activeFileId
											? "text-primary"
											: "text-muted-foreground"
									}`}
								/>
								<span
									className={`truncate ${
										file.id === activeFileId ? "font-medium" : ""
									}`}
								>
									{file.filename}
									{file.hasUnsavedChanges && (
										<span className="ml-1 text-amber-500">•</span>
									)}
								</span>
							</SidebarMenuButton>
						}
					/>
					<ContextMenuContent>
						{supportsFileSystem && (
							<ContextMenuItem onClick={() => onSaveAs(file)}>
								<Check />
								{t("doc.saveAs")}
							</ContextMenuItem>
						)}
						<ContextMenuItem onClick={() => onDownload(file)}>
							<Download />
							{t("doc.download")}
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							onClick={() => void onCloseFile(file.id)}
							className="gap-2"
						>
							<X />
							{t("doc.sidebar.closeFile")}
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			))}
		</SidebarMenu>
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
