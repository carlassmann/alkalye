import { useState, useSyncExternalStore } from "react"
import { useNavigate } from "@tanstack/react-router"
import { co, Group } from "jazz-tools"
import { useCoState, useAccount } from "jazz-tools/react"
import { toast } from "sonner"
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
} from "@/app/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog"
import { testIds } from "@/app/lib/test-ids"
import { MoveToFolderDialog } from "./move-to-folder-dialog"
import { MoveToSpaceDialog } from "@/app/features/spaces"
import { FileText } from "lucide-react"
import { getShortcutLabel } from "@/app/lib/shortcut-registry"
import { Document, UserAccount } from "@/schema"
import {
	canEdit,
	getDocumentGroup,
	leavePersonalDocument,
} from "@/app/features/sharing"
import {
	parseFrontmatter,
	togglePinned,
	getFrontmatterRange,
} from "@/app/features/editor"
import { unfoldEffect } from "@codemirror/language"
import { getPresentationMode } from "@/app/features/presentation"
import { getDocumentTitle, addCopyToTitle } from "../lib/title"
import {
	exportDocument,
	saveDocumentAs,
	printToPdf,
	type ExportAsset,
} from "@/app/features/import-export"
import {
	applyContentDiffWithCommentAnchors,
	copyCommentsAndApplyContent,
	getExportComments,
} from "@/app/features/comments"
import type { MarkdownEditorRef } from "@/app/features/editor"
import { serializeAsset } from "@/app/features/assets"

import { loadThemesForPdf } from "@/app/features/themes"
import { createDocumentMetadata, syncDocumentMetadata } from "../lib/metadata"
import { useIntl } from "@/shared/intl/setup"

export { SidebarFileMenu }

type LoadedDocument = co.loaded<
	typeof Document,
	{
		content: true
		assets: true
		comments: { $each: { replies: true } }
	}
>
type LoadedMe = co.loaded<
	typeof UserAccount,
	{ root: { documents: { $each: true }; settings: true } }
>
type MaybeDocWithContent = ReturnType<
	typeof useCoState<
		typeof Document,
		{ content: true; comments: { $each: true } }
	>
>
type EditorRef = React.RefObject<MarkdownEditorRef | null>

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
	let [deleteOpen, setDeleteOpen] = useState(false)
	let [leaveOpen, setLeaveOpen] = useState(false)
	let [moveOpen, setMoveOpen] = useState(false)
	let [moveSpaceOpen, setMoveSpaceOpen] = useState(false)

	let docWithContent = useCoState(Document, doc.$jazz.id, {
		resolve: { content: true, comments: { $each: true } },
	})

	// Themes carry binary assets, so load them on demand when exporting
	let account = useAccount(UserAccount)

	let content = doc.content?.toString() ?? ""
	let readOnly = !canEdit(doc)
	let docGroup = getDocumentGroup(doc)
	let isAdmin = docGroup?.myRole() === "admin"
	let isPinned = parseFrontmatter(content).frontmatter?.pinned === true
	let isPresentation = getPresentationMode(content)
	let handlePrintPdf = makePrintPdf(content, account)

	return (
		<>
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
						<DropdownMenuItem onClick={makeToggleFocusMode(focusMode)}>
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
							onClick={() => setMoveOpen(true)}
							disabled={readOnly || !me}
						>
							{t("doc.moveToFolder")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => setMoveSpaceOpen(true)}
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
						<DropdownMenuItem
							onClick={makeDuplicate(doc, me, spaceId, navigate)}
							data-testid={testIds.doc.duplicateButton}
						>
							{t("doc.duplicate")}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						{isAdmin ? (
							<DropdownMenuItem
								onClick={() => setDeleteOpen(true)}
								className="text-destructive focus:text-destructive"
								data-testid={testIds.doc.deleteButton}
							>
								{t("doc.delete")}
							</DropdownMenuItem>
						) : (
							<DropdownMenuItem
								onClick={() => setLeaveOpen(true)}
								className="text-destructive focus:text-destructive"
								disabled={!me}
							>
								{t("doc.leave")}
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>

			{docWithContent?.$isLoaded && me && (
				<MoveToFolderDialog
					doc={docWithContent}
					existingFolders={getExistingFolders(me)}
					open={moveOpen}
					onOpenChange={setMoveOpen}
				/>
			)}
			<ConfirmDialog
				open={deleteOpen}
				onOpenChange={setDeleteOpen}
				title={t("doc.deleteDialog.title")}
				description={t("doc.deleteDialog.description")}
				confirmLabel={t("doc.deleteDialog.confirm")}
				variant="destructive"
				onConfirm={makeDelete(doc, navigate, spaceId)}
				confirmTestId={testIds.dialog.deleteConfirm}
			/>
			<ConfirmDialog
				open={leaveOpen}
				onOpenChange={setLeaveOpen}
				title={t("doc.leaveDialog.title")}
				description={t("doc.leaveDialog.description")}
				confirmLabel={t("doc.leaveDialog.confirm")}
				variant="destructive"
				onConfirm={makeLeave(docWithContent, me, doc, navigate)}
			/>

			{moveSpaceOpen && docWithContent?.$isLoaded && (
				<MoveToSpaceDialog
					doc={docWithContent}
					open={moveSpaceOpen}
					onOpenChange={setMoveSpaceOpen}
					currentSpaceId={spaceId}
					onMove={makeMoveToSpace(navigate, spaceId)}
				/>
			)}
		</>
	)
}

function useFocusMode() {
	return useSyncExternalStore(
		callback => {
			let observer = new MutationObserver(callback)
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ["data-focus-mode"],
			})
			return () => observer.disconnect()
		},
		() => document.documentElement.dataset.focusMode === "true",
	)
}

