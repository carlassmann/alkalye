import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { co, Group, type ResolveQuery } from "jazz-tools"
import { useCoState, useAccount } from "jazz-tools/react"
import { toast } from "sonner"
import { Document, UserAccount, Asset, TldrawRevision, Space } from "@/schema"
import { MarkdownEditor, useMarkdownEditorRef } from "@/app/features/editor"
import { useEditorSettings } from "@/app/features/editor"
import {
	applyContentDiffWithCommentAnchors,
	copyCommentsAndApplyContent,
} from "@/app/features/comments"
import {
	createDocumentMetadata,
	getDocumentTitle,
	syncDocumentMetadata,
} from "@/app/features/documents"
import { canEdit } from "@/app/features/sharing"
import { getSpaceGroup } from "@/app/features/spaces"
import {
	DocumentNotFound,
	DocumentUnauthorized,
} from "@/app/components/error-states"

import {
	getEditHistory,
	getContentAtEdit,
	getEditTimestamp,
	restoreAssetsAtTime,
	getHistoricalAssetIds,
	getAuthorName,
	formatEditDate,
	groupEditsByDay,
} from "../lib/time-machine"
import {
	ConfirmDialog,
	useConfirmDialog,
} from "@/app/components/ui/confirm-dialog"
import { SidebarProvider } from "@/app/components/ui/sidebar"
import { useIntl } from "@/shared/intl/setup"
import { useResolvedTheme } from "@/app/components/appearance"
import {
	assetContentResolve,
	assetPreviewResolve,
	copyAsset,
} from "@/app/features/assets"
import {
	TimeMachineBottomBar,
	TimeMachineToolbar,
	type ViewMode,
} from "../widgets/time-machine-bars"

export { TimeMachineScreen, resolve, settingsResolve }
export type { ViewMode }

let resolve = {
	content: true,
	archivedContent: { $each: { content: true, successor: true } },
	assets: {
		$each: assetContentResolve,
	},
	comments: { $each: { replies: true } },
} as const satisfies ResolveQuery<typeof Document>

let settingsResolve = {
	root: { settings: true },
} as const satisfies ResolveQuery<typeof UserAccount>

let meResolve = {
	root: {
		documents: { $each: { content: true, comments: { $each: true } } },
		spaces: {
			$each: {
				documents: { $each: { content: true, comments: { $each: true } } },
			},
		},
		settings: true,
	},
} as const satisfies ResolveQuery<typeof UserAccount>

type LoadedDocument = co.loaded<typeof Document, typeof resolve>
type LoadedMe = ReturnType<
	typeof useAccount<typeof UserAccount, typeof meResolve>
>
type LoadedSettingsMe = co.loaded<typeof UserAccount, typeof settingsResolve>

interface TimeMachineScreenProps {
	id: string
	loaderData: {
		doc: LoadedDocument | null
		loadingState: string | null
		me: LoadedSettingsMe | null
	}
	search: { edit?: number; mode?: ViewMode }
}

function TimeMachineScreen({ id, loaderData, search }: TimeMachineScreenProps) {
	let { edit, mode } = search

	let subscribedDoc = useCoState(Document, id, { resolve })

	if (!loaderData.doc) {
		if (loaderData.loadingState === "unauthorized")
			return <DocumentUnauthorized />
		return <DocumentNotFound />
	}

	if (
		!subscribedDoc.$isLoaded &&
		subscribedDoc.$jazz.loadingState !== "loading"
	) {
		if (subscribedDoc.$jazz.loadingState === "unauthorized")
			return <DocumentUnauthorized />
		return <DocumentNotFound />
	}

	let doc = subscribedDoc.$isLoaded ? subscribedDoc : loaderData.doc

	return (
		<SidebarProvider>
			<TimeMachineContent
				doc={doc}
				docId={id}
				initialEdit={edit}
				initialMode={mode}
				loaderMe={loaderData.me}
			/>
		</SidebarProvider>
	)
}

interface TimeMachineContentProps {
	doc: LoadedDocument
	docId: string
	initialEdit?: number
	initialMode?: ViewMode
	loaderMe: LoadedSettingsMe | null
}

