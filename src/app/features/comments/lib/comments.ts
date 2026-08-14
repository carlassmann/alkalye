import { co } from "jazz-tools"
import type { TextPos } from "jazz-tools"
import { stringifyOpID } from "cojson"
import { diff } from "fast-myers-diff"
import { CommentReply, CommentThread, Document } from "@/schema"
import { syncDocumentMetadata } from "@/app/features/documents/lib/metadata"

export {
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
	cloneCommentThreads,
	copyCommentsAndApplyContent,
	applyContentDiffWithCommentAnchors,
	applyContentDiffLoadingCommentAnchors,
	replaceDocumentContentPreservingAnchors,
	recoverRange,
	mapCommentRangeAcrossContent,
	type LoadedCommentDocument,
	type LoadedAnchorDocument,
	type CommentRange,
	type ExportComment,
}

type CommentResolve = {
	content: true
	comments: { $each: { replies: true } }
}

type LoadedCommentDocument = co.loaded<typeof Document, CommentResolve>
type LoadedCommentThread = co.loaded<typeof CommentThread, { replies: true }>
type LoadedAnchorDocument = co.loaded<
	typeof Document,
	{ content: true; comments: { $each: true } }
>

type CommentRange = {
	from: number
	to: number
	orphaned: boolean
}

type RecoveredRange = {
	from: number
	to: number
}

type RangeRecovery = (
	content: string,
	anchor: CommentAnchorData,
) => RecoveredRange | null

type CommentAnchorData = {
	start?: string
	end?: string
	quote: string
	originalQuote?: string
	contextBefore: string
	contextAfter: string
	collapsed?: boolean
}

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

function createCommentThread(
	doc: LoadedCommentDocument,
	selection: { from: number; to: number },
	body: string,
	authorName?: string,
) {
	if (!areCommentsEnabled(doc)) return null

	let content = doc.content.toString()
	let from = Math.min(
		content.length,
		Math.max(0, Math.min(selection.from, selection.to)),
	)
	let to = Math.min(content.length, Math.max(selection.from, selection.to))
	let text = body.trim()

	if (from === to || !text) return null

	let comments = ensureComments(doc)
	if (!comments?.$isLoaded) return null

	let now = new Date()
	let reply = CommentReply.create(
		{ body: text, authorName: cleanAuthorName(authorName), createdAt: now },
		doc.$jazz.owner,
	)
	let thread = CommentThread.create(
		{
			anchor: makeAnchor(doc, from, to),
			replies: co.list(CommentReply).create([reply], doc.$jazz.owner),
			createdAt: now,
			updatedAt: now,
		},
		doc.$jazz.owner,
	)

	comments.$jazz.push(thread)
	doc.$jazz.set("updatedAt", now)
	syncDocumentMetadata(doc, { contentChanged: false })
	return thread
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
	if (!areCommentsEnabled(doc)) return null

	let content = doc.content.toString()
	let selected = quote.trim()
	if (!selected) return null

	let from = findNthOccurrence(content, selected, occurrence)
	if (from < 0) return null

	return createCommentThread(
		doc,
		{ from, to: from + selected.length },
		body,
		authorName,
	)
}

function restoreExportedComments(
	doc: LoadedCommentDocument,
	comments: ExportComment[],
	sourceContent?: string,
) {
	let threads = co.list(CommentThread).create([], doc.$jazz.owner)
	let targetContent = doc.content.toString()
	let changes = sourceContent
		? getContentChanges(sourceContent, targetContent)
		: getContentChanges(targetContent, targetContent)

	for (let comment of comments) {
		let range = getRestoredCommentRange(comment, targetContent, changes)
		let replies = co.list(CommentReply).create([], doc.$jazz.owner)
		for (let reply of comment.replies) {
			replies.$jazz.push(
				CommentReply.create(
					{
						body: reply.body,
						authorName: reply.authorName ?? undefined,
						createdAt: new Date(reply.createdAt),
						updatedAt: reply.updatedAt ? new Date(reply.updatedAt) : undefined,
					},
					doc.$jazz.owner,
				),
			)
		}
		if (replies.length === 0) continue
		let anchor = range.orphaned
			? {
					quote: comment.quote,
					contextBefore: comment.contextBefore,
					contextAfter: comment.contextAfter,
					originalQuote: comment.quote,
					start: undefined,
					end: undefined,
				}
			: makeAnchor(doc, range.from, range.to, {
					quote: comment.quote,
					contextBefore: comment.contextBefore,
					contextAfter: comment.contextAfter,
					originalQuote: comment.quote,
				})
		threads.$jazz.push(
			CommentThread.create(
				{
					anchor,
					replies,
					resolvedAt: comment.resolved
						? new Date(comment.updatedAt)
						: undefined,
					createdAt: new Date(comment.createdAt),
					updatedAt: new Date(comment.updatedAt),
				},
				doc.$jazz.owner,
			),
		)
	}

	doc.$jazz.set("comments", threads)
}

