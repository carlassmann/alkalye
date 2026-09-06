import JSZip from "jszip"
import { assetExtensionFromMimeType } from "@/app/features/assets"
import type { ExportComment } from "@/app/features/comments"

export {
	exportDocument,
	createDocumentExport,
	canShareDocument,
	shareDocument,
	saveDocumentAs,
	exportDocumentsAsZip,
	getExtensionFromBlob,
	sanitizeFilename,
	transformWikilinksForExport,
	stripBacklinksFrontmatter,
	getRelativePath,
	type ExportAsset,
	type ExportComment,
	type ExportDoc,
}

interface ExportAsset {
	id: string
	name: string
	blob: Blob
}

interface ExportDoc {
	title: string
	content: string
	assets?: ExportAsset[]
	path?: string | null
	comments?: ExportComment[]
}

async function exportDocument(
	content: string,
	filename: string,
	assets?: ExportAsset[],
	comments?: ExportComment[],
) {
	let file = await createDocumentExport(content, filename, assets, comments)
	downloadFile(file)
}

async function createDocumentExport(
	content: string,
	filename: string,
	assets?: ExportAsset[],
	comments?: ExportComment[],
) {
	let safeName = sanitizeFilename(filename)
	let hasComments = comments && comments.length > 0

	if ((!assets || assets.length === 0) && !hasComments)
		return createDocumentFile(content, safeName)

	let zip = new JSZip()
	let docFolder = zip.folder(safeName)!
	let assetNameMap = new Map<string, string>()
	let usedAssetNames = new Set<string>()

	if (assets && assets.length > 0) {
		let assetsFolder = docFolder.folder("assets")!
		for (let asset of assets) {
			let ext = getExtensionFromBlob(asset.blob)
			let baseName =
				asset.name.replace(/[^a-zA-Z0-9-_\s]/g, "").trim() || "image"
			let fileName = baseName + ext
			let counter = 1

			while (usedAssetNames.has(fileName)) {
				fileName = `${baseName}-${counter++}${ext}`
			}
			usedAssetNames.add(fileName)

			assetsFolder.file(fileName, asset.blob)
			assetNameMap.set(asset.id, `assets/${fileName}`)
		}
	}

	let exportedContent = content.replace(
		/!\[([^\]]*)\]\(asset:([^)]+)\)/g,
		(match, alt, assetId) => {
			let newPath = assetNameMap.get(assetId)
			if (newPath) {
				return `![${alt}](${newPath})`
			}
			return match
		},
	)

	docFolder.file(`${safeName}.md`, exportedContent)
	writeCommentSidecar(docFolder, `${safeName}.comments.json`, comments)

	let blob = await zip.generateAsync({ type: "blob" })
	return new File([blob], `${safeName}.zip`, { type: "application/zip" })
}

function downloadFile(file: File) {
	let url = URL.createObjectURL(file)
	let a = document.createElement("a")
	a.href = url
	a.download = file.name
	a.click()
	URL.revokeObjectURL(url)
}

function canShareDocument() {
	if (
		typeof navigator === "undefined" ||
		typeof navigator.share !== "function" ||
		typeof navigator.canShare !== "function"
	)
		return false

	return navigator.canShare({
		files: [createDocumentFile("", "document")],
	})
}

async function shareDocument(
	content: string,
	suggestedName: string,
	assets?: ExportAsset[],
	comments?: ExportComment[],
) {
	if (!canShareDocument()) return false

	let safeName = sanitizeFilename(suggestedName)
	let file = await createDocumentExport(content, safeName, assets, comments)
	if (!navigator.canShare({ files: [file] })) return false

	try {
		await navigator.share({ files: [file], title: safeName })
		return true
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return false
		throw error
	}
}

function createDocumentFile(content: string, name: string) {
	return new File([content], `${name}.md`, {
		type: "text/markdown;charset=utf-8",
	})
}

