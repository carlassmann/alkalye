import { experimental_JazzMessageChannel } from "jazz-tools"
import { startWorker } from "jazz-tools/worker"
import { applyContentDiffWithCommentAnchors } from "@/app/features/comments/lib/comments"
import { syncDocumentMetadata } from "./metadata"
import { Document } from "./schema"
import type {
	DocumentSaveWorkerRequest,
	DocumentSaveWorkerResponse,
} from "./document-save-protocol"

let saveQueue = Promise.resolve()
let shutdown: (() => Promise<void>) | undefined

addEventListener(
	"message",
	(event: MessageEvent<DocumentSaveWorkerRequest>) => {
		let request = event.data
		if (request.type === "initialize") {
			void initialize(request)
			return
		}
		if (request.type === "save") {
			saveQueue = saveQueue.then(() => save(request))
			return
		}
		if (request.type === "close") void stopWorker()
	},
)

async function initialize(
	request: Extract<DocumentSaveWorkerRequest, { type: "initialize" }>,
) {
	try {
		let peer = await experimental_JazzMessageChannel.waitForConnection({
			role: "server",
		})
		let runtime = await startWorker({
			accountID: request.accountId,
			accountSecret: request.accountSecret,
			peer,
			skipInboxLoad: true,
			asActiveAccount: false,
		})
		let doc = await Document.load(request.documentId, {
			loadAs: runtime.worker,
			resolve: { content: true, comments: { $each: true } },
		})
		if (!doc.$isLoaded) throw new Error("Document unavailable in save worker")

		shutdown = runtime.shutdownWorker
		saveDocument = async content => {
			applyContentDiffWithCommentAnchors(doc, content)
			syncDocumentMetadata(doc)
			await Promise.all([
				doc.content.$jazz.raw.core.waitForSync({ timeout: 5_000 }),
				doc.$jazz.raw.core.waitForSync({ timeout: 5_000 }),
			])
		}
		post({ type: "ready" })
	} catch (error) {
		post({ type: "failed", message: errorMessage(error) })
	}
}

let saveDocument: ((content: string) => Promise<void>) | undefined

async function save(
	request: Extract<DocumentSaveWorkerRequest, { type: "save" }>,
) {
	try {
		if (!saveDocument) throw new Error("Save worker not ready")
		await saveDocument(request.content)
		post({ type: "saved", requestId: request.requestId })
	} catch (error) {
		post({
			type: "failed",
			requestId: request.requestId,
			message: errorMessage(error),
		})
	}
}

async function stopWorker() {
	await saveQueue
	await shutdown?.()
	post({ type: "closed" })
	self.close()
}

function post(response: DocumentSaveWorkerResponse) {
	postMessage(response)
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}
