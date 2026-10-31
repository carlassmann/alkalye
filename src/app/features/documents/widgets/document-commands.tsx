import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useSidebar } from "@/app/components/ui/sidebar"
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog"
import { testIds } from "@/app/lib/test-ids"
import {
	isShortcutEvent,
	isShortcutTargetBlocked,
	type ShortcutId,
} from "@/app/lib/shortcut-registry"
import { QuickJumpDialog, type DocumentCommandId } from "@/app/features/editor"
import { MoveToSpaceDialog } from "@/app/features/spaces"
import { canEdit, getDocumentGroup } from "@/app/features/sharing"
import { getPresentationMode } from "@/app/features/presentation"
import { useIntl } from "@/shared/intl/setup"
import { readDocumentText } from "../lib/document-text"
import { MoveToFolderDialog } from "./move-to-folder-dialog"
import {
	getExistingFolders,
	makeAddTag,
	makeDelete,
	makeDownload,
	makeDuplicate,
	makeLeave,
	makeMoveToSpace,
	makeOpenTimeMachine,
	makeRename,
	makeTogglePin,
	makeTurnIntoPresentation,
	type EditorRef,
	type LoadedDocument,
	type LoadedMe,
} from "../lib/document-file-actions"

export { DocumentCommands, runDocumentCommand }

type DocumentShortcutId = Extract<
	ShortcutId,
	"newDocument" | "openDocument" | "renameDocument" | "deleteDocument"
>
type RunnableDocumentCommand = DocumentCommandId | DocumentShortcutId

let documentShortcuts: DocumentShortcutId[] = [
	"newDocument",
	"openDocument",
	"renameDocument",
	"deleteDocument",
]

interface DocumentCommandsProps {
	doc: LoadedDocument
	editor: EditorRef
	me?: LoadedMe
	spaceId?: string
	documents: { id: string; title: string }[]
}

function DocumentCommands({
	doc,
	editor,
	me,
	spaceId,
	documents,
}: DocumentCommandsProps) {
	let t = useIntl()
	let navigate = useNavigate()
	let {
		isMobile,
		setLeftOpen,
		setRightOpen,
		setLeftOpenMobile,
		setRightOpenMobile,
	} = useSidebar()
	let [openDocumentOpen, setOpenDocumentOpen] = useState(false)
	let [deleteOpen, setDeleteOpen] = useState(false)
	let [leaveOpen, setLeaveOpen] = useState(false)
	let [moveOpen, setMoveOpen] = useState(false)
	let [moveSpaceOpen, setMoveSpaceOpen] = useState(false)

	let content = doc.content?.$isLoaded ? readDocumentText(doc.content) : ""
	let readOnly = !canEdit(doc)
	let isAdmin = getDocumentGroup(doc)?.myRole() === "admin"

	function run(id: RunnableDocumentCommand) {
		if (id === "newDocument") {
			navigate({ to: "/new", search: { spaceId } })
		} else if (id === "openDocument") {
			setOpenDocumentOpen(true)
		} else if (id === "deleteDocument") {
			if (isAdmin) setDeleteOpen(true)
			else if (me) setLeaveOpen(true)
		} else if (id === "duplicateDocument") {
			void makeDuplicate(doc, me, spaceId, navigate)()
		} else if (id === "moveToSpace") {
			if (me) setMoveSpaceOpen(true)
		} else if (id === "downloadDocument") {
			void makeDownload(doc, content)()
		} else if (id === "timeMachine") {
			makeOpenTimeMachine(
				doc,
				navigate,
				setLeftOpen,
				setRightOpen,
				setLeftOpenMobile,
				setRightOpenMobile,
			)()
		} else if (!readOnly) {
			runEditCommand(id)
		}
	}

	function runEditCommand(id: RunnableDocumentCommand) {
		if (id === "renameDocument")
			makeRename(editor, isMobile, setRightOpenMobile)()
		else if (id === "togglePin") makeTogglePin(doc)()
		else if (id === "addTag") makeAddTag(editor, isMobile, setRightOpenMobile)()
		else if (id === "moveToFolder" && me) setMoveOpen(true)
		else if (id === "turnIntoPresentation" && !getPresentationMode(content))
			makeTurnIntoPresentation(editor, isMobile, setRightOpenMobile)()
	}

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || isShortcutTargetBlocked(event.target))
				return
			let id = documentShortcuts.find(id => isShortcutEvent(event, id))
			if (!id) return
			event.preventDefault()
			run(id)
		}
		function handleRunShortcut(event: Event) {
			if (!(event instanceof CustomEvent)) return
			if (isRunnableDocumentCommand(event.detail)) run(event.detail)
		}
		document.addEventListener("keydown", handleKeyDown)
		document.addEventListener("alkalye:run-shortcut", handleRunShortcut)
		return () => {
			document.removeEventListener("keydown", handleKeyDown)
			document.removeEventListener("alkalye:run-shortcut", handleRunShortcut)
		}
	})

	return (
		<>
			{openDocumentOpen && (
				<QuickJumpDialog
					open
					onOpenChange={setOpenDocumentOpen}
					title="Open document"
					searchLabel="Find a document"
					emptyLabel="No other documents"
					items={documents.map(document => ({
						id: document.id,
						label: document.title,
						value: document.id,
					}))}
					onSelect={id => {
						if (spaceId)
							navigate({
								to: "/spaces/$spaceId/doc/$id",
								params: { spaceId, id },
							})
						else navigate({ to: "/doc/$id", params: { id } })
					}}
				/>
			)}
			{me && (
				<MoveToFolderDialog
					doc={doc}
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
				onConfirm={makeLeave(doc, me, doc, navigate)}
			/>
			{moveSpaceOpen && (
				<MoveToSpaceDialog
					doc={doc}
					open={moveSpaceOpen}
					onOpenChange={setMoveSpaceOpen}
					currentSpaceId={spaceId}
					onMove={makeMoveToSpace(navigate, spaceId)}
				/>
			)}
		</>
	)
}

function runDocumentCommand(id: RunnableDocumentCommand) {
	document.dispatchEvent(
		new CustomEvent("alkalye:run-shortcut", { detail: id }),
	)
}

let runnableDocumentCommands = new Set<string>([
	...documentShortcuts,
	"duplicateDocument",
	"togglePin",
	"addTag",
	"moveToFolder",
	"moveToSpace",
	"turnIntoPresentation",
	"downloadDocument",
	"timeMachine",
] satisfies RunnableDocumentCommand[])

function isRunnableDocumentCommand(
	value: unknown,
): value is RunnableDocumentCommand {
	return typeof value === "string" && runnableDocumentCommands.has(value)
}
