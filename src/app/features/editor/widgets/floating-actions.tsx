import {
	useEffect,
	useState,
	useRef,
	useImperativeHandle,
	type FormEvent,
	type KeyboardEvent,
} from "react"
import { createPortal } from "react-dom"
import { useSidebar } from "@/app/components/ui/sidebar"
import { syntaxTree } from "@codemirror/language"
import type { EditorView } from "@codemirror/view"
import type { MarkdownEditorRef } from "./editor"
import { Button } from "@/app/components/ui/button"
import { Textarea } from "@/app/components/ui/textarea"
import { useScreenKeyboardFloatingBottomOffset } from "../hooks/use-screen-keyboard-bottom-inset"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import { Kbd } from "@/app/components/ui/kbd"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import {
	Check,
	ExternalLink,
	Image as ImageIcon,
	Film,
	FileText,
	Link2,
	Trash2,
	Plus,
	FileSymlinkIcon,
	MessageSquarePlus,
	PenTool,
} from "lucide-react"
import { parseWikiLinks } from "../lib/wikilink-parser"
import { useNavigate } from "@tanstack/react-router"
import { Combobox } from "@base-ui/react/combobox"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { cn } from "@/app/lib/cn"
import {
	getAriaShortcut,
	getShortcutLabel,
	type ShortcutId,
} from "@/app/lib/shortcut-registry"
import { useIntl, T } from "@/shared/intl/setup"

export {
	FloatingActions,
	TaskAction,
	LinkAction,
	MediaAction,
	WikiLinkAction,
	CommentAction,
	WikiLinkDialog,
}
export type { FloatingActionsProps, FloatingActionsRef }

type Range = { from: number; to: number }

interface FloatingActionsRef {
	triggerContextAction: () => boolean
	triggerAddComment: () => boolean
	triggerAssetPicker: () => boolean
}

interface FloatingActionsProps {
	editor: React.RefObject<MarkdownEditorRef | null>
	focused: boolean
	readOnly?: boolean
	assets?: { id: string; name: string }[]
	docs?: { id: string; title: string }[]
	onUploadAndInsert?: (file: File, replaceRange: Range) => Promise<void>
	onAddComment?: (selection: Range, body: string) => boolean
	children: (ctx: FloatingActionsContext) => React.ReactNode
	actionsRef?: React.RefObject<FloatingActionsRef | null>
}

interface FloatingActionsContext {
	task: { isTask: boolean; taskChecked: boolean; taskRange: Range | null }
	link: { linkUrl: string | null; linkRange: Range | null }
	image: {
		isImage: boolean
		imageRange: Range | null
		assetMenuOpen: boolean
		setAssetMenuOpen: (open: boolean) => void
		markAssetMenuAction: () => void
		imageDialogOpen: boolean
		setImageDialogOpen: (open: boolean) => void
		closeImageDialog: () => void
		imageRangeRef: React.RefObject<Range | null>
	}
	wikiLink: {
		wikiLinkId: string | null
		wikiLinkRange: Range | null
		wikiLinkMenuOpen: boolean
		setWikiLinkMenuOpen: (open: boolean) => void
		wikiLinkDialogOpen: boolean
		setWikiLinkDialogOpen: (open: boolean) => void
		wikiLinkRangeRef: React.RefObject<Range | null>
		wikilinkPrefill: string
		setWikilinkPrefill: (value: string) => void
	}
	comment: {
		selectionRange: Range | null
		selectedText: string
		rememberedSelection: Range | null
		setRememberedSelection: (selection: Range | null) => void
		commentDialogOpen: boolean
		setCommentDialogOpen: (open: boolean) => void
		onAddComment?: (selection: Range, body: string) => boolean
	}
}

interface EditorContext {
	isTask: boolean
	taskChecked: boolean
	taskRange: Range | null
	linkUrl: string | null
	linkRange: Range | null
	isImage: boolean
	imageRange: Range | null
	imageSelection: Range | null
	wikiLinkId: string | null
	wikiLinkRange: Range | null
	selectionRange: Range | null
	selectedText: string
}

