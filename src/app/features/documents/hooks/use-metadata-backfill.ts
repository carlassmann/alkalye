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
		let timer = setTimeout(() => void backfillDocuments(), 800)
		return () => {
			cancelled = true
			clearTimeout(timer)
		}

		async function backfillDocuments() {
			let candidates = docsRef.current.filter(
				doc => needsMetadataBackfill(doc) && canEdit(doc),
			)
			for (let doc of candidates) {
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
