import { co } from "jazz-tools"
import { diff } from "fast-myers-diff"
import { ArchivedDocumentContent, Document } from "./schema"
import {
	applyContentDiffWithCommentAnchors,
	replaceDocumentContentMappingAnchors,
	replaceDocumentContentPreservingAnchors,
} from "@/app/features/comments"
import {
	recordStartupTrace,
	startStartupSpan,
} from "@/app/lib/reload-diagnostics"

export {
	DOCUMENT_CONTENT_TRANSACTION_BUDGET,
	compactDocumentContent,
	replaceDocumentContentGeneration,
	reconcileArchivedDocumentContent,
	getDocumentContentGenerations,
	mergeNonConflictingText,
	hasActiveDocumentCollaborators,
	getOwnDocumentContentTransactionCount,
}
export type { DocumentContentGeneration }

let DOCUMENT_CONTENT_TRANSACTION_BUDGET = 2_000
let ACTIVE_CURSOR_MAX_AGE_MS = 30_000

type CompactableDocument = co.loaded<
	typeof Document,
	{ content: true; comments: { $each: true }; cursors: true }
>

type GenerationDocument = co.loaded<typeof Document, { content: true }>

type LoadedArchive = co.loaded<
	typeof ArchivedDocumentContent,
	{ content: true }
>

type DocumentContentGeneration = {
	content: CompactableDocument["content"]
	archive: LoadedArchive | null
}

let compactions = new WeakSet<object>()

function getOwnDocumentContentTransactionCount(doc: CompactableDocument) {
	let sessionId = doc.$jazz.raw.core.node.currentSessionID
	return doc.content.$jazz.raw.core.knownState().sessions[sessionId] ?? 0
}

async function compactDocumentContent(
	doc: CompactableDocument,
	transactionBudget = DOCUMENT_CONTENT_TRANSACTION_BUDGET,
) {
	let transactionCount =
		doc.content.$jazz.raw.core.getValidSortedTransactions().length
	let seedTransactionCount = getSuccessorSeedTransactionCount(doc)
	if (transactionCount <= transactionBudget + seedTransactionCount) return false
	let finish = startStartupSpan("document-content-compaction", {
		documentId: doc.$jazz.id,
		contentId: doc.content.$jazz.id,
		transactionCount,
		contentCharacters: doc.content.toString().length,
	})
	let loaded
	try {
		loaded = await doc.$jazz.ensureLoaded({
			resolve: {
				content: true,
				comments: { $each: true },
				cursors: true,
				archivedContent: { $each: true, $onError: "catch" },
			},
		})
	} catch (error) {
		finish({ status: "load-error", error: errorName(error) })
		return false
	}
	if (!loaded.$isLoaded) {
		finish({ status: "load-failed" })
		return false
	}
	doc = loaded
	transactionCount =
		doc.content.$jazz.raw.core.getValidSortedTransactions().length
	seedTransactionCount = getSuccessorSeedTransactionCount(doc)
	if (transactionCount <= transactionBudget + seedTransactionCount) {
		finish({ status: "within-budget", seedTransactionCount })
		return false
	}
	let contentRaw = doc.content.$jazz.raw
	if (compactions.has(contentRaw)) {
		finish({ status: "already-running" })
		return false
	}
	if (hasActiveDocumentCollaborators(doc)) {
		finish({ status: "active-collaborator" })
		return false
	}

	compactions.add(contentRaw)
	try {
		try {
			await contentRaw.core.waitForSync({ timeout: 5_000 })
		} catch {
			finish({ status: "sync-timeout" })
			return false
		}
		if (doc.content.$jazz.id !== contentRaw.id) {
			finish({ status: "pointer-changed" })
			return false
		}
		if (hasActiveDocumentCollaborators(doc)) {
			finish({ status: "active-collaborator" })
			return false
		}

		let successor = co
			.plainText()
			.create(doc.content.toString(), doc.$jazz.owner)
		let archive = createDocumentContentArchive(doc, successor, false)

		if (doc.content.$jazz.id !== contentRaw.id) {
			finish({ status: "pointer-changed" })
			return false
		}
		let archives = getOrCreateDocumentContentArchives(doc)
		if (!archives) {
			finish({ status: "archive-load-failed" })
			return false
		}

		archives.$jazz.push(archive)
		replaceDocumentContentPreservingAnchors(doc, successor)
		finish({
			status: "rotated",
			successorId: successor.$jazz.id,
			successorTransactions:
				successor.$jazz.raw.core.getValidSortedTransactions().length,
		})
		return true
	} catch (error) {
		finish({ status: "error", error: errorName(error) })
		return false
	} finally {
		compactions.delete(contentRaw)
	}
}

