import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { co, Group, type ResolveQuery } from "jazz-tools"
import { useCoState, useAccount } from "jazz-tools/react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import {
	X,
	EllipsisVertical,
	ChevronLeft,
	ChevronRight,
	ChevronDown,
} from "lucide-react"
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

import { Button } from "@/app/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
} from "@/app/components/ui/dropdown-menu"
import {
	getEditHistory,
	getContentAtEdit,
	getEditTimestamp,
	restoreAssetsAtTime,
	getHistoricalAssetIds,
	getAuthorName,
	formatEditDate,
	groupEditsByDay,
	type DayGroup,
	type EditHistoryItem,
} from "../lib/time-machine"
import {
	ConfirmDialog,
	useConfirmDialog,
} from "@/app/components/ui/confirm-dialog"
import { SidebarProvider } from "@/app/components/ui/sidebar"
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import { Kbd } from "@/app/components/ui/kbd"
import { cn } from "@/app/lib/cn"
import { useIntl } from "@/shared/intl/setup"
import { useResolvedTheme } from "@/app/components/appearance"
import {
	assetContentResolve,
	assetPreviewResolve,
	copyAsset,
} from "@/app/features/assets"

export { TimeMachineScreen, resolve, settingsResolve }
export type { ViewMode }

type ViewMode = "days" | "edits"

