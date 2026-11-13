import { loadThemesForPdf } from "@/app/features/themes"
import { printToPdf, printSlidesToPdf } from "@/app/features/import-export"
import { app, type Database } from "../lib/library"
import { readAssetBlob } from "@/app/features/assets"
import { DuplicateDocDialog } from "./duplicate-doc-dialog"
import { useState, useSyncExternalStore } from "react"
import { useNavigate } from "@tanstack/react-router"

import { FileText } from "lucide-react"
import {
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/app/components/ui/sidebar"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@/app/components/ui/dropdown-menu"
import { testIds } from "@/app/lib/test-ids"
import { getShortcutLabel } from "@/app/lib/shortcut-registry"
import { isFocusMode, toggleFocusMode } from "@/app/lib/focus-mode"

import { canEdit, getDocumentGroup } from "@/app/features/sharing"
import { getPresentationMode } from "@/app/features/presentation"
import {
	canShareDocument,
	shareDocument,
	saveDocumentAs,
	type SlideAspectRatio,
	type SlidePrintLayout,
} from "@/app/features/import-export"
import { useIntl } from "@/shared/intl/setup"
import { useLibrary } from "../lib/library"
import { getDocumentTitle } from "../lib/title"
import {
	getExportAssets,
	makeAddTag,
	makeDownload,
	makeOpenTimeMachine,
	makeRename,
	makeTogglePin,
	makeTurnIntoPresentation,
	type EditorRef,
	type LoadedDocument,
} from "../lib/document-file-actions"
import { runDocumentCommand } from "./document-commands"

export { SidebarFileMenu }

interface SidebarFileMenuProps {
	doc: LoadedDocument & { content: string }
	editor: EditorRef
	spaceId?: string
}

// --- Component ---

function SidebarFileMenu({ doc, editor }: SidebarFileMenuProps) {
	let { db, ownerId, documents: libraryDocuments } = useLibrary()
	let me = libraryDocuments
	let t = useIntl()
	let navigate = useNavigate()
	let {
		isMobile,
		setLeftOpen,
		setRightOpen,
		setLeftOpenMobile,
		setRightOpenMobile,
	} = useSidebar()

	let focusMode = useFocusMode()

	let docWithContent = doc

	// Themes carry binary assets, so load them on demand when exporting

	let [duplicateOpen, setDuplicateOpen] = useState(false)
	let content = doc.content
	let readOnly = !canEdit(doc)
	let docGroup = getDocumentGroup(doc)
	let isAdmin = docGroup?.myRole() === "admin"
	let isPinned = doc.pinned
	let isPresentation = getPresentationMode(content)
	let handlePrintPdf = makePrintPdf(db, content, doc)
	let makePrintSlides = makePrintSlidesFactory(db, content, doc)
	let canShare = canShareDocument()

	return (
		<SidebarMenuItem>
			<DuplicateDocDialog
				doc={doc}
				open={duplicateOpen}
				onOpenChange={setDuplicateOpen}
				onDuplicate={(id, destination) => {
					if (destination)
						void navigate({
							to: "/spaces/$spaceId/doc/$id",
							params: { spaceId: destination.id, id },
						})
					else void navigate({ to: "/doc/$id", params: { id } })
				}}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<SidebarMenuButton
							nativeButton
							data-testid={testIds.doc.fileMenuButton}
						>
							<FileText className="size-4" />
							<span>{t("doc.file")}</span>
						</SidebarMenuButton>
					}
				/>
				<DropdownMenuContent
					align={isMobile ? "center" : "start"}
					side={isMobile ? "bottom" : "left"}
				>
					<DropdownMenuItem onClick={toggleFocusMode}>
						{focusMode ? t("doc.exitFocusMode") : t("doc.focusMode")}
						<DropdownMenuShortcut>
							{getShortcutLabel("focusMode")}
						</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={makeOpenTimeMachine(
							doc,
							navigate,
							setLeftOpen,
							setRightOpen,
							setLeftOpenMobile,
							setRightOpenMobile,
						)}
					>
						{t("doc.timeMachine")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={makeRename(editor, isMobile, setRightOpenMobile)}
						disabled={readOnly}
					>
						{t("doc.rename")}
						<DropdownMenuShortcut>
							{getShortcutLabel("renameDocument")}
						</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={makeTogglePin(db, ownerId, docWithContent)}
						disabled={readOnly}
					>
						{isPinned ? t("doc.unpin") : t("doc.pin")}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={makeAddTag(editor, isMobile, setRightOpenMobile)}
						disabled={readOnly}
					>
						{t("doc.addTag")}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => runDocumentCommand("moveToFolder")}
						disabled={readOnly || !me}
					>
						{t("doc.moveToFolder")}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => runDocumentCommand("moveToSpace")}
						disabled={!me}
					>
						{t("doc.moveToSpace")}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={makeTurnIntoPresentation(
							editor,
							isMobile,
							setRightOpenMobile,
						)}
						disabled={readOnly || isPresentation}
					>
						{t("doc.turnIntoPresentation")}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={makeDownload(db, doc, content)}>
						{t("doc.download")}
					</DropdownMenuItem>
					{canShare && (
						<DropdownMenuItem
							onClick={makeShare(db, doc, content)}
							data-testid={testIds.doc.nativeShareButton}
						>
							{t("doc.shareCopy")}
						</DropdownMenuItem>
					)}
					<DropdownMenuItem onClick={makeSaveAs(content)}>
						{t("doc.saveAs")}
						<DropdownMenuShortcut>
							{getShortcutLabel("saveAs")}
						</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={handlePrintPdf}>
						{t("doc.printToPdf")}
						<DropdownMenuShortcut>
							{getShortcutLabel("print")}
						</DropdownMenuShortcut>
					</DropdownMenuItem>
					{isPresentation && (
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>
								{t("doc.printSlides")}
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								{slidePrintOptions.map(option => (
									<DropdownMenuItem
										key={`${option.layout}-${option.aspectRatio}`}
										onClick={makePrintSlides(option)}
									>
										{t(
											option.layout === "notes"
												? "doc.printSlides.withNotes"
												: "doc.printSlides.slidesOnly",
											{ aspectRatio: option.aspectRatio },
										)}
									</DropdownMenuItem>
								))}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					)}
					<DropdownMenuItem
						onClick={() => setDuplicateOpen(true)}
						data-testid={testIds.doc.duplicateButton}
					>
						{t("doc.duplicate")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{isAdmin ? (
						<DropdownMenuItem
							onClick={() => runDocumentCommand("deleteDocument")}
							className="text-destructive focus:text-destructive"
							data-testid={testIds.doc.deleteButton}
						>
							{t("doc.delete")}
							<DropdownMenuShortcut>
								{getShortcutLabel("deleteDocument")}
							</DropdownMenuShortcut>
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							onClick={() => runDocumentCommand("deleteDocument")}
							className="text-destructive focus:text-destructive"
							disabled={!me}
						>
							{t("doc.leave")}
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</SidebarMenuItem>
	)
}

function useFocusMode() {
	return useSyncExternalStore(callback => {
		let observer = new MutationObserver(callback)
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-focus-mode"],
		})
		return () => observer.disconnect()
	}, isFocusMode)
}

