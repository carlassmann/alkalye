import { create } from "zustand"
import { persist, type PersistStorage } from "zustand/middleware"
import { get, set, del } from "idb-keyval"
import { toast } from "sonner"
import { tryCatch } from "@/app/lib/try-catch"
import { z } from "zod"
import { mergeFileContent } from "@/app/lib/merge-file-content"
import { getPresentationMode } from "@/app/features/presentation"

export {
	useLocalFileStore,
	openLocalFile,
	saveLocalFile,
	saveLocalFileAs,
	readFileFromHandle,
	consumeLaunchQueue,
	isFileSystemAccessSupported,
	type LocalFileState,
	type LocalFileEntry,
	closeLocalFile,
	switchToLocalFile,
	getHandleFromDB,
	openLocalDirectory,
	selectLocalWorkspace,
	refreshLocalDirectory,
	renameDirectoryFile,
	resolveLocalFileId,
	waitForLocalFileHydration,
	createDirectoryFolder,
	createDirectoryFile,
	moveDirectoryEntry,
	deleteDirectoryEntry,
	openDirectoryFile,
	readDirectoryFile,
	refreshLocalFile,
	getDirectoryHandleFromDB,
	removeLocalDirectory,
	resolveLocalFileConflict,
	restoreLocalFileRecovery,
	type LocalDirectoryWorkspace,
}

declare global {
	interface Window {
		launchQueue?: LaunchQueue
		showOpenFilePicker?: (
			options?: OpenFilePickerOptions,
		) => Promise<FileSystemFileHandle[]>
		showSaveFilePicker?: (
			options?: SaveFilePickerOptions,
		) => Promise<FileSystemFileHandle>
	}

	interface LaunchQueue {
		setConsumer(consumer: (params: LaunchParams) => void): void
	}

	interface LaunchParams {
		files: readonly FileSystemFileHandle[]
	}

	interface OpenFilePickerOptions {
		multiple?: boolean
		excludeAcceptAllOption?: boolean
		types?: FilePickerAcceptType[]
	}

	interface SaveFilePickerOptions {
		suggestedName?: string
		excludeAcceptAllOption?: boolean
		types?: FilePickerAcceptType[]
	}

	interface FilePickerAcceptType {
		description?: string
		accept: Record<string, string[]>
	}

	interface FileSystemFileHandle {
		getFile(): Promise<File>
		createWritable(): Promise<FileSystemWritableFileStream>
		move?(directory: FileSystemDirectoryHandle, name: string): Promise<void>
		queryPermission?(options: {
			mode: "read" | "readwrite"
		}): Promise<"granted" | "denied" | "prompt">
		requestPermission?(options: {
			mode: "read" | "readwrite"
		}): Promise<"granted" | "denied" | "prompt">
	}

	interface FileSystemDirectoryHandle {
		move?(directory: FileSystemDirectoryHandle, name: string): Promise<void>
	}

	interface FileSystemWritableFileStream extends WritableStream {
		write(data: string | Blob | ArrayBuffer): Promise<void>
		close(): Promise<void>
		abort(reason?: unknown): Promise<void>
	}
}

interface LocalFileEntry {
	id: string
	filename: string
	lastOpened: number
	lastModified?: number
	content: string
	lastSavedContent: string
	hasUnsavedChanges: boolean
	isActive: boolean
	workspaceId?: string
	path?: string
	conflict?: boolean
	recovery?: { content: string; source: "local" | "disk"; savedAt: number }
}

interface LocalDirectoryWorkspace {
	id: string
	name: string
	folders?: string[]
	files: {
		id: string
		name: string
		path: string
		lastModified?: number
		isPresentation?: boolean
	}[]
	status: "ready" | "reconnect" | "error"
}

interface LocalFileState {
	files: LocalFileEntry[]
	directoryWorkspaces: LocalDirectoryWorkspace[]
	selectedWorkspaceId: string | null
	activeFileId: string | null
	saveStatus: "idle" | "saving" | "saved" | "error"
	errorMessage: string | null

	setFiles: (files: LocalFileEntry[]) => void
	relocateFiles: (
		workspaceId: string,
		oldPath: string,
		newPath: string,
		folder: boolean,
	) => void
	removeDirectoryFiles: (
		workspaceId: string,
		path: string,
		folder: boolean,
	) => void
	setDirectoryWorkspaces: (workspaces: LocalDirectoryWorkspace[]) => void
	setSelectedWorkspaceId: (id: string | null) => void
	setActiveFileId: (id: string | null) => void
	setSaveStatus: (status: "idle" | "saving" | "saved" | "error") => void
	setErrorMessage: (message: string | null) => void
	setFileContent: (id: string, content: string) => void
	setFileSavedContent: (id: string, content: string) => void
	setFileLastModified: (id: string, lastModified: number) => void
	reconcileFile: (
		id: string,
		base: string,
		content: string,
		conflict: boolean,
	) => void
	setFileRecovery: (id: string, recovery: LocalFileEntry["recovery"]) => void
	addFile: (entry: LocalFileEntry) => void
	removeFile: (id: string) => void
	markFileActive: (id: string) => void
	reset: () => void

	getActiveFile: () => LocalFileEntry | null
	getFileById: (id: string) => LocalFileEntry | null
}

const STORE_NAME = "local-files-storage"
const HANDLES_KEY = "local-file-handles"
let DIRECTORY_HANDLES_KEY = "local-directory-handles"

let handleCache = new Map<string, FileSystemFileHandle>()
let directoryHandleCache = new Map<string, FileSystemDirectoryHandle>()
let fileMutationLocks = new Map<string, Promise<void>>()
let relocatedFileIds = new Map<string, string>()
let workspaceMutationQueues = new Map<string, Promise<void>>()

let persistedStateSchema = z.object({
	files: z.array(
		z.object({
			id: z.string(),
			filename: z.string(),
			lastOpened: z.number(),
			lastModified: z.number().optional(),
			content: z.string(),
			lastSavedContent: z.string(),
			hasUnsavedChanges: z.boolean(),
			isActive: z.boolean(),
			workspaceId: z.string().optional(),
			path: z.string().optional(),
			conflict: z.boolean().optional(),
			recovery: z
				.object({
					content: z.string(),
					source: z.enum(["local", "disk"]),
					savedAt: z.number(),
				})
				.optional(),
		}),
	),
	folders: z.array(z.string()).optional(),
	directoryWorkspaces: z
		.array(
			z.object({
				id: z.string(),
				name: z.string(),
				files: z.array(
					z.object({
						id: z.string(),
						name: z.string(),
						path: z.string(),
						lastModified: z.number().optional(),
						isPresentation: z.boolean().optional(),
					}),
				),
				status: z.enum(["ready", "reconnect", "error"]),
			}),
		)
		.default([]),
	selectedWorkspaceId: z.string().nullable().default(null),
	activeFileId: z.string().nullable(),
	saveStatus: z.enum(["idle", "saving", "saved", "error"]),
	errorMessage: z.string().nullable(),
})

