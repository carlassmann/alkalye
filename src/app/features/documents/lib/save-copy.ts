import type { useNavigate } from "@tanstack/react-router"
import { copyDocumentAssets } from "@/app/features/assets"
import { exportComments, importComments } from "@/app/features/import-export"
import {
	createDocument,
	updateContent,
	type Database,
	type LibraryDocument,
} from "./library"

export { handleSaveCopy }

async function handleSaveCopy(
	db: Database,
	ownerId: string,
	doc: LibraryDocument & { content: string },
	setState: (state: "idle" | "saving" | "saved") => void,
	navigate: ReturnType<typeof useNavigate>,
) {
	setState("saving")
	try {
		let copy = await createDocument(db, ownerId, doc.content)
		await updateContent(
			db,
			copy,
			await copyDocumentAssets(db, doc.id, copy.id, doc.content),
		)
		await importComments(
			db,
			copy.id,
			ownerId,
			await exportComments(db, doc.id),
			doc.content,
		)
		setState("saved")
		setTimeout(() => {
			void navigate({ to: "/doc/$id", params: { id: copy.id } })
		}, 1000)
	} catch (error) {
		console.error("Failed to save copy:", error)
		setState("idle")
	}
}
