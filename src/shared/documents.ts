import type { Atom, Operation } from "./model"
import { array, string } from "./model"
import { assetReferences } from "./authoring"

import type { Replica } from "./crdt"
import { frontmatter, withFrontmatter } from "./markdown"
import { wikiReplacements } from "./portable-links"
import { rewrite as rewriteLinks } from "./portable"
import {
	canonicalDocumentSource,
	documentMetadata,
	metadataSource,
	relocatedRange,
} from "./document-metadata"

export function setFields(
	replica: Replica,
	id: string,
	fields: Record<string, string>,
) {
	return Object.entries(fields).map(([field, value]) =>
		replica.set(id, field, value),
	)
}

export function newDocument(
	replica: Replica,
	id: string,
	title: string,
	content: string,
) {
	if (
		title &&
		title !== "Untitled" &&
		title !== documentMetadata(content).title
	)
		content = metadataSource(content, { title })
	return [
		...setFields(replica, id, { type: "document", metadata: "frontmatter-v1" }),
		replica.edit(id, content),
	]
}

export function newComment(
	replica: Replica,
	id: string,
	documentId: string,
	quote: string,
	body: string,
	author: string,
	selectionStart?: number,
	anchor?: CommentAnchor,
) {
	if (replica.metadata(documentId).commentsDisabled)
		throw new Error("Comments are disabled for this document")
	let captured =
		anchor ?? commentAnchor(replica, documentId, quote, selectionStart)
	return setFields(replica, id, {
		type: "comment",
		document: documentId,
		quote,
		body,
		author,
		resolved: "false",
		anchor: captured.anchor,
		source: captured.source,
	})
}

export interface CommentSelection extends CommentAnchor {
	readonly quote: string
}
export interface CommentAnchor {
	readonly anchor: string
	readonly source: "frontmatter" | "body"
}
export function commentAnchor(
	replica: Pick<Replica, "text" | "visible">,
	documentId: string,
	quote: string,
	selectionStart?: number,
): CommentAnchor {
	return selectionAnchor(
		replica.visible(documentId),
		replica.text(documentId),
		quote,
		selectionStart,
	)
}
export function selectionAnchor(
	atoms: readonly Atom[],
	source: string,
	quote: string,
	selectionStart?: number,
): CommentSelection {
	let start = selectionStart ?? source.indexOf(quote)
	let end = start + quote.length,
		offset = 0
	let anchors =
		quote && start >= 0 && source.slice(start, end) === quote
			? atoms
					.filter(atom => {
						let previous = offset
						offset += atom.value.length
						return offset > start && previous < end
					})
					.map(atom => atom.id)
			: []
	return {
		quote,
		anchor: JSON.stringify(anchors),
		source:
			quote && end <= source.length - frontmatter(source).body.length
				? "frontmatter"
				: "body",
	}
}

export function commentRange(
	replica: Pick<Replica, "text" | "visible">,
	documentId: string,
	fields: Record<string, string>,
	version = "",
) {
	return commentRanges(replica, documentId, [fields], version)[0]
}
export function commentRanges(
	replica: Pick<Replica, "text" | "visible">,
	documentId: string,
	comments: readonly Record<string, string>[],
	version = "",
) {
	if (!comments.length) return []
	let offsets = new Map<string, { start: number; end: number }>()
	let offset = 0
	for (let atom of replica.visible(documentId, version || Infinity)) {
		let start = offset
		offset += atom.value.length
		offsets.set(atom.id, { start, end: offset })
	}
	let content = replica.text(documentId, version || Infinity)
	let header: string | undefined
	return comments.map(fields => {
		let anchors: string[] = []
		try {
			if (fields.anchor) anchors = array(JSON.parse(fields.anchor)).map(string)
		} catch {}
		if (!anchors.length) {
			let start = fields.quote ? content.indexOf(fields.quote) : -1
			return start < 0
				? undefined
				: { start, end: start + (fields.quote?.length ?? 0) }
		}
		let start = Infinity,
			end = 0
		for (let id of anchors) {
			let position = offsets.get(id)
			if (position) {
				start = Math.min(start, position.start)
				end = Math.max(end, position.end)
			}
		}
		if (start < Infinity) return { start, end }
		if (fields.source === "frontmatter" && fields.quote) {
			header ??= content.slice(
				0,
				content.length - frontmatter(content).body.length,
			)
			let start = header.indexOf(fields.quote)
			if (start >= 0) return { start, end: start + fields.quote.length }
		}
		return undefined
	})
}

