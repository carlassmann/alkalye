import {
	getDirectoryHandleFromDB,
	type LocalFileEntry,
} from "@/app/lib/local-file"
import {
	transformContentForBackup,
	transformContentForImport,
} from "@/app/features/backup/lib/sync"
import {
	classifyAssetFile,
	assetExtensionFromMimeType,
	isAssetFileName,
	TLDRAW_BACKUP_EXTENSION,
} from "./asset-transfer"
import {
	createTldrawBackupBundleFromSave,
	decodeTldrawBackupBundle,
	type TldrawSave,
} from "./tldraw"

export {
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
	type LocalAsset,
}

interface LocalAsset {
	id: string
	name: string
	type: "image" | "video" | "tldraw"
	blob: Blob
	lastModified?: number
	lightPreview?: Blob
	darkPreview?: Blob
}

type LocalAssetLocation = Pick<LocalFileEntry, "workspaceId" | "path">

function localEditorContent(content: string, assets: LocalAsset[]) {
	let files = new Map(assets.map(asset => [asset.id, asset.id]))
	return transformContentForImport(content, files)
}

function localDiskContent(content: string, assets: LocalAsset[]) {
	let files = new Map(assets.map(asset => [asset.id, asset.id]))
	let transformed = transformContentForBackup(content, files)
	return transformed.replace(
		/!\[([^\]]*)\]\(asset:([^)]+)\)/g,
		(match, alt, id) =>
			isAssetFileName(id) && !id.includes("/")
				? `![${alt}](assets/${id})`
				: match,
	)
}

function updateLocalAssetReferences(
	content: string,
	assetId: string,
	nextId?: string,
) {
	return content.replace(
		/!\[([^\]]*)\]\(assets\/([^)]+)\)/g,
		(match, alt, id) => {
			if (id !== assetId) return match
			return nextId ? `![${alt}](assets/${nextId})` : ""
		},
	)
}

async function createLocalAssetArchive(
	content: string,
	filename: string,
	assets: LocalAsset[],
) {
	let references = new Set<string>()
	for (let match of content.matchAll(/!\[[^\]]*\]\(assets\/([^)]+)\)/g))
		references.add(match[1])
	if (references.size === 0) return null
	let { default: JSZip } = await import("jszip")
	let zip = new JSZip()
	let name = filename.replace(/\.md$/i, "")
	let folder = zip.folder(name)!
	folder.file(filename, content)
	let assetsFolder = folder.folder("assets")!
	for (let asset of assets) {
		if (references.has(asset.id)) assetsFolder.file(asset.id, asset.blob)
	}
	let blob = await zip.generateAsync({ type: "blob" })
	return new File([blob], `${name}.zip`, {
		type: "application/zip",
	})
}

async function loadLocalAssets(
	file: LocalAssetLocation,
): Promise<LocalAsset[]> {
	let directory = await getAssetsDirectory(file)
	if (!directory) return []
	let assets: LocalAsset[] = []
	for await (let [, handle] of directory.entries()) {
		if (handle.kind !== "file") continue
		let blob = await (await directory.getFileHandle(handle.name)).getFile()
		let kind = classifyAssetFile({ name: handle.name, type: blob.type })
		if (!kind) continue
		let asset: LocalAsset = {
			id: handle.name,
			name: handle.name.replace(/\.[^.]+$/, ""),
			type: kind,
			blob,
			lastModified: blob.lastModified,
		}
		if (kind === "tldraw") {
			try {
				let save = await decodeTldrawBackupBundle(blob)
				asset.lightPreview = save.lightPreview
				asset.darkPreview = save.darkPreview
			} catch {
				continue
			}
		}
		assets.push(asset)
	}
	return assets.sort((left, right) => left.name.localeCompare(right.name))
}

async function writeLocalAsset(
	file: LocalAssetLocation,
	blob: Blob,
	fileName: string,
) {
	let directory = await getAssetsDirectory(file, true)
	if (!directory)
		throw new Error("Open this file from a local folder to add assets")
	let base = fileName.replace(/[^a-zA-Z0-9._-]/g, "-")
	if (!isAssetFileName(base)) {
		let extension = assetExtensionFromMimeType(blob.type)
		if (!extension) throw new Error(`Unsupported asset file: ${fileName}`)
		base = `${base.replace(/\.[^.]+$/, "")}${extension}`
	}
	let extension = base.match(/\.[^.]+$/)?.[0] ?? ""
	let stem = base.slice(0, base.length - extension.length) || "asset"
	let names = new Set<string>()
	for await (let [existing] of directory.entries()) {
		names.add(existing.toLocaleLowerCase())
	}
	let name = `${stem}${extension}`
	let counter = 2
	while (names.has(name.toLocaleLowerCase()))
		name = `${stem}-${counter++}${extension}`
	let handle = await directory.getFileHandle(name, { create: true })
	await writeBlob(handle, blob)
	return name
}

