import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { webCryptoLayer } from "../platform/web-crypto"
import { IdentifierSchema } from "../shared/model"
import { BrowserAccount } from "./browser-account"
import { BrowserStorage } from "./storage"

declare global {
	interface FileSystemHandle {
		queryPermission?(descriptor?: {
			mode?: "read" | "readwrite"
		}): Promise<PermissionState>
		requestPermission?(descriptor?: {
			mode?: "read" | "readwrite"
		}): Promise<PermissionState>
		move?(parent: FileSystemDirectoryHandle, name: string): Promise<void>
	}
	interface Window {
		showDirectoryPicker?(options?: {
			id?: string
			mode?: "read" | "readwrite"
		}): Promise<FileSystemDirectoryHandle>
		showOpenFilePicker?(options?: {
			multiple?: boolean
			types?: { description: string; accept: Record<string, string[]> }[]
		}): Promise<FileSystemFileHandle[]>
		launchQueue?: {
			setConsumer(
				consumer: (parameters: {
					files: ReadonlyArray<FileSystemHandle>
				}) => void,
			): void
		}
		showSaveFilePicker?(options?: {
			suggestedName?: string
			types?: { description: string; accept: Record<string, string[]> }[]
		}): Promise<FileSystemFileHandle>
	}
}

export class LocalFileUnavailable extends Schema.TaggedError<LocalFileUnavailable>()(
	"LocalFileUnavailable",
	{ message: Schema.String, reconnect: Schema.Boolean },
) {}

let LocalFileSchema = Schema.Struct({
	document: IdentifierSchema,
	path: Schema.String,
	lastModified: Schema.Number,
})
let LocalDirectoryRecordSchema = Schema.Struct({
	id: IdentifierSchema,
	name: Schema.String,
	files: Schema.Array(LocalFileSchema),
	folders: Schema.Array(Schema.String),
})
let SavedDirectoriesSchema = Schema.Array(LocalDirectoryRecordSchema)
export type LocalFile = typeof LocalFileSchema.Type
export interface LocalDirectory extends Omit<
	typeof LocalDirectoryRecordSchema.Type,
	"files"
> {
	readonly files: ReadonlyArray<LocalFile>
	readonly status: "ready" | "reconnect" | "scanning" | "error"
	readonly message?: string
}
let documentPattern = /\.(md|markdown|txt)$/i
let maximumFiles = 5000

// A folder chosen with the File System Access API becomes a workspace whose
// documents are its Markdown files. Each file keeps a stable document
// identity, so renaming it keeps its editing session, undo and drafts.
export class LocalDirectories extends Context.Service<
	LocalDirectories,
	Effect.Success<ReturnType<typeof makeLocalDirectories>>
>()("alkalye/LocalDirectories") {
	static layer = Layer.effect(LocalDirectories, makeLocalDirectories()).pipe(
		Layer.provide(webCryptoLayer),
	)
}

export function isLocalWorkspace(workspace: string) {
	return workspace.startsWith("local:")
}
// Files opened one at a time share this workspace; each keeps its own handle
// because the browser grants no access to the folder around it.
export let openedFiles = "local:files"