function makeToggleFocusMode(focusMode: boolean) {
	return function handleToggleFocusMode() {
		document.documentElement.dataset.focusMode = String(!focusMode)
	}
}

function makeOpenTimeMachine(
	doc: LoadedDocument,
	navigate: ReturnType<typeof useNavigate>,
	setLeftOpen: (open: boolean) => void,
	setRightOpen: (open: boolean) => void,
	setLeftOpenMobile: (open: boolean) => void,
	setRightOpenMobile: (open: boolean) => void,
) {
	return function handleOpenTimeMachine() {
		setLeftOpen(false)
		setRightOpen(false)
		setLeftOpenMobile(false)
		setRightOpenMobile(false)
		navigate({
			to: "/doc/$id/timemachine",
			params: { id: doc.$jazz.id },
		})
	}
}

function makeRename(
	editor: EditorRef,
	isMobile: boolean,
	setRightOpenMobile: (open: boolean, callback?: () => void) => void,
) {
	return function handleRename() {
		runWithMobileClose(isMobile, setRightOpenMobile, () => {
			let view = editor.current?.getEditor()
			if (!view) return

			let content = view.state.doc.toString()
			let { frontmatter, body } = parseFrontmatter(content)

			if (!frontmatter) {
				let inferredTitle = getInferredTitle(content)
				let newFrontmatter = `---\ntitle: ${inferredTitle}\n---\n\n`
				view.dispatch({ changes: { from: 0, to: 0, insert: newFrontmatter } })
				let titleStart = 4 + 7
				let titleEnd = titleStart + inferredTitle.length
				view.dispatch({ selection: { anchor: titleStart, head: titleEnd } })
				view.focus()
				return
			}

			if (!frontmatter.title) {
				let inferredTitle = getInferredTitle(body)
				let insertPos = 4
				let titleLine = `title: ${inferredTitle}\n`
				view.dispatch({
					changes: { from: insertPos, to: insertPos, insert: titleLine },
				})
				let range = getFrontmatterRange(view.state)
				if (range)
					view.dispatch({
						effects: unfoldEffect.of({ from: range.from, to: range.to }),
					})
				let titleStart = insertPos + 7
				let titleEnd = titleStart + inferredTitle.length
				view.dispatch({ selection: { anchor: titleStart, head: titleEnd } })
				view.focus()
				return
			}

			let range = getFrontmatterRange(view.state)
			if (range)
				view.dispatch({
					effects: unfoldEffect.of({ from: range.from, to: range.to }),
				})
			let titleMatch = content.match(/^---\r?\n[\s\S]*?^title:\s*(.*)$/m)
			if (titleMatch) {
				let titleValueStart = content.indexOf(
					titleMatch[1],
					content.indexOf("title:"),
				)
				let titleValueEnd = titleValueStart + titleMatch[1].length
				view.dispatch({
					selection: { anchor: titleValueStart, head: titleValueEnd },
				})
			}
			view.focus()
		})
	}
}