function FloatingActions({
	editor,
	focused,
	readOnly,
	docs,
	onAddComment,
	children,
	actionsRef,
}: FloatingActionsProps) {
	let { rightOpen, isMobile } = useSidebar()
	let { bottomOffset, screenKeyboardOpen } =
		useScreenKeyboardFloatingBottomOffset()
	let [context, setContext] = useState<EditorContext>({
		isTask: false,
		taskChecked: false,
		taskRange: null,
		linkUrl: null,
		linkRange: null,
		isImage: false,
		imageRange: null,
		imageSelection: null,
		wikiLinkId: null,
		wikiLinkRange: null,
		selectionRange: null,
		selectedText: "",
	})
	let [imageDialogOpen, setImageDialogOpen] = useState(false)
	let [assetMenuOpen, setAssetMenuOpen] = useState(false)
	let [wikiLinkMenuOpen, setWikiLinkMenuOpen] = useState(false)
	let [wikiLinkDialogOpen, setWikiLinkDialogOpen] = useState(false)
	let [commentDialogOpen, setCommentDialogOpen] = useState(false)
	let [rememberedCommentSelection, setRememberedCommentSelection] =
		useState<Range | null>(null)
	let [isInteracting, setIsInteracting] = useState(false)
	let [wikilinkPrefill, setWikilinkPrefill] = useState("")

	let imageRangeRef = useRef<Range | null>(null)
	let imageSelectionRef = useRef<Range | null>(null)
	let assetMenuActionPendingRef = useRef(false)
	let imageDialogDismissPendingRef = useRef(false)
	let assetMenuCloseTimerRef = useRef<number | null>(null)
	let imageDialogCloseTimerRef = useRef<number | null>(null)
	let wikiLinkRangeRef = useRef<Range | null>(null)

	let rightOffset =
		!isMobile && rightOpen
			? "calc(var(--right-sidebar-width, 14rem) + 1rem)"
			: "1rem"

	let hasTextSelection = Boolean(
		context.selectionRange && context.selectedText.trim(),
	)

	// Reset context when focus lost and not interacting
	let shouldResetContext =
		!focused &&
		!isInteracting &&
		!assetMenuOpen &&
		!imageDialogOpen &&
		!wikiLinkMenuOpen &&
		!wikiLinkDialogOpen &&
		!commentDialogOpen &&
		!hasTextSelection

	let emptyContext: EditorContext = {
		isTask: false,
		taskChecked: false,
		taskRange: null,
		linkUrl: null,
		linkRange: null,
		isImage: false,
		imageRange: null,
		imageSelection: null,
		wikiLinkId: null,
		wikiLinkRange: null,
		selectionRange: null,
		selectedText: "",
	}

	// Reset context during render when conditions change (adjust state during render pattern)
	let [prevShouldReset, setPrevShouldReset] = useState(shouldResetContext)
	if (shouldResetContext !== prevShouldReset) {
		setPrevShouldReset(shouldResetContext)
		if (shouldResetContext) {
			setContext(emptyContext)
		}
	}

	// Subscribe to editor selection changes and compute context
	useEffect(() => {
		let view = editor.current?.getEditor()
		if (!view) return

		function getEditorContext(v: EditorView): EditorContext {
			let state = v.state
			let selection = state.selection.main
			let pos = selection.head
			let tree = syntaxTree(state)
			let node = tree.resolveInner(pos, -1)
			let selectionFrom = Math.min(selection.from, selection.to)
			let selectionTo = Math.max(selection.from, selection.to)

			let result: EditorContext = {
				isTask: false,
				taskChecked: false,
				taskRange: null,
				linkUrl: null,
				linkRange: null,
				isImage: false,
				imageRange: null,
				imageSelection: null,
				wikiLinkId: null,
				wikiLinkRange: null,
				selectionRange:
					selectionFrom === selectionTo
						? null
						: { from: selectionFrom, to: selectionTo },
				selectedText:
					selectionFrom === selectionTo
						? ""
						: state.sliceDoc(selectionFrom, selectionTo),
			}

			let current: typeof node | null = node
			while (current) {
				if (current.name === "Task" || current.name === "TaskMarker") {
					result.isTask = true
					let taskNode = current.name === "Task" ? current : current.parent
					if (taskNode) {
						let taskText = state.sliceDoc(taskNode.from, taskNode.to)
						result.taskChecked =
							taskText.includes("[x]") || taskText.includes("[X]")
						result.taskRange = { from: taskNode.from, to: taskNode.to }
					}
				}

				if (current.name === "ListItem") {
					let child = current.firstChild
					while (child) {
						if (child.name === "Task") {
							result.isTask = true
							let taskText = state.sliceDoc(child.from, child.to)
							result.taskChecked =
								taskText.includes("[x]") || taskText.includes("[X]")
							result.taskRange = { from: child.from, to: child.to }
							break
						}
						child = child.nextSibling
					}
				}

				if (current.name === "Link") {
					let urlNode = current.getChild("URL")
					if (urlNode) {
						let url = state.sliceDoc(urlNode.from, urlNode.to)
						if (!url.startsWith("asset:")) {
							result.linkUrl = url
							result.linkRange = { from: current.from, to: current.to }
						}
					}
				}

				if (current.name === "Image") {
					result.isImage = true
					result.imageRange = { from: current.from, to: current.to }
					result.imageSelection = { from: selection.from, to: selection.to }
				}

				current = current.parent
			}

			// Check for wikilinks via text-based detection (not in syntax tree)
			let content = state.doc.toString()
			let wikilinks = parseWikiLinks(content)
			for (let link of wikilinks) {
				if (pos >= link.from && pos <= link.to) {
					result.wikiLinkId = link.id
					result.wikiLinkRange = { from: link.from, to: link.to }
					break
				}
			}

			// Also detect incomplete wikilinks: [[ or [[text without closing ]]
			if (!result.wikiLinkId) {
				let line = state.doc.lineAt(pos)
				let textBefore = line.text.slice(0, pos - line.from)
				let textAfter = line.text.slice(pos - line.from)
				let match = textBefore.match(/\[\[([^\][]*)$/)
				if (match) {
					let from = line.from + textBefore.lastIndexOf("[[")
					// Check if closing brackets exist after cursor
					let closingMatch = textAfter.match(/^([^\][]*)]]/)
					let to = closingMatch
						? pos + closingMatch[0].length
						: pos + (textAfter.match(/^[^\][]*/) ?? [""])[0].length
					result.wikiLinkId = match[1] || "" // empty string for [[]]
					result.wikiLinkRange = { from, to }
				}
			}

			return result
		}

		let rafId: number | null = null
		let lastSelectionKey = ""

		function checkSelection() {
			let v = editor.current?.getEditor()
			if (v) {
				let selection = v.state.selection.main
				let selectionKey = `${selection.anchor}:${selection.head}`
				if (selectionKey !== lastSelectionKey) {
					lastSelectionKey = selectionKey
					setContext(getEditorContext(v))
				}
			}
			rafId = requestAnimationFrame(checkSelection)
		}

		rafId = requestAnimationFrame(() => {
			setContext(getEditorContext(view))
			checkSelection()
		})

		return () => {
			if (rafId !== null) {
				cancelAnimationFrame(rafId)
			}
		}
	}, [editor, focused])

	// Expose triggerContextAction to parent via ref
	useImperativeHandle(actionsRef, () => ({
		triggerAssetPicker: () => {
			let view = editor.current?.getEditor()
			if (!view || readOnly) return false
			let selection = view.state.selection.main
			imageRangeRef.current = { from: selection.from, to: selection.to }
			imageSelectionRef.current = { from: selection.from, to: selection.to }
			setImageDialogOpen(true)
			return true
		},
		triggerAddComment: () => {
			let view = editor.current?.getEditor()
			if (!view || readOnly || !onAddComment) return false

			let selection = view.state.selection.main
			let from = Math.min(selection.from, selection.to)
			let to = Math.max(selection.from, selection.to)
			let selectedText = from === to ? "" : view.state.sliceDoc(from, to)
			if (!selectedText.trim()) return false

			setRememberedCommentSelection({ from, to })
			setContext(context => ({
				...context,
				selectionRange: { from, to },
				selectedText,
			}))
			setCommentDialogOpen(true)
			return true
		},
		triggerContextAction: () => {
			let view = editor.current?.getEditor()
			if (!view) return false

			// Detect wikilink at cursor
			let state = view.state
			let pos = state.selection.main.head
			let content = state.doc.toString()
			let wikilinks = parseWikiLinks(content)

			for (let link of wikilinks) {
				if (pos >= link.from && pos <= link.to) {
					wikiLinkRangeRef.current = { from: link.from, to: link.to }
					// Check if link ID resolves to an existing doc
					let isValidLink = docs?.some(d => d.id === link.id)
					if (isValidLink) {
						setWikiLinkMenuOpen(true)
					} else if (!readOnly) {
						setWikilinkPrefill(link.id)
						setWikiLinkDialogOpen(true)
					} else {
						return false
					}
					return true
				}
			}

			// Check for incomplete wikilink
			let line = state.doc.lineAt(pos)
			let textBefore = line.text.slice(0, pos - line.from)
			let textAfter = line.text.slice(pos - line.from)
			let match = textBefore.match(/\[\[([^\][]*)$/)
			if (match) {
				let from = line.from + textBefore.lastIndexOf("[[")
				let closingMatch = textAfter.match(/^([^\][]*)]]/)
				let to = closingMatch
					? pos + closingMatch[0].length
					: pos + (textAfter.match(/^[^\][]*/) ?? [""])[0].length
				wikiLinkRangeRef.current = { from, to }
				setWikilinkPrefill((match[1] ?? "").trim())
				if (readOnly) return false
				setWikiLinkDialogOpen(true)
				return true
			}

			// Check for image
			let tree = syntaxTree(state)
			let node = tree.resolveInner(pos, -1)
			let current: typeof node | null = node
			while (current) {
				if (current.name === "Image") {
					imageRangeRef.current = { from: current.from, to: current.to }
					imageSelectionRef.current = {
						from: state.selection.main.from,
						to: state.selection.main.to,
					}
					if (readOnly) return false
					setImageDialogOpen(true)
					return true
				}
				current = current.parent
			}
			return false
		},
	}))

	function handleImageDialogOpenChange(open: boolean) {
		if (open) {
			rememberImageTarget()
			clearImageDialogCloseTimer()
			imageDialogDismissPendingRef.current = false
		} else {
			imageDialogDismissPendingRef.current = true
			scheduleImageDialogSelectionRestore()
		}
		setImageDialogOpen(open)
	}

	function closeImageDialog() {
		imageDialogDismissPendingRef.current = false
		setImageDialogOpen(false)
	}

	function handleAssetMenuOpenChange(open: boolean) {
		if (open) {
			rememberImageTarget()
			clearAssetMenuCloseTimer()
			assetMenuActionPendingRef.current = false
		} else {
			scheduleAssetMenuSelectionRestore()
		}
		setAssetMenuOpen(open)
	}

	function scheduleImageDialogSelectionRestore() {
		clearImageDialogCloseTimer()
		imageDialogCloseTimerRef.current = window.setTimeout(() => {
			imageDialogCloseTimerRef.current = null
			if (!imageDialogDismissPendingRef.current) return

			imageDialogDismissPendingRef.current = false
			restoreImageSelection()
		}, 150)
	}

	function scheduleAssetMenuSelectionRestore() {
		clearAssetMenuCloseTimer()
		assetMenuCloseTimerRef.current = window.setTimeout(() => {
			assetMenuCloseTimerRef.current = null
			if (!assetMenuActionPendingRef.current) restoreImageSelection()

			assetMenuActionPendingRef.current = false
		}, 150)
	}

	function clearImageDialogCloseTimer() {
		if (imageDialogCloseTimerRef.current === null) return

		clearTimeout(imageDialogCloseTimerRef.current)
		imageDialogCloseTimerRef.current = null
	}

	function clearAssetMenuCloseTimer() {
		if (assetMenuCloseTimerRef.current === null) return

		clearTimeout(assetMenuCloseTimerRef.current)
		assetMenuCloseTimerRef.current = null
	}

	function restoreImageSelection() {
		let selection = imageSelectionRef.current
		if (selection) editor.current?.restoreSelection(selection)
	}

	function markAssetMenuAction() {
		assetMenuActionPendingRef.current = true
	}

	function rememberImageTarget() {
		if (context.imageRange) imageRangeRef.current = context.imageRange
		if (context.imageSelection)
			imageSelectionRef.current = context.imageSelection
	}

	function handlePointerDown() {
		rememberImageTarget()
		setIsInteracting(true)
	}

	function handlePointerUp() {
		setTimeout(() => {
			setIsInteracting(false)
		}, 100)
	}

	let shouldShow =
		focused ||
		assetMenuOpen ||
		imageDialogOpen ||
		wikiLinkMenuOpen ||
		wikiLinkDialogOpen ||
		commentDialogOpen ||
		isInteracting ||
		hasTextSelection
	if (readOnly || !shouldShow) return null

	let ctx: FloatingActionsContext = {
		task: {
			isTask: context.isTask,
			taskChecked: context.taskChecked,
			taskRange: context.taskRange,
		},
		link: {
			linkUrl: context.linkUrl,
			linkRange: context.linkRange,
		},
		image: {
			isImage: context.isImage,
			imageRange: context.imageRange,
			assetMenuOpen,
			setAssetMenuOpen: handleAssetMenuOpenChange,
			markAssetMenuAction,
			imageDialogOpen,
			setImageDialogOpen: handleImageDialogOpenChange,
			closeImageDialog,
			imageRangeRef,
		},
		wikiLink: {
			wikiLinkId: context.wikiLinkId,
			wikiLinkRange: context.wikiLinkRange,
			wikiLinkMenuOpen,
			setWikiLinkMenuOpen: handleWikiLinkMenuOpenChange,
			wikiLinkDialogOpen,
			setWikiLinkDialogOpen,
			wikiLinkRangeRef,
			wikilinkPrefill,
			setWikilinkPrefill,
		},
		comment: {
			selectionRange: context.selectionRange,
			selectedText: context.selectedText,
			rememberedSelection: rememberedCommentSelection,
			setRememberedSelection: setRememberedCommentSelection,
			commentDialogOpen,
			setCommentDialogOpen,
			onAddComment,
		},
	}

	function handleWikiLinkMenuOpenChange(open: boolean) {
		if (open && context.wikiLinkRange) {
			wikiLinkRangeRef.current = context.wikiLinkRange
		}
		setWikiLinkMenuOpen(open)
	}

	return createPortal(
		<div
			className={cn(
				"editor-floating-actions",
				"fixed z-50 flex flex-col gap-1",
				"pr-[env(safe-area-inset-right)]",
				!screenKeyboardOpen && "pb-[env(safe-area-inset-bottom)]",
			)}
			style={{ bottom: bottomOffset, right: rightOffset }}
			onPointerDown={handlePointerDown}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
		>
			{children(ctx)}
		</div>,
		document.body,
	)
}

