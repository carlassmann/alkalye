import { useAll, useDb } from "jazz-tools/react"
import { schema } from "jazz-tools"
import { z } from "zod"
import { diff } from "fast-myers-diff"
import { app, type DocumentRow } from "@/jazz/schema"
import type { Database } from "@/app/features/documents/lib/library"
import {
	countOccurrences,
	findBestTextOccurrence,
} from "@/app/features/documents/lib/comment-text-match"

export {
	useComments,
	loadCommentDocument,
	createCommentThread,
	createCommentThreadFromQuote,
	createCommentThreadFromQuoteOccurrence,
	addCommentReply,
	resolveCommentThread,
	reopenCommentThread,
	deleteCommentThread,
	areCommentsEnabled,
	setCommentsEnabled,
	getCommentRange,
	getVisibleCommentThreads,
	getUnresolvedCommentCount,
	getExportComments,
	getExportCommentsForContent,
	restoreExportedComments,
	recoverRange,
	mapCommentRangeAcrossContent,
}
export type { LoadedCommentDocument, ExportComment, CommentRange }

type CommentRange = { from: number; to: number; orphaned: boolean }
type RecoveredRange = { from: number; to: number }
let MAX_ANCHOR_QUOTE_LENGTH = 1_000
let textRange = z.object({
	version: z.number().optional(),
	start: z.number().optional(),
	end: z.number().optional(),
	before: z.string(),
	matched: z.string(),
	after: z.string(),
})
let commentAnchor = z.object({
	range: textRange.optional(),
	quote: z.string(),
	originalQuote: z.string().optional(),
	contextBefore: z.string(),
	contextAfter: z.string(),
})
type CommentAnchorData = z.infer<typeof commentAnchor>
type LoadedCommentThread = Omit<
	schema.RowOf<typeof app.commentThreads>,
	"anchor"
> & {
	anchor: CommentAnchorData
	replies: schema.RowOf<typeof app.commentReplies>[]
	db: Database
}
type LoadedCommentDocument = Pick<
	DocumentRow,
	"id" | "content" | "commentsDisabled"
> & { db: Database; comments: LoadedCommentThread[] }

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

function useComments(
	doc: Pick<DocumentRow, "id" | "content" | "commentsDisabled">,
): LoadedCommentDocument {
	let db = useDb()
	let { data: threads = [] } = useAll(
		app.commentThreads.where({ documentId: doc.id }),
	)
	let { data: replies = [] } = useAll(
		app.commentReplies.where({
			threadId: { in: threads.map(thread => thread.id) },
		}),
	)
	return assembleCommentDocument(db, doc, threads, replies)
}
async function loadCommentDocument(
	db: Database,
	doc: Pick<DocumentRow, "id" | "content" | "commentsDisabled">,
) {
	let threads = await db.all(app.commentThreads.where({ documentId: doc.id }))
	let replies = await db.all(
		app.commentReplies.where({
			threadId: { in: threads.map(thread => thread.id) },
		}),
	)
	return assembleCommentDocument(db, doc, threads, replies)
}
function assembleCommentDocument(
	db: Database,
	doc: Pick<DocumentRow, "id" | "content" | "commentsDisabled">,
	threads: schema.RowOf<typeof app.commentThreads>[],
	replies: schema.RowOf<typeof app.commentReplies>[],
): LoadedCommentDocument {
	return {
		...doc,
		db,
		comments: threads.flatMap(thread => {
			let anchor = commentAnchor.safeParse(thread.anchor)
			return [
				{
					...thread,
					anchor: anchor.success
						? anchor.data
						: { quote: "", contextBefore: "", contextAfter: "" },
					db,
					replies: replies
						.filter(reply => reply.threadId === thread.id && !reply.deletedAt)
						.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
				},
			]
		}),
	}
}

function createCommentThread(
	doc: LoadedCommentDocument,
	selection: { from: number; to: number },
	body: string,
	authorName?: string,
) {
	if (!areCommentsEnabled(doc) || !body.trim()) return null
	let from = Math.max(
		0,
		Math.min(doc.content.length, selection.from, selection.to),
	)
	let to = Math.min(doc.content.length, Math.max(selection.from, selection.to))
	if (from === to) return null
	let id = crypto.randomUUID()
	let now = new Date()
	let authorId = doc.db.getAuthState().session?.user
	if (!authorId) return null
	void doc.db.transaction(tx => {
		tx.insert(
			app.commentThreads,
			{
				documentId: doc.id,
				authorId,
				anchor: makeAnchor(doc, from, to),
				createdAt: now,
				updatedAt: now,
			},
			{ id },
		)
		tx.insert(app.commentReplies, {
			threadId: id,
			authorId,
			body: body.trim(),
			authorName: authorName?.trim() || null,
			createdAt: now,
		})
	})
	return { id }
}