async function writeLocalWhiteboard(
	file: LocalAssetLocation,
	name: string,
	save: TldrawSave,
	assetId?: string,
	expectedLastModified?: number,
) {
	let bundle = await createTldrawBackupBundleFromSave(save)
	if (!assetId)
		return writeLocalAsset(file, bundle, `${name}${TLDRAW_BACKUP_EXTENSION}`)
	let directory = await getAssetsDirectory(file)
	if (!directory) throw new Error("Whiteboard asset is unavailable")
	let handle = await directory.getFileHandle(assetId)
	let current = await handle.getFile()
	if (
		expectedLastModified !== undefined &&
		current.lastModified !== expectedLastModified
	) {
		throw new Error("Whiteboard changed on disk; reopen it before saving")
	}
	await writeBlob(handle, bundle)
	return assetId
}

async function readLocalWhiteboard(file: LocalAssetLocation, assetId: string) {
	let directory = await getAssetsDirectory(file)
	if (!directory) throw new Error("Whiteboard asset is unavailable")
	let blob = await (await directory.getFileHandle(assetId)).getFile()
	return decodeTldrawBackupBundle(blob)
}

async function removeLocalAsset(file: LocalAssetLocation, assetId: string) {
	let directory = await getAssetsDirectory(file)
	if (!directory) throw new Error("Asset is unavailable")
	await directory.removeEntry(assetId)
}

async function isLocalAssetReferencedElsewhere(
	file: LocalAssetLocation,
	assetId: string,
) {
	let directory = await getLocalDirectory(file)
	if (!directory) return false
	let filename = file.path?.split("/").at(-1)
	for await (let [name, handle] of directory.entries()) {
		if (handle.kind !== "file" || name === filename || !/\.md$/i.test(name))
			continue
		let content = await (await directory.getFileHandle(name)).getFile()
		let markdown = await content.text()
		for (let match of markdown.matchAll(/!\[[^\]]*\]\(assets\/([^)]+)\)/g)) {
			if (match[1] === assetId) return true
		}
	}
	return false
}

async function copyLocalAssetForRename(
	file: LocalAssetLocation,
	assetId: string,
	newName: string,
) {
	let directory = await getAssetsDirectory(file)
	if (!directory) throw new Error("Asset is unavailable")
	let oldHandle = await directory.getFileHandle(assetId)
	let extension = assetId.match(/\.[^.]+$/)?.[0] ?? ""
	let base = newName.trim().replace(/[^a-zA-Z0-9._-]/g, "-")
	if (!base) throw new Error("Asset name is required")
	let name = `${base}${extension}`
	if (name === assetId) return assetId
	for await (let [existing] of directory.entries()) {
		if (existing.toLocaleLowerCase() === name.toLocaleLowerCase()) {
			throw new Error("An asset with that name already exists")
		}
	}
	let next = await directory.getFileHandle(name, { create: true })
	try {
		await writeBlob(next, await oldHandle.getFile())
	} catch (error) {
		await directory.removeEntry(name).catch(() => undefined)
		throw error
	}
	return name
}

async function getAssetsDirectory(file: LocalAssetLocation, create = false) {
	let directory = await getLocalDirectory(file)
	if (!directory) return null
	try {
		return await directory.getDirectoryHandle("assets", { create })
	} catch (error) {
		if (create) throw error
		return null
	}
}

async function getLocalDirectory(file: LocalAssetLocation) {
	if (!file.workspaceId || !file.path) return null
	let root = await getDirectoryHandleFromDB(file.workspaceId)
	if (!root) return null
	let segments = file.path.split("/")
	segments.pop()
	let directory = root
	for (let segment of segments) {
		directory = await directory.getDirectoryHandle(segment)
	}
	return directory
}

async function writeBlob(handle: FileSystemFileHandle, blob: Blob) {
	let writable = await handle.createWritable()
	try {
		await writable.write(blob)
		await writable.close()
	} catch (error) {
		await writable.abort().catch(() => undefined)
		throw error
	}
}