function makeTogglePin(docWithContent: MaybeDocWithContent) {
	return function handleTogglePin() {
		if (!docWithContent?.$isLoaded || !docWithContent.content) return
		let content = docWithContent.content.toString()
		let newContent = togglePinned(content)
		applyContentDiffWithCommentAnchors(docWithContent, newContent)
		docWithContent.$jazz.set("updatedAt", new Date())
		syncDocumentMetadata(docWithContent)
	}
}

function makeAddTag(
	editor: EditorRef,
	isMobile: boolean,
	setRightOpenMobile: (open: boolean, callback?: () => void) => void,
) {
	return function handleAddTag() {
		runWithMobileClose(isMobile, setRightOpenMobile, () => {
			let view = editor.current?.getEditor()
			if (!view) return

			let content = view.state.doc.toString()
			let { frontmatter } = parseFrontmatter(content)
			let tag = "your_tag"

			if (!frontmatter) {
				let newFrontmatter = `---\ntags: ${tag}\n---\n\n`
				view.dispatch({ changes: { from: 0, to: 0, insert: newFrontmatter } })
				let tagStart = 4 + 6
				let tagEnd = tagStart + tag.length
				view.dispatch({ selection: { anchor: tagStart, head: tagEnd } })
				view.focus()
				return
			}

			if (!frontmatter.tags) {
				let insertPos = 4
				let tagsLine = `tags: ${tag}\n`
				view.dispatch({
					changes: { from: insertPos, to: insertPos, insert: tagsLine },
				})
				let range = getFrontmatterRange(view.state)
				if (range)
					view.dispatch({
						effects: unfoldEffect.of({ from: range.from, to: range.to }),
					})
				let tagStart = insertPos + 6
				let tagEnd = tagStart + tag.length
				view.dispatch({ selection: { anchor: tagStart, head: tagEnd } })
				view.focus()
				return
			}

			let tagsMatch = content.match(/^(tags:\s*)(.*)$/m)
			if (tagsMatch) {
				let lineStart = content.indexOf(tagsMatch[0])
				let existingTags = tagsMatch[2]
				let insertPos = lineStart + tagsMatch[1].length + existingTags.length
				let insertText = existingTags ? `, ${tag}` : tag
				view.dispatch({
					changes: { from: insertPos, to: insertPos, insert: insertText },
				})
				let range = getFrontmatterRange(view.state)
				if (range)
					view.dispatch({
						effects: unfoldEffect.of({ from: range.from, to: range.to }),
					})
				let tagStart = insertPos + (existingTags ? 2 : 0)
				let tagEnd = tagStart + tag.length
				view.dispatch({ selection: { anchor: tagStart, head: tagEnd } })
				view.focus()
			}
		})
	}
}

function makeTurnIntoPresentation(
	editor: EditorRef,
	isMobile: boolean,
	setRightOpenMobile: (open: boolean, callback?: () => void) => void,
) {
	return function handleTurnIntoPresentation() {
		runWithMobileClose(isMobile, setRightOpenMobile, () => {
			let view = editor.current?.getEditor()
			if (!view) return

			let content = view.state.doc.toString()
			let { frontmatter } = parseFrontmatter(content)

			if (!frontmatter) {
				let newFrontmatter = `---\nmode: present\n---\n\n`
				view.dispatch({ changes: { from: 0, to: 0, insert: newFrontmatter } })
				view.focus()
				return
			}

			let insertPos = 4
			let modeLine = `mode: present\n`
			view.dispatch({
				changes: { from: insertPos, to: insertPos, insert: modeLine },
			})
			view.focus()
		})
	}
}

function makeDownload(doc: LoadedDocument, content: string) {
	return async function handleDownload() {
		let docAssets: ExportAsset[] = []
		if (doc.assets?.$isLoaded) {
			for (let asset of Array.from(doc.assets)) {
				if (!asset?.$isLoaded) continue
				let blob = await serializeAsset(asset)
				if (blob) docAssets.push({ id: asset.$jazz.id, name: asset.name, blob })
			}
		}
		let title = getDocumentTitle(content)
		await exportDocument(
			content,
			title,
			docAssets.length > 0 ? docAssets : undefined,
			getExportComments(doc),
		)
	}
}

function makeSaveAs(content: string) {
	return async function handleSaveAs() {
		let title = getDocumentTitle(content)
		await saveDocumentAs(content, title)
	}
}

function makePrintPdf(
	content: string,
	account: ReturnType<typeof useAccount<typeof UserAccount>>,
) {
	return async function handlePrintPdf() {
		if (!account.$isLoaded) return
		let { themes, defaultPreviewTheme } = await loadThemesForPdf(account)
		await printToPdf({ content, themes, defaultPreviewTheme })
	}
}

