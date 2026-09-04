import type { co } from "jazz-tools"
import { applyDocumentContentPatches } from "@/app/features/comments/lib/comments"
import { syncDocumentMetadata } from "./metadata"
import { Document } from "./schema"
import type {
	DocumentContentPatch,
	DocumentSaveWorkerRequest,
	DocumentSaveWorkerResponse,
} from "./document-save-protocol"

export {
	createBackgroundDocumentSave,
	type BackgroundDocumentSave,
	type BackgroundSaveDocument,
}

type BackgroundSaveDocument = co.loaded<typeof Document, { content: true }>

type BackgroundDocumentSave = {
	save(content: string): Promise<void>
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
	let saveQueue = Promise.resolve()
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

	async function saveContent(content: string): Promise<void> {
		let doc = await getDocument().$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true } },
		})
		let oldContent = doc.content.toString()
		if (oldContent === content) return
		if (content.startsWith(oldContent)) {
			doc.content.insertBefore(
				doc.content.$jazz.raw.entries().length,
				content.slice(oldContent.length),
			)
			await finishSave(doc)
			return
		}
		let patches = await calculateDiff(oldContent, content)
		if (doc.content.toString() !== oldContent) return saveContent(content)
		applyDocumentContentPatches(doc, content, patches)
		if (doc.content.toString() !== content) {
			throw new Error("Document diff did not produce the requested content")
		}
		await finishSave(doc)
	}

	async function finishSave(
		doc: co.loaded<
			typeof Document,
			{ content: true; comments: { $each: true } }
		>,
	) {
		doc.$jazz.set("updatedAt", new Date())
		syncDocumentMetadata(doc)
		await Promise.all([
			doc.content.$jazz.raw.core.waitForSync({ timeout: 5_000 }),
			doc.$jazz.raw.core.waitForSync({ timeout: 5_000 }),
		])
	}

	function calculateDiff(oldContent: string, newContent: string) {
		if (closed)
			return Promise.reject(new Error("Document diff worker is closed"))
		let requestId = nextRequestId++
		let result = deferred<DocumentContentPatch[]>()
		requests.set(requestId, result)
		let request: DocumentSaveWorkerRequest = {
			type: "diff",
			requestId,
			oldContent,
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

function deferred<T>() {
	let resolvePromise: (value: T | PromiseLike<T>) => void = () => {}
	let rejectPromise: (reason?: unknown) => void = () => {}
	let promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve
		rejectPromise = reject
	})
	return { promise, resolve: resolvePromise, reject: rejectPromise }
}
