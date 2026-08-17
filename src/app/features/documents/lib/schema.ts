import { co, z } from "jazz-tools"
import { Asset } from "@/app/features/assets/lib/schema"

export {
	Document,
	CursorEntry,
	CursorFeed,
	HighlightRange,
	CommentTextPosition,
	CommentAnchor,
	CommentReply,
	CommentThread,
	ArchivedDocumentContent,
}

let CursorEntry = z.object({
	position: z.number(),
	selectionEnd: z.number().optional(),
})

let CursorFeed = co.feed(CursorEntry)

let HighlightRange = z.object({
	start: z.number(),
	end: z.number(),
})

let CommentTextPosition = z.string()

let CommentAnchor = z.object({
	start: CommentTextPosition.optional(),
	end: CommentTextPosition.optional(),
	quote: z.string(),
	originalQuote: z.string().optional(),
	contextBefore: z.string(),
	contextAfter: z.string(),
	collapsed: z.boolean().optional(),
})

let CommentReply = co.map({
	body: z.string(),
	authorName: z.string().optional(),
	createdAt: z.date(),
	updatedAt: z.date().optional(),
	deletedAt: z.date().optional(),
})

let CommentThread = co.map({
	anchor: CommentAnchor,
	replies: co.list(CommentReply),
	resolvedAt: z.date().optional(),
	deletedAt: z.date().optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
})

let ArchivedDocumentContent = co.map({
	content: co.plainText(),
	successor: co.optional(co.plainText()),
	cutoverFrontier: z.record(z.string(), z.number()),
	reconciledFrontier: z.record(z.string(), z.number()).optional(),
	successorSeedFrontier: z.record(z.string(), z.number()).optional(),
	successorReconciledFrontier: z.record(z.string(), z.number()).optional(),
	replaced: z.boolean().optional(),
	cutoverAt: z.date(),
	successorId: z.string(),
})

let Document = co.map({
	version: z.literal(1),
	content: co.plainText(),
	archivedContent: co.optional(co.list(ArchivedDocumentContent)),
	title: z.string().optional(),
	pinned: z.boolean().optional(),
	path: z.string().optional(),
	tags: z.array(z.string()).optional(),
	isPresentation: z.boolean().optional(),
	contentUpdatedAt: z.date().optional(),
	metadataUpdatedAt: z.date().optional(),
	assets: co.optional(co.list(Asset)),
	cursors: co.optional(CursorFeed),
	comments: co.optional(co.list(CommentThread)),
	commentsDisabled: z.boolean().optional(),
	deletedAt: z.date().optional(),
	presentationLine: z.number().optional(),
	highlightRange: HighlightRange.optional(),
	spaceId: z.string().optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
})