function makeSaveAs(content: string) {
	return async function handleSaveAs() {
		let title = getDocumentTitle(content)
		await saveDocumentAs(content, title)
	}
}

function makeShare(
	db: import("../lib/library").Database,
	doc: LoadedDocument & { content: string },
	content: string,
) {
	return async function handleShare() {
		let docAssets = await getExportAssets(db, doc)
		let title = getDocumentTitle(content)
		await shareDocument(
			content,
			title,
			docAssets.length > 0 ? docAssets : undefined,
			undefined,
		)
	}
}

function makePrintPdf(
	db: Database,
	content: string,
	doc: LoadedDocument & { content: string },
) {
	return async () => {
		let themes = await loadThemesForPdf(db)
		await printToPdf({
			...themes,
			content,
			assets: await printableAssets(db, doc),
		})
	}
}
let slidePrintOptions: {
	layout: SlidePrintLayout
	aspectRatio: SlideAspectRatio
}[] = [
	{ layout: "slides", aspectRatio: "16:9" },
	{ layout: "slides", aspectRatio: "4:3" },
	{ layout: "notes", aspectRatio: "16:9" },
	{ layout: "notes", aspectRatio: "4:3" },
]
function makePrintSlidesFactory(
	db: Database,
	content: string,
	doc: LoadedDocument & { content: string },
) {
	return (option: {
			layout: SlidePrintLayout
			aspectRatio: SlideAspectRatio
		}) =>
		async () => {
			let themes = await loadThemesForPdf(db)
			await printSlidesToPdf({
				...themes,
				...option,
				content,
				assets: await printableAssets(db, doc),
			})
		}
}
async function printableAssets(
	db: Database,
	doc: LoadedDocument & { content: string },
) {
	let rows = await db.all(
		app.assets
			.where({ documentId: doc.id })
			.select("id", "name", "type", "revisionId"),
	)
	return rows.map(row => ({
		...row,
		getBlob: async () => {
			if (row.type === "tldraw" && row.revisionId) {
				let revision = await db.one(
					app.tldrawRevisions
						.where({ id: row.revisionId })
						.select("lightPreview"),
				)
				return revision
					? new Blob([new Uint8Array(revision.lightPreview)], {
							type: "image/png",
						})
					: undefined
			}
			return readAssetBlob(db, row.id)
		},
	}))
}
