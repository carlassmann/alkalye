import { exportComments, importComments } from "../lib/comment-format"
import { useRef, useState } from "react"
import {
	app,
	useLibrary,
	createDocument,
	updateContent,
	type Database,
	type LibraryDocument as SidebarDoc,
} from "@/app/features/documents"
import { createAssetFromFile, readAssetBlob } from "@/app/features/assets"
import { getPath, setFrontmatterField } from "@/app/features/editor"
import { Button } from "@/app/components/ui/button"
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
	exportDocumentsAsZip,
	transformWikilinksForExport,
	stripBacklinksFrontmatter,
} from "../lib/export"
import {
	ImportProgressDialog,
	type ImportProgress,
} from "./import-progress-dialog"
import { StorageModeMenuItems } from "@/app/components/storage-mode-menu"
import { T, useIntl } from "@/shared/intl/setup"
export { SidebarImportExport, handleImportFiles }
export type { ImportOptions }
type ImportOptions = {
	onProgress?: (progress: ImportProgress) => void
	signal?: AbortSignal
}
function SidebarImportExport({
	docs,
	onImport: importHandler,
}: {
	docs?: SidebarDoc[]
	onImport?: (files: ImportedFile[], options?: ImportOptions) => Promise<void>
}) {
	let { db, ownerId, documents } = useLibrary()
	let activeDocs = docs ?? documents.filter(doc => !doc.deletedAt)
	let onImport =
		importHandler ??
		((files: ImportedFile[], options?: ImportOptions) =>
			handleImportFiles(files, db, ownerId, options))
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
						<DropdownMenuItem onClick={() => handleExportAll(db, activeDocs)}>
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
	db: Database,
	ownerId: string,
	options: ImportOptions = {},
) {
	let created: {
		doc: Awaited<ReturnType<typeof createDocument>>
		title: string
		path: string | null
	}[] = []
	for (let [fileIndex, file] of imported.entries()) {
		options.signal?.throwIfAborted()
		let content = file.content
		if (!content.trimStart().startsWith("---"))
			content = setFrontmatterField(content, "title", file.name)
		if (file.path && !getPath(content))
			content = setFrontmatterField(content, "path", file.path)
		let doc = await createDocument(db, ownerId, content)
		for (let [assetIndex, asset] of file.assets.entries()) {
			options.signal?.throwIfAborted()
			options.onProgress?.({
				phase: "creating",
				currentFile: file.name,
				fileIndex,
				totalFiles: imported.length,
				assetIndex,
				totalAssets: file.assets.length,
				compressionProgress: 0,
			})
			let row = await createAssetFromFile(db, doc.id, {
				blob: asset.file,
				fileName: asset.file.name,
				name: asset.name,
			})
			content = content.replaceAll(`](${asset.refName})`, `](asset:${row.id})`)
		}
		await updateContent(db, doc, content)
		doc = { ...doc, content }
		if (file.comments) await importComments(db, doc.id, ownerId, file.comments)
		created.push({ doc, title: file.name, path: file.path })
	}
	let info = created.map(item => ({
		title: item.title,
		path: item.path,
		newId: item.doc.id,
	}))
	for (let { doc, path } of created)
		await updateContent(
			db,
			doc,
			resolveWikilinksForImport(doc.content, path, info),
		)
}
async function handleExportAll(db: Database, docs: SidebarDoc[]) {
	let titles = docs.map(doc => ({
		id: doc.id,
		title: doc.title,
		path: doc.path,
	}))
	let exported = []
	for (let doc of docs) {
		let assets = await db.all(
			app.assets.where({ documentId: doc.id }).select("id", "name"),
		)
		let binary = await Promise.all(
			assets.map(async asset => ({
				...asset,
				blob: await readAssetBlob(db, asset.id),
			})),
		)
		exported.push({
			title: doc.title,
			path: doc.path,
			content: stripBacklinksFrontmatter(
				transformWikilinksForExport(doc.content, doc.path, titles),
			),
			assets: binary,
			comments: await exportComments(db, doc.id),
		})
	}
	await exportDocumentsAsZip(exported)
}
