import { useEffect, useRef } from "react"
import {
	createBackgroundDocumentSave,
	type BackgroundDocumentSave,
	type BackgroundSaveDocument,
} from "../lib/background-document-save"

export { useBackgroundDocumentSave, DOCUMENT_SAVE_DEBOUNCE_MS }

let DOCUMENT_SAVE_DEBOUNCE_MS = 250

function useBackgroundDocumentSave(doc: BackgroundSaveDocument) {
	let saveRef = useRef<BackgroundDocumentSave | null>(null)
	let docRef = useRef(doc)
	let documentId = doc.$jazz.id
	useEffect(() => {
		docRef.current = doc
	}, [doc])

	useEffect(() => {
		let save = createBackgroundDocumentSave(() => docRef.current)
		saveRef.current = save
		return () => {
			setTimeout(() => {
				if (saveRef.current === save) saveRef.current = null
				save.close()
			}, DOCUMENT_SAVE_DEBOUNCE_MS + 50)
		}
	}, [documentId])

	return saveRef
}