function createCommentThreadFromQuote(
	doc: LoadedCommentDocument,
	quote: string,
	body: string,
	authorName?: string,
) {
	return createCommentThreadFromQuoteOccurrence(doc, quote, 0, body, authorName)
}
function createCommentThreadFromQuoteOccurrence(
	doc: LoadedCommentDocument,
	quote: string,
	occurrence: number,
	body: string,
	authorName?: string,
) {
	let from = findNthOccurrence(doc.content, quote.trim(), occurrence)
	if (from < 0 || !quote.trim()) return null
	return createCommentThread(
		doc,
		{ from, to: from + quote.trim().length },
		body,
		authorName,
	)
}
function addCommentReply(
	thread: LoadedCommentThread,
	body: string,
	authorName?: string,
) {
	let authorId = thread.db.getAuthState().session?.user
	if (!body.trim() || !authorId) return
	let now = new Date()
	return thread.db.transaction(tx => {
		tx.insert(app.commentReplies, {
			threadId: thread.id,
			authorId,
			body: body.trim(),
			authorName: authorName?.trim() || null,
			createdAt: now,
		})
		tx.update(app.commentThreads, thread.id, { updatedAt: now })
	})
}
function resolveCommentThread(thread: LoadedCommentThread) {
	return thread.db.update(app.commentThreads, thread.id, {
		resolvedAt: new Date(),
		updatedAt: new Date(),
	})
}
function reopenCommentThread(thread: LoadedCommentThread) {
	return thread.db.update(app.commentThreads, thread.id, {
		resolvedAt: null,
		updatedAt: new Date(),
	})
}
function deleteCommentThread(thread: LoadedCommentThread) {
	return thread.db.update(app.commentThreads, thread.id, {
		deletedAt: new Date(),
		updatedAt: new Date(),
	})
}
function areCommentsEnabled(doc: Pick<DocumentRow, "commentsDisabled">) {
	return !doc.commentsDisabled
}
function setCommentsEnabled(doc: LoadedCommentDocument, enabled: boolean) {
	return doc.db.update(app.documents, doc.id, {
		commentsDisabled: !enabled,
		updatedAt: new Date(),
	})
}
function getVisibleCommentThreads(doc: LoadedCommentDocument) {
	return areCommentsEnabled(doc)
		? doc.comments
				.filter(thread => !thread.deletedAt)
				.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
		: []
}
function getUnresolvedCommentCount(doc: LoadedCommentDocument) {
	return getVisibleCommentThreads(doc).filter(thread => !thread.resolvedAt)
		.length
}
function makeAnchor(
	doc: LoadedCommentDocument,
	from: number,
	to: number,
): CommentAnchorData {
	return {
		range: doc.db.textAnchors().captureRange(doc.content, from, to),
		quote: doc.content.slice(from, to).slice(0, MAX_ANCHOR_QUOTE_LENGTH),
		contextBefore: doc.content.slice(Math.max(0, from - 80), from),
		contextAfter: doc.content.slice(to, to + 80),
	}
}
function getCommentRange(
	doc: LoadedCommentDocument,
	anchor: CommentAnchorData,
): CommentRange {
	if (anchor.range) {
		let found = doc.db.textAnchors().resolveRange(anchor.range, doc.content)
		if (!found.ambiguous && found.confidence >= 0.8 && found.end > found.start)
			return { from: found.start, to: found.end, orphaned: false }
	}
	if (anchor.range) {
		let recovered = recoverRange(doc.content, anchor)
		if (!recovered) return orphanedRange()
		let before = anchor.contextBefore.slice(-12),
			after = anchor.contextAfter.slice(0, 12)
		let matchesBefore =
			!!before.trim() && doc.content.slice(0, recovered.from).endsWith(before)
		let matchesAfter =
			!!after.trim() && doc.content.slice(recovered.to).startsWith(after)
		return matchesBefore || matchesAfter
			? { ...recovered, orphaned: false }
			: orphanedRange()
	}

	let recovered = recoverRange(doc.content, anchor)
	return recovered ? { ...recovered, orphaned: false } : orphanedRange()
}
function recoverRange(
	content: string,
	anchor: CommentAnchorData,
): RecoveredRange | null {
	if (!anchor.quote) return null
	let count = countOccurrences(content, anchor.quote)
	if (count === 1) {
		let from = content.indexOf(anchor.quote)
		return { from, to: from + anchor.quote.length }
	}
	if (count > 1) {
		let match = anchor.contextBefore + anchor.quote + anchor.contextAfter
		if (match === anchor.quote || countOccurrences(content, match) !== 1)
			return null
		let from = findBestTextOccurrence(content, anchor.quote, {
			...anchor,
			occurrence: 0,
		})
		return from < 0 ? null : { from, to: from + anchor.quote.length }
	}
	// Fuzzy matching is confined to a unique context window to avoid moving a comment elsewhere.
	let before = anchor.contextBefore.trim(),
		after = anchor.contextAfter.trim()
	if (
		!before ||
		!after ||
		countOccurrences(content, before) !== 1 ||
		countOccurrences(content, after) !== 1
	)
		return null
	let from = content.indexOf(before) + before.length,
		to = content.indexOf(after, from)
	if (to < from) return null
	let tokens = anchor.quote.match(/[^\s]+/g) ?? []
	let first = -1,
		end = from
	for (let token of tokens) {
		let index = content.indexOf(token, end)
		if (index < 0 || index + token.length > to) return null
		if (first < 0) first = index
		end = index + token.length
	}
	return first < 0 ? null : { from: first, to: end }
}
function getExportComments(doc: LoadedCommentDocument): ExportComment[] {
	return getExportCommentsForContent(doc, doc.content)
}
function getExportCommentsForContent(
	doc: LoadedCommentDocument,
	transformedContent: string,
): ExportComment[] {
	return doc.comments
		.filter(thread => !thread.deletedAt)
		.map(thread => {
			let range = mapCommentRangeAcrossContent(
				doc.content,
				transformedContent,
				getCommentRange(doc, thread.anchor),
			)
			return {
				id: thread.id,
				quote: range.orphaned
					? thread.anchor.quote
					: transformedContent.slice(range.from, range.to) ||
						thread.anchor.quote,
				contextBefore: range.orphaned
					? thread.anchor.contextBefore
					: transformedContent.slice(Math.max(0, range.from - 80), range.from),
				contextAfter: range.orphaned
					? thread.anchor.contextAfter
					: transformedContent.slice(range.to, range.to + 80),
				from: range.orphaned ? null : range.from,
				to: range.orphaned ? null : range.to,
				resolved: !!thread.resolvedAt,
				createdAt: thread.createdAt.toISOString(),
				updatedAt: thread.updatedAt.toISOString(),
				replies: thread.replies.map(reply => ({
					body: reply.body,
					authorName: reply.authorName,
					createdAt: reply.createdAt.toISOString(),
					updatedAt: reply.updatedAt?.toISOString() ?? null,
				})),
			}
		})
}
async function restoreExportedComments(
	doc: LoadedCommentDocument,
	comments: ExportComment[],
	sourceContent?: string,
) {
	let authorId = doc.db.getAuthState().session?.user
	if (
		!authorId ||
		(!doc.comments.length && !comments.some(comment => comment.replies.length))
	)
		return
	let write = await doc.db.transaction(tx => {
		for (let thread of doc.comments) tx.delete(app.commentThreads, thread.id)
		for (let comment of comments) {
			if (!comment.replies.length) continue
			let range =
				sourceContent && comment.from !== null && comment.to !== null
					? mapCommentRangeAcrossContent(sourceContent, doc.content, {
							from: comment.from,
							to: comment.to,
							orphaned: false,
						})
					: null
			let recovered = recoverRange(doc.content, comment)
			let anchor =
				range && !range.orphaned
					? makeAnchor(doc, range.from, range.to)
					: recovered
						? makeAnchor(doc, recovered.from, recovered.to)
						: {
								quote: comment.quote,
								contextBefore: comment.contextBefore,
								contextAfter: comment.contextAfter,
							}
			let thread = tx.insert(app.commentThreads, {
				documentId: doc.id,
				authorId,
				anchor,
				createdAt: new Date(comment.createdAt),
				updatedAt: new Date(comment.updatedAt),
				resolvedAt: comment.resolved ? new Date(comment.updatedAt) : null,
			})
			for (let reply of comment.replies)
				tx.insert(app.commentReplies, {
					threadId: thread.id,
					authorId,
					body: reply.body,
					authorName: reply.authorName,
					createdAt: new Date(reply.createdAt),
					updatedAt: reply.updatedAt ? new Date(reply.updatedAt) : null,
				})
		}
	})
	await write.wait({ tier: "local" })
}
function mapCommentRangeAcrossContent(
	oldContent: string,
	newContent: string,
	range: CommentRange,
): CommentRange {
	return mapCommentRange(
		range,
		getContentChanges(oldContent, newContent),
		newContent,
	)
}
type DiffChange = {
	fromA: number
	toA: number
	fromB: number
	toB: number
}