function makeLocalDirectories() {
	return Effect.gen(function* () {
		let storage = yield* BrowserStorage
		let account = yield* BrowserAccount
		let random = yield* Crypto.Crypto
		let key = "local-directories:" + account.subject
		let saved = Option.getOrElse(
			Schema.decodeUnknownOption(SavedDirectoriesSchema)(
				yield* storage.get(key),
			),
			() => [],
		)
		let handles = new Map<string, FileSystemDirectoryHandle>()
		let files = new Map<string, FileSystemFileHandle>()
		for (let directory of saved) {
			let handle = yield* storage.get(handleKey(directory.id))
			if (handle instanceof FileSystemDirectoryHandle)
				handles.set(directory.id, handle)
			if (directory.id === openedFiles)
				for (let file of directory.files) {
					let handle = yield* storage.get(fileKey(file.document))
					if (handle instanceof FileSystemFileHandle)
						files.set(file.document, handle)
				}
		}
		let state = yield* SubscriptionRef.make<ReadonlyArray<LocalDirectory>>(
			saved.map(directory => ({
				...directory,
				status:
					handles.has(directory.id) || directory.id === openedFiles
						? "scanning"
						: "error",
			})),
		)
		let mutations = yield* Semaphore.make(1)
		let persist = Effect.suspend(() =>
			storage.set(
				key,
				SubscriptionRef.getUnsafe(state).map(directory => ({
					id: directory.id,
					name: directory.name,
					files: directory.files,
					folders: directory.folders,
				})),
			),
		)
		// Startup lists the last scan immediately and refreshes in the background.
		yield* Effect.forEach(saved, directory => refresh(directory.id, false), {
			concurrency: 4,
			discard: true,
		}).pipe(Effect.forkScoped({ startImmediately: true }))
		return Object.freeze({
			current: () => SubscriptionRef.getUnsafe(state),
			changes: SubscriptionRef.changes(state),
			supported: () => typeof window.showDirectoryPicker === "function",
			open,
			openFile,
			close,
			reconnect: (id: string) => refresh(id, true),
			refresh: (id: string) => refresh(id, false),
			forget,
			locate,
			read,
			write,
			create,
			createFolder,
			move,
			remove,
			writeAsset,
			readAsset,
		})

		function open() {
			return Effect.gen(function* () {
				let picker = window.showDirectoryPicker
				if (!picker)
					return yield* unavailable(
						"This browser cannot open folders; try a Chromium-based browser",
					)
				let handle = yield* Effect.tryPromise({
					try: () => picker.call(window, { id: "alkalye", mode: "readwrite" }),
					catch: error => error,
				}).pipe(
					Effect.catchIf(
						error =>
							error instanceof DOMException && error.name === "AbortError",
						() => Effect.interrupt,
					),
				)
				for (let [id, existing] of handles)
					if (yield* Effect.promise(() => existing.isSameEntry(handle))) {
						yield* refresh(id, true)
						return id
					}
				let id = "local:" + (yield* random.randomUUIDv4)
				handles.set(id, handle)
				yield* storage.set(handleKey(id), handle)
				let added: LocalDirectory = {
					id,
					name: handle.name,
					files: [],
					folders: [],
					status: "scanning",
				}
				yield* SubscriptionRef.update(state, directories => [
					...directories,
					added,
				])
				yield* refresh(id, true)
				return id
			})
		}
		function openFile(given?: FileSystemFileHandle) {
			return Effect.gen(function* () {
				let picker = window.showOpenFilePicker
				let handle = given
				if (!handle) {
					if (!picker)
						return yield* unavailable(
							"This browser cannot open files; try a Chromium-based browser",
						)
					let picked = yield* Effect.tryPromise({
						try: () =>
							picker.call(window, {
								types: [
									{
										description: "Markdown",
										accept: {
											"text/markdown": [".md", ".markdown"],
											"text/plain": [".txt"],
										},
									},
								],
							}),
						catch: error => error,
					}).pipe(
						Effect.catchIf(
							error =>
								error instanceof DOMException && error.name === "AbortError",
							() => Effect.interrupt,
						),
					)
					handle = picked[0]
				}
				if (!handle) return yield* Effect.interrupt
				let chosen = handle
				return yield* mutations.withPermit(
					Effect.gen(function* () {
						for (let [document, existing] of files)
							if (yield* Effect.promise(() => existing.isSameEntry(chosen)))
								return document
						let document = "local-" + (yield* random.randomUUIDv4)
						let file = yield* Effect.promise(() => chosen.getFile())
						files.set(document, chosen)
						yield* storage.set(fileKey(document), chosen)
						let entry = {
							document,
							path: chosen.name,
							lastModified: file.lastModified,
						}
						if (!find(openedFiles)) {
							let added: LocalDirectory = {
								id: openedFiles,
								name: "Opened files",
								files: [],
								folders: [],
								status: "ready",
							}
							yield* SubscriptionRef.update(state, directories => [
								...directories,
								added,
							])
						}
						yield* change(openedFiles, current => ({
							files: [...current.files, entry],
							status: "ready",
						}))
						return document
					}),
				)
			})
		}
		// Closing forgets an opened file; the file itself stays on disk.
		function close(document: string) {
			return mutations.withPermit(
				Effect.gen(function* () {
					files.delete(document)
					yield* storage.delete(fileKey(document))
					yield* change(openedFiles, current => ({
						files: current.files.filter(file => file.document !== document),
					}))
				}),
			)
		}
		function forget(id: string) {
			return mutations.withPermit(
				Effect.gen(function* () {
					handles.delete(id)
					yield* SubscriptionRef.update(state, directories =>
						directories.filter(directory => directory.id !== id),
					)
					yield* storage.delete(handleKey(id))
					yield* persist
				}),
			)
		}
		function refresh(id: string, prompt: boolean) {
			return mutations.withPermit(
				Effect.gen(function* () {
					if (id === openedFiles) return yield* refreshFiles(prompt)
					let handle = handles.get(id)
					if (!handle)
						return yield* update(id, {
							status: "error",
							message: "Open this folder again",
						})
					if (!(yield* permitted(handle, prompt)))
						return yield* update(id, {
							status: "reconnect",
							message: "Allow access to this folder again",
						})
					let directory = find(id)
					let previous = new Map(
						(directory?.files ?? []).map(file => [file.path, file.document]),
					)
					let scanned = yield* Effect.tryPromise({
						try: () => scan(handle),
						catch: error => error,
					}).pipe(
						Effect.catch(error =>
							update(id, {
								status: "error",
								message:
									error instanceof Error
										? error.message
										: "Could not read this folder",
							}).pipe(Effect.as(undefined)),
						),
					)
					if (!scanned) return
					let files: LocalFile[] = []
					for (let file of scanned.files)
						files.push({
							document:
								previous.get(file.path) ??
								"local-" + (yield* random.randomUUIDv4),
							path: file.path,
							lastModified: file.lastModified,
						})
					yield* update(id, {
						name: handle.name,
						files,
						folders: scanned.folders,
						status: "ready",
						message: undefined,
					})
				}),
			)
		}
		function refreshFiles(prompt: boolean) {
			return Effect.gen(function* () {
				let directory = find(openedFiles)
				if (!directory) return
				let allowed = true
				let entries: LocalFile[] = []
				for (let entry of directory.files) {
					let handle = files.get(entry.document)
					if (!handle || !(yield* permitted(handle, prompt, prompt))) {
						allowed = false
						entries.push(entry)
						continue
					}
					let modified = yield* Effect.tryPromise(() => handle.getFile()).pipe(
						Effect.map(file => file.lastModified),
						Effect.orElseSucceed(() => entry.lastModified),
					)
					entries.push({ ...entry, lastModified: modified })
				}
				yield* update(openedFiles, {
					files: entries,
					status: allowed ? "ready" : "reconnect",
					message: allowed
						? undefined
						: "Allow access to your opened files again",
				})
			})
		}
		function locate(document: string) {
			for (let directory of SubscriptionRef.getUnsafe(state)) {
				let file = directory.files.find(file => file.document === document)
				if (file) return { directory, file }
			}
			return undefined
		}
		function read(document: string) {
			return Effect.gen(function* () {
				let { handle } = yield* fileHandle(document, false)
				let file = yield* Effect.promise(() => handle.getFile())
				return {
					content: yield* Effect.promise(() => file.text()),
					lastModified: file.lastModified,
				}
			}).pipe(Effect.catchDefect(error => failure(error)))
		}
		function write(document: string, content: string) {
			return Effect.gen(function* () {
				let { handle } = yield* fileHandle(document, true)
				let modified = yield* Effect.tryPromise({
					try: async () => {
						let writable = await handle.createWritable()
						try {
							await writable.write(content)
							await writable.close()
						} catch (error) {
							await writable.abort().catch(() => undefined)
							throw error
						}
						return (await handle.getFile()).lastModified
					},
					catch: error => error,
				}).pipe(Effect.catch(error => failure(error)))
				yield* touch(document, modified)
				return modified
			})
		}
		function create(
			directory: string,
			folder: string,
			name: string,
			content: string,
		) {
			return mutations.withPermit(
				Effect.gen(function* () {
					let filename = yield* validName(name)
					if (!documentPattern.test(filename)) filename += ".md"
					let root = yield* writableRoot(directory)
					let parent = yield* Effect.promise(() =>
						folderHandle(root, folder, true),
					)
					filename = yield* Effect.promise(() =>
						availableName(parent, filename),
					)
					let handle = yield* Effect.promise(() =>
						parent.getFileHandle(filename, { create: true }),
					)
					let modified = yield* Effect.promise(async () => {
						let writable = await handle.createWritable()
						await writable.write(content)
						await writable.close()
						return (await handle.getFile()).lastModified
					})
					let document = "local-" + (yield* random.randomUUIDv4)
					let path = join(folder, filename)
					yield* change(directory, current => ({
						files: [
							...current.files,
							{ document, path, lastModified: modified },
						],
						folders: withFolders(current.folders, folder),
					}))
					return document
				}).pipe(Effect.catchDefect(error => failure(error))),
			)
		}
		function createFolder(directory: string, path: string) {
			return mutations.withPermit(
				Effect.gen(function* () {
					for (let part of path.split("/")) yield* validName(part)
					let root = yield* writableRoot(directory)
					yield* Effect.promise(() => folderHandle(root, path, true))
					yield* change(directory, current => ({
						folders: withFolders(current.folders, path),
					}))
				}).pipe(Effect.catchDefect(error => failure(error))),
			)
		}
		// Moving keeps the document identity; a rename is a move within a folder.
		function move(document: string, path: string) {
			return mutations.withPermit(
				Effect.gen(function* () {
					let parts = path.split("/").filter(Boolean)
					for (let part of parts) yield* validName(part)
					let filename = parts.pop() ?? ""
					if (!documentPattern.test(filename))
						return yield* unavailable("Use a .md, .markdown or .txt name")
					let target = parts.join("/")
					let { directory, file, handle, root } = yield* fileHandle(
						document,
						true,
					)
					if (!root) return yield* unavailable(singleFile)
					if (file.path === join(target, filename)) return
					let destination = yield* Effect.promise(() =>
						folderHandle(root, target, true),
					)
					if (yield* Effect.promise(() => exists(destination, filename)))
						return yield* unavailable(filename + " already exists there")
					let source = yield* Effect.promise(() =>
						folderHandle(root, parentPath(file.path), false),
					)
					yield* Effect.promise(async () => {
						if (handle.move) return handle.move(destination, filename)
						let copy = await destination.getFileHandle(filename, {
							create: true,
						})
						let writable = await copy.createWritable()
						await writable.write(await handle.getFile())
						await writable.close()
						await source.removeEntry(file.path.split("/").at(-1) ?? "")
					})
					yield* change(directory.id, current => ({
						files: current.files.map(entry =>
							entry.document === document
								? { ...entry, path: join(target, filename) }
								: entry,
						),
						folders: withFolders(current.folders, target),
					}))
				}).pipe(Effect.catchDefect(error => failure(error))),
			)
		}
		function remove(document: string) {
			return mutations.withPermit(
				Effect.gen(function* () {
					let { directory, file, root } = yield* fileHandle(document, true)
					if (!root) return yield* unavailable(singleFile)
					let parent = yield* Effect.promise(() =>
						folderHandle(root, parentPath(file.path), false),
					)
					yield* Effect.promise(() =>
						parent.removeEntry(file.path.split("/").at(-1) ?? ""),
					)
					yield* change(directory.id, current => ({
						files: current.files.filter(entry => entry.document !== document),
					}))
				}).pipe(Effect.catchDefect(error => failure(error))),
			)
		}
		// Attachments live beside the document in `assets/`, as in the original
		// application, so the folder stays readable by other Markdown tools.
		function writeAsset(document: string, file: File) {
			return Effect.gen(function* () {
				let { file: entry, root } = yield* fileHandle(document, true)
				if (!root) return yield* unavailable(singleFile)
				let assets = yield* Effect.promise(() =>
					folderHandle(root, join(parentPath(entry.path), "assets"), true),
				)
				let name = yield* Effect.promise(() =>
					availableName(assets, assetName(file.name)),
				)
				yield* Effect.promise(async () => {
					let handle = await assets.getFileHandle(name, { create: true })
					let writable = await handle.createWritable()
					await writable.write(file)
					await writable.close()
				})
				return "assets/" + name
			}).pipe(Effect.catchDefect(error => failure(error)))
		}
		function readAsset(document: string, source: string) {
			return Effect.gen(function* () {
				let located = locate(document)
				let root = located && handles.get(located.directory.id)
				if (!located || !root) return undefined
				let path = relativePath(parentPath(located.file.path), source)
				if (!path) return undefined
				let directory = root
				return yield* Effect.tryPromise(async () => {
					let parent = await folderHandle(directory, parentPath(path), false)
					let handle = await parent.getFileHandle(path.split("/").at(-1) ?? "")
					return await handle.getFile()
				}).pipe(Effect.option, Effect.map(Option.getOrUndefined))
			})
		}

		function fileHandle(document: string, writing: boolean) {
			return Effect.gen(function* () {
				let located = locate(document)
				if (!located)
					return yield* unavailable("This file is no longer in its folder")
				if (located.directory.id === openedFiles) {
					let single = files.get(document)
					if (!single || !(yield* permitted(single, false, writing)))
						return yield* new LocalFileUnavailable({
							message: "Allow access to " + located.file.path + " again",
							reconnect: true,
						})
					return { ...located, handle: single, root: undefined }
				}
				let root = handles.get(located.directory.id)
				if (!root || !(yield* permitted(root, false, writing)))
					return yield* new LocalFileUnavailable({
						message: "Allow access to " + located.directory.name + " again",
						reconnect: true,
					})
				let directory = root
				let handle = yield* Effect.tryPromise({
					try: async () => {
						let parent = await folderHandle(
							directory,
							parentPath(located.file.path),
							false,
						)
						return parent.getFileHandle(
							located.file.path.split("/").at(-1) ?? "",
						)
					},
					catch: () =>
						new LocalFileUnavailable({
							message:
								located.file.path + " was moved or deleted outside Alkalye",
							reconnect: false,
						}),
				})
				return { ...located, handle, root }
			})
		}
		function writableRoot(id: string) {
			return Effect.gen(function* () {
				let root = handles.get(id)
				if (!root || !(yield* permitted(root, false, true)))
					return yield* new LocalFileUnavailable({
						message: "Allow access to this folder again",
						reconnect: true,
					})
				return root
			})
		}
		function permitted(
			handle: FileSystemHandle,
			prompt: boolean,
			writing = prompt,
		) {
			return Effect.promise(async () => {
				let mode: "read" | "readwrite" = writing ? "readwrite" : "read"
				if (!handle.queryPermission) return true
				if ((await handle.queryPermission({ mode })) === "granted") return true
				if (!prompt || !handle.requestPermission) return false
				return (await handle.requestPermission({ mode })) === "granted"
			}).pipe(Effect.catchDefect(() => Effect.succeed(false)))
		}
		function touch(document: string, lastModified: number) {
			let located = locate(document)
			if (!located) return Effect.void
			return change(located.directory.id, current => ({
				files: current.files.map(file =>
					file.document === document ? { ...file, lastModified } : file,
				),
			}))
		}
		function find(id: string) {
			return SubscriptionRef.getUnsafe(state).find(
				directory => directory.id === id,
			)
		}
		function update(id: string, patch: Partial<LocalDirectory>) {
			return change(id, () => patch)
		}
		function change(
			id: string,
			patch: (current: LocalDirectory) => Partial<LocalDirectory>,
		) {
			return SubscriptionRef.update(state, directories =>
				directories.map(directory =>
					directory.id === id
						? { ...directory, ...patch(directory) }
						: directory,
				),
			).pipe(Effect.andThen(persist))
		}
	})
}