type PersistedState = z.infer<typeof persistedStateSchema>

let initialPersistedState: PersistedState = {
	files: [],
	directoryWorkspaces: [],
	selectedWorkspaceId: null,
	activeFileId: null,
	saveStatus: "idle",
	errorMessage: null,
}

let useLocalFileStore = create<LocalFileState>()(
	persist(
		(set): LocalFileState => ({
			files: [] as LocalFileEntry[],
			directoryWorkspaces: [],
			selectedWorkspaceId: null,
			activeFileId: null,
			saveStatus: "idle",
			errorMessage: null,

			setFiles: files => set({ files }),
			relocateFiles: (workspaceId, oldPath, newPath, folder) =>
				set(state => {
					let files = state.files.map(file => {
						if (file.workspaceId !== workspaceId || !file.path) return file
						if (
							file.path !== oldPath &&
							!(folder && file.path.startsWith(`${oldPath}/`))
						)
							return file
						let path = `${newPath}${file.path.slice(oldPath.length)}`
						return {
							...file,
							id: `${workspaceId}:${path}`,
							path,
							filename: path.split("/").at(-1) ?? file.filename,
						}
					})
					let activeFileId = state.activeFileId
					let prefix = `${workspaceId}:${oldPath}`
					if (
						activeFileId === prefix ||
						(folder && activeFileId?.startsWith(`${prefix}/`))
					)
						activeFileId = `${workspaceId}:${newPath}${activeFileId.slice(prefix.length)}`
					return { files, activeFileId }
				}),
			removeDirectoryFiles: (workspaceId, path, folder) =>
				set(state => {
					let files = state.files.filter(
						file =>
							file.workspaceId !== workspaceId ||
							!file.path ||
							(file.path !== path &&
								!(folder && file.path.startsWith(`${path}/`))),
					)
					let activeFileId = files.some(file => file.id === state.activeFileId)
						? state.activeFileId
						: (files
								.filter(
									file =>
										(file.workspaceId ?? null) === state.selectedWorkspaceId,
								)
								.sort((a, b) => b.lastOpened - a.lastOpened)[0]?.id ?? null)
					return { files, activeFileId }
				}),
			setDirectoryWorkspaces: directoryWorkspaces =>
				set({ directoryWorkspaces }),
			setSelectedWorkspaceId: selectedWorkspaceId =>
				set({ selectedWorkspaceId }),
			setActiveFileId: id => set({ activeFileId: id }),
			setSaveStatus: status => set({ saveStatus: status }),
			setErrorMessage: message => set({ errorMessage: message }),

			setFileContent: (id, content) =>
				set(state => ({
					files: state.files.map(f =>
						f.id === id
							? {
									...f,
									content,
									hasUnsavedChanges: content !== f.lastSavedContent,
								}
							: f,
					),
				})),

			setFileSavedContent: (id, content) =>
				set(state => ({
					files: state.files.map(f =>
						f.id === id
							? {
									...f,
									lastSavedContent: content,
									hasUnsavedChanges: false,
								}
							: f,
					),
				})),
			setFileLastModified: (id, lastModified) =>
				set(state => ({
					files: state.files.map(file =>
						file.id === id ? { ...file, lastModified } : file,
					),
				})),
			reconcileFile: (id, base, content, conflict) =>
				set(state => ({
					files: state.files.map(file =>
						file.id === id
							? {
									...file,
									lastSavedContent: base,
									content,
									conflict,
									hasUnsavedChanges: content !== base,
								}
							: file,
					),
				})),
			setFileRecovery: (id, recovery) =>
				set(state => ({
					files: state.files.map(file =>
						file.id === id ? { ...file, recovery } : file,
					),
				})),

			addFile: entry =>
				set(state => {
					let existing = state.files.find(f => f.id === entry.id)
					if (existing) {
						return {
							files: state.files.map(f =>
								f.id === entry.id
									? { ...entry, lastOpened: Date.now(), isActive: true }
									: { ...f, isActive: false },
							),
							activeFileId: entry.id,
							selectedWorkspaceId: entry.workspaceId ?? null,
						}
					}
					return {
						files: [
							...state.files.map(f => ({ ...f, isActive: false })),
							{ ...entry, isActive: true },
						],
						activeFileId: entry.id,
						selectedWorkspaceId: entry.workspaceId ?? null,
					}
				}),

			removeFile: id =>
				set(state => {
					let newFiles = state.files.filter(f => f.id !== id)
					let sibling = newFiles
						.filter(
							file => (file.workspaceId ?? null) === state.selectedWorkspaceId,
						)
						.sort((a, b) => b.lastOpened - a.lastOpened)[0]
					let newActiveId =
						state.activeFileId === id
							? (sibling?.id ?? null)
							: state.activeFileId
					return {
						files: newFiles,
						activeFileId: newActiveId,
					}
				}),

			markFileActive: id =>
				set(state => ({
					files: state.files.map(f => ({
						...f,
						isActive: f.id === id,
						lastOpened: f.id === id ? Date.now() : f.lastOpened,
					})),
					activeFileId: id,
				})),

			reset: () => {
				fileMutationLocks.clear()
				relocatedFileIds.clear()
				workspaceMutationQueues.clear()
				set({
					files: [],
					directoryWorkspaces: [],
					selectedWorkspaceId: null,
					activeFileId: null,
					saveStatus: "idle",
					errorMessage: null,
				})
			},

			getActiveFile: () => {
				let state = useLocalFileStore.getState()
				return state.files.find(f => f.id === state.activeFileId) || null
			},

			getFileById: (id: string) => {
				let state = useLocalFileStore.getState()
				return state.files.find(f => f.id === id) || null
			},
		}),
		{
			name: STORE_NAME,
			storage: createIdbStorage(persistedStateSchema, initialPersistedState),
			partialize: (state): PersistedState => ({
				files: state.files,
				directoryWorkspaces: state.directoryWorkspaces,
				selectedWorkspaceId: state.selectedWorkspaceId,
				activeFileId: state.activeFileId,
				saveStatus: state.saveStatus,
				errorMessage: state.errorMessage,
			}),
		},
	),
)

function waitForLocalFileHydration(): Promise<void> {
	if (useLocalFileStore.persist.hasHydrated()) return Promise.resolve()
	return new Promise(resolve => {
		let unsubscribe = useLocalFileStore.persist.onFinishHydration(() => {
			unsubscribe()
			resolve()
		})
		if (useLocalFileStore.persist.hasHydrated()) {
			unsubscribe()
			resolve()
		}
	})
}

