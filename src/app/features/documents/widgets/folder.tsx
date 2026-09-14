import { useState } from "react"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { Combobox } from "@base-ui/react/combobox"
import { co } from "jazz-tools"
import { Folder, Pencil, FolderInput, Trash2, Plus } from "lucide-react"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/app/components/ui/context-menu"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { Button } from "@/app/components/ui/button"
import { Input } from "@/app/components/ui/input"
import { Label } from "@/app/components/ui/label"
import { Document } from "@/schema"
import { parseFrontmatter } from "@/app/features/editor"
import { applyContentDiffLoadingCommentAnchors } from "@/app/features/comments"
import { syncDocumentMetadata } from "../lib/metadata"
import { useIntl } from "@/shared/intl/setup"

import { SidebarFolderButton } from "./sidebar-folder-button"

export { FolderRow, useFolderStore }
export type { FolderState }

type LoadedDocument = co.loaded<typeof Document>
type ViewMode = "folders" | "flat"

interface FolderState {
	viewMode: ViewMode
	collapsedFolders: Set<string>
	setViewMode: (mode: ViewMode) => void
	toggleFolder: (path: string) => void
	isCollapsed: (path: string) => boolean
	renameFolder: (oldPath: string, newPath: string) => void
	removeFolder: (path: string) => void
}

interface PersistedFolderState {
	viewMode?: ViewMode
	collapsedFolders?: string[]
}

let useFolderStore = create<FolderState>()(
	persist(
		(set, get) => ({
			viewMode: "folders",
			collapsedFolders: new Set<string>(),
			setViewMode: mode => set({ viewMode: mode }),
			toggleFolder: path =>
				set(state => {
					let next = new Set(state.collapsedFolders)
					if (next.has(path)) {
						next.delete(path)
					} else {
						next.add(path)
					}
					return { collapsedFolders: next }
				}),
			isCollapsed: path => get().collapsedFolders.has(path),
			renameFolder: (oldPath, newPath) =>
				set(state => {
					let next = new Set<string>()
					for (let p of state.collapsedFolders) {
						if (p === oldPath) {
							next.add(newPath)
						} else if (p.startsWith(oldPath + "/")) {
							next.add(newPath + p.slice(oldPath.length))
						} else {
							next.add(p)
						}
					}
					return { collapsedFolders: next }
				}),
			removeFolder: path =>
				set(state => {
					let next = new Set<string>()
					for (let p of state.collapsedFolders) {
						if (p !== path && !p.startsWith(path + "/")) {
							next.add(p)
						}
					}
					return { collapsedFolders: next }
				}),
		}),
		{
			name: "folder-state",
			partialize: state => ({
				viewMode: state.viewMode,
				collapsedFolders: Array.from(state.collapsedFolders),
			}),
			merge: (persisted, current) => {
				let p = parsePersistedFolderState(persisted)
				return {
					...current,
					viewMode: p.viewMode ?? current.viewMode,
					collapsedFolders: new Set(p.collapsedFolders ?? []),
				}
			},
		},
	),
)

interface FolderRowProps {
	path: string
	depth: number
	docCount: number
	isCollapsed: boolean
	onToggle: () => void
	docsInFolder: LoadedDocument[]
	existingFolders: string[]
	onDeleteDocs?: (docs: LoadedDocument[]) => void
}

function FolderRow({
	path,
	depth,
	docCount,
	isCollapsed,
	onToggle,
	docsInFolder,
	existingFolders,
	onDeleteDocs,
}: FolderRowProps) {
	let t = useIntl()
	let { renameFolder, removeFolder } = useFolderStore()

	let [renameOpen, setRenameOpen] = useState(false)
	let [moveOpen, setMoveOpen] = useState(false)
	let [deleteOpen, setDeleteOpen] = useState(false)

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger
					render={
						<SidebarFolderButton
							path={path}
							depth={depth}
							count={docCount}
							isCollapsed={isCollapsed}
							onClick={onToggle}
						/>
					}
				/>
				<ContextMenuContent>
					<ContextMenuItem onClick={() => setRenameOpen(true)}>
						<Pencil />
						{t("doc.rename")}
					</ContextMenuItem>
					<ContextMenuItem onClick={() => setMoveOpen(true)}>
						<FolderInput />
						{t("doc.moveToFolder")}
					</ContextMenuItem>
					<ContextMenuItem
						onClick={() => setDeleteOpen(true)}
						variant="destructive"
					>
						<Trash2 />
						{t("doc.delete")}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			<RenameFolderDialog
				open={renameOpen}
				onOpenChange={setRenameOpen}
				path={path}
				existingFolders={existingFolders}
				onRename={newPath => {
					void handleRenameFolder(docsInFolder, path, newPath)
					renameFolder(path, newPath)
				}}
			/>

			<MoveFolderDialog
				open={moveOpen}
				onOpenChange={setMoveOpen}
				path={path}
				existingFolders={existingFolders}
				onMove={targetPath => {
					void handleMoveFolder(docsInFolder, path, targetPath)
					removeFolder(path)
				}}
			/>

			<DeleteFolderDialog
				open={deleteOpen}
				onOpenChange={setDeleteOpen}
				path={path}
				docCount={docCount}
				onDelete={deleteDocuments => {
					if (deleteDocuments && onDeleteDocs) {
						// Let parent handle deletion (sets deletedAt + navigates if needed)
						let docsToDelete = getDocsToDeleteInFolder(docsInFolder, path)
						onDeleteDocs(docsToDelete)
					} else {
						// Fallback: handle deletion/path-removal directly
						void handleDeleteFolder(docsInFolder, path, deleteDocuments)
					}
					removeFolder(path)
				}}
			/>
		</>
	)
}

