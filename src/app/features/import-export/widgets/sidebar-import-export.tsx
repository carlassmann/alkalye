import { useRef, useState } from "react"
import { Group, co } from "jazz-tools"
import { Document, Asset } from "@/schema"
import {
	assetContentResolve,
	classifyAssetFile,
	compressVideo,
	canEncodeVideo,
	createAssetFromFile,
	serializeAsset,
} from "@/app/features/assets"
import { getPath } from "@/app/features/editor"
import { Button } from "@/app/components/ui/button"
import {
	createDocumentMetadata,
	syncDocumentMetadata,
} from "@/app/features/documents"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSeparator,
} from "@/app/components/ui/dropdown-menu"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import { Download, MoreHorizontal, Upload } from "lucide-react"
import {
	importMarkdownFiles,
	resolveWikilinksForImport,
	type ImportedFile,
} from "../lib/import"
import {
	applyContentDiffWithCommentAnchors,
	restoreExportedComments,
} from "@/app/features/comments"
import {
	exportDocumentsAsZip,
	transformWikilinksForExport,
	stripBacklinksFrontmatter,
	type ExportAsset,
} from "../lib/export"
import {
	getExportCommentsForContent,
	type ExportComment,
} from "@/app/features/comments"
import {
	ImportProgressDialog,
	type ImportProgress,
} from "./import-progress-dialog"
import type { SidebarDoc } from "@/app/features/documents"
import { StorageModeMenuItems } from "@/app/components/storage-mode-menu"
import { T, useIntl } from "@/shared/intl/setup"

export { SidebarImportExport, handleImportFiles }
export type { ImportOptions }

type DocumentList = co.loaded<ReturnType<typeof co.list<typeof Document>>>

type ImportOptions = {
	onProgress?: (progress: ImportProgress) => void
	signal?: AbortSignal
}

function SidebarImportExport({
	docs: activeDocs,
	onImport,
}: {
	docs: SidebarDoc[]
	onImport: (files: ImportedFile[], options?: ImportOptions) => Promise<void>
}) {
	let t = useIntl()
	let fileInputRef = useRef<HTMLInputElement>(null)
	let [importProgress, setImportProgress] = useState<ImportProgress | null>(
		null,
	)
	let [abortController, setAbortController] = useState<AbortController | null>(
		null,
	)

	async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
		if (e.target.files && e.target.files.length > 0) {
			let controller = new AbortController()
			setAbortController(controller)
			setImportProgress({
				phase: "reading",
				currentFile: t("importExport.progress.readingFilesInitial"),
				fileIndex: 0,
				totalFiles: 1,
				assetIndex: 0,
				totalAssets: 0,
				compressionProgress: 0,
			})

			try {
				let imported = await importMarkdownFiles(e.target.files)
				if (controller.signal.aborted) return

				await onImport(imported, {
					onProgress: setImportProgress,
					signal: controller.signal,
				})
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") {
					// Cancelled
				} else {
					console.error("Import failed:", err)
				}
			} finally {
				setImportProgress(null)
				setAbortController(null)
			}
		}
		e.target.value = ""
	}

	function handleCancelImport() {
		abortController?.abort()
		setImportProgress(null)
		setAbortController(null)
	}

	return (
		<>
			<input
				ref={fileInputRef}
				type="file"
				accept=".md,.markdown,.txt,.zip,.comments.json"
				multiple
				className="hidden"
				onChange={handleFileChange}
			/>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger
						render={
							<DropdownMenuTrigger
								render={
									<Button
										size="icon-sm"
										variant="ghost"
										nativeButton
										aria-label="File options"
									>
										<MoreHorizontal className="size-4" />
									</Button>
								}
							/>
						}
					/>
					<TooltipContent side="bottom">File options</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
						<Download />
						<T k="importExport.import" />
					</DropdownMenuItem>
					{activeDocs.length > 0 && (
						<DropdownMenuItem onClick={() => handleExportDocs(activeDocs)}>
							<Upload />
							<T k="importExport.exportAll" />
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<StorageModeMenuItems />
				</DropdownMenuContent>
			</DropdownMenu>
			{importProgress && (
				<ImportProgressDialog
					open={true}
					progress={importProgress}
					onCancel={handleCancelImport}
				/>
			)}
		</>
	)
}

async function handleImportFiles(
	imported: ImportedFile[],
	targetDocs: DocumentList,
	options: ImportOptions = {},
) {
	let { onProgress, signal } = options
	let listOwner = targetDocs.$jazz.owner

	// Phase 1: Create all documents and collect their info for wikilink resolution
	let createdDocs: {
		doc: co.loaded<typeof Document>
		title: string
		path: string | null
	}[] = []

	for (let fileIndex = 0; fileIndex < imported.length; fileIndex++) {
		if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

		let {
			name,
			content,
			assets: importedAssets,
			path,
			comments,
		} = imported[fileIndex]
		let now = new Date()
		let title = name.replace(/\.(md|markdown|txt)$/i, "")

		onProgress?.({
			phase: "creating",
			currentFile: title,
			fileIndex,
			totalFiles: imported.length,
			assetIndex: 0,
			totalAssets: importedAssets.length,
			compressionProgress: 0,
		})

		let processedContent = content
		let hasFrontmatter = content.trimStart().startsWith("---")

		if (!hasFrontmatter) {
			let pathLine = path ? `path: ${path}\n` : ""
			processedContent = `---\ntitle: ${title}\n${pathLine}---\n\n${content}`
		} else if (path) {
			let existingPath = getPath(content)
			if (!existingPath) {
				processedContent = content.replace(/^(---\r?\n)/, `$1path: ${path}\n`)
			}
		}

		// Create doc-specific group with list owner as parent
		let docGroup = Group.create()
		docGroup.addMember(listOwner)

		let docAssets: co.loaded<typeof Asset>[] = []
		for (let assetIndex = 0; assetIndex < importedAssets.length; assetIndex++) {
			if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

			let importedAsset = importedAssets[assetIndex]
			let kind = classifyAssetFile(importedAsset.file)
			if (!kind)
				throw new Error(`Unsupported asset: ${importedAsset.file.name}`)
			let blob: Blob = importedAsset.file
			if (kind === "video") {
				// Compress video if supported, otherwise use original
				if (await canEncodeVideo()) {
					onProgress?.({
						phase: "compressing",
						currentFile: importedAsset.name,
						fileIndex,
						totalFiles: imported.length,
						assetIndex,
						totalAssets: importedAssets.length,
						compressionProgress: 0,
					})
					try {
						blob = await compressVideo(importedAsset.file, {
							onProgress: p =>
								onProgress?.({
									phase: "compressing",
									currentFile: importedAsset.name,
									fileIndex,
									totalFiles: imported.length,
									assetIndex,
									totalAssets: importedAssets.length,
									compressionProgress: p.progress,
								}),
							signal,
						})
					} catch {
						// Fall back to original if compression fails (but not if cancelled)
						if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
					}
				}
			}
			let asset = await createAssetFromFile(
				{
					blob,
					fileName: importedAsset.file.name,
					name: importedAsset.name,
					createdAt: now,
				},
				docGroup,
			)
			docAssets.push(asset)

			if (importedAsset.refName) {
				let escapedRef = importedAsset.refName.replace(
					/[.*+?^${}()|[\]\\]/g,
					"\\$&",
				)
				processedContent = processedContent.replace(
					new RegExp(`!\\[([^\\]]*)\\]\\(${escapedRef}\\)`, "g"),
					`![$1](asset:${asset.$jazz.id})`,
				)
			}
		}

		let newDoc = Document.create(
			{
				version: 1,
				content: co.plainText().create(processedContent, docGroup),
				assets:
					docAssets.length > 0
						? co.list(Asset).create(docAssets, docGroup)
						: undefined,
				...createDocumentMetadata(processedContent, now),
				createdAt: now,
				updatedAt: now,
			},
			docGroup,
		)

		let loadedDoc = await newDoc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: { replies: true } } },
		})
		if (loadedDoc) {
			syncDocumentMetadata(loadedDoc)
			if (comments?.length)
				restoreExportedComments(loadedDoc, comments, content)
		}

		targetDocs.$jazz.push(newDoc)
		createdDocs.push({ doc: newDoc, title, path })
	}

	// Phase 2: Resolve wikilinks now that all docs exist with their new IDs
	let docInfoForResolution = createdDocs.map(d => ({
		title: d.title,
		path: d.path,
		newId: d.doc.$jazz.id,
	}))

	for (let { doc, path } of createdDocs) {
		let loadedDoc = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: true } },
		})
		if (!loadedDoc) continue
		let currentContent = loadedDoc.content.toString()
		let resolvedContent = resolveWikilinksForImport(
			currentContent,
			path,
			docInfoForResolution,
		)
		if (resolvedContent !== currentContent) {
			applyContentDiffWithCommentAnchors(loadedDoc, resolvedContent)
			loadedDoc.$jazz.set("updatedAt", new Date())
			syncDocumentMetadata(loadedDoc)
		}
	}
}