function addCommentReply(
	thread: co.loaded<typeof CommentThread, { replies: true }>,
	body: string,
	authorName?: string,
) {
	let text = body.trim()
	if (!text || !thread.replies?.$isLoaded) return
	let now = new Date()
	thread.replies.$jazz.push(
		CommentReply.create(
			{ body: text, authorName: cleanAuthorName(authorName), createdAt: now },
			thread.$jazz.owner,
		),
	)
	thread.$jazz.set("updatedAt", now)
}

function resolveCommentThread(thread: co.loaded<typeof CommentThread>) {
	let now = new Date()
	thread.$jazz.set("resolvedAt", now)
	thread.$jazz.set("updatedAt", now)
}

function reopenCommentThread(thread: co.loaded<typeof CommentThread>) {
	let now = new Date()
	thread.$jazz.set("resolvedAt", undefined)
	thread.$jazz.set("updatedAt", now)
}

function deleteCommentThread(thread: co.loaded<typeof CommentThread>) {
	let now = new Date()
	thread.$jazz.set("deletedAt", now)
	thread.$jazz.set("updatedAt", now)
}

function getVisibleCommentThreads(doc: LoadedCommentDocument) {
	if (!areCommentsEnabled(doc)) return []
	return getActiveCommentThreads(doc)
}

function getUnresolvedCommentCount(doc: co.loaded<typeof Document>) {
	if (!areCommentsEnabled(doc)) return 0
	if (!doc.comments?.$isLoaded) return 0
	let count = 0
	for (let thread of doc.comments.values()) {
		if (thread?.$isLoaded && !thread.deletedAt && !thread.resolvedAt) count++
	}
	return count
}

function areCommentsEnabled(doc: co.loaded<typeof Document>) {
	return doc.commentsDisabled !== true
}

function setCommentsEnabled(doc: co.loaded<typeof Document>, enabled: boolean) {
	doc.$jazz.set("commentsDisabled", enabled ? undefined : true)
	doc.$jazz.set("updatedAt", new Date())
}

function getCommentRange(
	doc: co.loaded<typeof Document, { content: true }>,
	anchor: CommentAnchorData,
): CommentRange {
	let tracked = getTrackedCommentRange(doc, anchor)
	if (tracked) return tracked

	let recovered = recoverRange(doc.content.toString(), anchor)
	if (recovered) return { ...recovered, orphaned: false }

	return orphanedRange()
}

function applyContentDiffWithCommentAnchors(
	doc: LoadedAnchorDocument,
	newContent: string,
) {
	let oldContent = doc.content.toString()
	if (oldContent === newContent) return

	let changes = getContentChanges(oldContent, newContent)
	let updates = getActiveCommentAnchorThreads(doc).map(thread => ({
		thread,
		range: mapCommentRange(
			getCommentRange(doc, thread.anchor),
			changes,
			newContent,
		),
	}))

	doc.content.$jazz.applyDiff(newContent)

	for (let update of updates) {
		if (update.range.orphaned) continue
		update.thread.$jazz.set(
			"anchor",
			makeAnchor(doc, update.range.from, update.range.to, update.thread.anchor),
		)
	}
}

