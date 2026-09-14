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
		queryPermission?(options: {
			mode: "read" | "readwrite"
		}): Promise<"granted" | "denied" | "prompt">
		requestPermission?(options: {
			mode: "read" | "readwrite"
		}): Promise<"granted" | "denied" | "prompt">
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

			reset: () =>
				set({
					files: [],
					directoryWorkspaces: [],
					selectedWorkspaceId: null,
					activeFileId: null,
					saveStatus: "idle",
					errorMessage: null,
				}),

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
	let scan = await tryCatch(scanDirectory(handle, "", previousFiles))
	if (!scan.ok) {
		updateDirectory(id, [], "error", false)
		return false
	}
	updateDirectory(id, scan.value, "ready", true)
	return true
}

function updateDirectory(
	id: string,
	files: LocalDirectoryWorkspace["files"],
	status: LocalDirectoryWorkspace["status"],
	replaceFiles: boolean,
) {
	let state = useLocalFileStore.getState()
	state.setDirectoryWorkspaces(
		state.directoryWorkspaces.map(workspace =>
			workspace.id === id
				? {
						...workspace,
						files: replaceFiles ? files : workspace.files,
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
): Promise<LocalDirectoryWorkspace["files"]> {
	let files: LocalDirectoryWorkspace["files"] = []
	for await (let [, handle] of directory.entries()) {
		if (handle.kind === "directory") {
			if ([".git", "node_modules"].includes(handle.name)) continue
			let child = await directory.getDirectoryHandle(handle.name)
			files.push(
				...(await scanDirectory(
					child,
					`${prefix}${handle.name}/`,
					previousFiles,
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