let resolve = {
	content: true,
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
					docId={docId}
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

interface TimeMachineToolbarProps {
	editDate: Date
	authorName: string
	onExit: () => void
	onCreateCopy: () => void
	onRestore: () => void
}

function TimeMachineToolbar({
	editDate,
	authorName,
	onExit,
	onCreateCopy,
	onRestore,
}: TimeMachineToolbarProps) {
	let t = useIntl()

	return (
		<div
			className="border-border bg-background fixed top-0 right-0 left-0 z-20 flex items-center justify-between border-b px-4 py-2"
			style={{
				paddingTop: "max(0.5rem, env(safe-area-inset-top))",
				paddingLeft: "max(1rem, env(safe-area-inset-left))",
				paddingRight: "max(1rem, env(safe-area-inset-right))",
			}}
		>
			<Button
				variant="ghost"
				size="sm"
				onClick={onExit}
				aria-label={t("timeMachine.exit")}
				className="gap-1.5"
			>
				<X className="size-4" />
				<span className="hidden sm:inline">{t("timeMachine.exit")}</span>
			</Button>

			<div className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center">
				<span className="text-foreground text-sm font-medium">
					{t("timeMachine.title")}
				</span>
				<span className="text-muted-foreground text-xs">
					{t("timeMachine.dateByAuthor", {
						date: formatEditDate(editDate),
						author: authorName,
					})}
				</span>
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							nativeButton={false}
							aria-label={t("timeMachine.actions")}
						>
							<EllipsisVertical className="size-4" />
						</Button>
					}
				/>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={onCreateCopy}>
						{t("timeMachine.createCopy")}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onRestore}>
						{t("timeMachine.restoreThisVersion")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}

interface TimeMachineBottomBarProps {
	editHistory: EditHistoryItem[]
	docId: string
	editParam?: number
	mode?: ViewMode
}

let HOLD_DELAY_MS = 1500

function TimeMachineBottomBar({
	editHistory,
	docId,
	editParam,
	mode,
}: TimeMachineBottomBarProps) {
	let t = useIntl()
	let navigate = useNavigate()

	let debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	let holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
	let holdDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	let holdEditRef = useRef(0)
	let [holdingDirection, setHoldingDirection] = useState<
		"prev" | "next" | null
	>(null)

	let totalEdits = editHistory.length
	let dayGroups = groupEditsByDay(editHistory)

	let currentEditIndex =
		editParam !== undefined
			? Math.min(Math.max(0, editParam), totalEdits - 1)
			: totalEdits - 1

	let viewMode: ViewMode = mode ?? "days"
	let selectedDayIndex: number | null = null
	if (viewMode === "edits") {
		selectedDayIndex = dayGroups.findIndex(day =>
			day.edits.some(e => e.index === currentEditIndex),
		)
		if (selectedDayIndex === -1) selectedDayIndex = null
	}

	let hasHistory = totalEdits > 0
	let disabled = dayGroups.length <= 1 && totalEdits <= 1
	let isViewingDay = viewMode === "edits" && selectedDayIndex !== null
	let selectedDay =
		selectedDayIndex !== null ? dayGroups[selectedDayIndex] : null

	let sliderMax: number
	let sliderValue: number

	if (isViewingDay && selectedDay) {
		sliderMax = selectedDay.edits.length - 1
		let editIndexInDay = selectedDay.edits.findIndex(
			e => e.index === currentEditIndex,
		)
		sliderValue = editIndexInDay >= 0 ? editIndexInDay : 0
	} else {
		sliderMax = totalEdits - 1
		sliderValue = currentEditIndex
	}

	useEffect(() => {
		holdEditRef.current = currentEditIndex
	}, [currentEditIndex])

	function sliderToEditIndex(value: number): number {
		if (isViewingDay && selectedDay) {
			return selectedDay.edits[value]?.index ?? currentEditIndex
		}
		return value
	}

	function navigateToEdit(editIndex: number, replace = false) {
		navigate({
			to: "/doc/$id/timemachine",
			params: { id: docId },
			search: {
				edit: editIndex,
				mode: viewMode === "edits" ? "edits" : undefined,
			},
			replace,
		})
	}

	function handleSliderChange(value: number) {
		if (debounceRef.current) clearTimeout(debounceRef.current)
		debounceRef.current = setTimeout(() => {
			let editIndex = sliderToEditIndex(value)
			navigateToEdit(editIndex, true)
		}, 150)
	}

	function handleSliderCommit(value: number) {
		if (debounceRef.current) {
			clearTimeout(debounceRef.current)
			debounceRef.current = null
		}
		navigateToEdit(sliderToEditIndex(value))
	}

	function handleViewModeChange(newMode: ViewMode, dayIndex?: number) {
		let targetEdit = currentEditIndex
		if (newMode === "edits" && dayIndex !== undefined) {
			let day = dayGroups[dayIndex]
			if (day && day.edits.length > 0) {
				targetEdit = day.edits[day.edits.length - 1].index
			}
		}
		navigate({
			to: "/doc/$id/timemachine",
			params: { id: docId },
			search: {
				edit: targetEdit,
				mode: newMode === "edits" ? "edits" : undefined,
			},
			replace: true,
		})
	}

	function getTooltipContent(value: number): string | undefined {
		let edit: EditHistoryItem | undefined
		if (isViewingDay && selectedDay) {
			edit = selectedDay.edits[value]
		} else {
			edit = editHistory[value]
		}
		if (!edit) return undefined
		return isViewingDay
			? edit.madeAt.toLocaleTimeString(undefined, {
					hour: "numeric",
					minute: "2-digit",
				})
			: formatEditDate(edit.madeAt)
	}

	function getPreviousEditIndex(fromIndex: number): number | null {
		if (isViewingDay && selectedDay) {
			let editIndexInDay = selectedDay.edits.findIndex(
				e => e.index === fromIndex,
			)
			if (editIndexInDay > 0) return selectedDay.edits[editIndexInDay - 1].index
		} else {
			if (fromIndex > 0) return fromIndex - 1
		}
		return null
	}

	function getNextEditIndex(fromIndex: number): number | null {
		if (isViewingDay && selectedDay) {
			let editIndexInDay = selectedDay.edits.findIndex(
				e => e.index === fromIndex,
			)
			if (editIndexInDay < selectedDay.edits.length - 1)
				return selectedDay.edits[editIndexInDay + 1].index
		} else {
			if (fromIndex < totalEdits - 1) return fromIndex + 1
		}
		return null
	}

	function startHold(direction: "prev" | "next") {
		stopHold()
		holdEditRef.current = currentEditIndex
		let getNext =
			direction === "prev"
				? () => getPreviousEditIndex(holdEditRef.current)
				: () => getNextEditIndex(holdEditRef.current)

		let idx = getNext()
		if (idx !== null) {
			holdEditRef.current = idx
			navigateToEdit(idx)
		}

		setHoldingDirection(direction)
		holdDelayRef.current = setTimeout(() => {
			setHoldingDirection(null)
			holdIntervalRef.current = setInterval(() => {
				let nextIdx = getNext()
				if (nextIdx !== null) {
					holdEditRef.current = nextIdx
					navigateToEdit(nextIdx)
				} else {
					stopHold()
				}
			}, 100)
		}, HOLD_DELAY_MS)
	}

	function stopHold() {
		setHoldingDirection(null)
		if (holdDelayRef.current) {
			clearTimeout(holdDelayRef.current)
			holdDelayRef.current = null
		}
		if (holdIntervalRef.current) {
			clearInterval(holdIntervalRef.current)
			holdIntervalRef.current = null
		}
	}

	let isAtStart =
		isViewingDay && selectedDay
			? selectedDay.edits[0]?.index === currentEditIndex
			: currentEditIndex === 0

	let isAtEnd =
		isViewingDay && selectedDay
			? selectedDay.edits[selectedDay.edits.length - 1]?.index ===
				currentEditIndex
			: currentEditIndex >= totalEdits - 1

	let statusText: string
	if (!hasHistory) {
		statusText = t("timeMachine.noPreviousVersions")
	} else if (isViewingDay && selectedDay) {
		let editIndexInDay =
			selectedDay.edits.findIndex(e => e.index === currentEditIndex) + 1
		statusText = `${editIndexInDay}/${selectedDay.edits.length}`
	} else {
		statusText = `${currentEditIndex + 1}/${totalEdits}`
	}

	let dropdownLabel = isViewingDay
		? formatDayLabel(selectedDay!.date)
		: t("timeMachine.allHistory")

	return (
		<div
			className="border-border bg-background fixed right-0 bottom-0 left-0 flex flex-col gap-3 border-t px-4 py-3 md:flex-row md:items-center md:gap-4"
			style={{
				paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
				paddingLeft: "max(1rem, env(safe-area-inset-left))",
				paddingRight: "max(1rem, env(safe-area-inset-right))",
			}}
		>
			<div className="flex items-center gap-3 md:hidden">
				<TimeMachineSlider
					min={0}
					max={Math.max(0, sliderMax)}
					value={sliderValue}
					onChange={handleSliderChange}
					onCommit={handleSliderCommit}
					disabled={disabled || !hasHistory || sliderMax === 0}
					className="flex-1"
					getTooltipContent={getTooltipContent}
				/>
			</div>

			<div className="flex items-center justify-between gap-3 md:hidden">
				<div className="flex items-center gap-2">
					<HoldButton
						direction="prev"
						holdingDirection={holdingDirection}
						onStartHold={startHold}
						onStopHold={stopHold}
						disabled={disabled || isAtStart || !hasHistory}
					/>
					<HoldButton
						direction="next"
						holdingDirection={holdingDirection}
						onStartHold={startHold}
						onStopHold={stopHold}
						disabled={disabled || isAtEnd || !hasHistory}
					/>
				</div>
				<DateDropdown
					dayGroups={dayGroups}
					selectedDayIndex={selectedDayIndex}
					dropdownLabel={dropdownLabel}
					disabled={disabled}
					hasHistory={hasHistory}
					onViewModeChange={handleViewModeChange}
				/>
				<div className="text-muted-foreground shrink-0 text-sm tabular-nums">
					{statusText}
				</div>
			</div>

			<TooltipProvider>
				<div className="hidden items-center gap-2 md:flex">
					<Tooltip>
						<TooltipTrigger
							render={
								<HoldButton
									direction="prev"
									holdingDirection={holdingDirection}
									onStartHold={startHold}
									onStopHold={stopHold}
									disabled={disabled || isAtStart || !hasHistory}
									showLabel
									nativeButton={false}
								/>
							}
						/>
						<TooltipContent side="top">
							{t("timeMachine.previousEdit")} <Kbd>[</Kbd>
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger
							render={
								<HoldButton
									direction="next"
									holdingDirection={holdingDirection}
									onStartHold={startHold}
									onStopHold={stopHold}
									disabled={disabled || isAtEnd || !hasHistory}
									showLabel
									nativeButton={false}
								/>
							}
						/>
						<TooltipContent side="top">
							{t("timeMachine.nextEdit")} <Kbd>]</Kbd>
						</TooltipContent>
					</Tooltip>
				</div>
			</TooltipProvider>

			<DateDropdown
				dayGroups={dayGroups}
				selectedDayIndex={selectedDayIndex}
				dropdownLabel={dropdownLabel}
				disabled={disabled}
				hasHistory={hasHistory}
				onViewModeChange={handleViewModeChange}
				className="hidden md:flex"
			/>

			<div className="hidden flex-1 items-center gap-4 md:flex">
				<TimeMachineSlider
					min={0}
					max={Math.max(0, sliderMax)}
					value={sliderValue}
					onChange={handleSliderChange}
					onCommit={handleSliderCommit}
					disabled={disabled || !hasHistory || sliderMax === 0}
					className="flex-1"
					getTooltipContent={getTooltipContent}
				/>
			</div>

			<div className="text-muted-foreground hidden shrink-0 text-sm tabular-nums md:block">
				{statusText}
			</div>
		</div>
	)
}

interface HoldButtonProps {
	direction: "prev" | "next"
	holdingDirection: "prev" | "next" | null
	onStartHold: (direction: "prev" | "next") => void
	onStopHold: () => void
	disabled: boolean
	showLabel?: boolean
	nativeButton?: boolean
}

function HoldButton({
	direction,
	holdingDirection,
	onStartHold,
	onStopHold,
	disabled,
	showLabel,
	nativeButton,
}: HoldButtonProps) {
	let t = useIntl()
	let isHolding = holdingDirection === direction
	let Icon = direction === "prev" ? ChevronLeft : ChevronRight
	let label =
		direction === "prev" ? t("timeMachine.previous") : t("timeMachine.next")
	let ariaLabel =
		direction === "prev"
			? t("timeMachine.previousEdit")
			: t("timeMachine.nextEdit")

	return (
		<Button
			variant="outline"
			size="sm"
			onMouseDown={() => onStartHold(direction)}
			onMouseUp={onStopHold}
			onMouseLeave={onStopHold}
			onTouchStart={() => onStartHold(direction)}
			onTouchEnd={onStopHold}
			disabled={disabled}
			aria-label={ariaLabel}
			nativeButton={nativeButton}
			className="relative gap-1 overflow-hidden"
		>
			{isHolding && (
				<span
					className="bg-primary/20 absolute inset-0 origin-left"
					style={{
						animation: `hold-progress ${HOLD_DELAY_MS}ms linear forwards`,
					}}
				/>
			)}
			{direction === "prev" && <Icon className="relative size-4" />}
			{showLabel ? (
				<span className="relative">{label}</span>
			) : (
				<span className="sr-only sm:not-sr-only">{label}</span>
			)}
			{direction === "next" && <Icon className="relative size-4" />}
		</Button>
	)
}

function formatDayLabel(date: Date): string {
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year:
			date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
	})
}