interface TaskActionProps {
	editor: React.RefObject<MarkdownEditorRef | null>
	isTask: boolean
	taskChecked: boolean
	taskRange: Range | null
}

function TaskAction({ editor, isTask, taskChecked }: TaskActionProps) {
	let t = useIntl()
	if (!isTask) return null

	function toggleTask() {
		editor.current?.toggleTaskComplete()
	}

	return (
		<ActionButton
			icon={<Check />}
			label={
				taskChecked
					? t("editor.floating.markIncomplete")
					: t("editor.floating.markComplete")
			}
			shortcutId="toggleTask"
			onClick={toggleTask}
		/>
	)
}

interface LinkActionProps {
	linkUrl: string | null
}

function LinkAction({ linkUrl }: LinkActionProps) {
	let t = useIntl()
	if (!linkUrl) return null

	let url = linkUrl
	function openLink() {
		window.open(url, "_blank", "noopener,noreferrer")
	}

	return (
		<ActionButton
			icon={<ExternalLink />}
			label={t("editor.floating.openLink")}
			onClick={openLink}
		/>
	)
}

interface WikiLinkActionProps {
	editor: React.RefObject<MarkdownEditorRef | null>
	wikiLinkId: string | null
	wikiLinkMenuOpen: boolean
	setWikiLinkMenuOpen: (open: boolean) => void
	wikiLinkDialogOpen: boolean
	setWikiLinkDialogOpen: (open: boolean) => void
	wikiLinkRangeRef: React.RefObject<Range | null>
	wikilinkPrefill: string
	setWikilinkPrefill: (value: string) => void
	docs: { id: string; title: string }[]
	onCreateDoc?: (title: string) => Promise<string>
}