async function replaceDocumentContentGeneration(
	doc: CompactableDocument,
	content: string,
) {
	let loaded
	try {
		loaded = await doc.$jazz.ensureLoaded({
			resolve: {
				content: true,
				comments: { $each: true },
				cursors: true,
				archivedContent: { $each: true, $onError: "catch" },
			},
		})
	} catch {
		return false
	}
	if (!loaded.$isLoaded || hasActiveDocumentCollaborators(loaded)) return false

	let contentRaw = loaded.content.$jazz.raw
	if (compactions.has(contentRaw)) return false
	compactions.add(contentRaw)
	try {
		try {
			await contentRaw.core.waitForSync({ timeout: 5_000 })
		} catch {
			return false
		}
		if (
			loaded.content.$jazz.id !== contentRaw.id ||
			hasActiveDocumentCollaborators(loaded)
		)
			return false

		let successor = co.plainText().create(content, loaded.$jazz.owner)
		let archive = createDocumentContentArchive(loaded, successor, true)
		let archives = getOrCreateDocumentContentArchives(loaded)
		if (!archives) return false

		archives.$jazz.push(archive)
		replaceDocumentContentMappingAnchors(loaded, successor)
		return true
	} finally {
		compactions.delete(contentRaw)
	}
}

function createDocumentContentArchive(
	doc: CompactableDocument,
	successor: co.loaded<ReturnType<typeof co.plainText>>,
	replaced: boolean,
) {
	return ArchivedDocumentContent.create(
		{
			content: doc.content,
			successor,
			cutoverFrontier: doc.content.$jazz.raw.core.frontier(),
			successorSeedFrontier: successor.$jazz.raw.core.frontier(),
			replaced: replaced || undefined,
			cutoverAt: new Date(),
			successorId: successor.$jazz.id,
		},
		doc.$jazz.owner,
	)
}

function getOrCreateDocumentContentArchives(doc: CompactableDocument) {
	let archives = doc.archivedContent
	if (!archives) {
		archives = co.list(ArchivedDocumentContent).create([], doc.$jazz.owner)
		doc.$jazz.set("archivedContent", archives)
	}
	return archives.$isLoaded ? archives : null
}

function hasActiveDocumentCollaborators(doc: CompactableDocument) {
	if (!doc.cursors?.$isLoaded) return false

	let ownSessionId = doc.$jazz.raw.core.node.currentSessionID
	let now = Date.now()
	for (let [sessionId, entry] of Object.entries(doc.cursors.perSession)) {
		if (sessionId === ownSessionId || !entry?.value) continue
		if (now - entry.madeAt.getTime() <= ACTIVE_CURSOR_MAX_AGE_MS) return true
	}
	return false
}

