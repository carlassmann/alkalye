import { useEffect, useRef } from "react"
import type { co } from "jazz-tools"
import { Document } from "../lib/schema"
import {
	compactDocumentContent,
	getOwnDocumentContentTransactionCount,
	reconcileArchivedDocumentContent,
} from "../lib/document-generations"
import { syncDocumentMetadata } from "../lib/metadata"

export { useDocumentCompaction }

let COMPACTION_QUIET_MS = 30_000

type LoadedDocument = co.loaded<
	typeof Document,
	{ content: true; comments: { $each: true }; cursors: true }
>

function useDocumentCompaction(doc: LoadedDocument, enabled: boolean) {
	let contentId = doc.content.$jazz.id
	let ownTransactionCount = getOwnDocumentContentTransactionCount(doc)
	let recordedTransactionCount = useRef(ownTransactionCount)

	useEffect(() => {
		if (!enabled) return
		let timeout = setTimeout(() => {
			if (recordedTransactionCount.current !== ownTransactionCount) {
				recordedTransactionCount.current = ownTransactionCount
				doc.$jazz.set("updatedAt", new Date())
				syncDocumentMetadata(doc)
			}
			void compactDocumentContent(doc)
		}, COMPACTION_QUIET_MS)
		return () => clearTimeout(timeout)
	}, [doc, enabled, contentId, ownTransactionCount])

	useEffect(() => {
		if (!enabled || !doc.archivedContent) return
		let timeout = setTimeout(() => {
			void reconcileArchivedDocumentContent(doc)
		}, 10_000)
		return () => clearTimeout(timeout)
	}, [doc, enabled, contentId])
}
