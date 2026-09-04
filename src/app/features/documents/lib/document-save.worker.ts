import { calculateDocumentContentPatches } from "./document-diff"
import type {
	DocumentSaveWorkerRequest,
	DocumentSaveWorkerResponse,
} from "./document-save-protocol"

addEventListener(
	"message",
	(event: MessageEvent<DocumentSaveWorkerRequest>) => {
		let request = event.data
		if (request.type === "diff") {
			diffContent(request)
			return
		}
		post({ type: "closed" })
		self.close()
	},
)

function diffContent(
	request: Extract<DocumentSaveWorkerRequest, { type: "diff" }>,
) {
	try {
		let patches = calculateDocumentContentPatches(
			request.oldEntries,
			request.newContent,
		)
		post({ type: "diffed", requestId: request.requestId, patches })
	} catch (error) {
		post({
			type: "failed",
			requestId: request.requestId,
			message: error instanceof Error ? error.message : String(error),
		})
	}
}

function post(response: DocumentSaveWorkerResponse) {
	postMessage(response)
}
