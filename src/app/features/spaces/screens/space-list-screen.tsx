import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useLibrary } from "@/app/features/documents"
import { createSpaceDocument, useSpaces } from "../lib/spaces"
import { SpaceNotFound } from "@/app/components/error-states"
export { SpaceListScreen }
function SpaceListScreen({ spaceId }: { spaceId: string }) {
	let { db, ownerId, documents, isLoading } = useLibrary()
	let space = useSpaces().find(space => space.id === spaceId)
	let creating = useRef(false)
	let navigate = useNavigate()
	useEffect(() => {
		if (isLoading || !space) return
		let doc = documents
			.filter(doc => doc.spaceId === spaceId && !doc.deletedAt)
			.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
		if (doc)
			void navigate({
				to: "/spaces/$spaceId/doc/$id",
				params: { spaceId, id: doc.id },
				replace: true,
			})
		else if (!space.role || space.role === "reader")
			void navigate({ to: "/", search: { personal: true } })
		else if (!creating.current) {
			creating.current = true
			void createSpaceDocument(db, ownerId, spaceId).then(doc =>
				navigate({
					to: "/spaces/$spaceId/doc/$id",
					params: { spaceId, id: doc.id },
					replace: true,
				}),
			)
		}
	}, [db, ownerId, documents, isLoading, space, spaceId, navigate])
	if (!isLoading && !space) return <SpaceNotFound />
	return <p role="status">Opening space…</p>
}