function WikiLinkAction({
	editor,
	wikiLinkId,
	wikiLinkMenuOpen,
	setWikiLinkMenuOpen,
	wikiLinkDialogOpen,
	setWikiLinkDialogOpen,
	wikiLinkRangeRef,
	wikilinkPrefill,
	setWikilinkPrefill,
	docs,
	onCreateDoc,
}: WikiLinkActionProps) {
	let t = useIntl()
	let navigate = useNavigate()
	let [inputValue, setInputValue] = useState(wikilinkPrefill)

	// Sync inputValue with wikilinkPrefill when dialog opens via Ctrl+Space
	let [prevPrefill, setPrevPrefill] = useState(wikilinkPrefill)
	if (wikilinkPrefill !== prevPrefill) {
		setPrevPrefill(wikilinkPrefill)
		setInputValue(wikilinkPrefill)
	}

	if (wikiLinkId === null) return null

	// Check if this is a valid existing doc (not empty/incomplete wikilink)
	let isValidLink = wikiLinkId && docs.some(d => d.id === wikiLinkId)
	// Extract text from incomplete wikilink to prefill search
	let prefillText = !isValidLink ? wikiLinkId.trim() : ""

	let filteredDocs = docs.filter(
		doc =>
			doc.id !== wikiLinkId &&
			doc.title.toLowerCase().includes(inputValue.toLowerCase()),
	)
	let showCreateOption =
		!!inputValue.trim() &&
		!docs.some(d => d.title.toLowerCase() === inputValue.toLowerCase())

	function openLinkedDoc() {
		setWikiLinkMenuOpen(false)
		navigate({ to: "/doc/$id", params: { id: wikiLinkId! } })
	}

	function handleChangeLink() {
		setWikiLinkMenuOpen(false)
		setWikiLinkDialogOpen(true)
	}

	function handleRemoveLink() {
		let view = editor.current?.getEditor()
		let range = wikiLinkRangeRef.current
		if (!view || !range) return

		view.dispatch({
			changes: { from: range.from, to: range.to, insert: "" },
		})
		setWikiLinkMenuOpen(false)
		view.focus()
	}

	function handleSelectDoc(docId: string | null) {
		if (!docId) return
		let view = editor.current?.getEditor()
		let range = wikiLinkRangeRef.current
		if (!view || !range) return

		view.dispatch({
			changes: { from: range.from, to: range.to, insert: `[[${docId}]]` },
		})
		setWikiLinkDialogOpen(false)
		setInputValue("")
		setWikilinkPrefill("")
		view.focus()
	}

	async function handleCreateAndLink() {
		if (!inputValue.trim() || !onCreateDoc) return
		let view = editor.current?.getEditor()
		let range = wikiLinkRangeRef.current
		if (!view || !range) return

		let newDocId = await onCreateDoc(inputValue.trim())
		view.dispatch({
			changes: { from: range.from, to: range.to, insert: `[[${newDocId}]]` },
		})
		setWikiLinkDialogOpen(false)
		setInputValue("")
		setWikilinkPrefill("")
		view.focus()
	}

	// For incomplete/empty wikilinks, show dialog directly instead of dropdown
	if (!isValidLink) {
		return (
			<>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								size="icon"
								variant="brand"
								className="shadow-md"
								nativeButton={false}
								onClick={() => {
									wikiLinkRangeRef.current =
										editor.current?.getEditor()?.state.selection.main.head !==
										undefined
											? ((): Range | null => {
													let view = editor.current?.getEditor()
													if (!view) return null
													let pos = view.state.selection.main.head
													let line = view.state.doc.lineAt(pos)
													let textBefore = line.text.slice(0, pos - line.from)
													let textAfter = line.text.slice(pos - line.from)
													let match = textBefore.match(/\[\[([^\][]*)$/)
													if (!match) return null
													let from = line.from + textBefore.lastIndexOf("[[")
													let closingMatch = textAfter.match(/^([^\][]*)]]/)
													let to = closingMatch
														? pos + closingMatch[0].length
														: pos +
															(textAfter.match(/^[^\][]*/) ?? [""])[0].length
													return { from, to }
												})()
											: null
									setInputValue(prefillText)
									setWikiLinkDialogOpen(true)
								}}
							>
								<FileSymlinkIcon />
							</Button>
						}
					/>
					<TooltipContent side="top" className="flex items-center gap-2">
						<T k="editor.floating.selectDocument" />
						<Kbd>Ctrl Space</Kbd>
					</TooltipContent>
				</Tooltip>

				<WikiLinkDialog
					open={wikiLinkDialogOpen}
					onOpenChange={setWikiLinkDialogOpen}
					title={t("editor.dialog.linkToDocument")}
					filteredDocs={filteredDocs}
					showCreateOption={showCreateOption}
					inputValue={inputValue}
					onInputValueChange={setInputValue}
					onSelectDoc={handleSelectDoc}
					onCreateAndLink={handleCreateAndLink}
				/>
			</>
		)
	}

	return (
		<>
			<DropdownMenu open={wikiLinkMenuOpen} onOpenChange={setWikiLinkMenuOpen}>
				<Tooltip>
					<DropdownMenuTrigger
						render={
							<TooltipTrigger
								render={
									<Button
										size="icon"
										variant="brand"
										className="shadow-md"
										nativeButton={false}
									>
										<FileSymlinkIcon />
									</Button>
								}
							/>
						}
					/>
					<TooltipContent side="top" className="flex items-center gap-2">
						<T k="editor.floating.wikiLink" />
						<Kbd>Ctrl Space</Kbd>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" side="top">
					<DropdownMenuItem onClick={openLinkedDoc}>
						<ExternalLink className="mr-2 size-4" />
						<T k="editor.floating.openLinkedDoc" />
					</DropdownMenuItem>
					<DropdownMenuItem onClick={handleChangeLink}>
						<Link2 className="mr-2 size-4" />
						<T k="editor.floating.changeLinkedDoc" />
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={handleRemoveLink}
						className="text-destructive"
					>
						<Trash2 className="mr-2 size-4" />
						<T k="editor.floating.removeLink" />
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<WikiLinkDialog
				open={wikiLinkDialogOpen}
				onOpenChange={setWikiLinkDialogOpen}
				title={t("editor.dialog.changeLinkedDocument")}
				filteredDocs={filteredDocs}
				showCreateOption={showCreateOption}
				inputValue={inputValue}
				onInputValueChange={setInputValue}
				onSelectDoc={handleSelectDoc}
				onCreateAndLink={handleCreateAndLink}
			/>
		</>
	)
}

