import { useEffect } from "react"
import type { co } from "jazz-tools"
import { Document } from "../lib/schema"
import {
	compactDocumentContent,
	getOwnDocumentContentTransactionCount,
	reconcileArchivedDocumentContent,
} from "../lib/document-generations"

export { useDocumentCompaction }

let COMPACTION_QUIET_MS = 30_000

type LoadedDocument = co.loaded<
	typeof Document,
	{ content: true; comments: { $each: true }; cursors: true }
>

function useDocumentCompaction(doc: LoadedDocument | null, enabled: boolean) {
	let contentId = doc?.content.$jazz.id
	let ownTransactionCount = doc ? getOwnDocumentContentTransactionCount(doc) : 0

	useEffect(() => {
		if (!enabled || !doc) return
		let timeout = setTimeout(() => {
			void compactDocumentContent(doc)
		}, COMPACTION_QUIET_MS)
		return () => clearTimeout(timeout)
	}, [doc, enabled, contentId, ownTransactionCount])

	useEffect(() => {
		if (!enabled || !doc?.archivedContent) return
		let timeout = setTimeout(() => {
			void reconcileArchivedDocumentContent(doc)
		}, 10_000)
		return () => clearTimeout(timeout)
	}, [doc, enabled, contentId])
}
