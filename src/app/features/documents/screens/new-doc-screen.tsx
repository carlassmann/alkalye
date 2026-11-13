import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { createDocument, useLibrary } from "../lib/library"
export { NewDocScreen }
function NewDocScreen() {
	let { db, ownerId } = useLibrary()
	let started = useRef(false)
	let navigate = useNavigate()
	useEffect(() => {
		if (started.current) return
		started.current = true
		void createDocument(db, ownerId).then(doc =>
			navigate({ to: "/doc/$id", params: { id: doc.id }, replace: true }),
		)
	}, [db, ownerId, navigate])
	return <p role="status">Creating document…</p>
}
