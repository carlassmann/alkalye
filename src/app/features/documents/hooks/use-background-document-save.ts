import { useEffect, useRef } from "react"
import type { Account } from "jazz-tools"
import {
	createBackgroundDocumentSave,
	type BackgroundDocumentSave,
} from "../lib/background-document-save"

export { useBackgroundDocumentSave, DOCUMENT_SAVE_DEBOUNCE_MS }

let DOCUMENT_SAVE_DEBOUNCE_MS = 250

function useBackgroundDocumentSave(
	documentId: string,
	account: Account | undefined,
) {
	let saveRef = useRef<BackgroundDocumentSave | null>(null)

	useEffect(() => {
		if (!account) return
		let save = createBackgroundDocumentSave(documentId, account)
		saveRef.current = save
		return () => {
			setTimeout(() => {
				if (saveRef.current === save) saveRef.current = null
				save.close()
			}, DOCUMENT_SAVE_DEBOUNCE_MS + 50)
		}
	}, [account, documentId])

	return saveRef
}