async function saveDocumentAs(content: string, suggestedName: string) {
	let safeName = sanitizeFilename(suggestedName)

	let w = window as Window &
		typeof globalThis & {
			showSaveFilePicker?: (options: {
				suggestedName: string
				types: { description: string; accept: Record<string, string[]> }[]
			}) => Promise<FileSystemFileHandle>
		}

	if (w.showSaveFilePicker) {
		try {
			let handle = await w.showSaveFilePicker({
				suggestedName: `${safeName}.md`,
				types: [
					{
						description: "Markdown file",
						accept: { "text/markdown": [".md"] },
					},
				],
			})
			let writable = await handle.createWritable()
			await writable.write(content)
			await writable.close()
			return
		} catch (e) {
			if (e instanceof Error && e.name === "AbortError") return
			throw e
		}
	}

	// Fallback for browsers without File System Access API
	let blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
	let url = URL.createObjectURL(blob)
	let a = document.createElement("a")
	a.href = url
	a.download = `${safeName}.md`
	a.click()
	URL.revokeObjectURL(url)
}

function sanitizeFilename(name: string): string {
	// Remove filesystem-unsafe characters: < > : " / \ | ? * and control chars (0x00-0x1f)
	let result = ""
	for (let char of name) {
		let code = char.charCodeAt(0)
		let isUnsafe = code < 0x20 || '<>:"/\\|?*'.includes(char)
		result += isUnsafe ? "_" : char
	}
	return result.trim() || "untitled"
}

function getExtensionFromBlob(blob: Blob): string {
	return assetExtensionFromMimeType(blob.type) ?? ".png"
}

// Structure:
// - No assets, no path: {title}.md at root
// - Has assets, no path: {title}/{title}.md + {title}/assets/
// - No assets, has path: {path}/{title}.md
// - Has assets, has path: {path}/{title}/{title}.md + {path}/{title}/assets/

async function exportDocumentsAsZip(docs: ExportDoc[]) {
	let zip = new JSZip()
	let usedNames = new Map<string, Set<string>>() // parentPath -> used names

	for (let doc of docs) {
		let baseName = sanitizeFilename(doc.title)
		let hasAssets = doc.assets && doc.assets.length > 0
		let parentPath = doc.path ?? ""

		// Track used names at parent level for conflict detection
		if (!usedNames.has(parentPath)) usedNames.set(parentPath, new Set())
		let used = usedNames.get(parentPath)!

		let docName = baseName
		let counter = 1
		while (used.has(docName.toLowerCase())) {
			docName = `${baseName}-${counter++}`
		}
		used.add(docName.toLowerCase())

		// Build asset name map for this doc
		let assetNameMap = new Map<string, string>()
		if (hasAssets) {
			let usedAssetNames = new Set<string>()
			for (let asset of doc.assets!) {
				let ext = getExtensionFromBlob(asset.blob)
				let assetBaseName =
					asset.name.replace(/[^a-zA-Z0-9-_\s]/g, "").trim() || "image"
				let fileName = assetBaseName + ext
				let assetCounter = 1
				while (usedAssetNames.has(fileName.toLowerCase())) {
					fileName = `${assetBaseName}-${assetCounter++}${ext}`
				}
				usedAssetNames.add(fileName.toLowerCase())
				assetNameMap.set(asset.id, fileName)
			}
		}

		// Transform asset references in content
		let exportedContent = doc.content.replace(
			/!\[([^\]]*)\]\(asset:([^)]+)\)/g,
			(match, alt, assetId) => {
				let assetFilename = assetNameMap.get(assetId)
				if (assetFilename) {
					return `![${alt}](assets/${assetFilename})`
				}
				return match
			},
		)

		if (hasAssets) {
			// Doc with assets: {parentPath}/{docName}/{docName}.md + assets/
			let docFolderPath = parentPath ? `${parentPath}/${docName}` : docName
			let docFolder = zip.folder(docFolderPath)!
			docFolder.file(`${docName}.md`, exportedContent)
			writeCommentSidecar(docFolder, `${docName}.comments.json`, doc.comments)

			let assetsFolder = docFolder.folder("assets")!
			for (let asset of doc.assets!) {
				let fileName = assetNameMap.get(asset.id)!
				assetsFolder.file(fileName, asset.blob)
			}
		} else {
			// Doc without assets: {parentPath}/{docName}.md
			let filePath = parentPath
				? `${parentPath}/${docName}.md`
				: `${docName}.md`
			zip.file(filePath, exportedContent)
			let commentPath = parentPath
				? `${parentPath}/${docName}.comments.json`
				: `${docName}.comments.json`
			writeCommentSidecar(zip, commentPath, doc.comments)
		}
	}

	let blob = await zip.generateAsync({ type: "blob" })
	let url = URL.createObjectURL(blob)
	let a = document.createElement("a")
	a.href = url
	a.download = "documents.zip"
	a.click()
	URL.revokeObjectURL(url)
}

