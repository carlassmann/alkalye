import { useSyncExternalStore } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAccount } from "jazz-tools/react"
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
import { UserAccount } from "@/schema"
import { canEdit, getDocumentGroup } from "@/app/features/sharing"
import { parseFrontmatter, parseWikiLinks } from "@/app/features/editor"
import { getPresentationMode } from "@/app/features/presentation"
import {
	canShareDocument,
	shareDocument,
	saveDocumentAs,
	printToPdf,
	printSlidesToPdf,
	type SlideAspectRatio,
	type SlidePrintLayout,
} from "@/app/features/import-export"
import { getExportComments } from "@/app/features/comments"
import { getLoadedAssets, toPrintableAsset } from "@/app/features/assets"
import { loadThemesForPdf } from "@/app/features/themes"
import { useIntl } from "@/shared/intl/setup"
import { readDocumentText } from "../lib/document-text"
import { getDocumentTitle } from "../lib/title"
import { resolveDocTitles } from "../lib/wikilink-titles"
import {
	getExportAssets,
	makeAddTag,
	makeDownload,
	makeDuplicate,
	makeOpenTimeMachine,
	makeRename,
	makeTogglePin,
	makeTurnIntoPresentation,
	type EditorRef,
	type LoadedDocument,
	type LoadedMe,
} from "../lib/document-file-actions"
import { runDocumentCommand } from "./document-commands"

export { SidebarFileMenu }

interface SidebarFileMenuProps {
	doc: LoadedDocument
	editor: EditorRef
	me?: LoadedMe
	spaceId?: string
}

// --- Component ---

function SidebarFileMenu({ doc, editor, me, spaceId }: SidebarFileMenuProps) {
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
	let account = useAccount(UserAccount)

	let content = doc.content?.$isLoaded ? readDocumentText(doc.content) : ""
	let readOnly = !canEdit(doc)
	let docGroup = getDocumentGroup(doc)
	let isAdmin = docGroup?.myRole() === "admin"
	let isPinned = parseFrontmatter(content).frontmatter?.pinned === true
	let isPresentation = getPresentationMode(content)
	let handlePrintPdf = makePrintPdf(content, account, doc)
	let makePrintSlides = makePrintSlidesFactory(content, account, doc)
	let canShare = canShareDocument()

	return (
		<SidebarMenuItem>
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
						onClick={makeTogglePin(docWithContent)}
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
					<DropdownMenuItem onClick={makeDownload(doc, content)}>
						{t("doc.download")}
					</DropdownMenuItem>
					{canShare && (
						<DropdownMenuItem
							onClick={makeShare(doc, content)}
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
						onClick={makeDuplicate(doc, me, spaceId, navigate)}
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

function makeShare(doc: LoadedDocument, content: string) {
	return async function handleShare() {
		let docAssets = await getExportAssets(doc)
		let title = getDocumentTitle(content)
		await shareDocument(
			content,
			title,
			docAssets.length > 0 ? docAssets : undefined,
			getExportComments(doc),
		)
	}
}

function makePrintPdf(
	content: string,
	account: ReturnType<typeof useAccount<typeof UserAccount>>,
	doc: LoadedDocument,
) {
	return async function handlePrintPdf() {
		if (!account.$isLoaded) return
		let { themes, defaultPreviewTheme, defaultSyntaxTheme } =
			await loadThemesForPdf(account)
		let assets = getLoadedAssets(doc.assets).map(toPrintableAsset)
		await printToPdf({
			content,
			themes,
			defaultPreviewTheme,
			defaultSyntaxTheme,
			assets,
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
	content: string,
	account: ReturnType<typeof useAccount<typeof UserAccount>>,
	doc: LoadedDocument,
) {
	return function makePrintSlides(option: (typeof slidePrintOptions)[number]) {
		return async function handlePrintSlides() {
			if (!account.$isLoaded) return
			let { themes, defaultSlideshowTheme, defaultSyntaxTheme } =
				await loadThemesForPdf(account)
			let wikilinks = await resolveDocTitles(
				parseWikiLinks(content).map(link => link.id),
			)
			await printSlidesToPdf({
				content,
				themes,
				defaultSlideshowTheme,
				defaultSyntaxTheme,
				assets: getLoadedAssets(doc.assets).map(toPrintableAsset),
				layout: option.layout,
				aspectRatio: option.aspectRatio,
				wikilinkTitles: new Map(
					Array.from(wikilinks.values())
						.filter(link => link.exists)
						.map(link => [link.id, link.title]),
				),
			})
		}
	}
}
