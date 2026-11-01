import { co } from "jazz-tools"
import { Document } from "@/schema"
import { togglePinned } from "@/app/features/editor"
import { applyContentDiffLoadingCommentAnchors } from "@/app/features/comments"
import { canEdit } from "@/app/features/sharing"
import { tryCatch } from "@/app/lib/try-catch"
import { syncDocumentMetadata } from "./metadata"
import type { BatchResult } from "./folders"

export { toggleDocumentPinned, setDocumentsPinned }

async function toggleDocumentPinned(doc: co.loaded<typeof Document>) {
	let loaded = await doc.$jazz.ensureLoaded({ resolve: { content: true } })
	let content = loaded.content.toString()
	let newContent = togglePinned(content)
	await applyContentDiffLoadingCommentAnchors(loaded, newContent)
	loaded.$jazz.set("updatedAt", new Date())
	syncDocumentMetadata(loaded)
}

async function setDocumentsPinned(
	docs: co.loaded<typeof Document>[],
	pinned: boolean,
): Promise<BatchResult> {
	let result: BatchResult = { changed: 0, skipped: 0 }
	for (let doc of docs) {
		if ((doc.pinned ?? false) === pinned) continue
		if (!canEdit(doc)) {
			result.skipped++
			continue
		}
		let toggled = await tryCatch(toggleDocumentPinned(doc))
		if (toggled.ok) result.changed++
		else result.skipped++
	}
	return result
}
