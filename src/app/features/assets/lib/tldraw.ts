import { z } from "zod"
import { app } from "@/jazz/schema"
import type { Database } from "@/app/features/documents/lib/library"
export {
	createTldrawAsset,
	updateTldrawAsset,
	tldrawNameFromFile,
	createTldrawBackupBundleFromSave,
	decodeTldrawBackupBundle,
	TLDRAW_BACKUP_EXTENSION,
	TLDRAW_BACKUP_MIME_TYPE,
	TldrawBackupContentError,
	TldrawBackupSizeError,
}
export type { TldrawSave }
let TLDRAW_BACKUP_EXTENSION = ".alkalye-tldraw"
let TLDRAW_BACKUP_MIME_TYPE = "application/vnd.alkalye.tldraw+json"
let MAX_TLDRAW_BACKUP_BYTES = 32 * 1024 * 1024
let MAX_TLDRAW_SNAPSHOT_LENGTH = 8 * 1024 * 1024
let MAX_TLDRAW_PREVIEW_BYTES = 8 * 1024 * 1024
let PNG_DATA_URL_PREFIX = "data:image/png;base64,"
let MAX_TLDRAW_PREVIEW_DATA_URL_LENGTH =
	PNG_DATA_URL_PREFIX.length + 4 * Math.ceil(MAX_TLDRAW_PREVIEW_BYTES / 3)

class TldrawBackupSizeError extends Error {}
class TldrawBackupContentError extends Error {}

interface TldrawSave {
	json: string
	lightPreview: Blob
	darkPreview: Blob
}

let backupBundleSchema = z.object({
	format: z.literal("alkalye-tldraw-v1"),
	snapshot: z.string().max(MAX_TLDRAW_SNAPSHOT_LENGTH),
	lightPreview: z.string().max(MAX_TLDRAW_PREVIEW_DATA_URL_LENGTH),
	darkPreview: z.string().max(MAX_TLDRAW_PREVIEW_DATA_URL_LENGTH),
})

function tldrawNameFromFile(file: File) {
	return file.name.replace(/\.tldr$/i, "") || "Whiteboard"
}

async function createTldrawBackupBundleFromSave(save: TldrawSave) {
	assertSnapshotSize(save.json.length)
	assertPreviewSize(save.lightPreview.size)
	assertPreviewSize(save.darkPreview.size)
	let [lightPreview, darkPreview] = await Promise.all([
		blobToDataUrl(save.lightPreview),
		blobToDataUrl(save.darkPreview),
	])
	let bundle = {
		format: "alkalye-tldraw-v1" as const,
		snapshot: save.json,
		lightPreview,
		darkPreview,
	}
	await decodeTldrawBackupObject(bundle, true)

	let blob = new Blob([JSON.stringify(bundle)], {
		type: TLDRAW_BACKUP_MIME_TYPE,
	})
	assertBackupSize(blob.size)
	return blob
}

async function decodeTldrawBackupBundle(blob: {
	size: number
	text: () => Promise<string>
}): Promise<TldrawSave> {
	assertBackupSize(blob.size)
	return decodeTldrawBackupObject(JSON.parse(await blob.text()))
}

async function decodeTldrawBackupObject(
	value: unknown,
	wrapContentErrors = false,
): Promise<TldrawSave> {
	let parsed = parseBackupBundle(value, wrapContentErrors)
	let { validateTldrawFile } = await import("./tldraw-file")
	try {
		validateTldrawFile(parsed.snapshot)
		return {
			json: parsed.snapshot,
			lightPreview: decodePngDataUrl(parsed.lightPreview),
			darkPreview: decodePngDataUrl(parsed.darkPreview),
		}
	} catch (error) {
		throwContentError(error, wrapContentErrors)
	}
}

function parseBackupBundle(value: unknown, wrapContentErrors: boolean) {
	try {
		return backupBundleSchema.parse(value)
	} catch (error) {
		throwContentError(error, wrapContentErrors)
	}
}

function throwContentError(error: unknown, wrap: boolean): never {
	if (!wrap || error instanceof TldrawBackupSizeError) throw error
	throw new TldrawBackupContentError(
		"Whiteboard data is invalid or unsupported",
	)
}

function assertBackupSize(size: number) {
	if (size > MAX_TLDRAW_BACKUP_BYTES) {
		throw new TldrawBackupSizeError("Whiteboard backup is too large")
	}
}

function assertSnapshotSize(length: number) {
	if (length > MAX_TLDRAW_SNAPSHOT_LENGTH) {
		throw new TldrawBackupSizeError("Whiteboard snapshot is too large")
	}
}

function assertPreviewSize(size: number) {
	if (size > MAX_TLDRAW_PREVIEW_BYTES) {
		throw new TldrawBackupSizeError("Whiteboard preview is too large")
	}
}

function decodePngDataUrl(dataUrl: string) {
	if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
		throw new Error("Whiteboard preview must be a PNG data URL")
	}
	let encoded = dataUrl.slice(PNG_DATA_URL_PREFIX.length)
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
		throw new Error("Whiteboard preview is not valid base64")
	}
	let binary = atob(encoded)
	assertPreviewSize(binary.length)
	let bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
	return new Blob([bytes], { type: "image/png" })
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		let reader = new FileReader()
		reader.onload = () => {
			if (typeof reader.result === "string") resolve(reader.result)
			else reject(new Error("Could not encode whiteboard preview"))
		}
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(blob)
	})
}

async function createRevision(
	db: Database,
	documentId: string,
	save: TldrawSave,
) {
	let write = await db.insertStreaming(app.tldrawRevisions, {
		documentId,
		snapshot: new Blob([save.json]).stream(),
		lightPreview: new Uint8Array(await save.lightPreview.arrayBuffer()),
		darkPreview: new Uint8Array(await save.darkPreview.arrayBuffer()),
		createdAt: new Date(),
	})
	await write.wait({ tier: "local" })
	return write.value
}
async function createTldrawAsset(
	db: Database,
	documentId: string,
	name: string,
	save: TldrawSave,
) {
	let revision = await createRevision(db, documentId, save)
	let write = db.insert(app.assets, {
		documentId,
		name,
		type: "tldraw",
		revisionId: revision.id,
		createdAt: new Date(),
	})
	await write.wait({ tier: "local" })
	return write.value
}
async function updateTldrawAsset(
	db: Database,
	documentId: string,
	assetId: string,
	save: TldrawSave,
) {
	let revision = await createRevision(db, documentId, save)
	await db
		.update(app.assets, assetId, { revisionId: revision.id })
		.wait({ tier: "local" })
}