function getDocumentContentGenerations(
	doc: GenerationDocument,
): DocumentContentGeneration[] {
	let bySuccessor = new Map<string, LoadedArchive>()
	let archives = doc.archivedContent?.$isLoaded
		? doc.archivedContent
		: undefined
	for (let archive of archives?.values() ?? []) {
		if (!archive?.$isLoaded) continue
		if (!hasLoadedArchiveContent(archive)) continue
		if (archive.content.$jazz.id === doc.content.$jazz.id) continue
		bySuccessor.set(archive.successorId, archive)
	}

	let generations: DocumentContentGeneration[] = [
		{ content: doc.content, archive: null },
	]
	let predecessor = bySuccessor.get(doc.content.$jazz.id)
	let visited = new Set<string>()
	while (predecessor && !visited.has(predecessor.$jazz.id)) {
		visited.add(predecessor.$jazz.id)
		generations.unshift({ content: predecessor.content, archive: predecessor })
		predecessor = bySuccessor.get(predecessor.content.$jazz.id)
	}

	return generations
}

function hasLoadedArchiveContent(
	archive: co.loaded<typeof ArchivedDocumentContent> | null | undefined,
): archive is LoadedArchive {
	return Boolean(archive?.$isLoaded && archive.content?.$isLoaded)
}

async function reconcileArchivedDocumentContent(doc: CompactableDocument) {
	try {
		return await reconcileArchivedDocumentContentUnsafe(doc)
	} catch (error) {
		recordStartupTrace("document-content-reconciliation", {
			documentId: doc.$jazz.id,
			status: "error",
			error: errorName(error),
		})
		return false
	}
}

async function reconcileArchivedDocumentContentUnsafe(
	doc: CompactableDocument,
) {
	let loaded
	try {
		loaded = await doc.$jazz.ensureLoaded({
			resolve: {
				content: true,
				comments: { $each: true },
				cursors: true,
				archivedContent: { $each: { content: true, successor: true } },
			},
		})
	} catch (error) {
		recordStartupTrace("document-content-reconciliation", {
			documentId: doc.$jazz.id,
			status: "load-error",
			error: errorName(error),
		})
		return false
	}
	if (!loaded.$isLoaded || hasActiveDocumentCollaborators(loaded)) return false

	let changed = false
	let reconciled = 0
	let conflicts = 0
	let generations = getDocumentContentGenerations(loaded)
	for (let generation of generations) {
		let archive = generation.archive
		if (!archive) continue

		let reconciledFrontier =
			archive.reconciledFrontier ?? archive.cutoverFrontier
		let archivedContent = archive.content.toString()
		let reconciledContent = archive.content.$jazz.raw
			.atFrontier(reconciledFrontier)
			.toString()
		if (archivedContent === reconciledContent) continue
		if (archive.replaced) {
			archive.$jazz.set(
				"reconciledFrontier",
				archive.content.$jazz.raw.core.frontier(),
			)
			conflicts++
			continue
		}

		let merged = mergeNonConflictingText(
			reconciledContent,
			archivedContent,
			loaded.content.toString(),
		)
		if (merged.content !== loaded.content.toString()) {
			applyContentDiffWithCommentAnchors(loaded, merged.content)
			changed = true
		}
		if (merged.conflicts === 0) {
			archive.$jazz.set(
				"reconciledFrontier",
				archive.content.$jazz.raw.core.frontier(),
			)
			reconciled++
		} else {
			conflicts += merged.conflicts
		}
	}

	let chainContentIds = new Set(
		generations.map(generation => generation.content.$jazz.id),
	)
	for (let archive of loaded.archivedContent?.values() ?? []) {
		if (
			!archive?.$isLoaded ||
			!archive.successor?.$isLoaded ||
			!archive.successorSeedFrontier ||
			chainContentIds.has(archive.successor.$jazz.id)
		)
			continue

		let reconciledFrontier =
			archive.successorReconciledFrontier ?? archive.successorSeedFrontier
		let orphanedContent = archive.successor.toString()
		let reconciledContent = archive.successor.$jazz.raw
			.atFrontier(reconciledFrontier)
			.toString()
		if (orphanedContent === reconciledContent) continue

		let merged = mergeNonConflictingText(
			reconciledContent,
			orphanedContent,
			loaded.content.toString(),
		)
		if (merged.content !== loaded.content.toString()) {
			applyContentDiffWithCommentAnchors(loaded, merged.content)
			changed = true
		}
		if (merged.conflicts === 0) {
			archive.$jazz.set(
				"successorReconciledFrontier",
				archive.successor.$jazz.raw.core.frontier(),
			)
			reconciled++
		} else {
			conflicts += merged.conflicts
		}
	}
	recordStartupTrace("document-content-reconciliation", {
		documentId: doc.$jazz.id,
		status: conflicts > 0 ? "conflicts" : "complete",
		changed,
		reconciled,
		conflicts,
	})
	return changed
}