function formatMonthLabel(date: Date): string {
	return date.toLocaleDateString(undefined, {
		month: "long",
		year: "numeric",
	})
}

type MonthGroup = {
	label: string
	days: { day: DayGroup; originalIndex: number }[]
	totalEdits: number
}

function groupDaysByMonth(dayGroups: DayGroup[]): {
	recentDays: { day: DayGroup; originalIndex: number }[]
	olderMonths: MonthGroup[]
} {
	let now = new Date()
	let sevenDaysAgo = new Date(now)
	sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
	sevenDaysAgo.setHours(0, 0, 0, 0)

	let recentDays: { day: DayGroup; originalIndex: number }[] = []
	let olderDays: { day: DayGroup; originalIndex: number }[] = []

	dayGroups.forEach((day, idx) => {
		if (day.date >= sevenDaysAgo) {
			recentDays.push({ day, originalIndex: idx })
		} else {
			olderDays.push({ day, originalIndex: idx })
		}
	})

	let monthMap = new Map<string, MonthGroup>()
	for (let item of olderDays) {
		let monthKey = `${item.day.date.getFullYear()}-${item.day.date.getMonth()}`
		let existing = monthMap.get(monthKey)
		if (existing) {
			existing.days.push(item)
			existing.totalEdits += item.day.edits.length
		} else {
			monthMap.set(monthKey, {
				label: formatMonthLabel(item.day.date),
				days: [item],
				totalEdits: item.day.edits.length,
			})
		}
	}

	let olderMonths = Array.from(monthMap.values())

	return { recentDays, olderMonths }
}