function TimeMachineContent({
	doc,
	docId,
	initialEdit,
	initialMode,
	loaderMe,
}: TimeMachineContentProps) {
	let t = useIntl()
	let navigate = useNavigate()
	let editor = useMarkdownEditorRef()
	let restoreDialog = useConfirmDialog()
	let colorScheme = useResolvedTheme()

	let me = useAccount(UserAccount, { resolve: meResolve })

	let editorSettings =
		me.$isLoaded && me.root?.settings?.$isLoaded
			? me.root.settings
			: loaderMe?.root?.settings

	useEditorSettings(editorSettings)

	let content = doc.content?.toString() ?? ""
	let docTitle = getDocumentTitle(content)

	let editHistory = getEditHistory(doc)
	let totalEdits = editHistory.length
	let dayGroups = groupEditsByDay(editHistory)

	let currentEditIndex =
		initialEdit !== undefined
			? Math.min(Math.max(0, initialEdit), totalEdits - 1)
			: totalEdits - 1

	let currentEdit = editHistory[currentEditIndex]
	let timeMachineContent = getContentAtEdit(doc, currentEditIndex)
	let historicalTimestamp = getEditTimestamp(doc, currentEditIndex)
	let historicalAssets = useHistoricalEditorAssets(
		doc,
		historicalTimestamp,
		colorScheme,
	)

	let viewMode: ViewMode = initialMode ?? "days"
	let selectedDayIndex: number | null = null
	if (viewMode === "edits") {
		selectedDayIndex = dayGroups.findIndex(day =>
			day.edits.some(e => e.index === currentEditIndex),
		)
		if (selectedDayIndex === -1) selectedDayIndex = null
	}

	let currentEditAuthor = useCoState(
		UserAccount,
		currentEdit?.accountId ?? undefined,
		{ resolve: { profile: true } },
	)

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
					authorName={getAuthorName(
						currentEditAuthor?.$isLoaded ? currentEditAuthor : null,
						me.$isLoaded ? me.$jazz.id : undefined,
					)}
					onExit={() => {
						navigate({
							to: "/doc/$id",
							params: { id: docId },
							search: {},
						})
					}}
					onCreateCopy={makeTimeMachineCreateCopy({
						doc,
						historicalContent: timeMachineContent,
						originalTitle: docTitle,
						editDate: currentEdit?.madeAt ?? doc.createdAt,
						historicalTimestamp,
						me,
						navigate,
					})}
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
					onConfirm={makeTimeMachineRestore({
						doc,
						historicalContent: timeMachineContent,
						historicalTimestamp,
						navigate,
						docId,
						restoreFailedMessage: t("timeMachine.restoreFailed"),
					})}
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

interface HistoricalEditorAsset {
	id: string
	name: string
	type: "image" | "video" | "tldraw"
	imageId?: string
	video?: { $isLoaded?: boolean; toBlob?: () => Blob | undefined }
	muteAudio?: boolean
}

function useHistoricalEditorAssets(
	doc: LoadedDocument,
	timestamp: number,
	colorScheme: "light" | "dark",
) {
	let [assets, setAssets] = useState<HistoricalEditorAsset[]>([])

	useEffect(() => {
		let cancelled = false
		void loadHistoricalEditorAssets(doc, timestamp, colorScheme).then(
			result => {
				if (!cancelled) setAssets(result)
			},
		)
		return () => {
			cancelled = true
		}
	}, [doc, timestamp, colorScheme])

	return assets
}

async function loadHistoricalEditorAssets(
	doc: LoadedDocument,
	timestamp: number,
	colorScheme: "light" | "dark",
): Promise<HistoricalEditorAsset[]> {
	let assetIds = getHistoricalAssetIds(doc, timestamp)
	let loaded = await Promise.all(
		assetIds.map(assetId =>
			Asset.load(assetId, {
				resolve: assetPreviewResolve,
			}),
		),
	)
	let result: HistoricalEditorAsset[] = []

	for (let asset of loaded) {
		if (!asset?.$isLoaded) continue
		let historical = asset.$jazz.raw.atTime(timestamp)
		let historicalName = historical.get("name")
		let name = typeof historicalName === "string" ? historicalName : asset.name

		if (asset.type === "image") {
			let imageId = historical.get("image")
			result.push({
				id: asset.$jazz.id,
				name,
				type: "image",
				imageId: typeof imageId === "string" ? imageId : undefined,
			})
			continue
		}
		if (asset.type === "video") {
			result.push({
				id: asset.$jazz.id,
				name,
				type: "video",
				video: asset.video?.$isLoaded ? asset.video : undefined,
				muteAudio: asset.muteAudio,
			})
			continue
		}

		let revisionId = historical.get("revision")
		if (typeof revisionId !== "string") continue
		let revision = await TldrawRevision.load(revisionId, {
			resolve: { lightPreview: true, darkPreview: true },
		})
		if (!revision?.$isLoaded) continue
		let preview =
			colorScheme === "dark" ? revision.darkPreview : revision.lightPreview
		result.push({
			id: asset.$jazz.id,
			name,
			type: "tldraw",
			imageId: preview?.$isLoaded ? preview.$jazz.id : undefined,
		})
	}

	return result
}

type TimeMachineCopyParams = {
	doc: LoadedDocument
	historicalContent: string
	originalTitle: string
	editDate: Date
	historicalTimestamp: number
	me: LoadedMe
	navigate: ReturnType<typeof useNavigate>
}

type LoadedSpace = co.loaded<typeof Space, { documents: true }>

function makeTimeMachineCreateCopy(params: TimeMachineCopyParams) {
	return async function handleTimeMachineCreateCopy() {
		let {
			doc,
			historicalContent,
			originalTitle,
			editDate,
			historicalTimestamp,
			me,
			navigate,
		} = params
		if (!me.$isLoaded || !me.root?.documents?.$isLoaded) return

		let owner: Group
		let targetSpace: LoadedSpace | undefined

		if (doc.spaceId) {
			let space = me.root.spaces?.find(s => s?.$jazz.id === doc.spaceId)
			if (space?.$isLoaded) {
				targetSpace = space as LoadedSpace
				let spaceGroup = getSpaceGroup(space as LoadedSpace)
				if (spaceGroup) {
					owner = Group.create()
					owner.addMember(spaceGroup)
				} else {
					owner = Group.create()
				}
			} else {
				owner = Group.create()
			}
		} else {
			owner = Group.create()
		}

		let assetIdMap = new Map<string, string>()
		let newAssets = co.list(Asset).create([], owner)
		let assetIds = getHistoricalAssetIds(doc, historicalTimestamp)
		let assets = await Promise.all(
			assetIds.map(assetId =>
				Asset.load(assetId, {
					resolve: assetContentResolve,
				}),
			),
		)

		for (let asset of assets) {
			if (!asset?.$isLoaded) continue
			let historical = asset.$jazz.raw.atTime(historicalTimestamp)
			let historicalName = historical.get("name")
			let name =
				typeof historicalName === "string" ? historicalName : asset.name

			try {
				let revision =
					asset.type === "tldraw"
						? await loadHistoricalTldrawRevision(asset, historicalTimestamp)
						: undefined
				if (asset.type === "tldraw" && !revision) continue
				let newAsset = await copyAsset(asset, owner, {
					name,
					tldrawRevision: revision,
				})

				newAssets.$jazz.push(newAsset)
				assetIdMap.set(asset.$jazz.id, newAsset.$jazz.id)
			} catch (err) {
				console.error("Failed to copy asset:", err)
				toast.error(`Failed to copy asset: ${asset.name}`)
			}
		}

		let content = historicalContent
		for (let [oldId, newId] of assetIdMap) {
			content = content.replace(
				new RegExp(`\\(asset:${oldId}\\)`, "g"),
				`(asset:${newId})`,
			)
		}

		let formattedDate = formatEditDate(editDate)
		let frontmatter = `---\ntimemachine: restored from ${originalTitle} at ${formattedDate}\n---\n\n`

		let lines = content.split("\n")
		let newTitle = `${originalTitle} (restored)`

		if (lines[0]?.startsWith("#")) {
			lines[0] = `# ${newTitle}`
		} else {
			lines.unshift(`# ${newTitle}`)
		}

		let finalContent = frontmatter + lines.join("\n")

		let now = new Date()
		let newDoc = Document.create(
			{
				version: 1,
				content: co.plainText().create(doc.content.toString(), owner),
				assets: newAssets,
				...createDocumentMetadata(finalContent, now),
				createdAt: now,
				updatedAt: now,
				spaceId: doc.spaceId,
			},
			owner,
		)
		try {
			await copyCommentsAndApplyContent(doc, newDoc, finalContent)
		} catch (error) {
			console.error("Failed to create document copy:", error)
			toast.error("Failed to create document copy")
			return
		}

		if (targetSpace?.documents?.$isLoaded) {
			targetSpace.documents.$jazz.push(newDoc)
		} else {
			me.root.documents.$jazz.push(newDoc)
		}

		navigate({ to: "/doc/$id", params: { id: newDoc.$jazz.id } })
	}
}

async function loadHistoricalTldrawRevision(
	asset: co.loaded<typeof Asset>,
	timestamp: number,
) {
	let revisionId = asset.$jazz.raw.atTime(timestamp).get("revision")
	if (typeof revisionId !== "string") return undefined
	let revision = await TldrawRevision.load(revisionId, {
		resolve: {
			snapshot: true,
			lightPreview: true,
			darkPreview: true,
		},
	})
	return revision?.$isLoaded ? revision : undefined
}

type TimeMachineRestoreParams = {
	doc: LoadedDocument
	historicalContent: string
	historicalTimestamp: number
	navigate: ReturnType<typeof useNavigate>
	docId: string
	restoreFailedMessage: string
}

function makeTimeMachineRestore(params: TimeMachineRestoreParams) {
	return async function handleTimeMachineRestore() {
		let { doc, historicalContent, historicalTimestamp, navigate, docId } =
			params
		if (!doc.content) return
		if (!canEdit(doc)) return

		try {
			await restoreAssetsAtTime(doc, historicalTimestamp)
			applyContentDiffWithCommentAnchors(doc, historicalContent)
			doc.$jazz.set("updatedAt", new Date())
			syncDocumentMetadata(doc)
		} catch (error) {
			console.error("Failed to restore document version:", error)
			toast.error(params.restoreFailedMessage)
			return
		}

		navigate({
			to: "/doc/$id",
			params: { id: docId },
			search: {},
		})
	}
}
