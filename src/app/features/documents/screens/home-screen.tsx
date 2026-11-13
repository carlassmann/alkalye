import { useClassicImportPending } from "@/app/features/classic-import/migration-state"
import { readStorageMode } from "@/app/lib/storage-mode"
import { fetchWelcomeContent } from "@/app/features/onboarding"
import { readLastOpenedDocument } from "../lib/last-opened-document"
import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { createDocument, useLibrary } from "../lib/library"

export { HomeScreen }
function HomeScreen() {
	let { db, ownerId, documents, isLoading } = useLibrary()
	let navigate = useNavigate()
	let creating = useRef(false)
	let importing = useClassicImportPending()
	useEffect(() => {
		if (readStorageMode() === "filesystem") {
			void navigate({ to: "/local", replace: true })
			return
		}
		if (isLoading) return
		let last = readLastOpenedDocument(ownerId)
		let doc =
			documents.find(doc => doc.id === last?.documentId && !doc.deletedAt) ??
			documents
				.filter(doc => !doc.deletedAt)
				.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
		if (doc)
			void navigate({ to: "/doc/$id", params: { id: doc.id }, replace: true })
		else if (!importing && !creating.current) {
			creating.current = true
			void fetchWelcomeContent()
				.then(content => createDocument(db, ownerId, content))
				.then(doc =>
					navigate({ to: "/doc/$id", params: { id: doc.id }, replace: true }),
				)
		}
	}, [db, ownerId, documents, isLoading, navigate, importing])
	return <p role="status">Opening documents…</p>
}