function replaceDocumentContentPreservingAnchors(
	doc: LoadedAnchorDocument,
	content: co.loaded<ReturnType<typeof co.plainText>>,
) {
	let updates = getActiveCommentAnchorThreads(doc).map(thread => ({
		thread,
		range: getCommentRange(doc, thread.anchor),
	}))

	doc.$jazz.set("content", content)

	for (let update of updates) {
		if (update.range.orphaned) continue
		update.thread.$jazz.set(
			"anchor",
			makeAnchor(doc, update.range.from, update.range.to, update.thread.anchor),
		)
	}
}

// For callers holding a document whose comments may still be streaming in:
// anchors can only be remapped for loaded threads, so load them first.
async function applyContentDiffLoadingCommentAnchors(
	doc: co.loaded<typeof Document, { content: true }>,
	newContent: string,
) {
	let withComments = await doc.$jazz.ensureLoaded({
		resolve: { content: true, comments: { $each: true } },
	})
	applyContentDiffWithCommentAnchors(withComments, newContent)
}

async function copyCommentsAndApplyContent(
	sourceDoc: co.loaded<typeof Document>,
	targetDoc: co.loaded<typeof Document>,
	newContent: string,
	options: { copyComments?: boolean } = {},
) {
	let copyComments = options.copyComments ?? true
	let source = await sourceDoc.$jazz.ensureLoaded({
		resolve: { content: true, comments: { $each: { replies: true } } },
	})
	let target = await targetDoc.$jazz.ensureLoaded({
		resolve: { content: true, comments: { $each: true } },
	})
	if (!source?.$isLoaded || !target?.$isLoaded) {
		throw new Error("Could not load documents for comment copy")
	}

	let sourceContent = source.content.toString()
	if (target.content.toString() !== sourceContent) {
		applyContentDiffWithCommentAnchors(target, sourceContent)
	}

	if (copyComments) {
		cloneCommentThreads(source, target)
	} else {
		target.$jazz.set("commentsDisabled", source.commentsDisabled)
	}

	applyContentDiffWithCommentAnchors(target, newContent)
}

function cloneCommentThreads(
	sourceDoc: LoadedCommentDocument,
	targetDoc: co.loaded<typeof Document, { content: true }>,
) {
	let threads = getActiveCommentThreads(sourceDoc)
	targetDoc.$jazz.set("commentsDisabled", sourceDoc.commentsDisabled)

	let cloned = co.list(CommentThread).create([], targetDoc.$jazz.owner)
	for (let thread of threads) {
		let range = getCommentRange(sourceDoc, thread.anchor)
		let anchor = range.orphaned
			? {
					...thread.anchor,
					start: undefined,
					end: undefined,
				}
			: makeAnchor(targetDoc, range.from, range.to, thread.anchor)
		let replies = co.list(CommentReply).create([], targetDoc.$jazz.owner)
		for (let reply of thread.replies.values()) {
			if (!reply?.$isLoaded || reply.deletedAt) continue
			replies.$jazz.push(
				CommentReply.create(
					{
						body: reply.body,
						authorName: reply.authorName,
						createdAt: reply.createdAt,
						updatedAt: reply.updatedAt,
					},
					targetDoc.$jazz.owner,
				),
			)
		}
		cloned.$jazz.push(
			CommentThread.create(
				{
					anchor,
					replies,
					resolvedAt: thread.resolvedAt,
					createdAt: thread.createdAt,
					updatedAt: thread.updatedAt,
				},
				targetDoc.$jazz.owner,
			),
		)
	}

	targetDoc.$jazz.set("comments", cloned)
}

function getExportComments(doc: LoadedCommentDocument): ExportComment[] {
	return getExportCommentsForContent(doc, doc.content.toString())
}

