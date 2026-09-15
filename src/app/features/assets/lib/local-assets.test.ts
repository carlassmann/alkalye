import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTLStore } from "tldraw"
import JSZip from "jszip"
import { getDirectoryHandleFromDB } from "@/app/lib/local-file"
import {
	MockDirectoryHandle,
	readFileAtPath,
	readBlobBytes,
} from "@/app/features/backup/lib/test-helpers"
import {
	loadLocalAssets,
	localDiskContent,
	localEditorContent,
	readLocalWhiteboard,
	copyLocalAssetForRename,
	updateLocalAssetReferences,
	writeLocalAsset,
	writeLocalWhiteboard,
	createLocalAssetArchive,
	isLocalAssetReferencedElsewhere,
} from "./local-assets"

vi.mock("@/app/lib/local-file", () => ({
	getDirectoryHandleFromDB: vi.fn(),
}))

let root: MockDirectoryHandle
let workDirectory: MockDirectoryHandle
let assetsDirectory: MockDirectoryHandle
let location = { workspaceId: "notes", path: "work/notes.md" }

beforeEach(() => {
	root = new MockDirectoryHandle("notes")
	workDirectory = new MockDirectoryHandle("work")
	assetsDirectory = new MockDirectoryHandle("assets")
	workDirectory.addDirectory("assets", assetsDirectory)
	workDirectory.addFile("notes.md", "# Notes")
	root.addDirectory("work", workDirectory)
	vi.mocked(getDirectoryHandleFromDB).mockResolvedValue(root)
})

describe("local asset files", () => {
	it("saves and reloads a whiteboard with its editable snapshot and previews", async () => {
		let save = createWhiteboardSave()
		let id = await writeLocalWhiteboard(location, "Diagram", save)
		let assets = await loadLocalAssets(location)

		expect(id).toBe("Diagram.alkalye-tldraw")
		expect(assets).toMatchObject([{ id, type: "tldraw" }])
		expect(assets[0].lightPreview?.type).toBe("image/png")
		expect((await readLocalWhiteboard(location, id)).json).toBe(save.json)

		let diskContent = `![Diagram](assets/${id})`
		expect(localEditorContent(diskContent, assets)).toBe(
			`![Diagram](asset:${id})`,
		)
		let explicitLink = `![Diagram](./assets/${id})`
		expect(localEditorContent(explicitLink, assets)).toBe(
			`![Diagram](asset:${id})`,
		)
		expect(
			localDiskContent(`![Diagram](asset:${id})`, assets, explicitLink),
		).toBe(explicitLink)
		expect(
			localDiskContent(`![Sketch](asset:${id})`, assets, explicitLink),
		).toBe(`![Sketch](./assets/${id})`)
		let mixedLinks = `![Diagram](assets/${id})\n` + `![Diagram](./assets/${id})`
		expect(
			localDiskContent(
				localEditorContent(mixedLinks, assets),
				assets,
				mixedLinks,
			),
		).toBe(mixedLinks)
		expect(localDiskContent(`![Diagram](asset:${id})`, assets)).toBe(
			diskContent,
		)
		expect(await readFileAtPath(root, `work/assets/${id}`)).toContain(
			"alkalye-tldraw-v1",
		)
		let expectedLastModified = assets[0].lastModified
		assetsDirectory.addFile(
			id,
			"external edit",
			(expectedLastModified ?? 0) + 1,
		)
		await expect(
			writeLocalWhiteboard(location, "", save, id, expectedLastModified),
		).rejects.toThrow("changed on disk")
		expect(await readFileAtPath(root, `work/assets/${id}`)).toBe(
			"external edit",
		)
	})

	it("keeps colliding files distinct and updates only the renamed asset reference", async () => {
		let first = await writeLocalAsset(
			location,
			new Blob(["one"], { type: "image/png" }),
			"map.png",
		)
		let second = await writeLocalAsset(
			location,
			new Blob(["two"], { type: "image/png" }),
			"map.png",
		)
		expect([first, second]).toEqual(["map.png", "map-2.png"])

		let renamed = await copyLocalAssetForRename(location, first, "plan")
		let content = `![Map](assets/${first})\n![Other](assets/${second})`
		expect(updateLocalAssetReferences(content, first, renamed)).toBe(
			`![Map](assets/plan.png)\n![Other](assets/${second})`,
		)
		expect(await readFileAtPath(root, `work/assets/${renamed}`)).toBe("one")
		expect(await readFileAtPath(root, `work/assets/${second}`)).toBe("two")
		let concurrent = await Promise.all([
			writeLocalAsset(
				location,
				new Blob(["three"], { type: "image/png" }),
				"holiday photo.png",
			),
			writeLocalAsset(
				location,
				new Blob(["four"], { type: "image/png" }),
				"holiday-photo.png",
			),
		])
		expect(concurrent).toEqual(["holiday-photo.png", "holiday-photo-2.png"])
		expect(await readFileAtPath(root, `work/assets/${concurrent[0]}`)).toBe(
			"three",
		)
		expect(await readFileAtPath(root, `work/assets/${concurrent[1]}`)).toBe(
			"four",
		)
	})

	it("exports referenced local assets with their original file names", async () => {
		let id = await writeLocalWhiteboard(
			location,
			"Diagram",
			createWhiteboardSave(),
		)
		let content = `![Diagram](assets/${id})`
		let archive = await createLocalAssetArchive(
			content,
			"notes.md",
			await loadLocalAssets(location),
		)
		if (!archive) throw new Error("Expected an asset archive")
		expect(archive?.name).toBe("notes.zip")
		let zip = await JSZip.loadAsync(await readBlobBytes(archive))
		expect(await zip.file("notes/notes.md")?.async("string")).toBe(content)
		expect(await zip.file(`notes/assets/${id}`)?.async("string")).toContain(
			"alkalye-tldraw-v1",
		)
		await expect(
			createLocalAssetArchive("![Missing](assets/missing.png)", "notes.md", []),
		).rejects.toThrow("missing.png is unavailable")
	})

	it("detects when a sibling Markdown file still uses an asset", async () => {
		let id = await writeLocalAsset(
			location,
			new Blob(["image"], { type: "image/png" }),
			"map.png",
		)
		workDirectory.addFile("other.md", `![Map](./assets/${id})`)
		expect(await isLocalAssetReferencedElsewhere(location, id)).toBe(true)
		workDirectory.addFile("other.md", "![Different](assets/map-2.png)")
		expect(await isLocalAssetReferencedElsewhere(location, id)).toBe(false)
	})
})

function createWhiteboardSave() {
	let json = JSON.stringify({
		tldrawFileFormatVersion: 1,
		schema: createTLStore().schema.serialize(),
		records: [
			{
				meta: {},
				id: "page:page",
				name: "Page",
				index: "a1",
				typeName: "page",
			},
			{
				gridSize: 10,
				name: "",
				meta: {},
				id: "document:document",
				typeName: "document",
			},
		],
	})
	let preview = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" })
	return { json, lightPreview: preview, darkPreview: preview }
}
