import { useImperativeHandle, useEffect, useRef, useState } from "react"
import { diff } from "fast-myers-diff"
import { ImageOff, Maximize2, Minimize2, PenTool } from "lucide-react"
import { toast } from "sonner"
import {
	EditorState,
	Compartment,
	type Extension,
	Prec,
} from "@codemirror/state"
import {
	EditorView,
	keymap,
	type KeyBinding,
	placeholder as placeholderExt,
	highlightActiveLine,
} from "@codemirror/view"
import {
	deleteMarkupBackward,
	markdown,
	markdownLanguage,
} from "@codemirror/lang-markdown"
import { languages } from "@codemirror/language-data"
import {
	defaultKeymap,
	addCursorAbove,
	addCursorBelow,
	copyLineDown,
	copyLineUp,
	deleteLine,
	history,
	historyKeymap,
	indentLess,
	indentMore,
	insertBlankLine,
	redo,
	selectLine,
	undo,
} from "@codemirror/commands"
import {
	selectNextOccurrence,
	selectSelectionMatches,
} from "@codemirror/search"
import { bracketMatching, syntaxTree } from "@codemirror/language"
import { Image as JazzImage } from "jazz-tools/react"
import { editorExtensions } from "../lib/extensions"
import {
	insertCodeBlock,
	insertBlankLineAbove,
	insertMarkdownLineBreak,
	clearFormatting,
	demoteHeading,
	insertImage,
	indentMarkdown,
	insertMarkdownBlock,
	insertLink,
	insertNewlineContinueMarkupTight,
	moveLineDown,
	moveLineUp,
	outdentMarkdown,
	promoteHeading,
	renumberOrderedLists,
	setBody,
	setHeadingLevel,
	sortTasks,
	toggleBlockquote,
	toggleBold,
	toggleBulletList,
	toggleInlineCode,
	toggleItalic,
	toggleOrderedList,
	toggleStrikethrough,
	toggleTaskCompleteWithSort,
	toggleTaskList,
} from "../lib/commands"
import {
	expandMarkdownSelection,
	shrinkMarkdownSelection,
} from "../lib/selection-commands"
import {
	insertTable,
	insertTableRow,
	moveTableCellBackward,
	moveTableCellForward,
} from "../lib/table-commands"
import { orderedListRenumbering } from "../lib/ordered-list-renumbering"
import { createCodeLanguageAutocomplete } from "../lib/code-language-autocomplete"
import { createSlashCommands } from "../lib/slash-commands"
import {
	insertPastedHtml,
	insertPastedText,
	insertRawPastedText,
} from "../lib/paste-commands"
import { createSpellcheckExtension } from "../lib/spellcheck"
import { createBracketsExtension } from "../lib/autocomplete-brackets"
import {
	deleteMarkerBackward,
	deleteMarkerForward,
} from "../lib/marker-deletion"
import { getDocumentHeadings } from "../lib/document-navigation"
import { createWikilinkAutocomplete } from "../lib/wikilink-autocomplete"
import { createLinkDecorations } from "../lib/link-decorations"
import { createWikilinkDecorations } from "../lib/wikilink-decorations"
import { createBacklinkDecorations } from "../lib/backlink-decorations"
import { findExtension, selectMatch } from "../lib/find-extension"
import { FindPanel } from "./find-panel"
import { fileDropCursor, clearFileDropCursor } from "../lib/file-drop-cursor"
import { EditorContextMenu } from "./editor-context-menu"

import { useIsMobile } from "@/app/hooks/use-mobile"
import { useHasFinePointer } from "@/app/hooks/use-fine-pointer"
import { useFindPanel } from "../hooks/use-find-panel"
import { useScreenKeyboardBottomInset } from "../hooks/use-screen-keyboard-bottom-inset"
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { Button } from "@/app/components/ui/button"
import { cn } from "@/app/lib/cn"
import {
	FloatingActions,
	TaskAction,
	LinkAction,
	MediaAction,
	WikiLinkAction,
	CommentAction,
	type FloatingActionsRef,
} from "./floating-actions"
import {
	UploadProgressDialog,
	type UploadPhase,
} from "@/app/features/import-export"
import { useIntl } from "@/shared/intl/setup"
import type { EditorAsset } from "@/app/features/assets"
import {
	getCodeMirrorShortcut,
	getAriaShortcut,
	getShortcutDefinitions,
	isShortcutId,
	isShortcutEvent,
	isShortcutTargetBlocked,
	type ShortcutId,
} from "@/app/lib/shortcut-registry"
import { combinedAutocompletion } from "@/app/lib/completion-sources"
import {
	CommandPalette,
	DocumentSwitcherDialog,
	OutlineDialog,
	ShortcutsDialog,
	type CommandId,
} from "./command-palette"

export { MarkdownEditor, useMarkdownEditorRef }
export { parseFrontmatter } from "../lib/frontmatter"
export type {
	MarkdownEditorProps,
	MarkdownEditorRef,
	WikilinkDoc,
	WikilinkResolution,
}

type WikilinkResolution = { title: string; exists: boolean }

type WikilinkDoc = {
	id: string
	title: string
	path?: string | null
	tags?: string[]
}

type DropTarget = { pos: number }
type EditorCommand = (view: EditorView) => boolean

interface MarkdownEditorProps {
	// Core
	value: string
	onChange: (readContent: () => string) => void

	// Cursor/focus callbacks
	onCursorChange?: (from: number, to: number) => void
	onFocus?: () => void
	onBlur?: () => void

	// Data for decorations (optional = feature detection)
	assets?: EditorAsset[]
	documents?: WikilinkDoc[]

	// Wikilink integration: caller resolves ids and handles clicks.
	// Editor owns the [[id]] syntax; documents owns the meaning.
	resolveWikilink?: (id: string) => WikilinkResolution | undefined
	onWikilinkClick?: (id: string, newTab: boolean) => void

	// Callbacks (optional = feature detection)
	onCreateDocument?: (title: string) => Promise<string>
	onUploadImage?: (file: File) => Promise<{ id: string; name: string }>
	onUploadVideo?: (
		file: File,
		options: {
			onProgress: (p: { phase: UploadPhase; progress: number }) => void
			signal: AbortSignal
		},
	) => Promise<{ id: string; name: string }>
	onImportTldraw?: (file: File) => void
	onCreateTldraw?: (
		onCreated: (asset: { id: string; name: string }) => void,
	) => void
	onEditTldraw?: (assetId: string) => void
	onAddComment?: (
		selection: { from: number; to: number },
		body: string,
	) => boolean

	// Extension slot for feature-supplied codemirror extensions
	extensions?: Extension[]