async function getHandleFromDB(
	id: string,
): Promise<FileSystemFileHandle | null> {
	let file = useLocalFileStore.getState().getFileById(id)
	if (file?.workspaceId && file.path) {
		let fresh = await resolveDirectoryFileHandle(file.workspaceId, file.path)
		if (fresh) {
			handleCache.set(id, fresh)
			return fresh
		}
		return null
	}
	if (handleCache.has(id)) return handleCache.get(id)!

	let map = await getHandleMap()
	let handle = map[id]
	if (handle) handleCache.set(id, handle)
	return handle || null
}

async function resolveDirectoryFileHandle(
	workspaceId: string,
	path: string,
): Promise<FileSystemFileHandle | null> {
	let root = await getDirectoryHandleFromDB(workspaceId)
	if (!root) return null
	let segments = path.split("/")
	let name = segments.pop()
	if (!name) return null
	let result = await tryCatch(
		(async () => {
			let directory = root
			for (let segment of segments)
				directory = await directory.getDirectoryHandle(segment)
			return directory.getFileHandle(name)
		})(),
	)
	return result.ok ? result.value : null
}

async function getDirectoryHandleFromDB(
	id: string,
): Promise<FileSystemDirectoryHandle | null> {
	let cached = directoryHandleCache.get(id)
	if (cached) return cached
	let handles = await getDirectoryHandleMap()
	let handle = handles[id]
	if (handle) directoryHandleCache.set(id, handle)
	return handle ?? null
}

function selectLocalWorkspace(id: string | null): void {
	let state = useLocalFileStore.getState()
	if (
		id !== null &&
		!state.directoryWorkspaces.some(workspace => workspace.id === id)
	)
		return
	state.setSelectedWorkspaceId(id)
	let active = state.files.find(file => file.id === state.activeFileId)
	if (active && (active.workspaceId ?? null) === id) return
	let recent = state.files
		.filter(file => (file.workspaceId ?? null) === id)
		.sort((a, b) => b.lastOpened - a.lastOpened)[0]
	state.setActiveFileId(recent?.id ?? null)
}

async function openLocalDirectory(): Promise<string | null> {
	if (!window.showDirectoryPicker) return null
	let picked = await tryCatch(window.showDirectoryPicker({ mode: "readwrite" }))
	if (!picked.ok) {
		if (picked.error.name === "AbortError") return null
		toast.error("Failed to open folder")
		return null
	}
	let handle = picked.value
	for (let workspace of useLocalFileStore.getState().directoryWorkspaces) {
		let existing = await getDirectoryHandleFromDB(workspace.id)
		if (
			existing &&
			handle.isSameEntry &&
			(await handle.isSameEntry(existing))
		) {
			selectLocalWorkspace(workspace.id)
			await refreshLocalDirectory(workspace.id, true)
			return workspace.id
		}
	}
	let id = crypto.randomUUID()
	let handles = await getDirectoryHandleMap()
	handles[id] = handle
	await set(DIRECTORY_HANDLES_KEY, handles)
	directoryHandleCache.set(id, handle)
	let state = useLocalFileStore.getState()
	state.setDirectoryWorkspaces([
		...state.directoryWorkspaces,
		{ id, name: handle.name, files: [], status: "ready" },
	])
	selectLocalWorkspace(id)
	await refreshLocalDirectory(id, true)
	return id
}

async function removeLocalDirectory(id: string): Promise<void> {
	let handles = await getDirectoryHandleMap()
	delete handles[id]
	await set(DIRECTORY_HANDLES_KEY, handles)
	directoryHandleCache.delete(id)
	let state = useLocalFileStore.getState()
	for (let file of state.files.filter(file => file.workspaceId === id)) {
		await removeHandleFromDB(file.id)
	}
	state.setDirectoryWorkspaces(
		state.directoryWorkspaces.filter(workspace => workspace.id !== id),
	)
	state.setFiles(state.files.filter(file => file.workspaceId !== id))
	if (state.selectedWorkspaceId === id) state.setSelectedWorkspaceId(null)
	if (
		state.files.find(file => file.id === state.activeFileId)?.workspaceId === id
	)
		state.setActiveFileId(null)
}

async function refreshLocalDirectory(
	id: string,
	requestPermission = false,
): Promise<boolean> {
	let handle = await getDirectoryHandleFromDB(id)
	if (
		!handle ||
		!(await hasPermission(
			handle,
			requestPermission ? "readwrite" : "read",
			requestPermission,
		))
	) {
		updateDirectory(id, [], "reconnect", false)
		return false
	}
	let existing = useLocalFileStore
		.getState()
		.directoryWorkspaces.find(workspace => workspace.id === id)
	let previousFiles = new Map(existing?.files.map(file => [file.path, file]))
	let folders: string[] = []
	let scan = await tryCatch(scanDirectory(handle, "", previousFiles, folders))
	if (!scan.ok) {
		updateDirectory(id, [], "error", false)
		return false
	}
	updateDirectory(id, scan.value, "ready", true, folders)
	return true
}

async function renameDirectoryFile(
	workspaceId: string,
	path: string,
	newName: string,
): Promise<void> {
	let parts = path.split("/")
	parts.pop()
	await moveDirectoryEntry(
		workspaceId,
		path,
		[...parts, newName.trim()].join("/"),
		"file",
	)
}

async function createDirectoryFolder(
	workspaceId: string,
	parentPath: string,
	name: string,
): Promise<string> {
	return withWorkspaceMutation(workspaceId, function perform() {
		return createDirectoryFolderNow(workspaceId, parentPath, name)
	})
}

async function createDirectoryFolderNow(
	workspaceId: string,
	parentPath: string,
	name: string,
): Promise<string> {
	validateEntryName(name, "folder")
	let root = await writableDirectoryRoot(workspaceId)
	let parent = await directoryAtPath(root, parentPath)
	await ensureEntryAvailable(parent, name.trim())
	await parent.getDirectoryHandle(name.trim(), { create: true })
	let path = [parentPath, name.trim()].filter(Boolean).join("/")
	if (!(await refreshLocalDirectory(workspaceId))) {
		let state = useLocalFileStore.getState()
		state.setDirectoryWorkspaces(
			state.directoryWorkspaces.map(workspace =>
				workspace.id === workspaceId
					? { ...workspace, folders: [...(workspace.folders ?? []), path] }
					: workspace,
			),
		)
	}
	return path
}

async function createDirectoryFile(
	workspaceId: string,
	parentPath: string,
	name: string,
): Promise<string> {
	return withWorkspaceMutation(workspaceId, function perform() {
		return createDirectoryFileNow(workspaceId, parentPath, name)
	})
}