// --- Helpers ---

async function handleExportDocs(docs: SidebarDoc[]) {
	if (docs.length === 0) return

	let docPathInfo = docs.map(d => ({
		id: d.$jazz.id,
		title: d.title ?? "Untitled",
		path: d.path ?? null,
	}))

	let exportDocs: {
		title: string
		content: string
		assets?: ExportAsset[]
		path?: string | null
		comments?: ExportComment[]
	}[] = []

	for (let d of docs) {
		let loaded = await d.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: { replies: true } } },
		})
		let content = loaded.content?.toString() ?? ""
		let docPath = d.path ?? null

		let transformedContent = transformWikilinksForExport(
			content,
			docPath,
			docPathInfo,
		)
		transformedContent = stripBacklinksFrontmatter(transformedContent)

		let docAssets = await loadDocumentAssets(d)
		let exportComments = getExportCommentsForContent(loaded, transformedContent)
		exportDocs.push({
			title: d.title ?? "Untitled",
			content: transformedContent,
			assets: docAssets.length > 0 ? docAssets : undefined,
			path: docPath,
			comments: exportComments,
		})
	}

	if (exportDocs.length > 0) {
		await exportDocumentsAsZip(exportDocs)
	}
}

async function loadDocumentAssets(
	doc: co.loaded<typeof Document>,
): Promise<ExportAsset[]> {
	let loaded = await doc.$jazz.ensureLoaded({
		resolve: {
			assets: {
				$each: assetContentResolve,
			},
		},
	})
	let docAssets: ExportAsset[] = []

	if (loaded.assets?.$isLoaded) {
		for (let asset of Array.from(loaded.assets)) {
			if (!asset?.$isLoaded) continue

			let blob = await serializeAsset(asset)
			if (blob) docAssets.push({ id: asset.$jazz.id, name: asset.name, blob })
		}
	}

	return docAssets
}