	// Config
	placeholder?: string
	readOnly?: boolean
	className?: string
	autoSortTasks?: boolean
	spellcheck?: boolean
	spellcheckLanguage?: string
	smartPairs?: boolean
	markerWrapping?: boolean
	tabIndent?: boolean
	smartPaste?: boolean
	autocomplete?: boolean
}

type VideoUploadState = {
	fileName: string
	phase: UploadPhase
	progress: number
	abortController: AbortController
}

interface MarkdownEditorRef {
	getContent(): string
	setContent(markdown: string): void
	focus(): void
	insertText(text: string): void
	insertBlock(text: string): void

	getSelection(): { from: number; to: number } | null
	getSelectedText(): string
	restoreSelection(selection: { from: number; to: number }): void

	getScrollPosition(): { top: number; left: number }
	setScrollPosition(position: { top: number; left: number }): void

	undo(): void
	redo(): void
	cut(): void
	copy(): void
	paste(): void

	toggleBold(): void
	toggleItalic(): void
	toggleStrikethrough(): void
	toggleInlineCode(): void
	setHeading(level: 1 | 2 | 3 | 4 | 5 | 6): void
	toggleBulletList(): void
	toggleOrderedList(): void
	toggleTaskList(): void
	toggleTaskComplete(): void
	toggleBlockquote(): void
	setBody(): void
	insertLink(): void
	insertImage(): void
	insertCodeBlock(): void

	indent(): void
	outdent(): void
	moveLineUp(): void
	moveLineDown(): void

	sortTasks(): void

	getLinkAtCursor(): string | null
	getEditor(): EditorView | null
	refreshDecorations(): void

	openFind(initialQuery?: string): void
	closeFind(): void
	openCommandPalette(): void
	openOutline(): void
	openDocumentSwitcher(): void

	showImagePreview(url: string, alt: string): void
}

function useMarkdownEditorRef() {
	return useRef<MarkdownEditorRef>(null)
}