async function createDirectoryFileNow(
	workspaceId: string,
	parentPath: string,
	name: string,
): Promise<string> {
	validateEntryName(name, "file")
	let root = await writableDirectoryRoot(workspaceId)
	let parent = await directoryAtPath(root, parentPath)
	await ensureEntryAvailable(parent, name.trim())
	let handle = await parent.getFileHandle(name.trim(), { create: true })
	let path = [parentPath, name.trim()].filter(Boolean).join("/")
	if (!(await refreshLocalDirectory(workspaceId))) {
		let state = useLocalFileStore.getState()
		let file = await tryCatch(handle.getFile())
		state.setDirectoryWorkspaces(
			state.directoryWorkspaces.map(workspace =>
				workspace.id === workspaceId
					? {
							...workspace,
							files: [
								...workspace.files,
								{
									id: path,
									path,
									name: name.trim(),
									lastModified: file.ok ? file.value.lastModified : undefined,
									isPresentation: false,
								},
							],
						}
					: workspace,
			),
		)
	}
	return path
}

async function moveDirectoryEntry(
	workspaceId: string,
	oldPath: string,
	newPath: string,
	kind: "file" | "folder",
): Promise<void> {
	return withWorkspaceMutation(workspaceId, function perform() {
		return moveDirectoryEntryNow(workspaceId, oldPath, newPath, kind)
	})
}

async function moveDirectoryEntryNow(
	workspaceId: string,
	oldPath: string,
	newPath: string,
	kind: "file" | "folder",
): Promise<void> {
	let oldParts = oldPath.split("/")
	let newParts = newPath.split("/")
	let oldName = oldParts.pop()
	let newName = newParts.pop()
	if (!oldName || !newName) throw Error("Entry not found")
	validateEntryName(newName, kind)
	if (oldPath === newPath) return
	if (kind === "folder" && newPath.startsWith(`${oldPath}/`))
		throw Error("Cannot move a folder into itself")
	let root = await writableDirectoryRoot(workspaceId)
	let sourceParent = await directoryAtPath(root, oldParts.join("/"))
	let destinationParent = await directoryAtPath(root, newParts.join("/"))
	let affected = useLocalFileStore
		.getState()
		.files.filter(
			file =>
				file.workspaceId === workspaceId &&
				file.path &&
				(file.path === oldPath ||
					(kind === "folder" && file.path.startsWith(`${oldPath}/`))),
		)
	let releaseLock: () => void = () => {}
	let lock = new Promise<void>(resolve => {
		releaseLock = resolve
	})
	for (let file of affected) fileMutationLocks.set(file.id, lock)
	try {
		for (let file of affected) {
			let pendingSave = saveQueues.get(file.id)
			if (pendingSave) await pendingSave
		}
		let caseOnlyRename =
			oldParts.join("/") === newParts.join("/") &&
			oldName.toLocaleLowerCase() === newName.toLocaleLowerCase()
		if (caseOnlyRename) {
			let extension =
				kind === "file"
					? (oldName.match(/\.(md|markdown|txt)$/i)?.[0] ?? ".md")
					: ""
			let temporaryName = `.rename-${crypto.randomUUID()}${extension}`
			await moveFilesystemEntry(
				sourceParent,
				oldName,
				sourceParent,
				temporaryName,
				kind,
			)
			try {
				await moveFilesystemEntry(
					sourceParent,
					temporaryName,
					destinationParent,
					newName,
					kind,
				)
			} catch (error) {
				let rollback = await tryCatch(
					moveFilesystemEntry(
						sourceParent,
						temporaryName,
						sourceParent,
						oldName,
						kind,
					),
				)
				if (!rollback.ok)
					throw Error(
						`Rename incomplete: ${String(error)}; original-name restore failed: ${rollback.error.message}`,
					)
				throw error
			}
		} else {
			await moveFilesystemEntry(
				sourceParent,
				oldName,
				destinationParent,
				newName,
				kind,
			)
		}
		let state = useLocalFileStore.getState()
		state.relocateFiles(workspaceId, oldPath, newPath, kind === "folder")
		for (let file of affected) {
			let path = `${newPath}${file.path?.slice(oldPath.length) ?? ""}`
			let newId = `${workspaceId}:${path}`
			relocatedFileIds.delete(newId)
			relocatedFileIds.set(file.id, newId)
		}
		await refreshLocalDirectory(workspaceId)
		for (let file of affected) await removeHandleFromDB(file.id).catch(() => {})
	} finally {
		for (let file of affected) fileMutationLocks.delete(file.id)
		releaseLock()
	}
	let current = useLocalFileStore.getState()
	for (let file of affected) {
		let relocated = current.getFileById(resolveLocalFileId(file.id))
		if (
			relocated?.hasUnsavedChanges &&
			!(await saveLocalFile(relocated.id, relocated.content))
		)
			throw Error("Moved, but unsaved edits still need to be saved")
	}
}

async function moveFilesystemEntry(
	sourceParent: FileSystemDirectoryHandle,
	oldName: string,
	destinationParent: FileSystemDirectoryHandle,
	newName: string,
	kind: "file" | "folder",
) {
	await ensureEntryAvailable(destinationParent, newName)
	let created = false
	let folderSnapshot: Map<string, string> | null = null
	try {
		if (kind === "file") {
			let source = await sourceParent.getFileHandle(oldName)
			if (await moveNativelyIfSupported(source, destinationParent, newName))
				return
			let destination = await destinationParent.getFileHandle(newName, {
				create: true,
			})
			if ((await destination.getFile()).size > 0)
				throw Error("Destination appeared while moving")
			created = true
			await copyDirectoryFile(source, destination)
		} else {
			let source = await sourceParent.getDirectoryHandle(oldName)
			if (await moveNativelyIfSupported(source, destinationParent, newName))
				return
			folderSnapshot = await snapshotDirectory(source)
			let destination = await destinationParent.getDirectoryHandle(newName, {
				create: true,
			})
			for await (let [existingName] of destination.entries())
				throw Error(`Destination appeared while moving: ${existingName}`)
			created = true
			await copyDirectoryFolder(source, destination)
			if (!(await matchesDirectorySnapshot(source, folderSnapshot)))
				throw Error("Folder changed during move; source was kept")
			if (!(await matchesDirectorySnapshot(destination, folderSnapshot)))
				throw Error("Destination changed during move; source was kept")
		}
		await sourceParent.removeEntry(oldName, { recursive: kind === "folder" })
	} catch (error) {
		if (created) {
			if (kind === "folder" && folderSnapshot) {
				let destination = await tryCatch(
					destinationParent.getDirectoryHandle(newName),
				)
				if (
					!destination.ok ||
					!(await matchesDirectorySnapshot(destination.value, folderSnapshot))
				)
					throw Error(
						`Move incomplete: ${String(error)}; destination copy needs review`,
					)
			}
			let rollback = await tryCatch(
				destinationParent.removeEntry(newName, {
					recursive: kind === "folder",
				}),
			)
			if (!rollback.ok)
				throw Error(
					`Move incomplete: ${String(error)}; destination cleanup failed: ${rollback.error.message}`,
				)
		}
		throw error
	}
}

