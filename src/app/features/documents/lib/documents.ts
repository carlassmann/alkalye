import { app, setPinned, type Database, type LibraryDocument } from "./library"
import { watchWrite } from "./writes"

export {
	permanentlyDeletePersonalDocument,
	getDaysUntilPermanentDelete,
	setDocumentsPinned,
}

async function permanentlyDeletePersonalDocument(
	db: Database,
	doc: LibraryDocument,
) {
	watchWrite(db.delete(app.documents, doc.id))
}
function getDaysUntilPermanentDelete(date: Date) {
	return Math.max(0, 30 - Math.floor((Date.now() - date.getTime()) / 86400000))
}
async function setDocumentsPinned(
	db: Database,
	ownerId: string,
	docs: LibraryDocument[],
	pinned: boolean,
) {
	for (let doc of docs) await setPinned(db, ownerId, doc, pinned)
	return { changed: docs.length, skipped: 0 }
}
