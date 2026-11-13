import { useEffect, useState } from "react"
import { useAll, useDb } from "jazz-tools/react"
import { app } from "@/jazz/schema"
import type { EditorAsset } from "@/app/features/assets"

export { useDocumentAssets, assetViews }

function useDocumentAssets(
	documentId: string,
	appearance: "light" | "dark" = "light",
) {
	let db = useDb()
	let { data: assets } = useAll(app.assets.where({ documentId }))
	let revisionIds = (assets ?? []).flatMap(asset =>
		asset.revisionId ? [asset.revisionId] : [],
	)
	let { data: revisions } = useAll(
		app.tldrawRevisions.where({ id: { in: revisionIds } }),
	)
	let [views, setViews] = useState<EditorAsset[]>([])
	useEffect(() => {
		let result = assetViews(assets ?? [], revisions ?? [], appearance)
		let frame = requestAnimationFrame(() => setViews(result.assets))
		return () => {
			cancelAnimationFrame(frame)
			result.release()
		}
	}, [assets, revisions, db, appearance])
	return views
}
function assetViews(
	assets: {
		id: string
		name: string
		type: "image" | "video" | "tldraw"
		data: Uint8Array | null
		mimeType: string | null
		muteAudio: boolean
		revisionId: string | null
	}[],
	revisions: {
		id: string
		lightPreview: Uint8Array
		darkPreview: Uint8Array
	}[],
	appearance: "light" | "dark" = "light",
) {
	let urls: string[] = []
	function url(bytes: Uint8Array | null, type: string) {
		if (!bytes) return undefined
		let value = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
		urls.push(value)
		return value
	}
	let views: EditorAsset[] = assets.map(asset => {
		let revision = revisions.find(revision => revision.id === asset.revisionId)
		let preview =
			asset.type === "tldraw"
				? url(
						revision
							? appearance === "dark"
								? revision.darkPreview
								: revision.lightPreview
							: null,
						"image/png",
					)
				: asset.type === "image"
					? url(asset.data, asset.mimeType ?? "image/png")
					: undefined
		return {
			id: asset.id,
			name: asset.name,
			type: asset.type,
			previewUrl: preview,
			videoUrl:
				asset.type === "video"
					? url(asset.data, asset.mimeType ?? "video/mp4")
					: undefined,
			muteAudio: asset.muteAudio,
		}
	})
	return {
		assets: views,
		release() {
			for (let value of urls) URL.revokeObjectURL(value)
		},
	}
}