async function moveNativelyIfSupported(
	source: FileSystemFileHandle | FileSystemDirectoryHandle,
	destinationParent: FileSystemDirectoryHandle,
	newName: string,
): Promise<boolean> {
	if (!source.move) return false
	try {
		await source.move(destinationParent, newName)
		return true
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"name" in error &&
			error.name === "NotSupportedError"
		)
			return false
		throw error
	}
}

async function snapshotDirectory(
	directory: FileSystemDirectoryHandle,
	prefix = "",
): Promise<Map<string, string>> {
	let snapshot = new Map<string, string>()
	for await (let [name, handle] of directory.entries()) {
		let path = `${prefix}${name}`
		if (handle.kind === "directory") {
			snapshot.set(`folder:${path}`, "")
			let child = await directory.getDirectoryHandle(name)
			for (let [childPath, hash] of await snapshotDirectory(child, `${path}/`))
				snapshot.set(childPath, hash)
		} else {
			let file = await (await directory.getFileHandle(name)).getFile()
			let digest = await crypto.subtle.digest(
				"SHA-256",
				await file.arrayBuffer(),
			)
			let hash = Array.from(new Uint8Array(digest), byte =>
				byte.toString(16).padStart(2, "0"),
			).join("")
			snapshot.set(`file:${path}`, hash)
		}
	}
	return snapshot
}

async function matchesDirectorySnapshot(
	directory: FileSystemDirectoryHandle,
	expected: Map<string, string>,
): Promise<boolean> {
	let current = await tryCatch(snapshotDirectory(directory))
	if (!current.ok || current.value.size !== expected.size) return false
	for (let [path, hash] of expected)
		if (current.value.get(path) !== hash) return false
	return true
}

function resolveLocalFileId(id: string): string {
	if (useLocalFileStore.getState().getFileById(id)) return id
	let current = id
	let visited = new Set([id])
	let next = relocatedFileIds.get(current)
	while (next && !visited.has(next)) {
		current = next
		visited.add(current)
		next = relocatedFileIds.get(current)
	}
	return current
}

async function deleteDirectoryEntry(
	workspaceId: string,
	path: string,
	kind: "file" | "folder",
): Promise<void> {
	return withWorkspaceMutation(workspaceId, function perform() {
		return deleteDirectoryEntryNow(workspaceId, path, kind)
	})
}

async function deleteDirectoryEntryNow(
	workspaceId: string,
	path: string,
	kind: "file" | "folder",
): Promise<void> {
	let parts = path.split("/")
	let name = parts.pop()
	if (!name) throw Error("Entry not found")
	let root = await writableDirectoryRoot(workspaceId)
	let parent = await directoryAtPath(root, parts.join("/"))
	let affected = useLocalFileStore
		.getState()
		.files.filter(
			file =>
				file.workspaceId === workspaceId &&
				file.path &&
				(file.path === path ||
					(kind === "folder" && file.path.startsWith(`${path}/`))),
		)
	let releaseLock: () => void = () => {}
	let lock = new Promise<void>(resolve => {
		releaseLock = resolve
	})
	for (let file of affected) fileMutationLocks.set(file.id, lock)
	try {
		for (let file of affected) {
			let pendingSave = saveQueues.get(file.id)
			if (pendingSave) await pendingSave
		}
		await parent.removeEntry(name, { recursive: kind === "folder" })
		useLocalFileStore
			.getState()
			.removeDirectoryFiles(workspaceId, path, kind === "folder")
		await refreshLocalDirectory(workspaceId)
		for (let file of affected) await removeHandleFromDB(file.id).catch(() => {})
	} finally {
		for (let file of affected) fileMutationLocks.delete(file.id)
		releaseLock()
	}
}

async function withWorkspaceMutation<T>(
	workspaceId: string,
	operation: () => Promise<T>,
): Promise<T> {
	let previous = workspaceMutationQueues.get(workspaceId) ?? Promise.resolve()
	let current = previous.then(operation)
	let tail = current.then(
		() => {},
		() => {},
	)
	workspaceMutationQueues.set(workspaceId, tail)
	try {
		return await current
	} finally {
		if (workspaceMutationQueues.get(workspaceId) === tail)
			workspaceMutationQueues.delete(workspaceId)
	}
}

function validateEntryName(name: string, kind: "file" | "folder") {
	let trimmed = name.trim()
	if (
		!trimmed ||
		trimmed === "." ||
		trimmed === ".." ||
		trimmed.includes("/") ||
		trimmed.includes("\\")
	)
		throw Error("Enter a valid name")
	if (kind === "file" && !/\.(md|markdown|txt)$/i.test(trimmed))
		throw Error("Use a .md, .markdown, or .txt filename")
}

async function writableDirectoryRoot(
	workspaceId: string,
): Promise<FileSystemDirectoryHandle> {
	let root = await getDirectoryHandleFromDB(workspaceId)
	if (!root || !(await hasPermission(root, "readwrite", true)))
		throw Error("Folder write access is required")
	return root
}

async function directoryAtPath(
	root: FileSystemDirectoryHandle,
	path: string,
): Promise<FileSystemDirectoryHandle> {
	let directory = root
	for (let part of path.split("/").filter(Boolean))
		directory = await directory.getDirectoryHandle(part)
	return directory
}

async function ensureEntryAvailable(
	directory: FileSystemDirectoryHandle,
	name: string,
) {
	for await (let [existing] of directory.entries()) {
		if (existing.toLocaleLowerCase() === name.toLocaleLowerCase())
			throw Error("An entry with that name already exists")
	}
}

async function copyDirectoryFile(
	source: FileSystemFileHandle,
	destination: FileSystemFileHandle,
) {
	let writable = await destination.createWritable()
	try {
		await writable.write(await (await source.getFile()).arrayBuffer())
		await writable.close()
	} catch (error) {
		await writable.abort().catch(() => {})
		throw error
	}
}

async function copyDirectoryFolder(
	source: FileSystemDirectoryHandle,
	destination: FileSystemDirectoryHandle,
) {
	for await (let [name, handle] of source.entries()) {
		if (handle.kind === "directory") {
			let childSource = await source.getDirectoryHandle(name)
			let childDestination = await destination.getDirectoryHandle(name, {
				create: true,
			})
			await copyDirectoryFolder(childSource, childDestination)
		} else {
			let fileSource = await source.getFileHandle(name)
			let fileDestination = await destination.getFileHandle(name, {
				create: true,
			})
			await copyDirectoryFile(fileSource, fileDestination)
		}
	}
}