function getExportCommentsForContent(
	doc: LoadedCommentDocument,
	transformedContent: string,
): ExportComment[] {
	let content = doc.content.toString()
	let changes = getContentChanges(content, transformedContent)
	return getActiveCommentThreads(doc).map(thread => {
		let range = mapCommentRange(
			getCommentRange(doc, thread.anchor),
			changes,
			transformedContent,
		)
		return exportCommentThread(transformedContent, thread, range)
	})
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

function recoverRange(content: string, anchor: CommentAnchorData) {
	if (!anchor.quote) return null
	return firstRecoveredRange(content, anchor, [
		recoverContextRange,
		recoverQuoteRange,
		recoverFuzzyRange,
	])
}

function getTrackedCommentRange(
	doc: co.loaded<typeof Document, { content: true }>,
	anchor: CommentAnchorData,
) {
	let start = anchor.start
		? getTextPositionIndex(doc, "before", anchor.start)
		: undefined
	let end = anchor.end
		? getTextPositionIndex(doc, "after", anchor.end)
		: undefined

	if (start !== undefined && end !== undefined && start <= end) {
		if (anchor.collapsed) return { from: start, to: start, orphaned: false }
		return { from: start, to: end, orphaned: false }
	}
	return null
}

function firstRecoveredRange(
	content: string,
	anchor: CommentAnchorData,
	recoveries: RangeRecovery[],
) {
	for (let recover of recoveries) {
		let range = recover(content, anchor)
		if (range) return range
	}
	return null
}

function recoverContextRange(content: string, anchor: CommentAnchorData) {
	let contextMatch = `${anchor.contextBefore}${anchor.quote}${anchor.contextAfter}`
	let contextIndex = content.indexOf(contextMatch)
	if (contextIndex >= 0) {
		let from = contextIndex + anchor.contextBefore.length
		return { from, to: from + anchor.quote.length }
	}
	return null
}

function recoverQuoteRange(content: string, anchor: CommentAnchorData) {
	let quoteIndex = content.indexOf(anchor.quote)
	if (quoteIndex < 0) return null
	return { from: quoteIndex, to: quoteIndex + anchor.quote.length }
}

function exportCommentThread(
	content: string,
	thread: LoadedCommentThread,
	range: CommentRange,
): ExportComment {
	let replies = []
	for (let reply of thread.replies.values()) {
		if (!reply?.$isLoaded || reply.deletedAt) continue
		replies.push({
			body: reply.body,
			authorName: reply.authorName ?? null,
			createdAt: reply.createdAt.toISOString(),
			updatedAt: reply.updatedAt?.toISOString() ?? null,
		})
	}
	let quote = range.orphaned
		? thread.anchor.quote
		: content.slice(range.from, range.to)
	return {
		id: thread.$jazz.id,
		quote: quote || thread.anchor.quote,
		contextBefore: range.orphaned
			? thread.anchor.contextBefore
			: content.slice(Math.max(0, range.from - 80), range.from),
		contextAfter: range.orphaned
			? thread.anchor.contextAfter
			: content.slice(range.to, Math.min(content.length, range.to + 80)),
		from: range.orphaned ? null : range.from,
		to: range.orphaned ? null : range.to,
		resolved: Boolean(thread.resolvedAt),
		createdAt: thread.createdAt.toISOString(),
		updatedAt: thread.updatedAt.toISOString(),
		replies,
	}
}

function cleanAuthorName(authorName: string | undefined) {
	let name = authorName?.trim()
	return name ? name.slice(0, 80) : undefined
}

function getActiveCommentThreads(doc: LoadedCommentDocument) {
	if (!doc.comments?.$isLoaded) return []
	let threads: LoadedCommentThread[] = []
	for (let thread of doc.comments.values()) {
		if (thread?.$isLoaded && thread.replies?.$isLoaded && !thread.deletedAt) {
			threads.push(thread)
		}
	}
	return threads
}

function getActiveCommentAnchorThreads(doc: LoadedAnchorDocument) {
	if (!doc.comments?.$isLoaded) return []
	let threads: co.loaded<typeof CommentThread>[] = []
	for (let thread of doc.comments.values()) {
		if (thread?.$isLoaded && !thread.deletedAt) threads.push(thread)
	}
	return threads
}

function ensureComments(doc: LoadedCommentDocument) {
	if (!doc.comments) {
		doc.$jazz.set(
			"comments",
			co.list(CommentThread).create([], doc.$jazz.owner),
		)
	}
	return doc.comments
}

function makeAnchor(
	doc: co.loaded<typeof Document, { content: true }>,
	from: number,
	to: number,
	previous?: CommentAnchorData,
): CommentAnchorData {
	let content = doc.content.toString()
	let safeFrom = Math.max(0, Math.min(from, content.length))
	let safeTo = Math.max(safeFrom, Math.min(to, content.length))
	let quotes = deriveAnchorQuotes(content.slice(safeFrom, safeTo), previous)
	return {
		start: stringifyTextPos(doc.content.posAfter(safeFrom)),
		end: stringifyTextPos(
			safeFrom === safeTo
				? (doc.content.posBefore(safeTo) ?? doc.content.posAfter(safeTo))
				: doc.content.posBefore(safeTo),
		),
		quote: quotes.current,
		originalQuote: quotes.original,
		contextBefore: content.slice(Math.max(0, safeFrom - 80), safeFrom),
		contextAfter: content.slice(safeTo, Math.min(content.length, safeTo + 80)),
		collapsed: safeFrom === safeTo ? true : undefined,
	}
}

function deriveAnchorQuotes(current: string, previous?: CommentAnchorData) {
	return {
		current: current || previous?.quote || "",
		original: previous?.originalQuote ?? previous?.quote ?? current,
	}
}

function stringifyTextPos(pos: TextPos | undefined) {
	if (!pos) return undefined
	return stringifyOpID(pos)
}

function getTextPositionIndex(
	doc: co.loaded<typeof Document, { content: true }>,
	side: "before" | "after",
	id: string,
): number | undefined {
	let mapping =
		side === "before"
			? doc.content.$jazz.raw.mapping.idxBeforeOpID
			: doc.content.$jazz.raw.mapping.idxAfterOpID
	// Jazz types mapping keys as branded op IDs; comment anchors persist them as plain strings.
	let index = Reflect.get(mapping, id)
	return typeof index === "number" ? index : undefined
}

function recoverFuzzyRange(content: string, anchor: CommentAnchorData) {
	let tokens = getSearchTokens(anchor.quote)
	if (tokens.length === 0) return null

	let window = getContextWindow(content, anchor)
	let match = findOrderedTokenSpan(window.text, tokens)
	if (!match) return null

	return {
		from: window.offset + match.from,
		to: window.offset + match.to,
	}
}

function getContextWindow(content: string, anchor: CommentAnchorData) {
	let from = 0
	let to = content.length
	let before = anchor.contextBefore.trim()
	let after = anchor.contextAfter.trim()

	if (before) {
		let beforeIndex = content.indexOf(before)
		if (beforeIndex >= 0) from = beforeIndex + before.length
	}

	if (after) {
		let afterIndex = content.indexOf(after, from)
		if (afterIndex >= 0) to = afterIndex
	}

	return { text: content.slice(from, to), offset: from }
}

function getSearchTokens(text: string) {
	return text.match(/[^\s]+/g) ?? []
}

function findOrderedTokenSpan(content: string, tokens: string[]) {
	let searchFrom = 0
	let from = -1
	let to = -1

	for (let token of tokens) {
		let index = content.indexOf(token, searchFrom)
		if (index < 0) return null
		if (from < 0) from = index
		to = index + token.length
		searchFrom = to
	}

	return from < 0 ? null : { from, to }
}

type DiffChange = {
	fromA: number
	toA: number
	fromB: number
	toB: number
}

function getContentChanges(oldContent: string, newContent: string) {
	return Array.from(diff(oldContent, newContent)).map(
		([fromA, toA, fromB, toB]) => ({ fromA, toA, fromB, toB }),
	)
}

function getRestoredCommentRange(
	comment: ExportComment,
	content: string,
	changes: DiffChange[],
): CommentRange {
	return (
		getRestoredOffsetRange(comment, content, changes) ??
		getRecoveredExportRange(comment, content) ??
		orphanedRange()
	)
}

function getRestoredOffsetRange(
	comment: ExportComment,
	content: string,
	changes: DiffChange[],
) {
	if (comment.from === null || comment.to === null) return null
	return mapCommentRange(
		{ from: comment.from, to: comment.to, orphaned: false },
		changes,
		content,
	)
}

function getRecoveredExportRange(comment: ExportComment, content: string) {
	let recovered = recoverRange(content, {
		quote: comment.quote,
		contextBefore: comment.contextBefore,
		contextAfter: comment.contextAfter,
	})
	if (recovered) return { ...recovered, orphaned: false }
	return null
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
	let repaired = repairInvertedRange(mapped, range, changes)
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