function makeDelete(
	doc: LoadedDocument,
	navigate: ReturnType<typeof useNavigate>,
	spaceId: string | undefined,
) {
	return function handleDelete() {
		doc.$jazz.set("deletedAt", new Date())
		if (spaceId) {
			navigate({ to: "/spaces/$spaceId", params: { spaceId } })
			return
		}
		navigate({ to: "/" })
	}
}

function makeLeave(
	docWithContent: MaybeDocWithContent,
	me: LoadedMe | undefined,
	doc: LoadedDocument,
	navigate: ReturnType<typeof useNavigate>,
) {
	return async function handleLeave() {
		if (!docWithContent?.$isLoaded || !me) return
		await leavePersonalDocument(docWithContent, me)
		let idx = me.root?.documents?.findIndex(d => d?.$jazz.id === doc.$jazz.id)
		if (idx !== undefined && idx !== -1 && me.root?.documents?.$isLoaded) {
			me.root.documents.$jazz.splice(idx, 1)
		}
		navigate({ to: "/" })
	}
}

function makeDuplicate(
	doc: LoadedDocument,
	me: LoadedMe | undefined,
	spaceId: string | undefined,
	navigate: ReturnType<typeof useNavigate>,
) {
	return async function handleDuplicate() {
		if (!me?.root?.documents?.$isLoaded) return

		let content = doc.content?.toString() ?? ""
		let newContent = addCopyToTitle(content)

		let now = new Date()
		let group = Group.create()
		let newDoc = Document.create(
			{
				version: 1,
				content: co.plainText().create(content, group),
				...createDocumentMetadata(newContent, now),
				createdAt: now,
				updatedAt: now,
			},
			group,
		)
		try {
			await copyCommentsAndApplyContent(doc, newDoc, newContent)
		} catch (error) {
			console.error("Failed to duplicate document:", error)
			toast.error("Failed to duplicate document")
			return
		}
		me.root.documents.$jazz.push(newDoc)

		if (spaceId) {
			navigate({
				to: "/spaces/$spaceId/doc/$id",
				params: { spaceId, id: newDoc.$jazz.id },
			})
		} else {
			navigate({ to: "/doc/$id", params: { id: newDoc.$jazz.id } })
		}
	}
}

function makeMoveToSpace(
	navigate: ReturnType<typeof useNavigate>,
	currentSpaceId?: string,
) {
	return function handleMoveToSpace(
		destination: { id: string; name: string } | null,
	) {
		if (destination) {
			let docId = window.location.pathname.match(
				/\/(?:app\/)?doc\/([^/]+)/,
			)?.[1]
			if (docId) {
				navigate({
					to: "/spaces/$spaceId/doc/$id",
					params: { spaceId: destination.id, id: docId },
				})
			}
		} else if (currentSpaceId) {
			let docId = window.location.pathname.match(
				/\/(?:app\/)?doc\/([^/]+)/,
			)?.[1]
			if (docId) {
				navigate({ to: "/doc/$id", params: { id: docId } })
			}
		}
	}
}

function runWithMobileClose(
	isMobile: boolean,
	setRightOpenMobile: (open: boolean, callback?: () => void) => void,
	fn: () => void,
) {
	if (isMobile) {
		setRightOpenMobile(false, fn)
	} else {
		requestAnimationFrame(fn)
	}
}

function getInferredTitle(body: string): string {
	let line = body.split("\n").find(l => l.trim()) ?? ""
	return (
		line
			.replace(/^#{1,6}\s+/, "")
			.replace(/\*\*([^*]+)\*\*/g, "$1")
			.replace(/\*([^*]+)\*/g, "$1")
			.replace(/__([^_]+)__/g, "$1")
			.replace(/_([^_]+)_/g, "$1")
			.replace(/`([^`]+)`/g, "$1")
			.trim()
			.slice(0, 80) || "Untitled"
	)
}

function getExistingFolders(me?: LoadedMe): string[] {
	if (!me?.root?.documents?.$isLoaded) return []

	let folders = new Set<string>()
	for (let doc of me.root.documents.values()) {
		if (!doc?.$isLoaded || !doc.path) continue
		folders.add(doc.path)
		let parts = doc.path.split("/")
		for (let i = 1; i < parts.length; i++) {
			folders.add(parts.slice(0, i).join("/"))
		}
	}

	return [...folders].sort()
}