function errorName(error: unknown) {
	return error instanceof Error ? error.name : "UnknownError"
}

type TextChange = {
	fromBase: number
	toBase: number
	fromTarget: number
	toTarget: number
}

function mergeNonConflictingText(base: string, local: string, remote: string) {
	let localChanges = getChanges(base, local)
	let remoteChanges = getChanges(base, remote)
	let applicable: TextChange[] = []
	let conflicts = 0

	for (let localChange of localChanges) {
		let overlapping = remoteChanges.filter(remoteChange =>
			changesOverlap(localChange, remoteChange),
		)
		if (overlapping.length === 0) {
			applicable.push(localChange)
			continue
		}
		if (!isSameChange(base, local, remote, localChange, overlapping)) {
			conflicts++
		}
	}

	let content = remote
	for (let change of applicable.reverse()) {
		let from = mapBasePosition(change.fromBase, remoteChanges, "before")
		let to = mapBasePosition(change.toBase, remoteChanges, "after")
		content =
			content.slice(0, from) +
			local.slice(change.fromTarget, change.toTarget) +
			content.slice(to)
	}

	return { content, conflicts }
}

function getChanges(base: string, target: string): TextChange[] {
	return Array.from(diff(base, target)).map(
		([fromBase, toBase, fromTarget, toTarget]) => ({
			fromBase,
			toBase,
			fromTarget,
			toTarget,
		}),
	)
}

function changesOverlap(left: TextChange, right: TextChange) {
	if (left.fromBase === left.toBase && right.fromBase === right.toBase) {
		return left.fromBase === right.fromBase
	}
	return left.fromBase < right.toBase && right.fromBase < left.toBase
}

function isSameChange(
	base: string,
	local: string,
	remote: string,
	localChange: TextChange,
	remoteChanges: TextChange[],
) {
	if (remoteChanges.length !== 1) return false
	let remoteChange = remoteChanges[0]
	return (
		localChange.fromBase === remoteChange.fromBase &&
		localChange.toBase === remoteChange.toBase &&
		local.slice(localChange.fromTarget, localChange.toTarget) ===
			remote.slice(remoteChange.fromTarget, remoteChange.toTarget) &&
		base.slice(localChange.fromBase, localChange.toBase) ===
			base.slice(remoteChange.fromBase, remoteChange.toBase)
	)
}

function mapBasePosition(
	position: number,
	changes: TextChange[],
	bias: "before" | "after",
) {
	let mapped = position
	for (let change of changes) {
		let insertionAtPosition =
			change.fromBase === change.toBase && change.fromBase === position
		if (
			change.toBase < position ||
			(change.toBase === position && (!insertionAtPosition || bias === "after"))
		) {
			mapped +=
				change.toTarget - change.fromTarget - (change.toBase - change.fromBase)
		}
	}
	return mapped
}

function getSuccessorSeedTransactionCount(doc: CompactableDocument) {
	if (!doc.archivedContent?.$isLoaded) return 0
	let predecessor = doc.archivedContent.find(
		archive =>
			archive?.$isLoaded && archive.successorId === doc.content.$jazz.id,
	)
	if (!predecessor?.$isLoaded || !predecessor.successorSeedFrontier) return 0
	return Object.values(predecessor.successorSeedFrontier).reduce(
		(total, lastTransactionIndex) => total + lastTransactionIndex + 1,
		0,
	)
}