function updateDirectory(
	id: string,
	files: LocalDirectoryWorkspace["files"],
	status: LocalDirectoryWorkspace["status"],
	replaceFiles: boolean,
	folders?: string[],
) {
	let state = useLocalFileStore.getState()
	state.setDirectoryWorkspaces(
		state.directoryWorkspaces.map(workspace =>
			workspace.id === id
				? {
						...workspace,
						files: replaceFiles ? files : workspace.files,
						folders: folders ?? workspace.folders,
						status,
					}
				: workspace,
		),
	)
}

async function scanDirectory(
	directory: FileSystemDirectoryHandle,
	prefix: string,
	previousFiles: Map<string, LocalDirectoryWorkspace["files"][number]>,
	folders: string[],
): Promise<LocalDirectoryWorkspace["files"]> {
	let files: LocalDirectoryWorkspace["files"] = []
	for await (let [, handle] of directory.entries()) {
		if (handle.kind === "directory") {
			if ([".git", "node_modules"].includes(handle.name)) continue
			let child = await directory.getDirectoryHandle(handle.name)
			folders.push(`${prefix}${handle.name}`)
			files.push(
				...(await scanDirectory(
					child,
					`${prefix}${handle.name}/`,
					previousFiles,
					folders,
				)),
			)
		} else if (/\.(md|markdown|txt)$/i.test(handle.name)) {
			let path = `${prefix}${handle.name}`
			let fileHandle = await directory.getFileHandle(handle.name)
			let file = await fileHandle.getFile()
			let previous = previousFiles.get(path)
			let isPresentation =
				previous?.lastModified === file.lastModified &&
				previous.isPresentation !== undefined
					? previous.isPresentation
					: !/\.txt$/i.test(handle.name) &&
						getPresentationMode(await file.text())
			files.push({
				id: path,
				name: handle.name,
				path,
				lastModified: file.lastModified,
				isPresentation,
			})
		}
	}
	return files.sort((a, b) => a.path.localeCompare(b.path))
}

async function openDirectoryFile(
	workspaceId: string,
	path: string,
): Promise<LocalFileEntry | null> {
	let workspace = useLocalFileStore
		.getState()
		.directoryWorkspaces.find(item => item.id === workspaceId)
	if (!workspace?.files.some(file => file.path === path)) return null
	let root = await getDirectoryHandleFromDB(workspaceId)
	if (!root || !(await hasPermission(root, "read", true))) {
		updateDirectory(workspaceId, [], "reconnect", false)
		return null
	}
	let handle = await resolveDirectoryFileHandle(workspaceId, path)
	if (!handle) {
		await refreshLocalDirectory(workspaceId)
		return null
	}
	let name = path.split("/").at(-1)
	if (!name) return null
	let id = `${workspaceId}:${path}`
	await saveHandleToDB(id, handle)
	let existing = useLocalFileStore.getState().getFileById(id)
	if (existing) {
		await refreshLocalFile(id)
		useLocalFileStore.getState().markFileActive(id)
		selectLocalWorkspace(workspaceId)
		return useLocalFileStore.getState().getFileById(id)
	}
	let file = await readFileFromHandle(handle)
	if (!file) return null
	let entry: LocalFileEntry = {
		id,
		filename: name,
		path,
		workspaceId,
		lastOpened: Date.now(),
		lastModified: file.lastModified,
		content: file.content,
		lastSavedContent: file.content,
		hasUnsavedChanges: false,
		isActive: true,
	}
	useLocalFileStore.getState().addFile(entry)
	selectLocalWorkspace(workspaceId)
	return entry
}

async function readDirectoryFile(
	workspaceId: string,
	path: string,
): Promise<{ content: string; filename: string } | null> {
	let loaded = useLocalFileStore
		.getState()
		.getFileById(`${workspaceId}:${path}`)
	if (loaded) return { content: loaded.content, filename: loaded.filename }
	let handle = await resolveDirectoryFileHandle(workspaceId, path)
	if (!handle) return null
	return readFileFromHandle(handle)
}

async function getDirectoryHandleMap(): Promise<
	Record<string, FileSystemDirectoryHandle>
> {
	return (await get(DIRECTORY_HANDLES_KEY)) ?? {}
}

async function hasPermission(
	handle: FileSystemDirectoryHandle,
	mode: "read" | "readwrite",
	requestPermission = false,
) {
	let permission = await tryCatch(handle.queryPermission({ mode }))
	if (!permission.ok) return false
	if (permission.value === "granted") return true
	if (!requestPermission) return false
	let request = await tryCatch(handle.requestPermission({ mode }))
	return request.ok && request.value === "granted"
}

async function closeLocalFile(id: string): Promise<void> {
	await removeHandleFromDB(id)
	useLocalFileStore.getState().removeFile(id)
}

async function switchToLocalFile(
	id: string,
	handle: FileSystemFileHandle,
): Promise<void> {
	let fileResult = await readFileFromHandle(handle)
	if (!fileResult) return
	selectLocalWorkspace(null)

	let existingFile = useLocalFileStore.getState().getFileById(id)
	if (existingFile) {
		useLocalFileStore.getState().markFileActive(id)
		await saveHandleToDB(id, handle)
	} else {
		useLocalFileStore.getState().addFile({
			id,
			filename: fileResult.filename,
			lastOpened: Date.now(),
			lastModified: fileResult.lastModified,
			content: fileResult.content,
			lastSavedContent: fileResult.content,
			hasUnsavedChanges: false,
			isActive: true,
		})
		await saveHandleToDB(id, handle)
	}
}

function isFileSystemAccessSupported(): boolean {
	return "showOpenFilePicker" in window
}

async function openLocalFile(): Promise<{
	handle: FileSystemFileHandle
	content: string
	filename: string
	lastModified: number
	id: string
} | null> {
	if (!isFileSystemAccessSupported()) {
		return null
	}

	let result = await tryCatch(
		window.showOpenFilePicker!({
			multiple: false,
			types: [
				{
					description: "Markdown files",
					accept: {
						"text/markdown": [".md", ".markdown"],
						"text/plain": [".txt"],
					},
				},
			],
		}),
	)

	if (!result.ok) {
		if (result.error.name === "AbortError") {
			return null
		}
		toast.error("Failed to open file. Please try again.")
		throw result.error
	}

	let [handle] = result.value

	let fileResult = await tryCatch(handle.getFile())
	if (!fileResult.ok) {
		toast.error("Failed to read file. The file may have been moved or deleted.")
		throw fileResult.error
	}

	let contentResult = await tryCatch(fileResult.value.text())
	if (!contentResult.ok) {
		toast.error("Failed to read file content. The file may be corrupted.")
		throw contentResult.error
	}

	let id = crypto.randomUUID()
	await saveHandleToDB(id, handle)

	return {
		handle,
		content: contentResult.value,
		filename: fileResult.value.name,
		lastModified: fileResult.value.lastModified,
		id,
	}
}

