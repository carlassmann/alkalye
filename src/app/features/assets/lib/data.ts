import { useResolvedTheme } from "@/app/components/appearance"
import { useEffect, useState } from "react"
import { useAll, useDb } from "jazz-tools/react"
import { app } from "@/jazz/schema"
import type { schema } from "jazz-tools"
import type { Database } from "@/app/features/documents/lib/library"

export {
	assetQuery,
	useDocumentAssets,
	readAssetBlob,
	bytesBlob,
	uploadAsset,
	copyDocumentAssets,
}
export type { AssetMetadata }
let assetQuery = app.assets.select(
	"id",
	"documentId",
	"name",
	"type",
	"mimeType",
	"muteAudio",
	"width",
	"height",
	"revisionId",
	"createdAt",
)
type AssetMetadata = schema.RowOf<typeof assetQuery>

function bytesBlob(bytes: Uint8Array, type = "application/octet-stream") {
	return new Blob([new Uint8Array(bytes)], { type })
}
async function readAssetBlob(db: Database, id: string) {
	let asset = await db.one(app.assets.where({ id }))
	if (!asset) throw new Error("Asset is unavailable")
	if (asset.type === "tldraw" && asset.revisionId) {
		let { createTldrawBackupBundleFromSave } = await import("./tldraw")
		let revision = await db.one(
			app.tldrawRevisions.where({ id: asset.revisionId }),
		)
		if (!revision) throw new Error("Whiteboard revision is unavailable")
		return createTldrawBackupBundleFromSave({
			json: new TextDecoder().decode(revision.snapshot),
			lightPreview: bytesBlob(revision.lightPreview, "image/png"),
			darkPreview: bytesBlob(revision.darkPreview, "image/png"),
		})
	}
	if (!asset.data) throw new Error("Asset bytes are unavailable")
	return bytesBlob(asset.data, asset.mimeType ?? undefined)
}
function useDocumentAssets(documentId: string, content = "") {
	let db = useDb()
	let appearance = useResolvedTheme()
	let { data: rows = [] } = useAll(assetQuery.where({ documentId }))
	let [loaded, setLoaded] = useState<{
		key: string
		urls: Map<string, { url?: string; lightUrl?: string; darkUrl?: string }>
	}>({ key: "", urls: new Map() })
	let key = JSON.stringify([
		rows,
		[...content.matchAll(/asset:([^)]+)/g)].map(match => match[1]),
	])
	useEffect(() => {
		let cancelled = false
		let urls: string[] = []
		let result = new Map<
			string,
			{ url?: string; lightUrl?: string; darkUrl?: string }
		>()
		function url(bytes: Uint8Array, mime: string) {
			let value = URL.createObjectURL(bytesBlob(bytes, mime))
			urls.push(value)
			return value
		}
		void Promise.all(
			rows.map(async asset => {
				if (asset.type === "image") {
					let row = await db.one(
						app.assets.where({ id: asset.id }).select("thumbnail"),
					)
					if (row?.thumbnail && !cancelled) {
						result.set(asset.id, { url: url(row.thumbnail, "image/png") })
						setLoaded({ key, urls: new Map(result) })
					}
				}
				if (asset.type === "tldraw" && asset.revisionId) {
					let revision = await db.one(
						app.tldrawRevisions
							.where({ id: asset.revisionId })
							.select("lightPreview", "darkPreview"),
					)
					if (revision && !cancelled)
						result.set(asset.id, {
							lightUrl: url(revision.lightPreview, "image/png"),
							darkUrl: url(revision.darkPreview, "image/png"),
						})
				} else if (content.includes(`asset:${asset.id}`)) {
					let row = await db.one(
						app.assets.where({ id: asset.id }).select("data"),
					)
					if (row?.data && !cancelled)
						result.set(asset.id, {
							url: url(row.data, asset.mimeType ?? "application/octet-stream"),
						})
				}
				if (!cancelled) setLoaded({ key, urls: new Map(result) })
			}),
		)
			.then(() => {
				if (!cancelled) setLoaded({ key, urls: result })
			})
			.catch(console.error)
		return () => {
			cancelled = true
			urls.forEach(value => URL.revokeObjectURL(value))
		}
	}, [db, key])
	let urls =
		loaded.key === key
			? loaded.urls
			: new Map<string, { url?: string; lightUrl?: string; darkUrl?: string }>()
	let sidebarAssets = rows.map(asset => ({
		...asset,
		tldrawRevisionId: asset.revisionId ?? undefined,
		imageUrl: urls.get(asset.id)?.url,
		lightPreviewUrl: urls.get(asset.id)?.lightUrl,
		darkPreviewUrl: urls.get(asset.id)?.darkUrl,
	}))
	let editorAssets = rows.map(asset => ({
		...asset,
		previewUrl:
			urls.get(asset.id)?.url ??
			(appearance === "dark"
				? urls.get(asset.id)?.darkUrl
				: urls.get(asset.id)?.lightUrl),
		videoUrl: asset.type === "video" ? urls.get(asset.id)?.url : undefined,
	}))
	let previewAssets = rows.flatMap(asset => {
		let value = urls.get(asset.id)
		return value
			? [
					{
						id: asset.id,
						type: asset.type,
						url: value.url ?? value.lightUrl ?? "",
						lightUrl: value.lightUrl,
						darkUrl: value.darkUrl,
						muteAudio: asset.muteAudio,
					},
				]
			: []
	})
	return { rows, sidebarAssets, editorAssets, previewAssets }
}
async function uploadAsset(
	db: Database,
	documentId: string,
	file: File,
	options: {
		signal?: AbortSignal
		onProgress?: (progress: {
			phase: "compressing" | "uploading" | "done"
			progress: number
		}) => void
	} = {},
) {
	if (file.size > 2 ** 31 - 1)
		throw new Error("Files larger than 2 GB are not supported")
	let type: "image" | "video" = file.type.startsWith("video/")
		? "video"
		: "image"
	let blob: Blob = file
	let width: number | undefined
	let height: number | undefined
	let thumbnail: Uint8Array | undefined
	if (type === "image") {
		let bitmap = await createImageBitmap(file)
		try {
			let ratio = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
			width = Math.round(bitmap.width * ratio)
			height = Math.round(bitmap.height * ratio)
			blob = await resize(bitmap, width, height)
			let small = await resize(
				bitmap,
				Math.max(1, Math.round((width * 128) / Math.max(width, height))),
				Math.max(1, Math.round((height * 128) / Math.max(width, height))),
			)
			thumbnail = new Uint8Array(await small.arrayBuffer())
		} finally {
			bitmap.close()
		}
	} else {
		let { compressVideo, canEncodeVideo, VideoCompressionError } =
			await import("./video-conversion")
		if (file.size > 500 * 1024 * 1024)
			throw new VideoCompressionError("Video exceeds 500 MB", "too_large")
		if (await canEncodeVideo())
			blob = await compressVideo(file, {
				signal: options.signal,
				onProgress: value =>
					options.onProgress?.({
						phase: "compressing",
						progress: value.progress,
					}),
			})
	}
	let size = blob.size
	let uploaded = 0
	let stream = blob.stream().pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				options.signal?.throwIfAborted()
				uploaded += chunk.byteLength
				options.onProgress?.({ phase: "uploading", progress: uploaded / size })
				controller.enqueue(chunk)
			},
		}),
	)
	let write = await db.insertStreaming(app.assets, {
		documentId,
		type,
		name: file.name.replace(/\.[^.]+$/, ""),
		mimeType: blob.type,
		data: stream,
		thumbnail,
		width,
		height,
		createdAt: new Date(),
	})
	await write.wait({ tier: "local" })
	options.onProgress?.({ phase: "done", progress: 1 })
	return { id: write.value.id, name: file.name.replace(/\.[^.]+$/, "") }
}
function resize(
	image: ImageBitmap,
	width: number,
	height: number,
): Promise<Blob> {
	let canvas = document.createElement("canvas")
	canvas.width = width
	canvas.height = height
	let context = canvas.getContext("2d")
	if (!context) throw new Error("Image processing is unavailable")
	context.drawImage(image, 0, 0, width, height)
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			blob =>
				blob ? resolve(blob) : reject(new Error("Could not resize image")),
			"image/png",
		),
	)
}
async function copyDocumentAssets(
	db: Database,
	sourceId: string,
	destinationId: string,
	content: string,
) {
	let assets = await db.all(app.assets.where({ documentId: sourceId }))
	for (let asset of assets) {
		let revisionId = asset.revisionId
		if (revisionId) {
			let revision = await db.one(app.tldrawRevisions.where({ id: revisionId }))
			if (!revision) throw new Error("Whiteboard revision is unavailable")
			let write = db.insert(app.tldrawRevisions, {
				documentId: destinationId,
				snapshot: revision.snapshot,
				lightPreview: revision.lightPreview,
				darkPreview: revision.darkPreview,
				createdAt: new Date(),
			})
			await write.wait({ tier: "local" })
			revisionId = write.value.id
		}
		let write = db.insert(app.assets, {
			documentId: destinationId,
			type: asset.type,
			name: asset.name,
			data: asset.data,
			thumbnail: asset.thumbnail,
			mimeType: asset.mimeType,
			width: asset.width,
			height: asset.height,
			muteAudio: asset.muteAudio,
			revisionId,
			createdAt: asset.createdAt,
		})
		await write.wait({ tier: "local" })
		content = content.replaceAll(`asset:${asset.id}`, `asset:${write.value.id}`)
	}
	return content
}
