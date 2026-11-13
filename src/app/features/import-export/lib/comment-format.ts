import { app } from "@/jazz/schema"
import {
	loadCommentDocument,
	getExportComments,
	restoreExportedComments,
} from "@/app/features/comments"
import type { Database } from "@/app/features/documents/lib/library"
export { exportComments, importComments }
export type { ExportComment }
type ExportComment = {
	id: string
	quote: string
	contextBefore: string
	contextAfter: string
	from: number | null
	to: number | null
	resolved: boolean
	createdAt: string
	updatedAt: string
	replies: {
		body: string
		authorName: string | null
		createdAt: string
		updatedAt: string | null
	}[]
}

async function exportComments(
	db: Database,
	documentId: string,
): Promise<ExportComment[]> {
	let document = await db.one(app.documents.where({ id: documentId }))
	if (!document) return []
	return getExportComments(await loadCommentDocument(db, document))
}
async function importComments(
	db: Database,
	documentId: string,
	_authorId: string,
	comments: ExportComment[],
	sourceContent?: string,
) {
	let document = await db.one(app.documents.where({ id: documentId }))
	if (!document) throw new Error("Document is unavailable")
	await restoreExportedComments(
		await loadCommentDocument(db, document),
		comments,
		sourceContent,
	)
}
