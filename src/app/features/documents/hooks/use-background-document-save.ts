import { useEffect, useRef } from "react"
import type { Account } from "jazz-tools"
import {
	createBackgroundDocumentSave,
	type BackgroundDocumentSave,
} from "../lib/background-document-save"

export { useBackgroundDocumentSave }

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
			if (saveRef.current === save) saveRef.current = null
			save.close()
		}
	}, [account, documentId])

	return saveRef
}
