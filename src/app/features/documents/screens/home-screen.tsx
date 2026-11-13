import { fetchWelcomeContent } from "@/app/features/onboarding"
import { readLastOpenedDocument } from "../lib/last-opened-document"
import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { createDocument, useLibrary } from "../lib/library"

export { HomeScreen }
function HomeScreen({ personal = false }: { personal?: boolean }) {
	let { db, ownerId, documents, entries, isLoading } = useLibrary()
	let navigate = useNavigate()
	let creating = useRef(false)
	useEffect(() => {
		if (isLoading) return
		let last = readLastOpenedDocument(ownerId)
		let doc =
			documents.find(
				doc =>
					doc.id === last?.documentId &&
					!doc.deletedAt &&
					(!personal || !doc.spaceId),
			) ??
			documents
				.filter(
					doc =>
						!doc.deletedAt &&
						(!personal || !doc.spaceId) &&
						(doc.ownerId === ownerId ||
							entries.some(entry => entry.documentId === doc.id)),
				)
				.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
		if (doc?.spaceId && last?.spaceId) {
			void navigate({
				to: "/spaces/$spaceId/doc/$id",
				params: { spaceId: doc.spaceId, id: doc.id },
				replace: true,
			})
		} else if (doc)
			void navigate({ to: "/doc/$id", params: { id: doc.id }, replace: true })
		else if (!creating.current) {
			creating.current = true
			void fetchWelcomeContent()
				.then(content => createDocument(db, ownerId, content))
				.then(doc =>
					navigate({ to: "/doc/$id", params: { id: doc.id }, replace: true }),
				)
		}
	}, [db, ownerId, documents, entries, isLoading, navigate, personal])
	return <p role="status">Opening documents…</p>
}
