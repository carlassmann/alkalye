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
	resolveLocalFileId,
	renameDirectoryFile,
	createDirectoryFolder,
	createDirectoryFile,
	moveDirectoryEntry,
	openDirectoryFile,
	deleteDirectoryEntry,
	refreshLocalDirectory,
	restoreLocalFileRecovery,
	saveLocalFile,
	selectLocalWorkspace,
	switchToLocalFile,
	useLocalFileStore,
} from "./local-file"
import {
	MockDirectoryHandle,
	readFileAtPath,
} from "@/test-helpers/mock-filesystem"

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
	it("creates empty folders and files, moves files between folders, then deletes them", async () => {
		let root = new MockDirectoryHandle("workspace")
		root.addFile("note.md", "body")
		records.set("local-directory-handles", { actions: root })
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "actions", name: "workspace", files: [], status: "ready" },
			])
		await refreshLocalDirectory("actions")
		await createDirectoryFolder("actions", "", "Empty")
		expect(
			useLocalFileStore.getState().directoryWorkspaces[0].folders,
		).toContain("Empty")
		await createDirectoryFile("actions", "Empty", "New.md")
		expect(await readFileAtPath(root, "Empty/New.md")).toBe("")
		await moveDirectoryEntry("actions", "note.md", "Empty/note.md", "file")
		expect(await readFileAtPath(root, "Empty/note.md")).toBe("body")
		await expect(readFileAtPath(root, "note.md")).rejects.toThrow()
		await deleteDirectoryEntry("actions", "Empty/New.md", "file")
		await expect(readFileAtPath(root, "Empty/New.md")).rejects.toThrow()
		expect(
			useLocalFileStore
				.getState()
				.directoryWorkspaces[0].files.map(file => file.path),
		).toContain("Empty/note.md")
	})

	it("shows a created folder even when the follow-up scan fails", async () => {
		let root = new MockDirectoryHandle("workspace")
		records.set("local-directory-handles", { rescan: root })
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "rescan", name: "workspace", files: [], status: "ready" },
			])
		let entries = root.entries.bind(root)
		vi.spyOn(root, "entries")
			.mockImplementationOnce(entries)
			.mockImplementationOnce(() => {
				throw Error("Scan failed")
			})
		expect(await createDirectoryFolder("rescan", "", "Created")).toBe("Created")
		expect(
			useLocalFileStore.getState().directoryWorkspaces[0].folders,
		).toContain("Created")
		expect((await root.getDirectoryHandle("Created")).name).toBe("Created")
	})

	it("moves a folder with open drafts and refuses to move it into itself", async () => {
		let root = new MockDirectoryHandle("workspace")
		let source = new MockDirectoryHandle("Source")
		source.addFile("note.md", "disk")
		root.addDirectory("Source", source)
		root.addDirectory("Target", new MockDirectoryHandle("Target"))
		records.set("local-directory-handles", { folders: root })
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "folders", name: "workspace", files: [], status: "ready" },
			])
		await refreshLocalDirectory("folders")
		useLocalFileStore.getState().addFile({
			id: "folders:Source/note.md",
			filename: "note.md",
			workspaceId: "folders",
			path: "Source/note.md",
			lastOpened: Date.now(),
			content: "draft",
			lastSavedContent: "disk",
			hasUnsavedChanges: true,
			isActive: true,
		})
		await expect(
			moveDirectoryEntry("folders", "Source", "Source/Inside", "folder"),
		).rejects.toThrow("itself")
		let remove = vi
			.spyOn(root, "removeEntry")
			.mockRejectedValueOnce(Error("Folder is locked"))
		await expect(
			moveDirectoryEntry("folders", "Source", "Target/Renamed", "folder"),
		).rejects.toThrow("locked")
		remove.mockRestore()
		expect(await readFileAtPath(root, "Source/note.md")).toBe("disk")
		await expect(
			readFileAtPath(root, "Target/Renamed/note.md"),
		).rejects.toThrow()
		await moveDirectoryEntry("folders", "Source", "Target/Renamed", "folder")
		expect(await readFileAtPath(root, "Target/Renamed/note.md")).toBe("draft")
		expect(useLocalFileStore.getState().getActiveFile()).toMatchObject({
			id: "folders:Target/Renamed/note.md",
			content: "draft",
			hasUnsavedChanges: false,
		})
		expect(await saveLocalFile("folders:Target/Renamed/note.md", "draft")).toBe(
			true,
		)
		expect(await readFileAtPath(root, "Target/Renamed/note.md")).toBe("draft")
		await deleteDirectoryEntry("folders", "Target/Renamed", "folder")
		expect(useLocalFileStore.getState().getActiveFile()).toBeNull()
		await expect(
			readFileAtPath(root, "Target/Renamed/note.md"),
		).rejects.toThrow()
	})

	it("uses a native folder move when available", async () => {
		let root = new MockDirectoryHandle("workspace")
		let source = new MockDirectoryHandle("Source")
		source.addFile("note.md", "body")
		root.addDirectory("Source", source)
		source.move = async function move(destination, name) {
			if (!(destination instanceof MockDirectoryHandle))
				throw Error("Unexpected destination")
			destination.addDirectory(name, source)
			await root.removeEntry("Source", { recursive: true })
		}
		records.set("local-directory-handles", { native: root })
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "native", name: "workspace", files: [], status: "ready" },
			])
		await moveDirectoryEntry("native", "Source", "Renamed", "folder")
		expect(await root.getDirectoryHandle("Renamed")).toBe(source)
		expect(await readFileAtPath(root, "Renamed/note.md")).toBe("body")
		await expect(readFileAtPath(root, "Source/note.md")).rejects.toThrow()
	})

	it("copies a folder when native move reports unsupported", async () => {
		let root = new MockDirectoryHandle("workspace")
		let source = new MockDirectoryHandle("Source")
		source.addFile("note.md", "body")
		root.addDirectory("Source", source)
		source.move = async function move() {
			throw new DOMException("Unsupported", "NotSupportedError")
		}
		records.set("local-directory-handles", { unsupported: root })
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "unsupported", name: "workspace", files: [], status: "ready" },
			])
		await moveDirectoryEntry("unsupported", "Source", "Renamed", "folder")
		expect(await readFileAtPath(root, "Renamed/note.md")).toBe("body")
		await expect(readFileAtPath(root, "Source/note.md")).rejects.toThrow()
	})

	it("keeps a folder when native move is denied", async () => {
		let root = new MockDirectoryHandle("workspace")
		let source = new MockDirectoryHandle("Source")
		source.addFile("note.md", "body")
		root.addDirectory("Source", source)
		source.move = async function move() {
			throw new DOMException("Denied", "NotAllowedError")
		}
		records.set("local-directory-handles", { denied: root })
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "denied", name: "workspace", files: [], status: "ready" },
			])
		await expect(
			moveDirectoryEntry("denied", "Source", "Renamed", "folder"),
		).rejects.toThrow("Denied")
		expect(await readFileAtPath(root, "Source/note.md")).toBe("body")
		await expect(readFileAtPath(root, "Renamed/note.md")).rejects.toThrow()
	})

	it("keeps external folder edits made during a move", async () => {
		let root = new MockDirectoryHandle("workspace")
		let source = new MockDirectoryHandle("Source")
		source.addFile("note.md", "original")
		root.addDirectory("Source", source)
		records.set("local-directory-handles", { external: root })
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "external", name: "workspace", files: [], status: "ready" },
			])
		let originalEntries = source.entries.bind(source)
		let scans = 0
		vi.spyOn(source, "entries").mockImplementation(() => {
			scans += 1
			if (scans === 3) {
				source.addFile("note.md", "external revision")
				source.addFile("new.md", "added")
			}
			return originalEntries()
		})
		await expect(
			moveDirectoryEntry("external", "Source", "Moved", "folder"),
		).rejects.toThrow("changed")
		expect(await readFileAtPath(root, "Source/note.md")).toBe(
			"external revision",
		)
		expect(await readFileAtPath(root, "Source/new.md")).toBe("added")
		await expect(readFileAtPath(root, "Moved/note.md")).rejects.toThrow()
	})

	it("serializes overlapping moves in one workspace", async () => {
		let root = new MockDirectoryHandle("workspace")
		root.addFile("a.md", "body")
		records.set("local-directory-handles", { overlap: root })
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "overlap", name: "workspace", files: [], status: "ready" },
			])
		let first = moveDirectoryEntry("overlap", "a.md", "b.md", "file")
		let second = moveDirectoryEntry("overlap", "a.md", "c.md", "file")
		await first
		await expect(second).rejects.toThrow()
		expect(await readFileAtPath(root, "b.md")).toBe("body")
		await expect(readFileAtPath(root, "c.md")).rejects.toThrow()
	})

	it("does not save a deleted file after deletion starts", async () => {
		let root = new MockDirectoryHandle("workspace")
		root.addFile("note.md", "disk")
		records.set("local-directory-handles", { deleting: root })
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "deleting", name: "workspace", files: [], status: "ready" },
			])
		await refreshLocalDirectory("deleting")
		await openDirectoryFile("deleting", "note.md")
		let releaseRemoval: () => void = () => {}
		let reachRemoval: () => void = () => {}
		let removalReached = new Promise<void>(resolve => {
			reachRemoval = resolve
		})
		let original = root.removeEntry.bind(root)
		vi.spyOn(root, "removeEntry").mockImplementation(async (name, options) => {
			reachRemoval()
			await new Promise<void>(release => {
				releaseRemoval = release
			})
			await original(name, options)
		})
		let deletion = deleteDirectoryEntry("deleting", "note.md", "file")
		await removalReached
		let save = saveLocalFile("deleting:note.md", "late edit")
		releaseRemoval()
		await deletion
		expect(await save).toBe(false)
		await expect(readFileAtPath(root, "note.md")).rejects.toThrow()
	})

	it("renames a directory file while keeping an open draft and blocking collisions", async () => {
		let root = new MockDirectoryHandle("notes")
		let nested = new MockDirectoryHandle("nested")
		nested.addFile("old.md", "disk")
		nested.addFile("taken.md", "other")
		root.addDirectory("nested", nested)
		records.set("local-directory-handles", { renamedFolder: root })
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "renamedFolder", name: "notes", files: [], status: "ready" },
			])
		await refreshLocalDirectory("renamedFolder")
		useLocalFileStore.getState().addFile({
			id: "renamedFolder:nested/old.md",
			filename: "old.md",
			workspaceId: "renamedFolder",
			path: "nested/old.md",
			lastOpened: Date.now(),
			content: "draft",
			lastSavedContent: "disk",
			hasUnsavedChanges: true,
			isActive: true,
		})

		await expect(
			renameDirectoryFile("renamedFolder", "nested/old.md", "taken.md"),
		).rejects.toThrow("already exists")
		expect(await readFileAtPath(root, "nested/old.md")).toBe("disk")
		expect(await readFileAtPath(root, "nested/taken.md")).toBe("other")

		await renameDirectoryFile("renamedFolder", "nested/old.md", "new.md")
		expect(await readFileAtPath(root, "nested/new.md")).toBe("draft")
		await expect(readFileAtPath(root, "nested/old.md")).rejects.toThrow()
		expect(useLocalFileStore.getState().getActiveFile()).toMatchObject({
			id: "renamedFolder:nested/new.md",
			filename: "new.md",
			content: "draft",
			hasUnsavedChanges: false,
		})
		expect(
			useLocalFileStore
				.getState()
				.directoryWorkspaces[0].files.map(file => file.path),
		).toContain("nested/new.md")
		expect(await saveLocalFile("renamedFolder:nested/new.md", "draft")).toBe(
			true,
		)
		expect(await readFileAtPath(root, "nested/new.md")).toBe("draft")
	})

	it("supports case-only renames and saves queued during a move", async () => {
		let root = new MockDirectoryHandle("workspace")
		root.addFile("note.md", "disk")
		records.set("local-directory-handles", { timing: root })
		useLocalFileStore
			.getState()
			.setDirectoryWorkspaces([
				{ id: "timing", name: "workspace", files: [], status: "ready" },
			])
		await refreshLocalDirectory("timing")
		await renameDirectoryFile("timing", "note.md", "Note.md")
		expect(await readFileAtPath(root, "Note.md")).toBe("disk")
		useLocalFileStore.getState().addFile({
			id: "timing:Note.md",
			filename: "Note.md",
			workspaceId: "timing",
			path: "Note.md",
			lastOpened: Date.now(),
			content: "disk",
			lastSavedContent: "disk",
			hasUnsavedChanges: false,
			isActive: true,
		})
		let releaseRemoval: () => void = () => {}
		let reachRemoval: () => void = () => {}
		let removalReached = new Promise<void>(resolve => {
			reachRemoval = resolve
		})
		let original = root.removeEntry.bind(root)
		let remove = vi
			.spyOn(root, "removeEntry")
			.mockImplementation(async (name, options) => {
				if (name === "Note.md") {
					reachRemoval()
					await new Promise<void>(release => {
						releaseRemoval = release
					})
				}
				await original(name, options)
			})
		let move = moveDirectoryEntry("timing", "Note.md", "Moved.md", "file")
		await removalReached
		useLocalFileStore.getState().setFileContent("timing:Note.md", "new draft")
		let save = saveLocalFile("timing:Note.md", "new draft")
		releaseRemoval()
		await move
		expect(await save).toBe(true)
		remove.mockRestore()
		expect(await readFileAtPath(root, "Moved.md")).toBe("new draft")
		await moveDirectoryEntry("timing", "Moved.md", "Note.md", "file")
		expect(resolveLocalFileId("timing:Note.md")).toBe("timing:Note.md")
		await moveDirectoryEntry("timing", "Note.md", "Other.md", "file")
		await createDirectoryFile("timing", "", "Note.md")
		await openDirectoryFile("timing", "Note.md")
		useLocalFileStore.getState().setFileContent("timing:Note.md", "replacement")
		expect(await saveLocalFile("timing:Note.md", "replacement")).toBe(true)
		expect(await readFileAtPath(root, "Note.md")).toBe("replacement")
		expect(await readFileAtPath(root, "Other.md")).toBe("new draft")
	})

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
