import { co, type Group } from "jazz-tools"
import { createImage } from "jazz-tools/media"
import { z } from "zod"
import {
	Asset,
	TldrawAsset,
	TldrawRevision,
	WhiteboardPresenceFeed,
} from "./schema"
import { Document } from "@/app/features/documents/lib/schema"
import { syncDocumentMetadata } from "@/app/features/documents/lib/metadata"

export {
	TLDRAW_BACKUP_EXTENSION,
	TLDRAW_BACKUP_MIME_TYPE,
	TldrawBackupContentError,
	TldrawBackupSizeError,
	createTldrawAsset,
	createTldrawAssetFromRevision,
	updateTldrawAsset,
	tldrawNameFromFile,
	copyTldrawRevision,
	createTldrawBackupBundle,
	createTldrawBackupBundleFromSave,
	createTldrawRevisionFromBackup,
	decodeTldrawBackupBundle,
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

type LoadedDocument = co.loaded<
	typeof Document,
	{
		content: true
		assets: true
	}
>

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

async function createTldrawAsset(
	doc: LoadedDocument,
	name: string,
	save: TldrawSave,
) {
	let revision = await createRevision(doc.$jazz.owner, save)
	let asset = createTldrawAssetFromRevision(name, revision, doc.$jazz.owner)

	let assets = doc.assets
	if (!assets) {
		assets = co.list(Asset).create([], doc.$jazz.owner)
		doc.$jazz.set("assets", assets)
	}
	assets.$jazz.push(asset)
	markDocumentUpdated(doc)
	return asset
}

function createTldrawAssetFromRevision(
	name: string,
	revision: co.loaded<typeof TldrawRevision>,
	owner: Group,
	createdAt = new Date(),
) {
	return TldrawAsset.create(
		{
			version: 1,
			type: "tldraw",
			name,
			revision,
			presence: WhiteboardPresenceFeed.create([], { owner }),
			createdAt,
		},
		owner,
	)
}

async function updateTldrawAsset(
	doc: LoadedDocument,
	assetId: string,
	save: TldrawSave,
) {
	let asset = doc.assets?.find(candidate => candidate?.$jazz.id === assetId)
	if (!asset?.$isLoaded || asset.type !== "tldraw") {
		throw new Error("Whiteboard asset is no longer available")
	}

	let revision = await createRevision(doc.$jazz.owner, save)
	asset.$jazz.set("revision", revision)
	markDocumentUpdated(doc)
}

function tldrawNameFromFile(file: File) {
	return file.name.replace(/\.tldr$/i, "") || "Whiteboard"
}

async function copyTldrawRevision(
	revision: co.loaded<typeof TldrawRevision>,
	owner: Group,
) {
	let { snapshotBlob, lightBlob, darkBlob } = await loadRevisionBlobs(revision)

	let [snapshot, lightPreview, darkPreview] = await Promise.all([
		co.fileStream().createFromBlob(snapshotBlob, { owner }),
		createImage(lightBlob, { owner, maxSize: 2048 }),
		createImage(darkBlob, { owner, maxSize: 2048 }),
	])
	return TldrawRevision.create(
		{ snapshot, lightPreview, darkPreview, createdAt: new Date() },
		owner,
	)
}

async function createTldrawBackupBundle(
	revision: co.loaded<typeof TldrawRevision>,
) {
	let { snapshotBlob, lightBlob, darkBlob } = await loadRevisionBlobs(revision)
	return createTldrawBackupBundleFromSave({
		json: await blobToText(snapshotBlob),
		lightPreview: lightBlob,
		darkPreview: darkBlob,
	})
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

async function createTldrawRevisionFromBackup(blob: Blob, owner: Group) {
	return createRevision(owner, await decodeTldrawBackupBundle(blob))
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

async function loadRevisionBlobs(revision: co.loaded<typeof TldrawRevision>) {
	let loaded = await revision.$jazz.ensureLoaded({
		resolve: {
			snapshot: true,
			lightPreview: { original: true },
			darkPreview: { original: true },
		},
	})
	let snapshotBlob = loaded.snapshot.toBlob()
	let lightOriginal = loaded.lightPreview.original
	let darkOriginal = loaded.darkPreview.original
	if (!snapshotBlob || !lightOriginal?.$isLoaded || !darkOriginal?.$isLoaded) {
		throw new Error("Whiteboard revision is incomplete")
	}
	let lightBlob = lightOriginal.toBlob()
	let darkBlob = darkOriginal.toBlob()
	if (!lightBlob || !darkBlob)
		throw new Error("Whiteboard previews are incomplete")
	return { snapshotBlob, lightBlob, darkBlob }
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

function blobToText(blob: Blob): Promise<string> {
	if (typeof blob.text === "function") return blob.text()
	return new Promise((resolve, reject) => {
		let reader = new FileReader()
		reader.onload = () => {
			if (typeof reader.result === "string") resolve(reader.result)
			else reject(new Error("Could not read whiteboard snapshot"))
		}
		reader.onerror = () => reject(reader.error)
		reader.readAsText(blob)
	})
}

function markDocumentUpdated(doc: LoadedDocument) {
	doc.$jazz.set("updatedAt", new Date())
	syncDocumentMetadata(doc, { contentChanged: false })
}

async function createRevision(owner: Group, save: TldrawSave) {
	let snapshot = await co
		.fileStream()
		.createFromBlob(
			new Blob([save.json], { type: "application/vnd.tldraw+json" }),
			{ owner },
		)
	let [lightPreview, darkPreview] = await Promise.all([
		createImage(save.lightPreview, { owner, maxSize: 2048 }),
		createImage(save.darkPreview, { owner, maxSize: 2048 }),
	])

	return TldrawRevision.create(
		{
			snapshot,
			lightPreview,
			darkPreview,
			createdAt: new Date(),
		},
		owner,
	)
}
