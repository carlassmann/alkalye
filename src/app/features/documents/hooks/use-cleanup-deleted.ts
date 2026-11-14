import { useEffect } from "react"
import { useLibrary, type LibraryDocument, type Database } from "../lib/library"
import { permanentlyDeletePersonalDocument } from "../lib/documents"

export { useCleanupDeleted, cleanupDeletedDocuments }

let cooldown = 8 * 60 * 60 * 1000

function useCleanupDeleted(documents: LibraryDocument[]) {
	let { db, ownerId } = useLibrary()
	useEffect(() => {
		let key = `alkalye:lastCleanupRun:${ownerId}`
		async function cleanup() {
			if (Date.now() - Number(localStorage.getItem(key) ?? 0) < cooldown) return
			await cleanupDeletedDocuments(db, documents)
			localStorage.setItem(key, String(Date.now()))
		}
		let timer = setTimeout(() => void cleanup().catch(console.error), 15_000)
		let interval = setInterval(
			() => void cleanup().catch(console.error),
			cooldown,
		)
		return () => {
			clearTimeout(timer)
			clearInterval(interval)
		}
	}, [db, ownerId, documents])
}

async function cleanupDeletedDocuments(
	db: Database,
	documents: LibraryDocument[],
	now = Date.now(),
) {
	for (let doc of documents) {
		if (
			doc.canAdmin &&
			doc.deletedAt &&
			now - doc.deletedAt.getTime() > 30 * 86400000
		)
			await permanentlyDeletePersonalDocument(db, doc)
	}
}
