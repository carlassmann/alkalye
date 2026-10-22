import {
	interactionWork,
	yieldBackgroundWork,
} from "@/app/lib/interaction-work"
import { useEffect, useRef } from "react"
import { co } from "jazz-tools"
import { Document } from "../lib/schema"
import {
	backfillDocumentMetadata,
	needsMetadataBackfill,
} from "../lib/metadata"
import { canEdit } from "@/app/features/sharing"

export { useMetadataBackfillQueue }

type MetadataBackfillDocument = co.loaded<typeof Document>

function useMetadataBackfillQueue(docs: MetadataBackfillDocument[]) {
	let docsRef = useRef(docs)
	docsRef.current = docs
	let pendingIds = docs
		.filter(doc => needsMetadataBackfill(doc) && canEdit(doc))
		.map(doc => doc.$jazz.id)
		.join(",")

	useEffect(() => {
		let cancelled = false
		let cancellation = new AbortController()
		let timer = setTimeout(() => void backfillDocuments(), 800)
		return () => {
			cancelled = true
			cancellation.abort()
			clearTimeout(timer)
		}

		async function backfillDocuments() {
			await interactionWork.waitForIdle(10_000, cancellation.signal)
			if (cancelled) return
			let candidates = docsRef.current.filter(
				doc => needsMetadataBackfill(doc) && canEdit(doc),
			)
			let sliceStartedAt = performance.now()
			for (let doc of candidates) {
				if (performance.now() - sliceStartedAt >= 16) {
					await yieldBackgroundWork()
					sliceStartedAt = performance.now()
				}
				if (cancelled) return
				await backfillMetadata(doc)
			}
		}
	}, [pendingIds])
}

async function backfillMetadata(doc: MetadataBackfillDocument) {
	if (!needsMetadataBackfill(doc) || !canEdit(doc)) return

	let loaded = await doc.$jazz.ensureLoaded({ resolve: { content: true } })
	if (!needsMetadataBackfill(loaded) || !canEdit(loaded)) return

	backfillDocumentMetadata(loaded)
}
