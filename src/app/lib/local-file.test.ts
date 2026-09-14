import { beforeEach, describe, expect, it, vi } from "vitest"

let records = new Map<string, unknown>()
vi.mock("idb-keyval", () => ({
	get: async (key: string) => records.get(key),
	set: async (key: string, value: unknown) => {
		records.set(key, value)
	},
	del: async (key: string) => {
		records.delete(key)
	},
}))

import {
	resolveLocalFileConflict,
	readDirectoryFile,
	restoreLocalFileRecovery,
	saveLocalFile,
	selectLocalWorkspace,
	switchToLocalFile,
	useLocalFileStore,
} from "./local-file"

class TestWritable
	extends WritableStream
	implements FileSystemWritableFileStream
{
	private handle: TestHandle
	private staged = ""

	constructor(handle: TestHandle) {
		super()
		this.handle = handle
	}

	async write(data: string | Blob | ArrayBuffer): Promise<void> {
		if (typeof data !== "string") throw Error("Unexpected test write")
		this.staged = data
		await this.handle.waitForWrite?.()
		if (this.handle.failWrite) throw Error("Write failed")
	}

	async close(): Promise<void> {
		this.handle.disk = this.staged
	}

	async abort(): Promise<void> {
		this.handle.aborted = true
	}

	async seek(): Promise<void> {}

	async truncate(): Promise<void> {}
}

class TestHandle implements FileSystemFileHandle {
	readonly kind = "file" as const
	readonly name = "notes.md"
	disk: string
	failWrite = false
	aborted = false
	waitForWrite?: () => Promise<void>
	waitForRead?: () => Promise<void>

	constructor(content: string) {
		this.disk = content
	}

	async getFile(): Promise<File> {
		let file = new File([this.disk], this.name)
		Object.defineProperty(file, "text", {
			value: async () => {
				await this.waitForRead?.()
				return this.disk
			},
		})
		return file
	}

	async createWritable(): Promise<FileSystemWritableFileStream> {
		return new TestWritable(this)
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		return other === this
	}
}

beforeEach(() => {
	records.clear()
	useLocalFileStore.getState().reset()
})

describe("local file saves", () => {
	it("reads an unopened directory file without activating it, then prefers its open draft", async () => {
		let handle = new TestHandle("disk")
		records.set("local-directory-handles", {
			folder: {
				getDirectoryHandle: async () => ({
					getFileHandle: async () => handle,
				}),
			},
		})
		useLocalFileStore.getState().setDirectoryWorkspaces([
			{
				id: "folder",
				name: "Folder",
				files: [
					{
						id: "nested/notes.md",
						name: "notes.md",
						path: "nested/notes.md",
					},
				],
				status: "ready",
			},
		])
		expect(await readDirectoryFile("folder", "nested/notes.md")).toMatchObject({
			content: "disk",
		})
		expect(useLocalFileStore.getState().files).toHaveLength(0)
		expect(useLocalFileStore.getState().getActiveFile()).toBeNull()
		useLocalFileStore.getState().addFile({
			id: "folder:nested/notes.md",
			filename: "notes.md",
			workspaceId: "folder",
			path: "nested/notes.md",
			lastOpened: Date.now(),
			content: "draft",
			lastSavedContent: "disk",
			hasUnsavedChanges: true,
			isActive: true,
		})
		expect(await readDirectoryFile("folder", "nested/notes.md")).toMatchObject({
			content: "draft",
		})
	})
	it("restores an individually opened file after visiting an empty folder", async () => {
		await switchToLocalFile("personal", new TestHandle("notes"))
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "empty", name: "Empty", files: [], status: "ready" },
			])
		selectLocalWorkspace("empty")
		expect(useLocalFileStore.getState().getActiveFile()).toBeNull()
		selectLocalWorkspace(null)
		expect(useLocalFileStore.getState().getActiveFile()?.id).toBe("personal")
	})

	it("keeps edits typed during an in-flight save", async () => {
		let handle = new TestHandle("one")
		await switchToLocalFile("a", handle)
		let releaseWrite: () => void = () => {}
		let writeReached = new Promise<void>(resolve => {
			handle.waitForWrite = () => {
				resolve()
				return new Promise<void>(release => {
					releaseWrite = release
				})
			}
		})
		useLocalFileStore.getState().setFileContent("a", "one two")
		let save = saveLocalFile("a", "one two")
		await writeReached
		useLocalFileStore.getState().setFileContent("a", "one two three")
		releaseWrite()
		expect(await save).toBe(true)
		expect(handle.disk).toBe("one two")
		expect(useLocalFileStore.getState().getFileById("a")).toMatchObject({
			content: "one two three",
			lastSavedContent: "one two",
			hasUnsavedChanges: true,
		})
	})

	it("aborts a failed write and retains the draft", async () => {
		let handle = new TestHandle("disk")
		await switchToLocalFile("b", handle)
		handle.failWrite = true
		useLocalFileStore.getState().setFileContent("b", "draft")
		expect(await saveLocalFile("b", "draft")).toBe(false)
		expect(handle.disk).toBe("disk")
		expect(handle.aborted).toBe(true)
		expect(useLocalFileStore.getState().getFileById("b")).toMatchObject({
			content: "draft",
			hasUnsavedChanges: true,
		})
	})

	it("preserves newer typing when a delayed disk read reveals a conflict", async () => {
		let handle = new TestHandle("base")
		await switchToLocalFile("d", handle)
		let releaseRead: () => void = () => {}
		let readReached = new Promise<void>(resolve => {
			handle.waitForRead = () => {
				resolve()
				return new Promise<void>(release => {
					releaseRead = release
				})
			}
		})
		useLocalFileStore.getState().setFileContent("d", "mine")
		let save = saveLocalFile("d", "mine")
		await readReached
		useLocalFileStore.getState().setFileContent("d", "mine newer")
		handle.disk = "theirs"
		releaseRead()
		expect(await save).toBe(false)
		expect(useLocalFileStore.getState().getFileById("d")).toMatchObject({
			content: "mine newer",
			conflict: true,
		})
		expect(handle.disk).toBe("theirs")
	})

	it("lets the user restore the version displaced by a conflict choice", async () => {
		let handle = new TestHandle("base")
		await switchToLocalFile("c", handle)
		useLocalFileStore.getState().setFileContent("c", "mine")
		handle.disk = "theirs"
		expect(await saveLocalFile("c", "mine")).toBe(false)
		expect(await resolveLocalFileConflict("c", "disk")).toBe(true)
		expect(
			useLocalFileStore.getState().getFileById("c")?.recovery?.content,
		).toBe("mine")
		expect(await restoreLocalFileRecovery("c")).toBe(true)
		expect(useLocalFileStore.getState().getFileById("c")).toMatchObject({
			content: "mine",
			lastSavedContent: "theirs",
			hasUnsavedChanges: true,
		})
		expect(handle.disk).toBe("theirs")
		handle.disk = "third"
		expect(await saveLocalFile("c", "mine")).toBe(false)
		expect(await resolveLocalFileConflict("c", "local")).toBe(true)
		expect(handle.disk).toBe("mine")
		expect(
			useLocalFileStore.getState().getFileById("c")?.recovery?.content,
		).toBe("third")
		expect(await restoreLocalFileRecovery("c")).toBe(true)
		expect(useLocalFileStore.getState().getFileById("c")).toMatchObject({
			content: "third",
			lastSavedContent: "mine",
			hasUnsavedChanges: true,
		})
	})
})