interface DateDropdownProps {
	dayGroups: DayGroup[]
	selectedDayIndex: number | null
	dropdownLabel: string
	disabled: boolean
	hasHistory: boolean
	onViewModeChange: (mode: ViewMode, dayIndex?: number) => void
	className?: string
}

function DateDropdown({
	dayGroups,
	selectedDayIndex,
	dropdownLabel,
	disabled,
	hasHistory,
	onViewModeChange,
	className = "",
}: DateDropdownProps) {
	let t = useIntl()
	let totalEdits = dayGroups.reduce((sum, day) => sum + day.edits.length, 0)
	let { recentDays, olderMonths } = groupDaysByMonth(dayGroups)

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={disabled || !hasHistory}
				className={`border-input bg-background hover:bg-muted hover:text-foreground h-9 items-center justify-between gap-1 rounded-none border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 md:h-7 md:px-2.5 md:text-xs ${className || "flex"}`}
			>
				<span>{dropdownLabel}</span>
				<ChevronDown className="size-4 opacity-50" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				side="top"
				align="start"
				className="max-h-80 overflow-y-auto"
			>
				<DropdownMenuRadioGroup
					value={selectedDayIndex !== null ? String(selectedDayIndex) : "all"}
					onValueChange={value => {
						if (value === "all") {
							onViewModeChange("days")
						} else {
							onViewModeChange("edits", Number(value))
						}
					}}
				>
					<DropdownMenuRadioItem value="all">
						{t("timeMachine.allHistoryCount", { count: String(totalEdits) })}
					</DropdownMenuRadioItem>

					{recentDays.length > 0 && (
						<>
							<DropdownMenuSeparator />
							{recentDays.map(({ day, originalIndex }) => (
								<DropdownMenuRadioItem
									key={originalIndex}
									value={String(originalIndex)}
								>
									{formatDayLabel(day.date)} ({day.edits.length})
								</DropdownMenuRadioItem>
							))}
						</>
					)}
				</DropdownMenuRadioGroup>

				{olderMonths.length > 0 && (
					<>
						<DropdownMenuSeparator />
						{olderMonths.map(month => (
							<DropdownMenuSub key={month.label}>
								<DropdownMenuSubTrigger>
									{month.label} ({month.totalEdits})
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent>
									<DropdownMenuRadioGroup
										value={
											selectedDayIndex !== null
												? String(selectedDayIndex)
												: "all"
										}
										onValueChange={value => {
											if (value !== "all") {
												onViewModeChange("edits", Number(value))
											}
										}}
									>
										{month.days.map(({ day, originalIndex }) => (
											<DropdownMenuRadioItem
												key={originalIndex}
												value={String(originalIndex)}
											>
												{formatDayLabel(day.date)} ({day.edits.length})
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						))}
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

interface TimeMachineSliderProps {
	min: number
	max: number
	value: number
	onChange: (value: number) => void
	onCommit: (value: number) => void
	disabled?: boolean
	className?: string
	getTooltipContent: (value: number) => string | undefined
}

function TimeMachineSlider({
	min,
	max,
	value,
	onChange,
	onCommit,
	disabled,
	className,
	getTooltipContent,
}: TimeMachineSliderProps) {
	let t = useIntl()
	let [localValue, setLocalValue] = useState(value)
	let [isHovering, setIsHovering] = useState(false)
	let [isDragging, setIsDragging] = useState(false)

	function handleValueChange(newValue: number, details: { reason: string }) {
		setLocalValue(newValue)
		if (details.reason === "drag") {
			setIsDragging(true)
		}
		onChange(newValue)
	}

	function handleValueCommitted(committedValue: number) {
		setIsDragging(false)
		setLocalValue(committedValue)
		onCommit(committedValue)
	}

	let displayValue = isDragging ? localValue : value
	let tooltipContent = getTooltipContent(displayValue)
	let showTooltip = (isDragging || isHovering) && tooltipContent

	return (
		<SliderPrimitive.Root
			className={cn("data-horizontal:w-full", className)}
			value={displayValue}
			onValueChange={handleValueChange}
			onValueCommitted={handleValueCommitted}
			min={min}
			max={max}
			disabled={disabled}
			thumbAlignment="edge"
		>
			<SliderPrimitive.Control className="relative flex h-5 w-full touch-none items-center select-none data-disabled:opacity-50">
				<SliderPrimitive.Track className="bg-muted relative h-1.5 w-full rounded-none select-none">
					<SliderPrimitive.Indicator className="bg-primary h-full select-none" />
					<SliderPrimitive.Thumb
						getAriaLabel={() => t("timeMachine.editHistory")}
						getAriaValueText={(_, thumbValue) =>
							getTooltipContent(thumbValue) ?? String(thumbValue)
						}
						className="border-ring ring-ring/50 relative block size-5 shrink-0 rounded-none border bg-white transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-1 focus-visible:ring-1 focus-visible:outline-hidden active:ring-1 disabled:pointer-events-none disabled:opacity-50"
						onMouseEnter={() => setIsHovering(true)}
						onMouseLeave={() => setIsHovering(false)}
					>
						{showTooltip && (
							<div className="bg-foreground text-background absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-none px-2 py-1 text-xs whitespace-nowrap">
								{tooltipContent}
								<div className="bg-foreground absolute top-full left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45" />
							</div>
						)}
					</SliderPrimitive.Thumb>
				</SliderPrimitive.Track>
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	)
}
