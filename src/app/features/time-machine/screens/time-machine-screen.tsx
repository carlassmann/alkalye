import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useOne, useAll, useDb } from "jazz-tools/react"
import { toast } from "sonner"
import { app, type DocumentRow } from "@/jazz/schema"
import {
	MarkdownEditor,
	useMarkdownEditorRef,
	useEditorSettings,
} from "@/app/features/editor"
import {
	useLibrary,
	updateContent,
	useDocumentAccess,
} from "@/app/features/documents"
import { DocumentNotFound } from "@/app/components/error-states"
import {
	getEditHistory,
	historyQuery,
	restoreAssetsAtTime,
	formatEditDate,
	groupEditsByDay,
} from "../lib/time-machine"
import {
	ConfirmDialog,
	useConfirmDialog,
} from "@/app/components/ui/confirm-dialog"
import { SidebarProvider } from "@/app/components/ui/sidebar"
import { createTimeMachineCopy } from "../lib/create-copy"
import { useHistoricalEditorAssets } from "../lib/historical-assets"
import { useResolvedTheme } from "@/app/components/appearance"
import { useIntl } from "@/shared/intl/setup"
import {
	TimeMachineBottomBar,
	TimeMachineToolbar,
	type ViewMode,
} from "../widgets/time-machine-bars"
export { TimeMachineScreen }
export type { ViewMode }
function TimeMachineScreen({
	id,
	search,
}: {
	id: string
	search: { edit?: number; mode?: ViewMode }
}) {
	let { data: doc, isLoading } = useOne(app.documents.where({ id }))
	if (isLoading) return <p role="status">Opening document…</p>
	if (!doc || doc.deletedAt) return <DocumentNotFound />
	return (
		<SidebarProvider>
			<TimeMachineContent
				key={id}
				doc={doc}
				docId={id}
				initialEdit={search.edit}
				initialMode={search.mode}
			/>
		</SidebarProvider>
	)
}
function TimeMachineContent({
	doc,
	docId,
	initialEdit,
	initialMode,
}: {
	doc: DocumentRow
	docId: string
	initialEdit?: number
	initialMode?: ViewMode
}) {
	let t = useIntl(),
		navigate = useNavigate(),
		editor = useMarkdownEditorRef(),
		restoreDialog = useConfirmDialog(),
		db = useDb()
	let { ownerId, settings } = useLibrary()
	useEditorSettings(settings)
	let { data: versions = [] } = useAll(historyQuery(docId))
	let { data: imported = [] } = useAll(
		app.documentVersions.where({ documentId: docId }),
	)
	let { data: profiles = [] } = useAll(app.profiles)
	let { canEdit } = useDocumentAccess(doc)
	let docTitle = doc.title
	let editHistory = getEditHistory(versions, imported),
		totalEdits = editHistory.length,
		dayGroups = groupEditsByDay(editHistory)
	let currentEditIndex =
		initialEdit !== undefined
			? Math.min(Math.max(0, initialEdit), totalEdits - 1)
			: totalEdits - 1
	let currentEdit = editHistory[currentEditIndex]
	let timeMachineContent = currentEdit?.content ?? doc.content
	let historicalTimestamp =
		currentEdit?.madeAt.getTime() ?? doc.updatedAt.getTime()
	let historicalAssets = useHistoricalEditorAssets(
		docId,
		historicalTimestamp,
		useResolvedTheme(),
	)
	let viewMode: ViewMode = initialMode ?? "days"
	let dayIndex = dayGroups.findIndex(day =>
		day.edits.some(edit => edit.index === currentEditIndex),
	)
	let selectedDayIndex = viewMode === "edits" && dayIndex >= 0 ? dayIndex : null
	useEffect(() => {
		if (initialEdit === undefined && totalEdits > 0) {
			navigate({
				to: "/doc/$id/timemachine",
				params: { id: docId },
				search: {
					edit: totalEdits - 1,
				},
				replace: true,
			})
		}
	}, [initialEdit, totalEdits, docId, navigate])

	let shownClampToastRef = useRef(false)
	useEffect(() => {
		if (initialEdit === undefined || totalEdits === 0) return

		let wasClamped = initialEdit !== currentEditIndex
		if (wasClamped && !shownClampToastRef.current) {
			shownClampToastRef.current = true
			toast(
				t("timeMachine.clampedTitle", {
					edit: String(currentEditIndex + 1),
					total: String(totalEdits),
				}),
				{
					description: t("timeMachine.clampedDescription", {
						edit: String(initialEdit + 1),
					}),
					duration: 4000,
				},
			)
			navigate({
				to: "/doc/$id/timemachine",
				params: { id: docId },
				search: {
					edit: currentEditIndex,
					mode: viewMode === "edits" ? "edits" : undefined,
				},
				replace: true,
			})
		}
	}, [
		initialEdit,
		currentEditIndex,
		totalEdits,
		docId,
		navigate,
		viewMode,
		selectedDayIndex,
		t,
	])

	let isViewingDay = viewMode === "edits" && selectedDayIndex !== null
	let selectedDay =
		selectedDayIndex !== null ? dayGroups[selectedDayIndex] : null

	useEffect(() => {
		function getPreviousEditIndex(): number | null {
			if (isViewingDay && selectedDay) {
				let editIndexInDay = selectedDay.edits.findIndex(
					e => e.index === currentEditIndex,
				)
				if (editIndexInDay > 0)
					return selectedDay.edits[editIndexInDay - 1].index
			} else {
				if (currentEditIndex > 0) return currentEditIndex - 1
			}
			return null
		}

		function getNextEditIndex(): number | null {
			if (isViewingDay && selectedDay) {
				let editIndexInDay = selectedDay.edits.findIndex(
					e => e.index === currentEditIndex,
				)
				if (editIndexInDay < selectedDay.edits.length - 1)
					return selectedDay.edits[editIndexInDay + 1].index
			} else {
				if (currentEditIndex < totalEdits - 1) return currentEditIndex + 1
			}
			return null
		}

		function handleKeyDown(e: KeyboardEvent) {
			if (e.metaKey || e.ctrlKey || e.altKey) return

			if (e.key === "[") {
				e.preventDefault()
				let idx = getPreviousEditIndex()
				if (idx !== null) {
					navigate({
						to: "/doc/$id/timemachine",
						params: { id: docId },
						search: {
							edit: idx,
							mode: viewMode === "edits" ? "edits" : undefined,
						},
					})
				}
				return
			}
			if (e.key === "]") {
				e.preventDefault()
				let idx = getNextEditIndex()
				if (idx !== null) {
					navigate({
						to: "/doc/$id/timemachine",
						params: { id: docId },
						search: {
							edit: idx,
							mode: viewMode === "edits" ? "edits" : undefined,
						},
					})
				}
				return
			}
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [
		currentEditIndex,
		totalEdits,
		docId,
		navigate,
		viewMode,
		selectedDayIndex,
		isViewingDay,
		selectedDay,
	])

	return (
		<>
			<title>{docTitle} - Time Machine</title>
			<div className="markdown-editor flex-1">
				<MarkdownEditor
					ref={editor}
					value={timeMachineContent}
					onChange={() => {}}
					onCursorChange={() => {}}
					placeholder=""
					readOnly={true}
					assets={historicalAssets}
					documents={[]}
					extensions={[]}
				/>
				<TimeMachineToolbar
					editDate={currentEdit?.madeAt ?? doc.createdAt}
					authorName={
						currentEdit?.accountId === ownerId
							? "you"
							: (currentEdit?.authorName ??
								profiles.find(
									profile => profile.ownerId === currentEdit?.accountId,
								)?.name ??
								"Unknown")
					}
					onExit={() => {
						navigate({
							to: "/doc/$id",
							params: { id: docId },
							search: {},
						})
					}}
					onCreateCopy={async () => {
						try {
							let copy = await createTimeMachineCopy(
								db,
								ownerId,
								doc,
								timeMachineContent,
								historicalTimestamp,
							)
							void navigate({ to: "/doc/$id", params: { id: copy.id } })
						} catch (error) {
							console.error(error)
							toast.error(t("timeMachine.restoreFailed"))
						}
					}}
					onRestore={() => restoreDialog.setOpen(true)}
				/>
				<ConfirmDialog
					open={restoreDialog.open}
					onOpenChange={restoreDialog.onOpenChange}
					title={t("timeMachine.restoreTitle")}
					description={t("timeMachine.restoreDescription", {
						date: formatEditDate(currentEdit?.madeAt ?? doc.createdAt),
					})}
					confirmLabel={t("timeMachine.restoreConfirm")}
					cancelLabel={t("timeMachine.cancel")}
					onConfirm={async () => {
						try {
							if (!canEdit) return
							if (!imported.some(version => version.id === currentEdit?.key))
								await restoreAssetsAtTime(db, doc.id, historicalTimestamp)
							await updateContent(db, doc, timeMachineContent)
							void navigate({ to: "/doc/$id", params: { id: docId } })
						} catch (error) {
							console.error(error)
							toast.error(t("timeMachine.restoreFailed"))
						}
					}}
				/>
				<TimeMachineBottomBar
					editHistory={editHistory}
					onEditChange={(edit, options) =>
						navigate({
							to: "/doc/$id/timemachine",
							params: { id: docId },
							search: {
								edit,
								mode: options.mode === "edits" ? "edits" : undefined,
							},
							replace: options.replace,
						})
					}
					editParam={initialEdit}
					mode={initialMode}
				/>
			</div>
		</>
	)
}
