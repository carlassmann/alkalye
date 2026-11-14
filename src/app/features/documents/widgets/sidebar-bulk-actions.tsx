import { type LibraryDocument, useLibrary } from "../lib/library"
import { toast } from "sonner"
import { FolderInput, Pin, PinOff, Trash2, X } from "lucide-react"
import {
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
} from "@/app/components/ui/context-menu"
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog"
import { canEdit, getDocumentGroup } from "@/app/features/sharing"
import { useIntl } from "@/shared/intl/setup"
import { testIds } from "@/app/lib/test-ids"
import { setDocumentsPinned } from "../lib/documents"
import type { BatchResult } from "../lib/folders"
import { MoveToFolderDialog } from "./move-to-folder-dialog"

export {
	SidebarBulkMenuItems,
	SidebarBulkDialogs,
	getDeletableDocs,
	notifySkippedDocuments,
}
export type { SidebarBulkDialog }

type SidebarDoc = LibraryDocument
type SidebarBulkDialog = "move" | "delete" | null

function getDeletableDocs(docs: SidebarDoc[]): SidebarDoc[] {
	return docs.filter(doc => getDocumentGroup(doc)?.myRole() === "admin")
}

function notifySkippedDocuments(
	result: BatchResult,
	t: ReturnType<typeof useIntl>,
) {
	if (result.skipped === 0) return
	toast.error(t("doc.sidebar.bulkSkipped", { count: result.skipped }))
}

function SidebarBulkMenuItems({
	docs,
	onOpenDialog,
	onClear,
}: {
	docs: SidebarDoc[]
	onOpenDialog: (dialog: SidebarBulkDialog) => void
	onClear: () => void
}) {
	let { db, ownerId } = useLibrary()
	let t = useIntl()
	let areAllPinned = docs.every(doc => doc.pinned)
	let hasEditableDocs = docs.some(canEdit)

	async function handleTogglePinned() {
		notifySkippedDocuments(
			await setDocumentsPinned(db, ownerId, docs, !areAllPinned),
			t,
		)
	}

	return (
		<>
			<ContextMenuGroup>
				<ContextMenuLabel>
					{t("doc.sidebar.selectedCount", { count: String(docs.length) })}
				</ContextMenuLabel>
			</ContextMenuGroup>
			<ContextMenuItem
				onClick={() => onOpenDialog("move")}
				disabled={!hasEditableDocs}
			>
				<FolderInput />
				{t("doc.moveToFolder")}
			</ContextMenuItem>
			<ContextMenuItem
				onClick={() => void handleTogglePinned()}
				disabled={!hasEditableDocs}
			>
				{areAllPinned ? <PinOff /> : <Pin />}
				{areAllPinned ? t("doc.unpin") : t("doc.pin")}
			</ContextMenuItem>
			<ContextMenuItem onClick={onClear}>
				<X />
				{t("doc.sidebar.clearSelection")}
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem
				onClick={() => onOpenDialog("delete")}
				variant="destructive"
				disabled={getDeletableDocs(docs).length === 0}
				data-testid={testIds.doc.deleteButton}
			>
				<Trash2 />
				{t("doc.delete")}
			</ContextMenuItem>
		</>
	)
}

function SidebarBulkDialogs({
	docs,
	dialog,
	existingFolders,
	onDialogChange,
	onDelete,
	onClear,
}: {
	docs: SidebarDoc[]
	dialog: SidebarBulkDialog
	existingFolders: string[]
	onDialogChange: (dialog: SidebarBulkDialog) => void
	onDelete: (doc: SidebarDoc) => void
	onClear: () => void
}) {
	useLibrary()
	let t = useIntl()
	let deletableDocs = getDeletableDocs(docs)
	let skippedCount = docs.length - deletableDocs.length
	let deleteDescription = t("doc.sidebar.bulkDeleteDialog.description")
	if (skippedCount > 0) {
		deleteDescription += ` ${t("doc.sidebar.bulkDeleteDialog.skipped", { count: skippedCount })}`
	}

	function handleConfirmDelete() {
		for (let doc of deletableDocs) onDelete(doc)
		onClear()
	}

	function closeWhen(open: boolean) {
		if (!open) onDialogChange(null)
	}

	return (
		<>
			{dialog === "move" && (
				<MoveToFolderDialog
					docs={docs}
					existingFolders={existingFolders}
					open
					onOpenChange={closeWhen}
				/>
			)}
			<ConfirmDialog
				open={dialog === "delete"}
				onOpenChange={closeWhen}
				title={t("doc.sidebar.bulkDeleteDialog.title", {
					count: deletableDocs.length,
				})}
				description={deleteDescription}
				confirmLabel={t("doc.deleteDialog.confirm")}
				variant="destructive"
				onConfirm={handleConfirmDelete}
				confirmTestId={testIds.dialog.deleteConfirm}
			/>
		</>
	)
}