export function replyToComment(
	replica: Replica,
	id: string,
	body: string,
	author: string,
	identity: { id: string; time: number },
) {
	let documentId = replica.fields(id).document
	if (documentId && replica.metadata(documentId).commentsDisabled)
		throw new Error("Comments are disabled for this document")
	return replica.set(
		id,
		`reply:${identity.time}:${identity.id}`,
		JSON.stringify({ body, author, time: identity.time }),
	)
}

export function records(replica: Replica, type: string) {
	return replica.records(type)
}

export function documentTargets(replica: Replica, documentId: string) {
	let targets = new Set([documentId])
	for (let operation of replica.operations.values())
		if (operation.field === "document" && operation.value === documentId)
			targets.add(operation.target)
	let fields = replica.fields(documentId)
	if (fields.theme) targets.add(fields.theme)
	if (fields.whiteboard) targets.add(fields.whiteboard)
	for (let id of assetReferences(replica.text(documentId))) targets.add(id)
	return targets
}

export function ownedDocumentTargets(replica: Replica, documentId: string) {
	return [...documentTargets(replica, documentId)].filter(
		target =>
			target === documentId || replica.fields(target).document === documentId,
	)
}

export function copyDocumentOperations(
	source: Replica,
	destination: Replica,
	documentId: string,
) {
	let targets = documentTargets(source, documentId)
	let history = [...source.operations.values()].filter(operation =>
		targets.has(operation.target),
	)
	if (
		!destination.fields(documentId).type &&
		history.every(operation => !destination.operations.has(operation.id))
	)
		return history
	return [...targets].flatMap(id => [
		...setFields(
			destination,
			id,
			id === documentId
				? {
						...documentProtocolFields(source.fields(id)),
						metadata: "frontmatter-v1",
					}
				: source.fields(id),
		),
		destination.edit(
			id,
			id === documentId
				? canonicalDocumentSource(source.text(id), source.fields(id))
				: source.text(id),
		),
	])
}

