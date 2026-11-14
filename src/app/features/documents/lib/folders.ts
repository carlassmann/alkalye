import {
	readDocument,
	type Database,
	type LibraryDocument,
	updateContent,
} from "./library"
import { getPath, parseFrontmatter } from "@/app/features/editor"
import { canEdit } from "@/app/features/sharing"
import { tryCatch } from "@/app/lib/try-catch"

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
	db: Database,
	doc: LibraryDocument,
	newPath: string | null,
): Promise<boolean> {
	let content = (await readDocument(db, doc.id)).content
	let newContent = applyFolderPathToContent(content, newPath)
	if (newContent === content) return false

	await updateContent(db, doc, newContent, content)
	return true
}

// One unwritable document must not stop the rest of the batch
async function moveDocumentsToFolder(
	db: Database,
	docs: LibraryDocument[],
	newPath: string | null,
): Promise<BatchResult> {
	let result: BatchResult = { changed: 0, skipped: 0 }
	for (let doc of docs) {
		if (!canEdit(doc)) {
			result.skipped++
			continue
		}
		let moved = await tryCatch(moveLoadedDocumentToFolder(db, doc, newPath))
		if (!moved.ok) result.skipped++
		else if (moved.value) result.changed++
	}
	return result
}

async function moveLoadedDocumentToFolder(
	db: Database,
	doc: LibraryDocument,
	newPath: string | null,
): Promise<boolean> {
	return moveDocumentToFolder(db, doc, newPath)
}
