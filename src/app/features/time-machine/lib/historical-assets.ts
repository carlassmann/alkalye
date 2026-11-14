import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useDb } from "jazz-tools/react"
import { app } from "@/jazz/schema"
import { assetViews } from "@/app/features/documents"
import type { EditorAsset } from "@/app/features/assets"
import { getAssetsAtTime } from "./time-machine"

export { useHistoricalEditorAssets }

function useHistoricalEditorAssets(
	documentId: string,
	timestamp: number,
	appearance: "light" | "dark",
) {
	let db = useDb(),
		[assets, setAssets] = useState<EditorAsset[]>([])
	useEffect(() => {
		let cancelled = false,
			release = () => {}
		void getAssetsAtTime(db, documentId, timestamp)
			.then(async rows => {
				let revisions = await db.all(
					app.tldrawRevisions.where({
						id: {
							in: rows.flatMap(row => (row.revisionId ? [row.revisionId] : [])),
						},
					}),
				)
				if (cancelled) return
				let result = assetViews(rows, revisions, appearance)
				release = result.release
				setAssets(result.assets)
			})
			.catch(error => {
				if (!cancelled)
					toast.error(
						error instanceof Error
							? error.message
							: "Could not load historical assets",
					)
			})
		return () => {
			cancelled = true
			release()
		}
	}, [db, documentId, timestamp, appearance])
	return assets
}