function MarkdownEditor(
	props: MarkdownEditorProps & { ref?: React.Ref<MarkdownEditorRef> },
) {
	let {
		value,
		onChange,
		onCursorChange,
		onFocus,
		onBlur,
		assets,
		documents,
		resolveWikilink,
		onWikilinkClick,
		onCreateDocument,
		onUploadImage,
		onUploadVideo,
		onImportTldraw,
		onCreateTldraw,
		onEditTldraw,
		onAddComment,
		extensions: externalExtensions,
		placeholder,
		readOnly,
		className,
		autoSortTasks,
		spellcheck = true,
		spellcheckLanguage,
		smartPairs = true,
		markerWrapping = true,
		tabIndent = true,
		smartPaste = true,
		autocomplete = true,
		ref,
	} = props

	let t = useIntl()
	let isMobile = useIsMobile()
	let hasFinePointer = useHasFinePointer()

	// Find panel state is URL-driven via hook
	let { findOpen, findQuery, findCase, findFuzzy, findReplace, setFind } =
		useFindPanel()
	let findPanelOpen = findOpen
	let findPanelOpenRef = useRef(false)

	let lastExternalValue = useRef(value)
	let containerRef = useRef<HTMLDivElement>(null)
	let readOnlyCompartment = useRef(new Compartment())
	let placeholderCompartment = useRef(new Compartment())
	let spellcheckCompartment = useRef(new Compartment())
	let bracketsCompartment = useRef(new Compartment())
	let autocompleteCompartment = useRef(new Compartment())
	let floatingActionsRef = useRef<FloatingActionsRef>(null)
	let [view, setView] = useState<EditorView | null>(null)
	let [isFocused, setIsFocused] = useState(false)
	let [findPanelHeight, setFindPanelHeight] = useState(0)
	let [mediaPreviewOpen, setMediaPreviewOpen] = useState(false)
	let [mediaPreviewExpanded, setMediaPreviewExpanded] = useState(false)
	let [mediaPreview, setMediaPreview] = useState<{
		url: string
		alt: string
		assetId: string | null
	} | null>(null)
	let pendingTldrawEdit = useRef<string | null>(null)
	let [videoUpload, setVideoUpload] = useState<VideoUploadState | null>(null)
	let [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
	let [shortcutsOpen, setShortcutsOpen] = useState(false)
	let [outlineOpen, setOutlineOpen] = useState(false)
	let [documentSwitcherOpen, setDocumentSwitcherOpen] = useState(false)

	let callbacksRef = useRef({ onChange, onCursorChange, onFocus, onBlur })
	findPanelOpenRef.current = findPanelOpen
	let dataRef = useRef({ assets, documents })
	let autoSortRef = useRef(autoSortTasks ?? false)
	let uploadImageRef = useRef(onUploadImage)
	let uploadVideoRef = useRef(onUploadVideo)
	let importTldrawRef = useRef(onImportTldraw)
	let addCommentEnabledRef = useRef(Boolean(onAddComment))
	let activeDropsRef = useRef<Set<DropTarget>>(new Set())
	let rawPasteRef = useRef(false)
	let behaviorRef = useRef({ tabIndent, smartPaste })
	behaviorRef.current = { tabIndent, smartPaste }

	useEffect(() => {
		callbacksRef.current = { onChange, onCursorChange, onFocus, onBlur }
	})

	useEffect(() => {
		uploadImageRef.current = onUploadImage
	})

	useEffect(() => {
		uploadVideoRef.current = onUploadVideo
	})

	useEffect(() => {
		importTldrawRef.current = onImportTldraw
	})

	useEffect(() => {
		addCommentEnabledRef.current = Boolean(onAddComment)
	})

	useEffect(() => {
		autoSortRef.current = autoSortTasks ?? false
	}, [autoSortTasks])

	useEffect(() => {
		dataRef.current = { assets, documents }
	})

	useScreenKeyboardBottomInset(containerRef)

	// Set CSS variable on parent .markdown-editor for find panel padding
	useEffect(() => {
		let parent = containerRef.current?.closest(".markdown-editor")
		if (parent instanceof HTMLElement) {
			parent.dataset.findPanelOpen = String(findPanelOpen)
			parent.style.setProperty(
				"--find-panel-height",
				findPanelOpen ? `${findPanelHeight}px` : "0px",
			)
		}
	}, [findPanelOpen, findPanelHeight])

	let handleImagePreview = (url: string, alt: string) => {
		let assetId: string | null = null
		if (url.startsWith("asset:")) {
			assetId = url.slice(6)
		}
		setMediaPreview({ url, alt, assetId })
		setMediaPreviewExpanded(false)
		setMediaPreviewOpen(true)
	}

	let editableTldrawAssetId =
		!readOnly && mediaPreview?.assetId && onEditTldraw
			? assets?.find(
					asset => asset.id === mediaPreview.assetId && asset.type === "tldraw",
				)?.id
			: undefined

	function handleEditTldrawPreview(assetId: string) {
		pendingTldrawEdit.current = assetId
		setMediaPreviewOpen(false)
	}

	let wikilinkResolver = (id: string) => resolveWikilink?.(id)
	let handleWikilinkNavigate = (id: string, newTab: boolean) => {
		onWikilinkClick?.(id, newTab)
	}

	let wikilinkResolverRef = useRef(wikilinkResolver)
	useEffect(() => {
		wikilinkResolverRef.current = wikilinkResolver
	})

	let initRef = useRef({
		value,
		placeholder,
		readOnly,
		spellcheck,
		spellcheckLanguage,
		smartPairs,
		markerWrapping,
		autocomplete,
		isMobile,
		externalExtensions,
	})

	useEffect(() => {
		if (!containerRef.current) return

		let extensions: Extension[] = [
			history(),
			keymap.of([...defaultKeymap, ...historyKeymap]),
			Prec.highest(
				keymap.of([
					shortcutEventTracker(),
					writableShortcut("bold", toggleBold),
					writableShortcut("italic", toggleItalic),
					writableShortcut("inlineCode", toggleInlineCode),
					writableShortcut("link", insertLink),
					writableShortcut("image", view => {
						let opened =
							floatingActionsRef.current?.triggerAssetPicker() ?? false
						return opened || insertImage(view)
					}),
					writableShortcut("strikethrough", toggleStrikethrough),
					writableShortcut("heading1", setHeadingLevel(1)),
					writableShortcut("heading2", setHeadingLevel(2)),
					writableShortcut("heading3", setHeadingLevel(3)),
					writableShortcut("heading4", setHeadingLevel(4)),
					writableShortcut("heading5", setHeadingLevel(5)),
					writableShortcut("heading6", setHeadingLevel(6)),
					writableShortcut("body", setBody),
					writableShortcut("bulletList", toggleBulletList),
					writableShortcut("orderedList", toggleOrderedList),
					writableShortcut("taskList", toggleTaskList),
					writableShortcut("toggleTask", view =>
						toggleTaskCompleteWithSort(autoSortRef.current)(view),
					),
					writableShortcut("sortTasks", sortTasks),
					writableShortcut("blockquote", toggleBlockquote),
					writableShortcut("codeBlock", insertCodeBlock),
					writableShortcut("comment", () => {
						if (!addCommentEnabledRef.current) return false
						let opened =
							floatingActionsRef.current?.triggerAddComment() ?? false
						if (!opened) toast.info(t("comments.selectionRequired"))
						return true
					}),
					writableShortcut("moveLineUp", moveLineUp),
					writableShortcut("moveLineDown", moveLineDown),
					writableShortcut("duplicateLineUp", copyLineUp),
					writableShortcut("duplicateLineDown", copyLineDown),
					writableShortcut("deleteLine", deleteLine),
					writableShortcut("insertLineBelow", insertBlankLine),
					writableShortcut("insertLineAbove", insertBlankLineAbove),
					writableShortcut("indentSelection", indentMore),
					writableShortcut("outdentSelection", indentLess),
					shortcut("selectLine", selectLine),
					shortcut("addCursorAbove", addCursorAbove),
					shortcut("addCursorBelow", addCursorBelow),
					shortcut("selectNextOccurrence", selectNextOccurrence),
					shortcut("selectAllOccurrences", selectSelectionMatches),
					shortcut("expandSelection", expandMarkdownSelection),
					shortcut("shrinkSelection", shrinkMarkdownSelection),
					writableShortcut("hardBreak", insertMarkdownLineBreak),
					shortcut("commandPalette", () => {
						setCommandPaletteOpen(true)
						return true
					}),
					shortcut("documentOutline", () => {
						setOutlineOpen(true)
						return true
					}),
					writableShortcut("indent", view =>
						behaviorRef.current.tabIndent ? moveTableCellForward(view) : false,
					),
					writableShortcut("outdent", view =>
						behaviorRef.current.tabIndent ? moveTableCellBackward(view) : false,
					),
					shortcut("indent", view =>
						behaviorRef.current.tabIndent ? indentMarkdown(view) : false,
					),
					shortcut("outdent", view =>
						behaviorRef.current.tabIndent ? outdentMarkdown(view) : false,
					),
					{
						key: "Enter",
						run: runWritable(insertTableRow),
					},
					{
						key: "Enter",
						run: runWritable(insertNewlineContinueMarkupTight),
					},
					{
						key: "Backspace",
						run: runWritable(deleteMarkerBackward),
					},
					{
						key: "Backspace",
						run: runWritable(deleteMarkupBackward),
					},
					{
						key: "Delete",
						run: runWritable(deleteMarkerForward),
					},
					shortcut(
						"contextAction",
						() => floatingActionsRef.current?.triggerContextAction() ?? false,
					),
					shortcut("find", view => {
						let selectedText = view.state.sliceDoc(
							view.state.selection.main.from,
							view.state.selection.main.to,
						)
						setFind({ open: true, q: selectedText || undefined })
						return true
					}),
					shortcut("replace", view => {
						let selectedText = view.state.sliceDoc(
							view.state.selection.main.from,
							view.state.selection.main.to,
						)
						setFind({ open: true, replace: true, q: selectedText || undefined })
						return true
					}),
					shortcut("findNext", view => {
						if (findPanelOpenRef.current) {
							selectMatch(view, "next")
							return true
						}
						return false
					}),
					shortcut("findPrevious", view => {
						if (findPanelOpenRef.current) {
							selectMatch(view, "prev")
							return true
						}
						return false
					}),
				]),
			),
			markdown({
				base: markdownLanguage,
				codeLanguages: languages,
				addKeymap: false,
			}),
			editorExtensions,
			highlightActiveLine(),
			EditorView.lineWrapping,
			EditorView.clickAddsSelectionRange.of(event => event.altKey),
			EditorView.contentAttributes.of({
				"aria-keyshortcuts": editorAriaShortcuts(),
			}),
			EditorView.updateListener.of(update => {
				if (update.docChanged) {
					if (callbacksRef.current.onChange) {
						callbacksRef.current.onChange(() => update.state.doc.toString())
					}
					// Keep in-flight drop targets aligned with the live doc so
					// images dropped while uploads await still land at the
					// originally-pointed position.
					for (let target of activeDropsRef.current) {
						target.pos = update.changes.mapPos(target.pos, 1)
					}
				}
				if (update.selectionSet && callbacksRef.current.onCursorChange) {
					let { from, to } = update.state.selection.main
					callbacksRef.current.onCursorChange(from, to)
				}
				if (update.focusChanged) {
					let focused = update.view.hasFocus
					setIsFocused(focused)
					if (focused) {
						callbacksRef.current.onFocus?.()
					} else {
						callbacksRef.current.onBlur?.()
					}
				}
			}),
			// Feature extensions
			bracketMatching(),
			createLinkDecorations(),
			createWikilinkDecorations(
				id => wikilinkResolverRef.current(id),
				handleWikilinkNavigate,
			),
			createBacklinkDecorations(
				id => wikilinkResolverRef.current(id),
				handleWikilinkNavigate,
			),
			findExtension,
			orderedListRenumbering,
			fileDropCursor,
			...(initRef.current.externalExtensions ?? []),
		]

		extensions.push(
			bracketsCompartment.current.of(
				createBracketsExtension({
					smartPairs: initRef.current.smartPairs,
					markerWrapping: initRef.current.markerWrapping,
				}),
			),
			autocompleteCompartment.current.of(
				initRef.current.autocomplete
					? [
							createCodeLanguageAutocomplete(),
							createSlashCommands(),
							combinedAutocompletion(),
							createWikilinkAutocomplete(() => dataRef.current.documents ?? []),
						]
					: [],
			),
			placeholderCompartment.current.of(
				initRef.current.placeholder
					? placeholderExt(initRef.current.placeholder)
					: [],
			),
			readOnlyCompartment.current.of(
				initRef.current.readOnly ? EditorState.readOnly.of(true) : [],
			),
			spellcheckCompartment.current.of(
				createSpellcheckExtension(
					initRef.current.spellcheck,
					initRef.current.spellcheckLanguage,
				),
			),
		)

		let state = EditorState.create({
			doc: initRef.current.value,
			extensions: [EditorState.allowMultipleSelections.of(true), extensions],
		})

		let editorView = new EditorView({
			state,
			parent: containerRef.current,
		})

		setView(editorView)

		return () => {
			editorView.destroy()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run once
	}, [])

	useEffect(() => {
		let dom = containerRef.current
		if (!dom || !view) return
		let activeView = view

		function isFileDrag(event: DragEvent) {
			return event.dataTransfer?.types.includes("Files") ?? false
		}

		function handleDragOver(event: DragEvent) {
			if (isFileDrag(event)) event.preventDefault()
		}

		function handleDrop(event: DragEvent) {
			let files = event.dataTransfer?.files
			if (!files || files.length === 0) return

			// Always preventDefault on file drops so unsupported files
			// (PDFs, etc) don't fall through to file:// navigation.
			event.preventDefault()
			event.stopPropagation()

			// stopPropagation prevents the file-drop-cursor plugin's own
			// drop listener on scrollDOM from firing, so clear it here.
			clearFileDropCursor(activeView)

			if (activeView.state.readOnly) return
			let uploadImage = uploadImageRef.current
			let uploadVideo = uploadVideoRef.current
			let importTldraw = importTldrawRef.current
			let tldrawFile = Array.from(files).find(file =>
				file.name.toLowerCase().endsWith(".tldr"),
			)
			if (tldrawFile && importTldraw) {
				importTldraw(tldrawFile)
				return
			}

			let images = uploadImage
				? Array.from(files).filter(f => f.type.startsWith("image/"))
				: []
			let videos = uploadVideo
				? Array.from(files).filter(f => f.type.startsWith("video/"))
				: []
			if (images.length === 0 && videos.length === 0) return

			let dropPos =
				activeView.posAtCoords({ x: event.clientX, y: event.clientY }) ??
				activeView.state.doc.length
			let target: DropTarget = { pos: dropPos }
			activeDropsRef.current.add(target)

			function insertAtTarget(text: string) {
				if (!activeView.contentDOM.isConnected) return
				let pos = Math.max(0, Math.min(target.pos, activeView.state.doc.length))
				activeView.dispatch({
					changes: { from: pos, insert: text },
					selection: { anchor: pos + text.length },
				})
			}

			void (async () => {
				try {
					if (uploadImage) {
						for (let file of images) {
							try {
								let result = await uploadImage(file)
								insertAtTarget(`![${result.name}](asset:${result.id})`)
							} catch (err) {
								console.error("Image upload failed:", err)
								toast.error(t("editor.upload.failed", { name: file.name }))
							}
						}
					}
					if (uploadVideo) {
						for (let file of videos) {
							let abortController = new AbortController()
							setVideoUpload({
								fileName: file.name,
								phase: "compressing",
								progress: 0,
								abortController,
							})
							try {
								let result = await uploadVideo(file, {
									onProgress: p =>
										setVideoUpload(prev =>
											prev
												? { ...prev, phase: p.phase, progress: p.progress }
												: null,
										),
									signal: abortController.signal,
								})
								insertAtTarget(`![${result.name}](asset:${result.id})`)
							} catch (err) {
								if (!abortController.signal.aborted) {
									console.error("Video upload failed:", err)
									toast.error(t("editor.upload.failed", { name: file.name }))
								}
							} finally {
								setVideoUpload(null)
							}
						}
					}
				} finally {
					activeDropsRef.current.delete(target)
				}
			})()
		}

		function handleKeyDown(event: KeyboardEvent) {
			rawPasteRef.current = isShortcutEvent(event, "rawPaste")
		}

		function handlePaste(event: ClipboardEvent) {
			if (activeView.state.readOnly) return
			if (rawPasteRef.current) {
				rawPasteRef.current = false
				return
			}
			let files = Array.from(event.clipboardData?.files ?? [])
			let images = files.filter(file => file.type.startsWith("image/"))
			let uploadImage = uploadImageRef.current
			if (images.length > 0 && uploadImage) {
				event.preventDefault()
				let target: DropTarget = { pos: activeView.state.selection.main.from }
				activeDropsRef.current.add(target)
				void (async () => {
					try {
						for (let file of images) {
							let result = await uploadImage(file)
							let text = `![${result.name}](asset:${result.id})`
							let pos = Math.min(target.pos, activeView.state.doc.length)
							activeView.dispatch({
								changes: { from: pos, insert: text },
								selection: { anchor: pos + text.length },
							})
						}
					} catch (error) {
						console.error("Clipboard image upload failed:", error)
						toast.error(
							t("editor.upload.failed", { name: images[0]?.name ?? "image" }),
						)
					} finally {
						activeDropsRef.current.delete(target)
					}
				})()
				return
			}
			let html = event.clipboardData?.getData("text/html") ?? ""
			let text = event.clipboardData?.getData("text/plain") ?? ""
			if (!behaviorRef.current.smartPaste) {
				event.preventDefault()
				insertRawPastedText(activeView, text)
				return
			}
			if (html && insertPastedHtml(activeView, html)) {
				event.preventDefault()
				return
			}
			if (
				activeView.state.selection.main.from !==
					activeView.state.selection.main.to &&
				insertPastedText(activeView, text)
			) {
				event.preventDefault()
			}
		}

		// Capture phase so our preventDefault runs before CodeMirror's
		// own drop handler on .cm-content.
		dom.addEventListener("dragover", handleDragOver, true)
		dom.addEventListener("drop", handleDrop, true)
		dom.addEventListener("keydown", handleKeyDown, true)
		dom.addEventListener("paste", handlePaste, true)
		return () => {
			dom.removeEventListener("dragover", handleDragOver, true)
			dom.removeEventListener("drop", handleDrop, true)
			dom.removeEventListener("keydown", handleKeyDown, true)
			dom.removeEventListener("paste", handlePaste, true)
		}
	}, [view, t])

	useEffect(() => {
		if (!view) return

		let currentContent = view.state.doc.toString()
		if (value !== currentContent && value !== lastExternalValue.current) {
			// Same document with remote changes - diff to preserve cursor
			let cursorPos = view.state.selection.main.head
			let anchorPos = view.state.selection.main.anchor

			let changes: { from: number; to: number; insert: string }[] = []
			for (let [fromA, toA, fromB, toB] of diff(currentContent, value)) {
				changes.push({
					from: fromA,
					to: toA,
					insert: value.slice(fromB, toB),
				})
			}

			if (changes.length > 0) {
				let tr = view.state.update({ changes })
				let newCursorPos = tr.changes.mapPos(cursorPos, 1)
				let newAnchorPos = tr.changes.mapPos(anchorPos, 1)
				view.dispatch({
					changes,
					selection: { anchor: newAnchorPos, head: newCursorPos },
				})
			}
		}
		lastExternalValue.current = value
	}, [value, view])

	useEffect(() => {
		if (view) {
			view.dispatch({ selection: view.state.selection })
		}
	}, [view, documents, resolveWikilink])

	useEffect(() => {
		if (!view) return
		view.dispatch({
			effects: readOnlyCompartment.current.reconfigure(
				readOnly ? EditorState.readOnly.of(true) : [],
			),
		})
	}, [view, readOnly])

	useEffect(() => {
		if (!view) return
		view.dispatch({
			effects: placeholderCompartment.current.reconfigure(
				placeholder ? placeholderExt(placeholder) : [],
			),
		})
	}, [view, placeholder])

	useEffect(() => {
		if (!view) return
		view.dispatch({
			effects: spellcheckCompartment.current.reconfigure(
				createSpellcheckExtension(spellcheck, spellcheckLanguage),
			),
		})
	}, [view, spellcheck, spellcheckLanguage])

	useEffect(() => {
		if (!view) return
		view.dispatch({
			effects: bracketsCompartment.current.reconfigure(
				createBracketsExtension({ smartPairs, markerWrapping }),
			),
		})
	}, [view, smartPairs, markerWrapping])

	useEffect(() => {
		if (!view) return
		view.dispatch({
			effects: autocompleteCompartment.current.reconfigure(
				autocomplete
					? [
							createCodeLanguageAutocomplete(),
							createSlashCommands(),
							combinedAutocompletion(),
							createWikilinkAutocomplete(() => dataRef.current.documents ?? []),
						]
					: [],
			),
		})
	}, [view, autocomplete])

	function getContent() {
		return view?.state.doc.toString() ?? ""
	}

	function setContent(content: string) {
		if (!view) return
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: content },
		})
	}

	function focus() {
		view?.focus()
	}

	function insertText(text: string) {
		if (!view || view.state.readOnly) return
		let { from, to } = view.state.selection.main
		view.dispatch({
			changes: { from, to, insert: text },
			selection: { anchor: from + text.length },
		})
	}

	function insertBlock(text: string) {
		if (!view || view.state.readOnly) return
		insertMarkdownBlock(text)(view)
	}

	function runCommand(cmd: (view: EditorView) => boolean) {
		if (!view || view.state.readOnly) return
		cmd(view)
		view.focus()
	}

	function getLinkAtCursor(): string | null {
		if (!view) return null
		let state = view.state
		let pos = state.selection.main.head
		let tree = syntaxTree(state)
		let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(
			pos,
			-1,
		)

		while (node) {
			if (node.name === "Link") {
				let urlNode = node.getChild("URL")
				if (urlNode) {
					return state.sliceDoc(urlNode.from, urlNode.to)
				}
				let linkText = state.sliceDoc(node.from, node.to)
				let match = linkText.match(/\[([^\]]*)\]\(([^)]*)\)/)
				if (match) {
					return match[2]
				}
				return null
			}
			node = node.parent
		}
		return null
	}

	function refreshDecorations() {
		if (view) {
			view.dispatch({ selection: view.state.selection })
		}
	}

	async function handleUploadAndInsert(
		file: File,
		replaceRange: { from: number; to: number },
	) {
		if (!onUploadImage || !view) return

		let result = await onUploadImage(file)
		let newText = `![${result.name}](asset:${result.id})`
		view.dispatch({
			changes: {
				from: replaceRange.from,
				to: replaceRange.to,
				insert: newText,
			},
		})
	}

	function getSelectedText() {
		if (!view) return ""
		let { from, to } = view.state.selection.main
		if (from === to) return ""
		return view.state.sliceDoc(from, to)
	}

	function openFind(initialQuery?: string) {
		if (initialQuery) {
			setFind({ open: true, q: initialQuery })
		} else {
			// Just open, keep existing query
			setFind({ open: true })
		}
	}

	function closeFind() {
		setFind({ open: false })
	}

	function openCommandPalette() {
		setCommandPaletteOpen(true)
	}

	function openOutline() {
		setOutlineOpen(true)
	}

	function openDocumentSwitcher() {
		setDocumentSwitcherOpen(true)
	}

	function runShortcut(id: CommandId) {
		if (id === "clearFormatting") return void runCommand(clearFormatting)
		if (id === "promoteHeading") return void runCommand(promoteHeading)
		if (id === "demoteHeading") return void runCommand(demoteHeading)
		if (id === "insertTable") return void runCommand(insertTable)
		if (id === "insertDivider")
			return void runCommand(insertMarkdownBlock("---"))
		if (id === "insertWikilink") return void insertText("[[]]")
		if (id === "renumberLists") return void runCommand(renumberOrderedLists)
		if (id === "keyboardShortcuts") {
			setShortcutsOpen(true)
			return
		}
		if (id === "documentOutline") {
			setOutlineOpen(true)
			return
		}
		if (id === "switchDocument") {
			setDocumentSwitcherOpen(true)
			return
		}
		if (!isShortcutId(id)) return
		let editorCommand = editorShortcutCommand(id, autoSortRef.current)
		if (editorCommand) {
			runCommand(editorCommand)
			return
		}
		if (id === "image") {
			if (!floatingActionsRef.current?.triggerAssetPicker())
				runCommand(insertImage)
			return
		}
		if (id === "comment") {
			floatingActionsRef.current?.triggerAddComment()
			return
		}
		if (id === "commandPalette") {
			setCommandPaletteOpen(true)
			return
		}
		if (id === "find" || id === "replace") {
			setFind({ open: true, replace: id === "replace" })
			return
		}
		if (id === "findNext" || id === "findPrevious") {
			if (view) selectMatch(view, id === "findNext" ? "next" : "prev")
			return
		}
		if (id === "undo") return void runCommand(undo)
		if (id === "redo") return void runCommand(redo)
		if (id === "cut") return void cut()
		if (id === "copy") return void copy()
		if (id === "paste" || id === "rawPaste") return void paste()
		document.dispatchEvent(
			new CustomEvent("alkalye:run-shortcut", { detail: id }),
		)
	}

	async function cut() {
		if (!view || view.state.readOnly) return
		let { from, to } = view.state.selection.main
		if (from === to) return
		let text = view.state.sliceDoc(from, to)
		try {
			await navigator.clipboard.writeText(text)
		} catch {
			toast.error(t("editor.clipboard.unavailable"))
			return
		}
		view.dispatch({
			changes: { from, to, insert: "" },
			selection: { anchor: from },
		})
		view.focus()
	}

	async function copy() {
		if (!view) return
		let { from, to } = view.state.selection.main
		if (from === to) return
		let text = view.state.sliceDoc(from, to)
		try {
			await navigator.clipboard.writeText(text)
			view.focus()
		} catch {
			toast.error(t("editor.clipboard.unavailable"))
		}
	}

	async function paste() {
		if (!view || view.state.readOnly) return
		try {
			let text = await navigator.clipboard.readText()
			if (behaviorRef.current.smartPaste) {
				insertPastedText(view, text)
			} else insertRawPastedText(view, text)
			view.focus()
		} catch {
			toast.error(t("editor.clipboard.unavailable"))
		}
	}

	useImperativeHandle(ref, () => ({
		getContent,
		setContent,
		focus,
		insertText,
		insertBlock,
		getSelection: () => {
			if (!view) return null
			let { from, to } = view.state.selection.main
			return { from, to }
		},
		getSelectedText,
		restoreSelection: (selection: { from: number; to: number }) => {
			if (!view) return
			view.focus()
			view.dispatch({
				selection: { anchor: selection.from, head: selection.to },
			})
		},
		getScrollPosition: () => {
			if (!view) return { top: 0, left: 0 }
			return {
				top: view.scrollDOM.scrollTop,
				left: view.scrollDOM.scrollLeft,
			}
		},
		setScrollPosition: (position: { top: number; left: number }) => {
			if (!view) return
			view.scrollDOM.scrollTop = position.top
			view.scrollDOM.scrollLeft = position.left
		},
		undo: () => {
			if (view && !view.state.readOnly) {
				undo(view)
				view.focus()
			}
		},
		redo: () => {
			if (view && !view.state.readOnly) {
				redo(view)
				view.focus()
			}
		},
		cut,
		copy,
		paste,
		toggleBold: () => runCommand(toggleBold),
		toggleItalic: () => runCommand(toggleItalic),
		toggleStrikethrough: () => runCommand(toggleStrikethrough),
		toggleInlineCode: () => runCommand(toggleInlineCode),
		setHeading: (level: 1 | 2 | 3 | 4 | 5 | 6) =>
			runCommand(setHeadingLevel(level)),
		toggleBulletList: () => runCommand(toggleBulletList),
		toggleOrderedList: () => runCommand(toggleOrderedList),
		toggleTaskList: () => runCommand(toggleTaskList),
		toggleTaskComplete: () =>
			runCommand(toggleTaskCompleteWithSort(autoSortRef.current)),
		toggleBlockquote: () => runCommand(toggleBlockquote),
		setBody: () => runCommand(setBody),
		insertLink: () => runCommand(insertLink),
		insertImage: () => runCommand(insertImage),
		insertCodeBlock: () => runCommand(insertCodeBlock),
		indent: () => {
			if (view && !view.state.readOnly) {
				indentMore(view)
				view.focus()
			}
		},
		outdent: () => {
			if (view && !view.state.readOnly) {
				indentLess(view)
				view.focus()
			}
		},
		moveLineUp: () => runCommand(moveLineUp),
		moveLineDown: () => runCommand(moveLineDown),
		sortTasks: () => runCommand(sortTasks),
		getLinkAtCursor,
		getEditor: () => view,
		refreshDecorations,
		openFind,
		closeFind,
		openCommandPalette,
		openOutline,
		openDocumentSwitcher,
		showImagePreview: handleImagePreview,
	}))

	let internalRef = useRef<MarkdownEditorRef | null>(null)
	useEffect(() => {
		internalRef.current = {
			getContent,
			setContent,
			focus,
			insertText,
			insertBlock,
			getSelection: () => {
				if (!view) return null
				let { from, to } = view.state.selection.main
				return { from, to }
			},
			getSelectedText,
			restoreSelection: selection => {
				if (!view) return
				view.focus()
				view.dispatch({
					selection: { anchor: selection.from, head: selection.to },
				})
			},
			getScrollPosition: () => ({ top: 0, left: 0 }),
			setScrollPosition: () => {},
			undo: () => {},
			redo: () => {},
			cut,
			copy,
			paste,
			toggleBold: () => runCommand(toggleBold),
			toggleItalic: () => runCommand(toggleItalic),
			toggleStrikethrough: () => runCommand(toggleStrikethrough),
			toggleInlineCode: () => runCommand(toggleInlineCode),
			setHeading: level => runCommand(setHeadingLevel(level)),
			toggleBulletList: () => runCommand(toggleBulletList),
			toggleOrderedList: () => runCommand(toggleOrderedList),
			toggleTaskList: () => runCommand(toggleTaskList),
			toggleTaskComplete: () => {
				if (view) {
					toggleTaskCompleteWithSort(autoSortRef.current)(view)
					view.focus()
				}
			},
			toggleBlockquote: () => runCommand(toggleBlockquote),
			setBody: () => runCommand(setBody),
			insertLink: () => runCommand(insertLink),
			insertImage: () => runCommand(insertImage),
			insertCodeBlock: () => runCommand(insertCodeBlock),
			indent: () => view && void indentMore(view),
			outdent: () => view && void indentLess(view),
			moveLineUp: () => runCommand(moveLineUp),
			moveLineDown: () => runCommand(moveLineDown),
			sortTasks: () => runCommand(sortTasks),
			getLinkAtCursor,
			getEditor: () => view,
			refreshDecorations,
			openFind,
			closeFind,
			openCommandPalette,
			openOutline,
			openDocumentSwitcher,
			showImagePreview: handleImagePreview,
		}
	})

	useEffect(() => {
		let container = containerRef.current
		function handleGlobalKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || isShortcutTargetBlocked(event.target))
				return
			if (isShortcutEvent(event, "commandPalette")) {
				event.preventDefault()
				setCommandPaletteOpen(true)
				return
			}
			if (isShortcutEvent(event, "documentOutline")) {
				event.preventDefault()
				setOutlineOpen(true)
			}
		}
		function handleOpenPalette() {
			setCommandPaletteOpen(true)
		}
		function handleOpenShortcuts() {
			setShortcutsOpen(true)
		}
		function handleEditorAction(event: Event) {
			if (!(event instanceof CustomEvent)) return
			if (event.detail === "image") {
				if (floatingActionsRef.current?.triggerAssetPicker())
					event.preventDefault()
			}
			if (event.detail === "comment") {
				if (floatingActionsRef.current?.triggerAddComment())
					event.preventDefault()
			}
		}
		document.addEventListener("alkalye:open-command-palette", handleOpenPalette)
		document.addEventListener("alkalye:open-shortcuts", handleOpenShortcuts)
		document.addEventListener("keydown", handleGlobalKeyDown)
		container?.addEventListener("alkalye:editor-action", handleEditorAction)
		return () => {
			document.removeEventListener(
				"alkalye:open-command-palette",
				handleOpenPalette,
			)
			document.removeEventListener(
				"alkalye:open-shortcuts",
				handleOpenShortcuts,
			)
			document.removeEventListener("keydown", handleGlobalKeyDown)
			container?.removeEventListener(
				"alkalye:editor-action",
				handleEditorAction,
			)
		}
	}, [])

	return (
		<>
			<CommandPalette
				open={commandPaletteOpen}
				onOpenChange={setCommandPaletteOpen}
				onRun={runShortcut}
			/>
			<ShortcutsDialog
				open={shortcutsOpen}
				onOpenChange={setShortcutsOpen}
				onRun={runShortcut}
			/>
			{outlineOpen && (
				<OutlineDialog
					open
					onOpenChange={setOutlineOpen}
					headings={getDocumentHeadings(view?.state.doc.toString() ?? value)}
					onSelect={heading => {
						if (!view) return
						view.dispatch({
							selection: { anchor: heading.from },
							effects: EditorView.scrollIntoView(heading.from, {
								y: "start",
							}),
						})
						view.focus()
					}}
				/>
			)}
			<DocumentSwitcherDialog
				open={documentSwitcherOpen}
				onOpenChange={setDocumentSwitcherOpen}
				documents={documents ?? []}
				onSelect={document => onWikilinkClick?.(document.id, false)}
			/>
			{findPanelOpen && (
				<FindPanel
					view={view}
					query={findQuery}
					caseSensitive={findCase}
					fuzzy={findFuzzy}
					replaceOpen={findReplace}
					onQueryChange={q => setFind({ q })}
					onCaseChange={caseSensitive => setFind({ case: caseSensitive })}
					onFuzzyChange={fuzzy => setFind({ fuzzy })}
					onClose={closeFind}
					onHeightChange={setFindPanelHeight}
				/>
			)}
			<EditorContextMenu
				editor={internalRef}
				readOnly={readOnly}
				nativeContextMenu={!hasFinePointer}
				canAddComment={Boolean(onAddComment)}
				onAddComment={() => {
					let opened = floatingActionsRef.current?.triggerAddComment() ?? false
					if (!opened) toast.info(t("comments.selectionRequired"))
				}}
				onWikilinkClick={onWikilinkClick}
				onCreateWhiteboard={onCreateTldraw}
			>
				<div ref={containerRef} className={className} />
			</EditorContextMenu>

			<FloatingActions
				editor={internalRef}
				focused={isFocused}
				readOnly={readOnly}
				docs={documents}
				actionsRef={floatingActionsRef}
				onAddComment={onAddComment}
			>
				{ctx => (
					<>
						<CommentAction editor={internalRef} {...ctx.comment} />
						<TaskAction editor={internalRef} {...ctx.task} />
						<LinkAction {...ctx.link} />
						<WikiLinkAction
							editor={internalRef}
							{...ctx.wikiLink}
							docs={documents ?? []}
							onCreateDoc={onCreateDocument}
						/>
						<MediaAction
							editor={internalRef}
							{...ctx.image}
							assets={assets ?? []}
							onCreateTldraw={onCreateTldraw}
							onUploadAndInsert={
								onUploadImage ? handleUploadAndInsert : undefined
							}
						/>
					</>
				)}
			</FloatingActions>

			{videoUpload && (
				<UploadProgressDialog
					open={true}
					fileName={videoUpload.fileName}
					phase={videoUpload.phase}
					progress={videoUpload.progress}
					onCancel={() => {
						videoUpload.abortController.abort()
						setVideoUpload(null)
					}}
				/>
			)}

			<Dialog
				open={mediaPreviewOpen}
				onOpenChange={setMediaPreviewOpen}
				onOpenChangeComplete={open => {
					if (open) return
					setMediaPreviewExpanded(false)
					setMediaPreview(null)
					let assetId = pendingTldrawEdit.current
					pendingTldrawEdit.current = null
					if (assetId) onEditTldraw?.(assetId)
				}}
			>
				<DialogContent
					animated={false}
					showCloseButton={false}
					className={cn(
						"max-w-5xl",
						mediaPreviewExpanded &&
							"inset-0 top-0 left-0 !flex h-[100dvh] max-w-none translate-x-0 flex-col pt-[max(1rem,env(safe-area-inset-top))] sm:top-0 sm:max-w-none sm:translate-y-0",
					)}
				>
					<DialogHeader className="pr-12">
						<DialogTitle>
							{mediaPreview?.alt ?? t("editor.dialog.selectMedia")}
						</DialogTitle>
					</DialogHeader>
					<Button
						variant="ghost"
						size="icon"
						className={cn(
							"absolute top-2 right-2 min-h-11 min-w-11 touch-manipulation transition-none active:scale-100 sm:min-h-9 sm:min-w-9",
							mediaPreviewExpanded &&
								"top-[max(0.5rem,env(safe-area-inset-top))]",
						)}
						aria-label={
							mediaPreviewExpanded
								? t("editor.media.collapsePreview")
								: t("editor.media.expandPreview")
						}
						onClick={() => setMediaPreviewExpanded(expanded => !expanded)}
					>
						{mediaPreviewExpanded ? (
							<Minimize2 className="size-4" />
						) : (
							<Maximize2 className="size-4" />
						)}
					</Button>
					<div
						className={cn(
							mediaPreviewExpanded && "min-h-0 flex-1 overflow-hidden",
						)}
					>
						{mediaPreview && (
							<MediaPreviewContent
								preview={mediaPreview}
								assets={assets}
								expanded={mediaPreviewExpanded}
							/>
						)}
					</div>
					<DialogFooter className={cn(mediaPreviewExpanded && "shrink-0")}>
						<Button
							variant="outline"
							className="min-h-11 touch-manipulation sm:min-h-9"
							onClick={() => setMediaPreviewOpen(false)}
						>
							{t("editor.dialog.close")}
						</Button>
						{editableTldrawAssetId && (
							<Button
								className="min-h-11 touch-manipulation sm:min-h-9"
								onClick={() => handleEditTldrawPreview(editableTldrawAssetId)}
							>
								<PenTool className="size-4" />
								{t("assets.editWhiteboard")}
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}

function MediaPreviewContent({
	preview,
	assets,
	expanded,
}: {
	preview: { url: string; alt: string; assetId: string | null }
	assets?: EditorAsset[]
	expanded: boolean
}) {
	let t = useIntl()
	let asset = preview.assetId
		? assets?.find(a => a.id === preview.assetId)
		: null

	// External URL (not asset)
	if (!preview.assetId) {
		return (
			<img
				src={preview.url}
				alt={preview.alt}
				className={cn(
					"w-full object-contain",
					expanded ? "h-full" : "max-h-[70vh]",
				)}
			/>
		)
	}

	// Asset not found
	if (!asset) {
		return (
			<div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-12">
				<ImageOff className="size-12 opacity-50" />
				<p className="text-sm">{t("editor.media.notAvailable")}</p>
			</div>
		)
	}

	// Image asset
	if ((asset.type === "image" || asset.type === "tldraw") && asset.previewId) {
		return (
			<JazzImage
				imageId={asset.previewId}
				className={cn(
					"w-full object-contain",
					expanded ? "h-full" : "max-h-[70vh]",
				)}
			/>
		)
	}

	// Video asset
	if (asset.type === "video" && asset.video) {
		return <VideoPreview asset={asset} expanded={expanded} />
	}

	return (
		<div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-12">
			<ImageOff className="size-12 opacity-50" />
			<p className="text-sm">{t("editor.media.notAvailable")}</p>
		</div>
	)
}

function VideoPreview({
	asset,
	expanded,
}: {
	asset: EditorAsset
	expanded: boolean
}) {
	let t = useIntl()
	let [url, setUrl] = useState<string | null>(null)
	let [trackedVideo, setTrackedVideo] = useState(asset.video)

	// Reset when video changes
	if (trackedVideo !== asset.video) {
		setTrackedVideo(asset.video)
		if (url) {
			URL.revokeObjectURL(url)
			setUrl(null)
		}
	}

	// Load URL
	useEffect(() => {
		if (url) return
		let video = asset.video
		if (!video?.$isLoaded || !video.toBlob) return

		let cancelled = false
		requestAnimationFrame(() => {
			if (cancelled) return
			let blob = video.toBlob?.()
			if (!blob) return
			let objectUrl = URL.createObjectURL(blob)
			setUrl(objectUrl)
		})

		return () => {
			cancelled = true
		}
	}, [asset.video, url])

	// Cleanup
	useEffect(() => {
		return () => {
			if (url) URL.revokeObjectURL(url)
		}
	}, [url])

	if (!url) {
		return (
			<div className="bg-muted flex aspect-video w-full items-center justify-center rounded-lg">
				<span className="text-muted-foreground text-sm">
					{t("editor.media.loadingVideo")}
				</span>
			</div>
		)
	}

	return (
		<video
			src={url}
			controls
			autoPlay
			muted={asset.muteAudio}
			className={cn(
				"w-full object-contain",
				expanded ? "h-full" : "max-h-[70vh]",
			)}
		/>
	)
}

let shortcutEvents = new WeakMap<EditorView, KeyboardEvent>()

function shortcut(id: ShortcutId, run: EditorCommand): KeyBinding {
	let binding = getCodeMirrorShortcut(id)
	return {
		...binding,
		run: view => {
			let event = shortcutEvents.get(view)
			if (event?.isComposing || event?.getModifierState("AltGraph"))
				return false
			return run(view)
		},
		stopPropagation: true,
	}
}

function shortcutEventTracker(): KeyBinding {
	return {
		any: (view, event) => {
			shortcutEvents.set(view, event)
			return false
		},
	}
}

function writableShortcut(id: ShortcutId, run: EditorCommand): KeyBinding {
	return shortcut(id, runWritable(run))
}

function runWritable(run: EditorCommand): EditorCommand {
	return view => {
		if (view.state.readOnly) return true
		if (view.composing || view.compositionStarted) return false
		return run(view)
	}
}

function editorShortcutCommand(
	id: ShortcutId,
	autoSortTasks: boolean,
): EditorCommand | null {
	switch (id) {
		case "bold":
			return toggleBold
		case "italic":
			return toggleItalic
		case "inlineCode":
			return toggleInlineCode
		case "link":
			return insertLink
		case "strikethrough":
			return toggleStrikethrough
		case "heading1":
			return setHeadingLevel(1)
		case "heading2":
			return setHeadingLevel(2)
		case "heading3":
			return setHeadingLevel(3)
		case "heading4":
			return setHeadingLevel(4)
		case "heading5":
			return setHeadingLevel(5)
		case "heading6":
			return setHeadingLevel(6)
		case "body":
			return setBody
		case "bulletList":
			return toggleBulletList
		case "orderedList":
			return toggleOrderedList
		case "taskList":
			return toggleTaskList
		case "toggleTask":
			return toggleTaskCompleteWithSort(autoSortTasks)
		case "sortTasks":
			return sortTasks
		case "blockquote":
			return toggleBlockquote
		case "codeBlock":
			return insertCodeBlock
		case "moveLineUp":
			return moveLineUp
		case "moveLineDown":
			return moveLineDown
		case "duplicateLineUp":
			return copyLineUp
		case "duplicateLineDown":
			return copyLineDown
		case "addCursorAbove":
			return addCursorAbove
		case "addCursorBelow":
			return addCursorBelow
		case "deleteLine":
			return deleteLine
		case "insertLineBelow":
			return insertBlankLine
		case "insertLineAbove":
			return insertBlankLineAbove
		case "selectLine":
			return selectLine
		case "indentSelection":
			return indentMore
		case "outdentSelection":
			return indentLess
		case "indent":
			return indentMarkdown
		case "outdent":
			return outdentMarkdown
		case "selectNextOccurrence":
			return selectNextOccurrence
		case "selectAllOccurrences":
			return selectSelectionMatches
		case "expandSelection":
			return expandMarkdownSelection
		case "shrinkSelection":
			return shrinkMarkdownSelection
		case "hardBreak":
			return insertMarkdownLineBreak
		default:
			return null
	}
}

function editorAriaShortcuts(): string {
	return getShortcutDefinitions()
		.map(definition => getAriaShortcut(definition.id))
		.join(" ")
}