// --- Helpers ---

function parsePersistedFolderState(persisted: unknown): PersistedFolderState {
	if (!persisted || typeof persisted !== "object") return {}
	let p = persisted as Record<string, unknown>
	return {
		viewMode:
			p.viewMode === "folders" || p.viewMode === "flat"
				? p.viewMode
				: undefined,
		collapsedFolders: Array.isArray(p.collapsedFolders)
			? p.collapsedFolders
			: undefined,
	}
}

// Dialogs

interface RenameFolderDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	path: string
	existingFolders: string[]
	onRename: (newPath: string) => void
}

function RenameFolderDialog({
	open,
	onOpenChange,
	path,
	existingFolders,
	onRename,
}: RenameFolderDialogProps) {
	let t = useIntl()
	let folderName = path.split("/").pop() || path
	let parentPath = path.includes("/")
		? path.slice(0, path.lastIndexOf("/"))
		: ""
	let [name, setName] = useState(folderName)
	let [error, setError] = useState("")

	let newPath = parentPath ? `${parentPath}/${name.trim()}` : name.trim()
	let isDuplicate =
		name.trim().toLowerCase() !== folderName.toLowerCase() &&
		existingFolders.some(f => f.toLowerCase() === newPath.toLowerCase())

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		if (!name.trim()) {
			setError(t("doc.folderDialog.nameRequired"))
			return
		}
		if (isDuplicate) {
			setError(t("doc.folderDialog.alreadyExists"))
			return
		}
		onRename(newPath)
		onOpenChange(false)
	}

	function handleOpenChange(open: boolean) {
		if (open) {
			setName(folderName)
			setError("")
		}
		onOpenChange(open)
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-sm">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>{t("doc.folderDialog.renameTitle")}</DialogTitle>
						<DialogDescription>
							{parentPath
								? t("doc.folderDialog.inPath", { path: parentPath })
								: t("doc.folderDialog.rootFolder")}
						</DialogDescription>
					</DialogHeader>
					<div className="py-4">
						<Label htmlFor="folder-name" className="sr-only">
							{t("doc.folderDialog.renameFolderName")}
						</Label>
						<Input
							id="folder-name"
							value={name}
							onChange={e => {
								setName(e.target.value)
								setError("")
							}}
							autoFocus
						/>
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
						<Button type="submit" disabled={!name.trim() || isDuplicate}>
							{t("doc.rename")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

interface MoveFolderDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	path: string
	existingFolders: string[]
	onMove: (targetPath: string) => void
}

function MoveFolderDialog({
	open,
	onOpenChange,
	path,
	existingFolders,
	onMove,
}: MoveFolderDialogProps) {
	let t = useIntl()
	let [inputValue, setInputValue] = useState("")
	let folderName = path.split("/").pop() || path

	// Filter out self, parent paths, and child paths
	let filteredFolders = existingFolders.filter(folder => {
		if (folder === path) return false
		if (path.startsWith(folder + "/")) return false // parent
		if (folder.startsWith(path + "/")) return false // child
		return folder.toLowerCase().includes(inputValue.toLowerCase())
	})

	let showCreateOption =
		inputValue.trim() &&
		!existingFolders.some(f => f.toLowerCase() === inputValue.toLowerCase()) &&
		inputValue.trim().toLowerCase() !== path.toLowerCase()

	function handleSelect(value: string | null) {
		if (!value) return
		let targetPath =
			value === "__root__" ? folderName : `${value}/${folderName}`
		onMove(targetPath)
		onOpenChange(false)
		setInputValue("")
	}

	function handleCreateAndMove() {
		if (!inputValue.trim()) return
		let targetPath = `${inputValue.trim()}/${folderName}`
		onMove(targetPath)
		onOpenChange(false)
		setInputValue("")
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{t("doc.folderDialog.moveTitle")}</DialogTitle>
					<DialogDescription>
						Move &ldquo;{folderName}&rdquo; to another folder
					</DialogDescription>
				</DialogHeader>

				<Combobox.Root
					value={null}
					onValueChange={handleSelect}
					onInputValueChange={value => setInputValue(value)}
				>
					<div className="relative">
						<Combobox.Input
							placeholder={t("doc.moveToFolderDialog.placeholder")}
							className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-none border px-3 py-1 text-sm focus-visible:ring-1 focus-visible:outline-none"
						/>
					</div>

					<Combobox.Portal>
						<Combobox.Positioner sideOffset={4} className="z-50">
							<Combobox.Popup className="bg-popover text-popover-foreground ring-foreground/10 max-h-60 w-[var(--anchor-width)] overflow-auto rounded-none shadow-md ring-1">
								{filteredFolders.length === 0 && !showCreateOption && (
									<div className="text-muted-foreground px-3 py-2 text-sm">
										{t("doc.moveToFolderDialog.noFolders")}
									</div>
								)}

								{path.includes("/") && (
									<Combobox.Item
										value="__root__"
										className="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none"
									>
										<Folder className="text-muted-foreground size-4" />
										<span className="text-muted-foreground italic">
											{t("doc.moveToFolderDialog.rootOption")}
										</span>
									</Combobox.Item>
								)}

								{filteredFolders.map(folder => (
									<Combobox.Item
										key={folder}
										value={folder}
										className="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none"
									>
										<Folder className="text-muted-foreground size-4" />
										<span className="flex-1 truncate">{folder}</span>
									</Combobox.Item>
								))}

								{showCreateOption && (
									<button
										type="button"
										onClick={handleCreateAndMove}
										className="hover:bg-accent hover:text-accent-foreground flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none"
									>
										<Plus className="text-muted-foreground size-4" />
										<span>
											{t("doc.folderDialog.createFolder", {
												name: inputValue,
											})}
										</span>
									</button>
								)}
							</Combobox.Popup>
						</Combobox.Positioner>
					</Combobox.Portal>
				</Combobox.Root>

				<div className="flex justify-end gap-2 pt-2">
					<Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
						{t("doc.cancel")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}

interface DeleteFolderDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	path: string
	docCount: number
	onDelete: (deleteDocuments: boolean) => void
}

function DeleteFolderDialog({
	open,
	onOpenChange,
	path,
	docCount,
	onDelete,
}: DeleteFolderDialogProps) {
	let t = useIntl()
	let folderName = path.split("/").pop() || path

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>
						{t("doc.folderDialog.deleteTitle", { folderName })}
					</DialogTitle>
					<DialogDescription>
						{t("doc.folderDialog.deleteDescription", {
							docCount: docCount.toString(),
						})}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter className="flex-col gap-2 sm:flex-col">
					<Button
						variant="outline"
						className="w-full"
						onClick={() => {
							onDelete(false)
							onOpenChange(false)
						}}
					>
						{t("doc.folderDialog.moveToRoot")}
					</Button>
					<Button
						variant="destructive"
						className="w-full"
						onClick={() => {
							onDelete(true)
							onOpenChange(false)
						}}
					>
						{t("doc.folderDialog.deleteDocuments", {
							docCount: docCount.toString(),
						})}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

// Handlers

async function handleRenameFolder(
	docs: LoadedDocument[],
	oldPath: string,
	newPath: string,
) {
	for (let doc of docs) {
		let docPath = doc.path
		if (!docPath) continue

		let updatedPath: string
		if (docPath === oldPath) {
			updatedPath = newPath
		} else if (docPath.startsWith(oldPath + "/")) {
			updatedPath = newPath + docPath.slice(oldPath.length)
		} else {
			continue
		}

		let loaded = await doc.$jazz.ensureLoaded({ resolve: { content: true } })
		let newContent = updatePathInContent(loaded.content.toString(), updatedPath)
		await applyContentDiffLoadingCommentAnchors(loaded, newContent)
		loaded.$jazz.set("updatedAt", new Date())
		syncDocumentMetadata(loaded)
	}
}

async function handleMoveFolder(
	docs: LoadedDocument[],
	oldPath: string,
	newPath: string,
) {
	await handleRenameFolder(docs, oldPath, newPath)
}

function getDocsToDeleteInFolder(
	docs: LoadedDocument[],
	path: string,
): LoadedDocument[] {
	return docs.filter(doc => {
		let docPath = doc.path
		if (!docPath) return false
		return docPath === path || docPath.startsWith(path + "/")
	})
}

async function handleDeleteFolder(
	docs: LoadedDocument[],
	path: string,
	deleteDocuments: boolean,
) {
	for (let doc of docs) {
		let docPath = doc.path
		if (!docPath) continue

		let isInFolder = docPath === path || docPath.startsWith(path + "/")
		if (!isInFolder) continue

		if (deleteDocuments) {
			doc.$jazz.set("deletedAt", new Date())
		} else {
			let loaded = await doc.$jazz.ensureLoaded({ resolve: { content: true } })
			let newContent = removePathFromContent(loaded.content.toString())
			await applyContentDiffLoadingCommentAnchors(loaded, newContent)
			loaded.$jazz.set("updatedAt", new Date())
			syncDocumentMetadata(loaded)
		}
	}
}

function updatePathInContent(content: string, newPath: string): string {
	let { frontmatter } = parseFrontmatter(content)
	if (!frontmatter) return content

	return content.replace(
		/^(---\r?\n[\s\S]*?)path:\s*[^\r\n]*/,
		`$1path: ${newPath}`,
	)
}

function removePathFromContent(content: string): string {
	return content.replace(
		/^(---\r?\n[\s\S]*?)path:\s*[^\r\n]*\r?\n([\s\S]*?---)/,
		"$1$2",
	)
}
