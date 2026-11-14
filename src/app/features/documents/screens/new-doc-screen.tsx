import { createSpaceDocument } from "@/app/features/spaces"
import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { createDocument, useLibrary } from "../lib/library"
export { NewDocScreen }
function NewDocScreen({ spaceId }: { spaceId?: string }) {
	let { db, ownerId } = useLibrary()
	let started = useRef(false)
	let navigate = useNavigate()
	useEffect(() => {
		if (started.current) return
		started.current = true
		void (
			spaceId
				? createSpaceDocument(db, ownerId, spaceId)
				: createDocument(db, ownerId)
		).then(doc =>
			spaceId
				? navigate({
						to: "/spaces/$spaceId/doc/$id",
						params: { spaceId, id: doc.id },
						replace: true,
					})
				: navigate({ to: "/doc/$id", params: { id: doc.id }, replace: true }),
		)
	}, [db, ownerId, navigate, spaceId])
	return <p role="status">Creating document…</p>
}