type DocPathInfo = {
	id: string
	title: string
	path: string | null
}

/**
 * Transform wikilinks from [[doc_id]] to [[relative/path]] for export.
 * - Same folder: [[Title]]
 * - Different folder: [[../other/path/Title]] or [[path/to/Title]]
 * - Not in export: [[Title]] (just the title, no path)
 */
function transformWikilinksForExport(
	content: string,
	currentDocPath: string | null,
	allDocs: DocPathInfo[],
): string {
	let docMap = new Map(allDocs.map(d => [d.id, d]))

	return content.replace(/\[\[([^\]]+)\]\]/g, (match, docId) => {
		let targetDoc = docMap.get(docId)
		if (!targetDoc) {
			// Doc not in export - just use the ID as-is (will be treated as title on import)
			return match
		}

		let relativePath = getRelativePath(
			currentDocPath,
			targetDoc.path,
			targetDoc.title,
		)
		return `[[${relativePath}]]`
	})
}

/**
 * Get relative path from source doc to target doc.
 * - Same folder: just "Title"
 * - One level up: "../Title" or "../other/Title"
 * - More than one level up: use absolute "/path/to/Title"
 * - Descending into subfolder: "sub/Title"
 */
function getRelativePath(
	fromPath: string | null,
	toPath: string | null,
	toTitle: string,
): string {
	let safeTitle = sanitizeFilename(toTitle)
	let targetFullPath = toPath ? `${toPath}/${safeTitle}` : safeTitle

	// Both at root level
	if (!fromPath && !toPath) {
		return safeTitle
	}

	// Source at root, target in folder - use absolute
	if (!fromPath && toPath) {
		return `/${targetFullPath}`
	}

	// Source in folder, target at root
	if (fromPath && !toPath) {
		let depth = fromPath.split("/").length
		if (depth > 1) {
			return `/${safeTitle}`
		}
		return `../${safeTitle}`
	}

	// Both in folders - calculate relative path
	let fromParts = fromPath!.split("/")
	let toParts = toPath!.split("/")

	// Find common prefix
	let commonLength = 0
	while (
		commonLength < fromParts.length &&
		commonLength < toParts.length &&
		fromParts[commonLength] === toParts[commonLength]
	) {
		commonLength++
	}

	// Same folder
	if (commonLength === fromParts.length && commonLength === toParts.length) {
		return safeTitle
	}

	let upsNeeded = fromParts.length - commonLength

	// More than one level up -> use absolute path
	if (upsNeeded > 1) {
		return `/${targetFullPath}`
	}

	// One level up or descending
	let remainingPath = toParts.slice(commonLength).join("/")

	if (upsNeeded === 1 && remainingPath) {
		return `../${remainingPath}/${safeTitle}`
	} else if (upsNeeded === 1) {
		return `../${safeTitle}`
	} else {
		return `${remainingPath}/${safeTitle}`
	}
}

/**
 * Strip the backlinks frontmatter field from content.
 * Backlinks will be regenerated on import.
 */
function stripBacklinksFrontmatter(content: string): string {
	// Match frontmatter block
	let frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
	if (!frontmatterMatch) return content

	let frontmatter = frontmatterMatch[1]
	let afterFrontmatter = content.slice(frontmatterMatch[0].length)

	// Remove backlinks line from frontmatter
	let lines = frontmatter.split("\n")
	let filteredLines = lines.filter(line => !line.startsWith("backlinks:"))

	// If no lines left, remove frontmatter entirely
	if (filteredLines.length === 0 || filteredLines.every(l => l.trim() === "")) {
		return afterFrontmatter
	}

	return `---\n${filteredLines.join("\n")}\n---\n${afterFrontmatter}`
}

function writeCommentSidecar(
	zip: JSZip,
	path: string,
	comments: ExportComment[] | undefined,
) {
	if (!comments || comments.length === 0) return
	zip.file(path, stringifyCommentSidecar(comments))
}

function stringifyCommentSidecar(comments: ExportComment[]) {
	return JSON.stringify({ version: 1, comments }, null, 2)
}
