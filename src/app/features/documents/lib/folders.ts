import { co } from "jazz-tools"
import { Document } from "@/schema"
import { getPath, parseFrontmatter } from "@/app/features/editor"
import { applyContentDiffLoadingCommentAnchors } from "@/app/features/comments"
import { canEdit } from "@/app/features/sharing"
import { tryCatch } from "@/app/lib/try-catch"
import { syncDocumentMetadata } from "./metadata"

export type { BatchResult }
export {
	makeFolderDocumentContent,
	applyFolderPathToContent,
	moveDocumentToFolder,
	moveDocumentsToFolder,
}

type BatchResult = { changed: number; skipped: number }

function makeFolderDocumentContent(path: string): string {
	return `---\ntitle: Untitled\npath: ${path}\n---\n\n`
}

function applyFolderPathToContent(
	content: string,
	newPath: string | null,
): string {
	let { frontmatter } = parseFrontmatter(content)
	let currentPath = getPath(content)

	if (currentPath === newPath) return content
	if (!frontmatter) {
		if (!newPath) return content
		return `---\npath: ${newPath}\n---\n\n${content}`
	}
	if (currentPath && !newPath) {
		return content.replace(
			/^(---\r?\n[\s\S]*?)path:\s*[^\r\n]*\r?\n([\s\S]*?---)/,
			"$1$2",
		)
	}
	if (currentPath && newPath) {
		return content.replace(
			/^(---\r?\n[\s\S]*?)path:\s*[^\r\n]*/,
			`$1path: ${newPath}`,
		)
	}
	if (!newPath) return content
	return content.replace(/^(---\r?\n)/, `$1path: ${newPath}\n`)
}

async function moveDocumentToFolder(
	doc: co.loaded<typeof Document, { content: true }>,
	newPath: string | null,
): Promise<boolean> {
	if (!doc.content) return false

	let content = doc.content.toString()
	let newContent = applyFolderPathToContent(content, newPath)
	if (newContent === content) return false

	await applyContentDiffLoadingCommentAnchors(doc, newContent)
	doc.$jazz.set("updatedAt", new Date())
	syncDocumentMetadata(doc)
	return true
}

// One unwritable document must not stop the rest of the batch
async function moveDocumentsToFolder(
	docs: co.loaded<typeof Document>[],
	newPath: string | null,
): Promise<BatchResult> {
	let result: BatchResult = { changed: 0, skipped: 0 }
	for (let doc of docs) {
		if (!canEdit(doc)) {
			result.skipped++
			continue
		}
		let moved = await tryCatch(moveLoadedDocumentToFolder(doc, newPath))
		if (!moved.ok) result.skipped++
		else if (moved.value) result.changed++
	}
	return result
}

async function moveLoadedDocumentToFolder(
	doc: co.loaded<typeof Document>,
	newPath: string | null,
): Promise<boolean> {
	let loaded = await doc.$jazz.ensureLoaded({ resolve: { content: true } })
	return moveDocumentToFolder(loaded, newPath)
}
