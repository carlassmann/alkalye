import { useEffect } from "react"
import { writeLastOpenedDocument } from "../lib/last-opened-document"

export { useTrackLastOpened }

function useTrackLastOpened(
	accountId: string,
	documentId: string,
	spaceId?: string,
) {
	useEffect(() => {
		writeLastOpenedDocument(accountId, documentId, spaceId)
	}, [accountId, documentId, spaceId])
}