async function readFileFromHandle(
	handle: FileSystemFileHandle,
): Promise<{ content: string; filename: string; lastModified: number } | null> {
	if (handle.queryPermission) {
		let queryResult = await tryCatch(handle.queryPermission({ mode: "read" }))
		if (!queryResult.ok) {
			toast.error("Cannot access file. Permission check failed.")
			return null
		}
		let permission = queryResult.value
		if (permission !== "granted" && handle.requestPermission) {
			let requestResult = await tryCatch(
				handle.requestPermission({ mode: "read" }),
			)
			if (!requestResult.ok) {
				toast.error("Cannot access file. Permission request failed.")
				return null
			}
			permission = requestResult.value
			if (permission !== "granted") {
				toast.error("File access denied. Please re-open the file.")
				return null
			}
		}
		if (permission !== "granted" && !handle.requestPermission) {
			toast.error("File access denied. Please re-open the file.")
			return null
		}
	}

	let fileResult = await tryCatch(handle.getFile())
	if (!fileResult.ok) {
		toast.error("Failed to read file. The file may have been moved or deleted.")
		return null
	}

	let contentResult = await tryCatch(fileResult.value.text())
	if (!contentResult.ok) {
		toast.error("Failed to read file content. The file may be corrupted.")
		return null
	}

	return {
		content: contentResult.value,
		filename: fileResult.value.name,
		lastModified: fileResult.value.lastModified,
	}
}

let saveQueues = new Map<string, Promise<boolean>>()

async function refreshLocalFile(id: string): Promise<boolean> {
	let entry = useLocalFileStore.getState().getFileById(id)
	let handle = await getHandleFromDB(id)
	if (!entry || !handle) return false
	let disk = await readFileFromHandle(handle)
	if (!disk) return false
	useLocalFileStore.getState().setFileLastModified(id, disk.lastModified)
	let current = useLocalFileStore.getState().getFileById(id)
	if (!current) return false
	let merged = mergeFileContent(
		current.lastSavedContent,
		current.content,
		disk.content,
	)
	useLocalFileStore
		.getState()
		.reconcileFile(
			id,
			merged.conflict ? current.lastSavedContent : disk.content,
			merged.content,
			merged.conflict,
		)
	return !merged.conflict
}

async function resolveLocalFileConflict(
	id: string,
	choice: "disk" | "local",
): Promise<boolean> {
	let handle = await getHandleFromDB(id)
	if (!handle || !useLocalFileStore.getState().getFileById(id)) return false
	let disk = await readFileFromHandle(handle)
	if (!disk) return false
	let current = useLocalFileStore.getState().getFileById(id)
	if (!current) return false
	if (choice === "disk") {
		useLocalFileStore.getState().setFileRecovery(id, {
			content: current.content,
			source: "local",
			savedAt: Date.now(),
		})
		useLocalFileStore
			.getState()
			.reconcileFile(id, disk.content, disk.content, false)
		return true
	}
	useLocalFileStore.getState().setFileRecovery(id, {
		content: disk.content,
		source: "disk",
		savedAt: Date.now(),
	})
	useLocalFileStore
		.getState()
		.reconcileFile(id, disk.content, current.content, false)
	return saveLocalFile(id, current.content)
}

async function restoreLocalFileRecovery(id: string): Promise<boolean> {
	let current = useLocalFileStore.getState().getFileById(id)
	if (!current?.recovery) return false
	let handle = await getHandleFromDB(id)
	if (!handle) return false
	let disk = await readFileFromHandle(handle)
	if (!disk) return false
	useLocalFileStore
		.getState()
		.reconcileFile(id, disk.content, current.recovery.content, false)
	useLocalFileStore.getState().setFileRecovery(id, undefined)
	return true
}

async function saveLocalFile(id: string, content: string): Promise<boolean> {
	let mutation = fileMutationLocks.get(id)
	if (mutation) await mutation
	let relocated = resolveLocalFileId(id)
	if (relocated !== id) {
		id = relocated
		let current = useLocalFileStore.getState().getFileById(id)
		if (!current) return false
		content = current.content
	}
	if (!useLocalFileStore.getState().getFileById(id)) return false
	let previous = saveQueues.get(id) ?? Promise.resolve(true)
	let current = previous
		.catch(() => false)
		.then(() => saveLocalFileNow(id, content))
	saveQueues.set(id, current)
	try {
		return await current
	} finally {
		if (saveQueues.get(id) === current) saveQueues.delete(id)
	}
}

async function saveLocalFileNow(id: string, content: string): Promise<boolean> {
	let requestedContent = content
	let handle = await getHandleFromDB(id)
	if (!handle) {
		toast.error("File handle not found")
		return false
	}
	let entry = useLocalFileStore.getState().getFileById(id)
	if (entry?.conflict) {
		toast.error("Resolve the file conflict before saving.")
		return false
	}
	let disk = await readFileFromHandle(handle)
	if (!disk) return false
	let base = entry?.lastSavedContent ?? disk.content
	let merged = mergeFileContent(base, content, disk.content)
	if (merged.conflict) {
		if (entry) markFileConflict(id, base, content)
		toast.error(
			"File changed elsewhere. Resolve overlapping edits before saving.",
		)
		return false
	}
	content = merged.content

	if (handle.queryPermission) {
		let queryResult = await tryCatch(
			handle.queryPermission({ mode: "readwrite" }),
		)
		if (!queryResult.ok) {
			toast.error("Cannot check file permissions. Please re-open the file.")
			return false
		}
		let permission = queryResult.value
		if (permission !== "granted" && handle.requestPermission) {
			let requestResult = await tryCatch(
				handle.requestPermission({ mode: "readwrite" }),
			)
			if (!requestResult.ok) {
				toast.error("Cannot request file permissions. Please re-open the file.")
				return false
			}
			if (requestResult.value !== "granted") {
				toast.error("File permissions denied. Please grant access to save.")
				return false
			}
			permission = requestResult.value
		}
		if (permission !== "granted" && !handle.requestPermission) {
			toast.error("File permissions denied. Please grant access to save.")
			return false
		}
	}

	let latestDisk = await readFileFromHandle(handle)
	if (!latestDisk) return false
	if (latestDisk.content !== disk.content) {
		let latestMerge = mergeFileContent(base, content, latestDisk.content)
		if (latestMerge.conflict) {
			if (entry) markFileConflict(id, base, content)
			toast.error(
				"File changed elsewhere. Resolve overlapping edits before saving.",
			)
			return false
		}
		content = latestMerge.content
	}

	let writableResult = await tryCatch(handle.createWritable())
	if (!writableResult.ok) {
		toast.error(
			"Cannot write to file. The file may be in use by another application.",
		)
		return false
	}

	let writeResult = await tryCatch(writableResult.value.write(content))
	if (!writeResult.ok) {
		toast.error("Failed to save changes. Please try again.")
		await writableResult.value.abort().catch(() => {})
		return false
	}

	let closeResult = await tryCatch(writableResult.value.close())
	if (!closeResult.ok) {
		toast.error("Failed to finalize save. Please try again.")
		return false
	}

	let latest = useLocalFileStore.getState().getFileById(id)
	if (latest) {
		let afterSave = mergeFileContent(requestedContent, latest.content, content)
		useLocalFileStore
			.getState()
			.reconcileFile(id, content, afterSave.content, afterSave.conflict)
		let savedFile = await tryCatch(handle.getFile())
		if (savedFile.ok)
			useLocalFileStore
				.getState()
				.setFileLastModified(id, savedFile.value.lastModified)
		if (latest.workspaceId && latest.path) {
			if (savedFile.ok) {
				let state = useLocalFileStore.getState()
				state.setDirectoryWorkspaces(
					state.directoryWorkspaces.map(workspace =>
						workspace.id === latest.workspaceId
							? {
									...workspace,
									files: workspace.files.map(file =>
										file.path === latest.path
											? {
													...file,
													lastModified: savedFile.value.lastModified,
													isPresentation:
														!/\.txt$/i.test(file.name) &&
														getPresentationMode(content),
												}
											: file,
									),
								}
							: workspace,
					),
				)
			}
		}
	}
	return true
}

