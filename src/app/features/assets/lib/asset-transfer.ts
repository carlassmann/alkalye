import {
	TLDRAW_BACKUP_EXTENSION,
	TLDRAW_BACKUP_MIME_TYPE,
	decodeTldrawBackupBundle,
	createTldrawAsset,
} from "./tldraw"
import { uploadAsset, readAssetBlob } from "./data"
import type { Database } from "@/app/features/documents/lib/library"
export {
	TLDRAW_BACKUP_EXTENSION,
	TLDRAW_BACKUP_MIME_TYPE,
	classifyAssetFile,
	isAssetFileName,
	assetMimeTypeFromFileName,
	assetExtensionFromMimeType,
	createAssetFromFile,
	readAssetBlob as serializeAsset,
}
export type { AssetFileKind }
type AssetFileKind = "image" | "video" | "tldraw"
async function createAssetFromFile(
	db: Database,
	documentId: string,
	input: { blob: Blob; fileName: string; name?: string },
) {
	let kind = classifyAssetFile({ name: input.fileName, type: input.blob.type })
	if (kind === "tldraw")
		return createTldrawAsset(
			db,
			documentId,
			input.name ?? input.fileName.replace(/\.[^.]+$/, ""),
			await decodeTldrawBackupBundle(input.blob),
		)
	if (!kind) throw new Error("Unsupported asset file")
	return uploadAsset(
		db,
		documentId,
		new File([input.blob], input.fileName, {
			type: input.blob.type || assetMimeTypeFromFileName(input.fileName),
		}),
	)
}
function classifyAssetFile(file: {
	name: string
	type: string
}): AssetFileKind | null {
	let name = file.name.toLowerCase()
	if (
		file.type === TLDRAW_BACKUP_MIME_TYPE ||
		name.endsWith(TLDRAW_BACKUP_EXTENSION)
	) {
		return "tldraw"
	}
	if (file.type.startsWith("image/") || isImageFileName(name)) return "image"
	if (file.type.startsWith("video/") || isVideoFileName(name)) return "video"
	return null
}

function isAssetFileName(name: string) {
	return classifyAssetFile({ name, type: "" }) !== null
}

function assetMimeTypeFromFileName(name: string) {
	let extension = name.toLowerCase().split(".").pop() ?? ""
	return mimeTypes[extension] ?? "application/octet-stream"
}

function assetExtensionFromMimeType(mimeType: string) {
	return extensionsByMimeType[mimeType]
}

function isImageFileName(name: string) {
	return imageExtensions.some(extension => name.endsWith(`.${extension}`))
}

function isVideoFileName(name: string) {
	return videoExtensions.some(extension => name.endsWith(`.${extension}`))
}

let imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]
let videoExtensions = ["mp4", "webm", "mov"]
let mimeTypes: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	bmp: "image/bmp",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	"alkalye-tldraw": TLDRAW_BACKUP_MIME_TYPE,
}
let extensionsByMimeType: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/svg+xml": ".svg",
	"image/bmp": ".bmp",
	"video/mp4": ".mp4",
	"video/webm": ".webm",
	"video/quicktime": ".mov",
	[TLDRAW_BACKUP_MIME_TYPE]: TLDRAW_BACKUP_EXTENSION,
}
