import { z as schemaValidator } from "zod"
import type { Db } from "jazz-tools/backend"
import { app, type DocumentRow } from "@/jazz/schema"
export { findComment, summarizeComment }

async function findComment(db: Db, documentId: string, commentId: string) {
	let thread = await db.one(
		app.commentThreads.where({ id: commentId, documentId, deletedAt: null }),
	)
	if (!thread) throw new Error("Comment not found")
	return thread
}

let textRangeSchema = schemaValidator.object({
	version: schemaValidator.number().optional(),
	start: schemaValidator.number().optional(),
	end: schemaValidator.number().optional(),
	before: schemaValidator.string(),
	matched: schemaValidator.string(),
	after: schemaValidator.string(),
})
async function summarizeComment(
	db: Db,
	document: DocumentRow,
	thread: NonNullable<Awaited<ReturnType<typeof findComment>>>,
) {
	let anchor = textRangeSchema.parse(thread.anchor)
	let range = db.textAnchors().resolveRange(anchor, document.content)
	let orphaned = range.confidence === 0 || range.ambiguous
	let replies = await db.all(
		app.commentReplies.where({ threadId: thread.id, deletedAt: null }),
	)
	return {
		commentId: thread.id,
		quote: anchor.matched,
		from: orphaned ? null : range.start,
		to: orphaned ? null : range.end,
		orphaned,
		resolved: Boolean(thread.resolvedAt),
		createdAt: thread.createdAt.toISOString(),
		updatedAt: thread.updatedAt.toISOString(),
		replies: replies
			.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
			.map(reply => ({
				replyId: reply.id,
				body: reply.body,
				authorName: reply.authorName ?? null,
				createdAt: reply.createdAt.toISOString(),
			})),
	}
}
