import { app } from "@/jazz/schema"
import { z } from "zod"
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

let rangeSchema = z.object({
	matched: z.string(),
	before: z.string(),
	after: z.string(),
	start: z.number().optional(),
	end: z.number().optional(),
})
let anchorSchema = z.object({
	quote: z.string().default(""),
	contextBefore: z.string().default(""),
	contextAfter: z.string().default(""),
	from: z.number().nullable().default(null),
	to: z.number().nullable().default(null),
})
async function exportComments(
	db: Database,
	documentId: string,
): Promise<ExportComment[]> {
	let document = await db.one(
		app.documents.where({ id: documentId }).select("content"),
	)
	let threads = await db.all(
		app.commentThreads.where({ documentId, deletedAt: null }),
	)
	return Promise.all(
		threads.map(async thread => {
			let parsed = anchorSchema.safeParse(thread.anchor)
			let anchor = parsed.success
				? parsed.data
				: {
						quote: "",
						contextBefore: "",
						contextAfter: "",
						from: null,
						to: null,
					}
			let range = rangeSchema.safeParse(thread.anchor)
			if (range.success) {
				let found = db
					.textAnchors()
					.resolveRange(range.data, document?.content ?? "")
				anchor = {
					quote: range.data.matched,
					contextBefore: range.data.before,
					contextAfter: range.data.after,
					from: found.start,
					to: found.end,
				}
			}
			let replies = await db.all(
				app.commentReplies.where({ threadId: thread.id, deletedAt: null }),
			)
			return {
				id: thread.id,
				...anchor,
				resolved: !!thread.resolvedAt,
				createdAt: thread.createdAt.toISOString(),
				updatedAt: thread.updatedAt.toISOString(),
				replies: replies.map(reply => ({
					body: reply.body,
					authorName: reply.authorName,
					createdAt: reply.createdAt.toISOString(),
					updatedAt: reply.updatedAt?.toISOString() ?? null,
				})),
			}
		}),
	)
}
async function importComments(
	db: Database,
	documentId: string,
	authorId: string,
	comments: ExportComment[],
) {
	for (let comment of comments) {
		let write = db.insert(app.commentThreads, {
			documentId,
			authorId,
			anchor: {
				matched: comment.quote,
				before: comment.contextBefore,
				after: comment.contextAfter,
				...(comment.from !== null ? { start: comment.from } : {}),
				...(comment.to !== null ? { end: comment.to } : {}),
			},
			resolvedAt: comment.resolved ? new Date(comment.updatedAt) : null,
			createdAt: new Date(comment.createdAt),
			updatedAt: new Date(comment.updatedAt),
		})
		await write.wait({ tier: "local" })
		for (let reply of comment.replies)
			await db
				.insert(app.commentReplies, {
					threadId: write.value.id,
					authorId,
					authorName: reply.authorName,
					body: reply.body,
					createdAt: new Date(reply.createdAt),
					updatedAt: reply.updatedAt ? new Date(reply.updatedAt) : null,
				})
				.wait({ tier: "local" })
	}
}