async function scan(root: FileSystemDirectoryHandle) {
	let files: { path: string; lastModified: number }[] = []
	let folders: string[] = []
	async function visit(directory: FileSystemDirectoryHandle, prefix: string) {
		for await (let [name, handle] of directory.entries()) {
			if (name.startsWith(".") || name === "node_modules") continue
			let path = join(prefix, name)
			if (handle instanceof FileSystemDirectoryHandle) {
				if (name !== "assets") folders.push(path)
				await visit(handle, path)
			} else if (
				handle instanceof FileSystemFileHandle &&
				documentPattern.test(name)
			) {
				if (files.length >= maximumFiles)
					throw new Error("This folder has more than 5,000 documents")
				files.push({
					path,
					lastModified: (await handle.getFile()).lastModified,
				})
			}
		}
	}
	await visit(root, "")
	files.sort((a, b) => a.path.localeCompare(b.path))
	folders.sort()
	return { files, folders }
}
async function folderHandle(
	root: FileSystemDirectoryHandle,
	path: string,
	create: boolean,
) {
	let directory = root
	for (let part of path.split("/").filter(Boolean))
		directory = await directory.getDirectoryHandle(part, { create })
	return directory
}
async function exists(directory: FileSystemDirectoryHandle, name: string) {
	for await (let entry of directory.keys()) if (entry === name) return true
	return false
}
async function availableName(
	directory: FileSystemDirectoryHandle,
	name: string,
) {
	let dot = name.lastIndexOf(".")
	let stem = dot > 0 ? name.slice(0, dot) : name
	let extension = dot > 0 ? name.slice(dot) : ""
	let candidate = name
	for (let index = 2; await exists(directory, candidate); index++)
		candidate = stem + "-" + index + extension
	return candidate
}
function relativePath(folder: string, source: string) {
	if (/^[a-z][\w+.-]*:|^\/|^#/i.test(source)) return undefined
	let parts = folder.split("/").filter(Boolean)
	let path = source.split(/[?#]/)[0] ?? ""
	try {
		path = decodeURIComponent(path)
	} catch {
		return undefined
	}
	for (let part of path.split("/")) {
		if (part === "..") {
			if (!parts.length) return undefined
			parts.pop()
		} else if (part && part !== ".") parts.push(part)
	}
	return parts.join("/") || undefined
}
function validName(name: string) {
	let trimmed = name.trim()
	return !trimmed ||
		trimmed === "." ||
		trimmed === ".." ||
		trimmed.startsWith(".") ||
		/[\\/:*?"<>|\u0000-\u001f]/.test(trimmed)
		? unavailable("Choose a name without slashes or special characters")
		: Effect.succeed(trimmed)
}
function assetName(name: string) {
	return (
		name.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[.-]+/, "") ||
		"attachment"
	)
}
function parentPath(path: string) {
	return path.split("/").slice(0, -1).join("/")
}
function join(folder: string, name: string) {
	return folder ? folder + "/" + name : name
}
function withFolders(folders: ReadonlyArray<string>, path: string) {
	let result = new Set(folders)
	let parts = path.split("/").filter(Boolean)
	for (let index = 1; index <= parts.length; index++)
		result.add(parts.slice(0, index).join("/"))
	return [...result].sort()
}
let singleFile =
	"Open the folder that contains this file to rename it or add attachments"
function fileKey(document: string) {
	return "local-file-handle:" + document
}
function handleKey(id: string) {
	return "local-directory-handle:" + id
}
function unavailable(message: string) {
	return Effect.fail(new LocalFileUnavailable({ message, reconnect: false }))
}
function failure(error: unknown) {
	return Effect.fail(
		new LocalFileUnavailable({
			message:
				error instanceof Error
					? error.message
					: "The folder could not be changed",
			reconnect:
				error instanceof DOMException && error.name === "NotAllowedError",
		}),
	)
}