function getContentChanges(oldContent: string, newContent: string) {
	let changedSpan = getChangedContentSpan(oldContent, newContent)
	let changedLength = Math.max(
		changedSpan.toA - changedSpan.fromA,
		changedSpan.toB - changedSpan.fromB,
	)
	if (changedLength > 4_000) return [changedSpan]
	return Array.from(diff(oldContent, newContent)).map(
		([fromA, toA, fromB, toB]) => ({ fromA, toA, fromB, toB }),
	)
}

function getChangedContentSpan(oldContent: string, newContent: string) {
	let prefix = 0
	let sharedLength = Math.min(oldContent.length, newContent.length)
	while (prefix < sharedLength && oldContent[prefix] === newContent[prefix]) {
		prefix++
	}

	let suffix = 0
	while (
		suffix < sharedLength - prefix &&
		oldContent[oldContent.length - suffix - 1] ===
			newContent[newContent.length - suffix - 1]
	) {
		suffix++
	}
	return {
		fromA: prefix,
		toA: oldContent.length - suffix,
		fromB: prefix,
		toB: newContent.length - suffix,
	}
}

function orphanedRange(): CommentRange {
	return { from: 0, to: 0, orphaned: true }
}

function findNthOccurrence(content: string, text: string, occurrence: number) {
	let index = -1
	let from = 0
	for (let i = 0; i <= occurrence; i++) {
		index = content.indexOf(text, from)
		if (index < 0) return -1
		from = index + text.length
	}
	return index
}