interface WikiLinkDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	title: string
	filteredDocs: { id: string; title: string }[]
	showCreateOption: boolean
	inputValue: string
	onInputValueChange: (value: string) => void
	onSelectDoc: (docId: string | null) => void
	onCreateAndLink: () => void
}

function WikiLinkDialog({
	open,
	onOpenChange,
	title,
	filteredDocs,
	showCreateOption,
	inputValue,
	onInputValueChange,
	onSelectDoc,
	onCreateAndLink,
}: WikiLinkDialogProps) {
	let t = useIntl()
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>
						<T k="editor.dialog.searchDocuments" />
					</DialogDescription>
				</DialogHeader>

				<Combobox.Root
					value={null}
					inputValue={inputValue}
					onValueChange={onSelectDoc}
					onInputValueChange={onInputValueChange}
				>
					<div className="relative">
						<Combobox.Input
							placeholder={t("editor.dialog.searchDocumentsPlaceholder")}
							className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-none border px-3 py-1 text-sm focus-visible:ring-1 focus-visible:outline-none"
						/>
					</div>

					<Combobox.Portal>
						<Combobox.Positioner sideOffset={4} className="z-50">
							<Combobox.Popup className="bg-popover text-popover-foreground ring-foreground/10 max-h-60 w-(--anchor-width) overflow-auto rounded-none shadow-md ring-1">
								{filteredDocs.length === 0 && !showCreateOption && (
									<div className="text-muted-foreground px-3 py-2 text-sm">
										<T k="editor.dialog.noDocumentsFound" />
									</div>
								)}

								{filteredDocs.map(doc => (
									<Combobox.Item
										key={doc.id}
										value={doc.id}
										className="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none"
									>
										<FileText className="text-muted-foreground size-4" />
										<span className="flex-1 truncate">{doc.title}</span>
									</Combobox.Item>
								))}

								{showCreateOption && (
									<button
										type="button"
										onClick={onCreateAndLink}
										className="hover:bg-accent hover:text-accent-foreground flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none"
									>
										<Plus className="text-muted-foreground size-4" />
										<span>
											{t("editor.dialog.createDocument", { name: inputValue })}
										</span>
									</button>
								)}
							</Combobox.Popup>
						</Combobox.Positioner>
					</Combobox.Portal>
				</Combobox.Root>

				<div className="flex justify-end gap-2 pt-2">
					<Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
						<T k="editor.dialog.cancel" />
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}