export function documentTimeline(replica: Replica, documentId: string) {
	let targets = new Set([documentId])
	for (let operation of replica.operations.values()) {
		if (operation.field === "document" && operation.value === documentId)
			targets.add(operation.target)
		if (
			operation.target === documentId &&
			operation.field === "whiteboard" &&
			operation.value
		)
			targets.add(operation.value)
	}
	return [...replica.operations.values()]
		.filter(operation => targets.has(operation.target))
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
export function restoreDocument(
	replica: Replica,
	documentId: string,
	version: string,
) {
	let operations: (Operation | null)[] = []
	let currentMetadata = replica.metadata(documentId)
	let historicalSource = replica.text(documentId, version)
	let restoredSource = metadataSource(
		canonicalDocumentSource(
			historicalSource,
			replica.fields(documentId, version),
		),
		{
			path: currentMetadata.path,
			tags: currentMetadata.tags,
			pinned: currentMetadata.pinned,
			archived: currentMetadata.archived,
		},
	)
	let targets = new Set(
		documentTimeline(replica, documentId).map(operation => operation.target),
	)
	for (let target of targets) {
		let historical = replica.fields(target, version),
			current = replica.fields(target)
		if (!historical.type && target !== documentId) {
			operations.push(replica.set(target, "type", "deleted"))
			continue
		}
		for (let field of new Set([
			...Object.keys(historical),
			...Object.keys(current),
		])) {
			if (
				target === documentId &&
				[
					"title",
					"commentsDisabled",
					"metadata",
					"archived",
					"pinned",
					"folder",
					"tags",
					"file",
					"source",
				].includes(field)
			)
				continue
			let value = historical[field] ?? ""
			if (value !== current[field])
				operations.push(replica.set(target, field, value))
		}
		if (target === documentId)
			operations.push(
				replica.set(documentId, "metadata", "frontmatter-v1"),
				replica.edit(documentId, restoredSource),
			)
	}
	for (let target of targets) {
		let fields = replica.fields(target, version)
		if (fields.type !== "comment") continue
		let range = commentRange(replica, documentId, fields, version)
		if (range) range = relocatedRange(historicalSource, restoredSource, range)
		if (range)
			operations.push(
				replica.set(
					target,
					"anchor",
					JSON.stringify(textAnchors(replica, documentId, range)),
				),
			)
	}
	return operations
}

function textAnchors(
	replica: Replica,
	documentId: string,
	range: { start: number; end: number },
) {
	let offset = 0
	return replica
		.visible(documentId)
		.filter(atom => {
			let start = offset
			offset += atom.value.length
			return offset > range.start && start < range.end
		})
		.map(atom => atom.id)
}

export function snapshotTargets(
	source: Replica,
	documentId: string,
	version = "",
) {
	let until = version || Infinity
	let targets = new Set(
		documentTimeline(source, documentId).map(operation => operation.target),
	)
	targets.add(documentId)
	let fields = source.fields(documentId, version)
	if (fields.theme) targets.add(fields.theme)
	let header = frontmatter(source.text(documentId, until)).data
	for (let key of ["theme-id", "theme"]) {
		let id = header[key]
		if (typeof id === "string" && source.fields(id, version).type === "theme")
			targets.add(id)
	}
	for (let match of source.text(documentId, until).matchAll(/asset:([\w-]+)/g))
		if (match[1]) targets.add(match[1])
	return targets
}

export function duplicateDocument(
	source: Replica,
	destination: Replica,
	documentId: string,
	id: string,
	title: string,
	identities: ReadonlyMap<string, string>,
	version = "",
	includeComments = true,
) {
	let until = version || Infinity
	let targets = snapshotTargets(source, documentId, version)
	if (
		identities.get(documentId) !== id ||
		[...targets].some(target => !identities.has(target))
	)
		throw new Error("Missing duplicate target identities")
	let operations: (Operation | null)[] = []
	function rewrite(value: string) {
		return rewriteLinks(
			value.replace(
				/asset:([\w-]+)/g,
				(_match, asset: string) => `asset:${identities.get(asset) ?? asset}`,
			),
			wikiReplacements(value, token => identities.get(token)),
		).text
	}
	function rewriteTheme(value: string) {
		let header = frontmatter(value).data
		for (let key of ["theme-id", "theme"]) {
			let previous = header[key]
			let next =
				typeof previous === "string" ? identities.get(previous) : undefined
			if (next) value = withFrontmatter(value, { [key]: next })
		}
		return value
	}
	for (let target of targets) {
		let targetId = identities.get(target)
		let historical = source.fields(target, version)
		if (!targetId || !historical.type || historical.type === "deleted") continue
		if (!includeComments && historical.type === "comment") continue
		operations.push(
			...setFields(
				destination,
				targetId,
				Object.fromEntries(
					Object.entries(
						target === documentId
							? documentProtocolFields(historical)
							: historical,
					).map(([field, value]) => [
						field,
						["document", "theme", "whiteboard"].includes(field)
							? (identities.get(value) ?? value)
							: rewrite(value),
					]),
				),
			),
		)
		if (
			["asset", "whiteboard"].includes(historical.type) ||
			(historical.type === "theme" && Boolean(historical.document))
		)
			operations.push(destination.set(targetId, "document", id))
		operations.push(
			destination.edit(
				targetId,
				target === documentId
					? metadataSource(
							canonicalDocumentSource(
								rewriteTheme(rewrite(source.text(target, until))),
								historical,
							),
							{ title, archived: false },
						)
					: rewrite(source.text(target, until)),
			),
		)
	}
	operations.push(
		...setFields(destination, id, {
			metadata: "frontmatter-v1",
			file: "",
			source: "",
		}),
	)
	for (let target of targets) {
		let fields = source.fields(target, version),
			targetId = identities.get(target)
		if (!includeComments || fields.type !== "comment" || !targetId) continue
		let range = commentRange(source, documentId, fields, version)
		if (range) {
			let content = source.text(documentId, until)
			range = {
				start: rewrite(content.slice(0, range.start)).length,
				end: rewrite(content.slice(0, range.end)).length,
			}
			range = relocatedRange(rewrite(content), destination.text(id), range)
		}
		operations.push(
			destination.set(
				targetId,
				"anchor",
				range
					? JSON.stringify(textAnchors(destination, id, range))
					: fields.anchor || "[]",
			),
		)
	}
	return { operations, targets }
}

function documentProtocolFields(fields: Record<string, string>) {
	return Object.fromEntries(
		Object.entries(fields).filter(
			([field]) =>
				![
					"title",
					"folder",
					"tags",
					"pinned",
					"archived",
					"commentsDisabled",
				].includes(field),
		),
	)
}
