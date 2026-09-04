import type { co } from "jazz-tools"
import {
	applyContentPatchesInBoundedTransactions,
	applyDocumentContentPatches,
	type LoadedAnchorDocument,
} from "@/app/features/comments/lib/comments"
import { calculateDocumentContentPatches } from "./document-diff"
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
	type BackgroundDocumentSave,
	type BackgroundSaveDocument,
}

type BackgroundSaveDocument = co.loaded<typeof Document, { content: true }>

type BackgroundDocumentSave = {
	save(content: string): Promise<"applied" | "superseded">
	close(): void
}

let DOCUMENT_DIFF_TIMEOUT_MS = 10_000

function createBackgroundDocumentSave(
	getDocument: () => BackgroundSaveDocument,
): BackgroundDocumentSave {
	let worker = new Worker(
		new URL("./document-save.worker.ts", import.meta.url),
		{ type: "module" },
	)
	let requests = new Map<
		number,
		ReturnType<typeof deferred<DocumentContentPatch[]>>
	>()
	let nextRequestId = 1
	let saveQueue: Promise<unknown> = Promise.resolve()
	let closeRequested = false
	let closed = false

	worker.addEventListener(
		"message",
		(event: MessageEvent<DocumentSaveWorkerResponse>) => {
			let response = event.data
			if (response.type === "diffed") {
				requests.get(response.requestId)?.resolve(response.patches)
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
		save(content) {
			if (closeRequested)
				return Promise.reject(new Error("Background save is closed"))
			let save = saveQueue.then(() => saveContent(content))
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
		content: string,
	): Promise<"applied" | "superseded"> {
		let doc = getDocument()
		let oldEntries = doc.content.$jazz.raw.entries().map(entry => entry.value)
		let oldContent = oldEntries.join("")
		if (oldContent === content) return "applied"
		if (content.startsWith(oldContent)) {
			doc.content.insertBefore(
				doc.content.$jazz.raw.entries().length,
				content.slice(oldContent.length),
			)
			await finishSave(doc)
			return "applied"
		}
		let patches = await calculateDiff(oldEntries, content)
		if (doc.content.toString() !== oldContent) return "superseded"
		applyPatchesPreservingLoadedAnchors(doc, content, patches)
		if (doc.content.toString() !== content) {
			throw new Error("Document diff did not produce the requested content")
		}
		finishSave(doc)
		return "applied"
	}

	function finishSave(doc: BackgroundSaveDocument) {
		doc.$jazz.set("updatedAt", new Date())
		syncDocumentMetadata(doc)
	}

	function calculateDiff(oldEntries: string[], newContent: string) {
		if (closed)
			return Promise.reject(new Error("Document diff worker is closed"))
		let requestId = nextRequestId++
		let result = deferred<DocumentContentPatch[]>()
		requests.set(requestId, result)
		let request: DocumentSaveWorkerRequest = {
			type: "diff",
			requestId,
			oldEntries,
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
) {
	let oldEntries = doc.content.$jazz.raw.entries().map(entry => entry.value)
	let oldContent = oldEntries.join("")
	if (oldContent === content) return
	if (content.startsWith(oldContent)) {
		doc.content.insertBefore(
			oldEntries.length,
			content.slice(oldContent.length),
		)
	} else {
		let patches = calculateDocumentContentPatches(oldEntries, content)
		applyPatchesPreservingLoadedAnchors(doc, content, patches)
	}
	doc.$jazz.set("updatedAt", new Date())
	syncDocumentMetadata(doc)
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