interface MediaActionProps {
	editor: React.RefObject<MarkdownEditorRef | null>
	isImage: boolean
	imageRange: Range | null
	assetMenuOpen: boolean
	setAssetMenuOpen: (open: boolean) => void
	markAssetMenuAction: () => void
	imageDialogOpen: boolean
	setImageDialogOpen: (open: boolean) => void
	closeImageDialog: () => void
	imageRangeRef: React.RefObject<Range | null>
	assets: {
		id: string
		name: string
		type: "image" | "video" | "tldraw"
	}[]
	onUploadAndInsert?: (file: File, replaceRange: Range) => Promise<void>
	onCreateTldraw?: (
		onCreated: (asset: { id: string; name: string }) => void,
	) => void
}

type AssetPickerStep = "media" | "whiteboard"

function MediaAction({
	editor,
	isImage,
	assetMenuOpen,
	setAssetMenuOpen,
	markAssetMenuAction,
	imageDialogOpen,
	setImageDialogOpen,
	closeImageDialog,
	imageRangeRef,
	assets,
	onUploadAndInsert,
	onCreateTldraw,
}: MediaActionProps) {
	let t = useIntl()
	let fileInputRef = useRef<HTMLInputElement>(null)
	let [inputValue, setInputValue] = useState("")
	let [step, setStep] = useState<AssetPickerStep>("media")

	if (!isImage && !assetMenuOpen && !imageDialogOpen) return null

	let selectableAssets = assets.filter(asset =>
		step === "whiteboard"
			? asset.type === "tldraw"
			: asset.type === "image" || asset.type === "video",
	)
	let filteredAssets = selectableAssets.filter(asset =>
		asset.name.toLowerCase().includes(inputValue.toLowerCase()),
	)

	function insertAsset(asset: { id: string; name: string }) {
		let view = editor.current?.getEditor()
		let range = imageRangeRef.current
		if (!view || !range) return

		view.dispatch({
			changes: {
				from: range.from,
				to: range.to,
				insert: `![${asset.name}](asset:${asset.id})`,
			},
		})
		view.focus()
	}

	function handleSelectAsset(assetId: string | null) {
		if (!assetId) return
		let asset = assets.find(a => a.id === assetId)
		if (!asset) return

		insertAsset(asset)
		closeImageDialog()
	}

	function handleDialogOpenChange(open: boolean) {
		setImageDialogOpen(open)
		if (!open) {
			setStep("media")
			setInputValue("")
		}
	}

	function createWhiteboard() {
		markAssetMenuAction()
		requestAnimationFrame(() => onCreateTldraw?.(insertAsset))
	}

	function createMedia() {
		markAssetMenuAction()
		fileInputRef.current?.click()
	}

	function selectAsset(assetType: AssetPickerStep) {
		markAssetMenuAction()
		setStep(assetType)
		setImageDialogOpen(true)
	}

	async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
		let file = e.target.files?.[0]
		let range = imageRangeRef.current
		if (!file || !range || !onUploadAndInsert) return

		e.target.value = ""
		closeImageDialog()
		await onUploadAndInsert(file, range)
		editor.current?.focus()
	}

	return (
		<>
			<DropdownMenu open={assetMenuOpen} onOpenChange={setAssetMenuOpen}>
				<Tooltip>
					<DropdownMenuTrigger
						render={
							<TooltipTrigger
								render={
									<Button
										size="icon"
										variant="brand"
										className="shadow-md"
										nativeButton={false}
										aria-label={t("editor.floating.addAsset")}
									>
										<Plus />
									</Button>
								}
							/>
						}
					/>
					<TooltipContent side="top" className="flex items-center gap-2">
						<T k="editor.floating.addAsset" />
						<Kbd>Ctrl Space</Kbd>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" side="top">
					<DropdownMenuGroup>
						<DropdownMenuLabel>
							<T k="editor.dialog.media" />
						</DropdownMenuLabel>
						<DropdownMenuItem
							disabled={!onUploadAndInsert}
							onClick={createMedia}
						>
							<Plus />
							<T k="editor.floating.new" />
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => selectAsset("media")}>
							<ImageIcon />
							<T k="editor.floating.select" />
						</DropdownMenuItem>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuLabel>
							<T k="assets.whiteboard" />
						</DropdownMenuLabel>
						<DropdownMenuItem
							disabled={!onCreateTldraw}
							onClick={createWhiteboard}
						>
							<Plus />
							<T k="editor.floating.new" />
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => selectAsset("whiteboard")}>
							<PenTool />
							<T k="editor.floating.select" />
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={imageDialogOpen} onOpenChange={handleDialogOpenChange}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>
							{step === "media"
								? t("editor.dialog.selectMedia")
								: t("editor.dialog.selectWhiteboard")}
						</DialogTitle>
						<DialogDescription>
							{step === "media"
								? t("editor.dialog.searchMedia")
								: t("editor.dialog.searchWhiteboards")}
						</DialogDescription>
					</DialogHeader>

					<Combobox.Root
						value={null}
						inputValue={inputValue}
						onValueChange={handleSelectAsset}
						onInputValueChange={setInputValue}
					>
						<div className="relative">
							<Combobox.Input
								placeholder={
									step === "media"
										? t("editor.dialog.searchMediaPlaceholder")
										: t("editor.dialog.searchWhiteboardsPlaceholder")
								}
								className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring h-11 w-full rounded-none border px-3 py-1 text-base focus-visible:ring-1 focus-visible:outline-none sm:h-9 sm:text-sm"
							/>
						</div>

						<Combobox.Portal>
							<Combobox.Positioner sideOffset={4} className="z-50">
								<Combobox.Popup className="bg-popover text-popover-foreground ring-foreground/10 max-h-60 w-(--anchor-width) overflow-auto rounded-none shadow-md ring-1">
									{filteredAssets.length === 0 && (
										<div className="text-muted-foreground px-3 py-2 text-sm">
											{step === "media"
												? t("editor.dialog.noMediaFound")
												: t("editor.dialog.noWhiteboardsFound")}
										</div>
									)}

									{filteredAssets.map(asset => (
										<Combobox.Item
											key={asset.id}
											value={asset.id}
											className="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none sm:min-h-9"
										>
											{asset.type === "video" ? (
												<Film className="text-muted-foreground size-4" />
											) : asset.type === "tldraw" ? (
												<PenTool className="text-muted-foreground size-4" />
											) : (
												<ImageIcon className="text-muted-foreground size-4" />
											)}
											<span className="flex-1 truncate">{asset.name}</span>
										</Combobox.Item>
									))}
								</Combobox.Popup>
							</Combobox.Positioner>
						</Combobox.Portal>
					</Combobox.Root>

					<div className="flex justify-end pt-2">
						<Button
							variant="ghost"
							size="sm"
							className="min-h-11 sm:min-h-9"
							onClick={() => handleDialogOpenChange(false)}
						>
							<T k="editor.dialog.cancel" />
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				className="hidden"
				onChange={handleFileChange}
			/>
		</>
	)
}

