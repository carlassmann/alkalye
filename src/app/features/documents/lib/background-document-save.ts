import type { co } from "jazz-tools"
import {
	applyContentPatchesInBoundedTransactions,
	applyDocumentContentPatches,
	type LoadedAnchorDocument,
} from "@/app/features/comments/lib/comments"
import { calculateDocumentContentPatches } from "./document-diff"
import { mergeDocumentContent } from "./merge-document-content"
import { syncDocumentMetadata } from "./metadata"
import { Document } from "./schema"
import type {
	DocumentContentPatch,
	DocumentSaveWorkerRequest,
	DocumentSaveWorkerResponse,
} from "./document-save-protocol"

export {
	createBackgroundDocumentSave,
	persistDocumentContentSynchronously,
	waitForDocumentStorageSync,
	type BackgroundDocumentSave,
	type BackgroundSaveDocument,
}

type BackgroundSaveDocument = co.loaded<typeof Document, { content: true }>

type BackgroundDocumentSave = {
	save(content: string, baseContent?: string): Promise<string>
	close(): void
}

type DiffResult = {
	content: string
	patches: DocumentContentPatch[]
}

let DOCUMENT_DIFF_TIMEOUT_MS = 10_000

function createBackgroundDocumentSave(
	getDocument: () => BackgroundSaveDocument,
): BackgroundDocumentSave {
	let worker = new Worker(
		new URL("./document-save.worker.ts", import.meta.url),
		{ type: "module" },
	)
	let requests = new Map<number, ReturnType<typeof deferred<DiffResult>>>()
	let nextRequestId = 1
	let saveQueue: Promise<unknown> = Promise.resolve()
	let closeRequested = false
	let closed = false

	worker.addEventListener(
		"message",
		(event: MessageEvent<DocumentSaveWorkerResponse>) => {
			let response = event.data
			if (response.type === "diffed") {
				requests.get(response.requestId)?.resolve({
					content: response.content,
					patches: response.patches,
				})
				requests.delete(response.requestId)
				return
			}
			if (response.type === "failed") {
				requests.get(response.requestId)?.reject(new Error(response.message))
				requests.delete(response.requestId)
				return
			}
			closed = true
			worker.terminate()
		},
	)
	worker.addEventListener("error", event => {
		event.preventDefault()
		failWorker(new Error(event.message || "Document diff worker failed"))
	})
	worker.addEventListener("messageerror", () => {
		failWorker(new Error("Document diff worker sent an unreadable message"))
	})

	return {
		save(content, baseContent = getDocument().content.toString()) {
			if (closeRequested)
				return Promise.reject(new Error("Background save is closed"))
			let save = saveQueue.then(() => saveContent(baseContent, content))
			saveQueue = save.catch(() => {})
			return save
		},
		close() {
			if (closeRequested) return
			closeRequested = true
			void saveQueue.then(closeWorker)
		},
	}

	async function saveContent(
		baseContent: string,
		content: string,
	): Promise<string> {
		let doc = getDocument()
		let oldEntries = doc.content.$jazz.raw.entries().map(entry => entry.value)
		let oldContent = oldEntries.join("")
		if (baseContent === oldContent && oldContent === content) return content
		if (baseContent === oldContent && content.startsWith(oldContent)) {
			doc.content.insertBefore(
				doc.content.$jazz.raw.entries().length,
				content.slice(oldContent.length),
			)
			await finishSave(doc)
			return content
		}
		let result = await calculateDiff(oldEntries, baseContent, content)
		if (doc.content.toString() !== oldContent) {
			return saveContent(oldContent, result.content)
		}
		applyPatchesPreservingLoadedAnchors(doc, result.content, result.patches)
		if (doc.content.toString() !== result.content) {
			throw new Error("Document diff did not produce the requested content")
		}
		await finishSave(doc)
		return result.content
	}

	async function finishSave(doc: BackgroundSaveDocument) {
		doc.$jazz.set("updatedAt", new Date())
		syncDocumentMetadata(doc)
		await waitForDocumentStorageSync(doc)
	}

	function calculateDiff(
		oldEntries: string[],
		baseContent: string,
		newContent: string,
	) {
		if (closed)
			return Promise.reject(new Error("Document diff worker is closed"))
		let requestId = nextRequestId++
		let result = deferred<DiffResult>()
		requests.set(requestId, result)
		let request: DocumentSaveWorkerRequest = {
			type: "diff",
			requestId,
			oldEntries,
			baseContent,
			newContent,
		}
		worker.postMessage(request)
		let timeout = setTimeout(() => {
			failWorker(new Error("Document diff worker timed out"))
		}, DOCUMENT_DIFF_TIMEOUT_MS)
		return result.promise.finally(() => clearTimeout(timeout))
	}

	function closeWorker() {
		if (closed) return
		closed = true
		worker.postMessage({ type: "close" } satisfies DocumentSaveWorkerRequest)
	}

	function failWorker(error: Error) {
		if (closed) return
		closed = true
		closeRequested = true
		for (let request of requests.values()) request.reject(error)
		requests.clear()
		worker.terminate()
	}
}

function persistDocumentContentSynchronously(
	doc: BackgroundSaveDocument,
	content: string,
	baseContent = doc.content.toString(),
) {
	let oldEntries = doc.content.$jazz.raw.entries().map(entry => entry.value)
	let oldContent = oldEntries.join("")
	let mergedContent = mergeDocumentContent(baseContent, content, oldContent)
	if (oldContent === mergedContent) return mergedContent
	if (mergedContent.startsWith(oldContent)) {
		doc.content.insertBefore(
			oldEntries.length,
			mergedContent.slice(oldContent.length),
		)
	} else {
		let patches = calculateDocumentContentPatches(oldEntries, mergedContent)
		applyPatchesPreservingLoadedAnchors(doc, mergedContent, patches)
	}
	doc.$jazz.set("updatedAt", new Date())
	syncDocumentMetadata(doc)
	return mergedContent
}

async function waitForDocumentStorageSync(doc: BackgroundSaveDocument) {
	let syncManager = doc.content.$jazz.raw.core.node.syncManager
	await Promise.all([
		syncManager.waitForStorageSync(doc.content.$jazz.raw.core.id),
		syncManager.waitForStorageSync(doc.$jazz.raw.core.id),
	])
}

function applyPatchesPreservingLoadedAnchors(
	doc: BackgroundSaveDocument,
	content: string,
	patches: DocumentContentPatch[],
) {
	if (hasLoadedCommentAnchors(doc)) {
		applyDocumentContentPatches(doc, content, patches)
		return
	}
	applyContentPatchesInBoundedTransactions(doc.content, patches)
}

function hasLoadedCommentAnchors(
	doc: BackgroundSaveDocument,
): doc is LoadedAnchorDocument {
	return (
		doc.comments === undefined ||
		(doc.comments.$isLoaded && doc.comments.every(thread => thread.$isLoaded))
	)
}

function deferred<T>() {
	let resolvePromise: (value: T | PromiseLike<T>) => void = () => {}
	let rejectPromise: (reason?: unknown) => void = () => {}
	let promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve
		rejectPromise = reject
	})
	return { promise, resolve: resolvePromise, reject: rejectPromise }
}
