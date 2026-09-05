import { calculateDocumentContentPatches } from "./document-diff"
import { mergeDocumentContent } from "./merge-document-content"
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
		let oldContent = request.oldEntries.join("")
		let content = mergeDocumentContent(
			request.baseContent,
			request.newContent,
			oldContent,
		)
		let patches = calculateDocumentContentPatches(request.oldEntries, content)
		post({ type: "diffed", requestId: request.requestId, content, patches })
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