interface ActionButtonProps {
	icon: React.ReactNode
	label: string
	shortcutId?: ShortcutId
	onClick: () => void
}

interface CommentActionProps {
	editor: React.RefObject<MarkdownEditorRef | null>
	selectionRange: Range | null
	selectedText: string
	rememberedSelection: Range | null
	setRememberedSelection: (selection: Range | null) => void
	commentDialogOpen: boolean
	setCommentDialogOpen: (open: boolean) => void
	onAddComment?: (selection: Range, body: string) => boolean
}

function CommentAction({
	editor,
	selectionRange,
	selectedText,
	rememberedSelection,
	setRememberedSelection,
	commentDialogOpen,
	setCommentDialogOpen,
	onAddComment,
}: CommentActionProps) {
	let t = useIntl()
	let [body, setBody] = useState("")
	let canOpen = Boolean(onAddComment && selectionRange && selectedText.trim())
	let canSubmit = Boolean(rememberedSelection && body.trim())

	function openDialog() {
		if (!selectionRange || !selectedText.trim()) return
		setRememberedSelection(selectionRange)
		setCommentDialogOpen(true)
	}

	function closeDialog(open: boolean) {
		setCommentDialogOpen(open)
		if (!open) {
			setBody("")
			setRememberedSelection(null)
		}
	}

	function submitComment(event?: FormEvent) {
		event?.preventDefault()
		let selection = rememberedSelection
		if (!onAddComment || !selection || !body.trim()) return
		if (onAddComment(selection, body)) {
			setBody("")
			setRememberedSelection(null)
			setCommentDialogOpen(false)
			editor.current?.restoreSelection(selection)
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key !== "Enter" || event.shiftKey) return
		event.preventDefault()
		submitComment()
	}

	if (!canOpen && !commentDialogOpen) return null

	return (
		<>
			<ActionButton
				icon={<MessageSquarePlus />}
				label={t("comments.add")}
				shortcutId="comment"
				onClick={openDialog}
			/>
			<Dialog open={commentDialogOpen} onOpenChange={closeDialog}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>{t("comments.add")}</DialogTitle>
						<DialogDescription className="line-clamp-3">
							{selectedText || t("comments.selectionRequired")}
						</DialogDescription>
					</DialogHeader>
					<form className="space-y-3" onSubmit={submitComment}>
						<Textarea
							value={body}
							onChange={event => setBody(event.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={t("comments.newPlaceholder")}
							minRows={3}
						/>
						<Button type="submit" className="w-full" disabled={!canSubmit}>
							<MessageSquarePlus />
							{t("comments.add")}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</>
	)
}

function ActionButton({ icon, label, shortcutId, onClick }: ActionButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						size="icon"
						variant="brand"
						onClick={onClick}
						aria-label={label}
						aria-keyshortcuts={
							shortcutId ? getAriaShortcut(shortcutId) : undefined
						}
						className="shadow-md"
						nativeButton={false}
					>
						{icon}
					</Button>
				}
			/>
			<TooltipContent side="top" className="flex items-center gap-2">
				{label}
				{shortcutId && <Kbd>{getShortcutLabel(shortcutId)}</Kbd>}
			</TooltipContent>
		</Tooltip>
	)
}