function markFileConflict(
	id: string,
	base: string,
	attemptedContent: string,
): void {
	let current = useLocalFileStore.getState().getFileById(id)
	if (!current) return
	let draft =
		current.content === current.lastSavedContent
			? attemptedContent
			: current.content
	useLocalFileStore.getState().reconcileFile(id, base, draft, true)
}

async function saveLocalFileAs(
	content: string,
	suggestedName?: string,
): Promise<{
	handle: FileSystemFileHandle
	id: string
	lastModified: number
} | null> {
	if (!isFileSystemAccessSupported() || !window.showSaveFilePicker) {
		downloadFile(content, suggestedName ?? "document.md")
		return null
	}

	let result = await tryCatch(
		window.showSaveFilePicker!({
			suggestedName: suggestedName ?? "document.md",
			types: [
				{
					description: "Markdown file",
					accept: { "text/markdown": [".md"] },
				},
			],
		}),
	)

	if (!result.ok) {
		if (result.error.name === "AbortError") {
			return null
		}
		toast.error("Failed to save file. Please try again.")
		throw result.error
	}

	let handle = result.value

	let writableResult = await tryCatch(handle.createWritable())
	if (!writableResult.ok) {
		toast.error(
			"Cannot write to file. The file may be in use by another application.",
		)
		throw writableResult.error
	}

	let writeResult = await tryCatch(writableResult.value.write(content))
	if (!writeResult.ok) {
		toast.error("Failed to save changes. Please try again.")
		await writableResult.value.abort().catch(() => {})
		throw writeResult.error
	}

	let closeResult = await tryCatch(writableResult.value.close())
	if (!closeResult.ok) {
		toast.error("Failed to finalize save. Please try again.")
		throw closeResult.error
	}

	let id = crypto.randomUUID()
	await saveHandleToDB(id, handle)
	let savedFile = await tryCatch(handle.getFile())

	return {
		handle,
		id,
		lastModified: savedFile.ok ? savedFile.value.lastModified : Date.now(),
	}
}

async function consumeLaunchQueue(): Promise<{
	handle: FileSystemFileHandle
	content: string
	filename: string
	lastModified: number
	id: string
} | null> {
	return new Promise(resolve => {
		if (!window.launchQueue) {
			resolve(null)
			return
		}

		let consumed = false

		window.launchQueue.setConsumer(async launchParams => {
			if (consumed) return
			consumed = true

			if (launchParams.files.length === 0) {
				resolve(null)
				return
			}

			let handle = launchParams.files[0]

			let fileResult = await tryCatch(handle.getFile())
			if (!fileResult.ok) {
				toast.error(
					"Failed to read launched file. Please try opening it manually.",
				)
				resolve(null)
				return
			}

			let contentResult = await tryCatch(fileResult.value.text())
			if (!contentResult.ok) {
				toast.error(
					"Failed to read launched file content. The file may be corrupted.",
				)
				resolve(null)
				return
			}

			let id = crypto.randomUUID()
			await saveHandleToDB(id, handle)

			resolve({
				handle,
				content: contentResult.value,
				filename: fileResult.value.name,
				lastModified: fileResult.value.lastModified,
				id,
			})
		})

		setTimeout(() => {
			if (!consumed) {
				consumed = true
				resolve(null)
			}
		}, 100)
	})
}

type StorageValue<T> = {
	state: T
	version: number
}

function createIdbStorage<T>(
	schema: z.ZodType<T>,
	initialState: T,
	version: number = 1,
): PersistStorage<T> {
	let hasIdb = typeof indexedDB !== "undefined"

	return {
		getItem: async function (name): Promise<StorageValue<T> | null> {
			if (!hasIdb) return null
			try {
				let item = await get(name)
				if (!item) return null

				let check = z
					.object({ state: schema, version: z.number() })
					.safeParse(item)

				if (!check.success) {
					console.warn("Invalid store data, using initial state", check.error)
					return { state: initialState, version }
				}

				return {
					state: check.data.state,
					version: check.data.version,
				}
			} catch (error) {
				console.error("Failed to get store from idb", error)
				return { state: initialState, version }
			}
		},
		setItem: async function (name, value) {
			if (!hasIdb) return
			try {
				await set(name, value)
			} catch (error) {
				console.error("Failed to persist store to idb", error)
			}
		},
		removeItem: async function (name) {
			if (!hasIdb) return
			try {
				await del(name)
			} catch (error) {
				console.error("Failed to remove store from idb", error)
			}
		},
	}
}

async function getHandleMap(): Promise<Record<string, FileSystemFileHandle>> {
	let result = await get(HANDLES_KEY)
	return result || {}
}

async function saveHandleToDB(
	id: string,
	handle: FileSystemFileHandle,
): Promise<void> {
	let existing = await getHandleMap()
	existing[id] = handle
	await set(HANDLES_KEY, existing)
	handleCache.set(id, handle)
}

async function removeHandleFromDB(id: string): Promise<void> {
	handleCache.delete(id)
	let existing = await getHandleMap()
	delete existing[id]
	await set(HANDLES_KEY, existing)
}

function downloadFile(content: string, filename: string): void {
	let blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
	let url = URL.createObjectURL(blob)
	let a = document.createElement("a")
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}