function mapCommentRange(
	range: CommentRange,
	changes: DiffChange[],
	content: string,
): CommentRange {
	if (range.orphaned) return range

	let mapped = mapRangeEdges(range, changes)
	if (mapped.to >= mapped.from) return collapseBlankRange(mapped, content)
	let repaired = repairInvertedRange(mapped, range, changes)
	if (repaired.to - repaired.from > MAX_ANCHOR_QUOTE_LENGTH) {
		return orphanedRange()
	}
	return collapseBlankRange(repaired, content)
}

function mapRangeEdges(range: RecoveredRange, changes: DiffChange[]) {
	return {
		from: mapPosition(range.from, changes, 1),
		to: mapPosition(range.to, changes, -1),
	}
}

function repairInvertedRange(
	mapped: RecoveredRange,
	original: RecoveredRange,
	changes: DiffChange[],
) {
	if (mapped.to >= mapped.from) return mapped

	let replacement = changes.find(
		change => change.fromA < original.to && change.toA > original.from,
	)
	if (replacement) {
		return { from: replacement.fromB, to: replacement.toB }
	}
	return { from: mapped.from, to: mapped.from }
}

function collapseBlankRange(
	range: RecoveredRange,
	content: string,
): CommentRange {
	if (content.slice(range.from, range.to).trim() === "") {
		return { from: range.from, to: range.from, orphaned: false }
	}
	return { ...range, orphaned: false }
}

function mapPosition(pos: number, changes: DiffChange[], assoc: -1 | 1) {
	let mapped = pos
	let offset = 0

	for (let change of changes) {
		if (pos < change.fromA) break

		let removed = change.toA - change.fromA
		let inserted = change.toB - change.fromB

		if (pos > change.toA || (pos === change.toA && assoc > 0)) {
			offset += inserted - removed
			mapped = pos + offset
			continue
		}

		let insideOffset = assoc < 0 ? 0 : inserted
		return change.fromB + insideOffset
	}

	return mapped
}
