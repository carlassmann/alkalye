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
	history,
	historyKeymap,
	indentLess,
	indentMore,
	redo,
	undo,
} from "@codemirror/commands"
import { syntaxTree } from "@codemirror/language"
import { Image as JazzImage } from "jazz-tools/react"
import { editorExtensions } from "../lib/extensions"
import {
	insertCodeBlock,
	insertImage,
	indentMarkdown,
	insertMarkdownBlock,
	insertLink,
	insertNewlineContinueMarkupTight,
	moveLineDown,
	moveLineUp,
	outdentMarkdown,
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
import { createBracketsExtension } from "../lib/autocomplete-brackets"
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
	type ShortcutId,
} from "@/app/lib/shortcut-registry"
import { combinedAutocompletion } from "@/app/lib/completion-sources"

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
	onChange: (content: string) => void

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
		ref,
	} = props

	let t = useIntl()
	let isMobile = useIsMobile()
	let hasFinePointer = useHasFinePointer()

	// Find panel state is URL-driven via hook
	let { findOpen, findQuery, findCase, findFuzzy, setFind } = useFindPanel()
	let findPanelOpen = findOpen
	let findPanelOpenRef = useRef(false)

	let lastExternalValue = useRef(value)
	let containerRef = useRef<HTMLDivElement>(null)
	let readOnlyCompartment = useRef(new Compartment())
	let placeholderCompartment = useRef(new Compartment())
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

	let callbacksRef = useRef({ onChange, onCursorChange, onFocus, onBlur })
	findPanelOpenRef.current = findPanelOpen
	let dataRef = useRef({ assets, documents })
	let autoSortRef = useRef(autoSortTasks ?? false)
	let uploadImageRef = useRef(onUploadImage)
	let uploadVideoRef = useRef(onUploadVideo)
	let importTldrawRef = useRef(onImportTldraw)
	let addCommentEnabledRef = useRef(Boolean(onAddComment))
	let activeDropsRef = useRef<Set<DropTarget>>(new Set())

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
					writableShortcut("image", insertImage),
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
					shortcut("indent", indentMarkdown),
					shortcut("outdent", outdentMarkdown),
					{
						key: "Enter",
						run: runWritable(insertNewlineContinueMarkupTight),
					},
					{
						key: "Backspace",
						run: runWritable(deleteMarkupBackward),
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
			EditorView.updateListener.of(update => {
				if (update.docChanged) {
					if (callbacksRef.current.onChange) {
						callbacksRef.current.onChange(update.state.doc.toString())
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
			createBracketsExtension(),
			combinedAutocompletion(),
			createWikilinkAutocomplete(() => dataRef.current.documents ?? []),
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
			fileDropCursor,
			...(initRef.current.externalExtensions ?? []),
		]

		extensions.push(
			placeholderCompartment.current.of(
				initRef.current.placeholder
					? placeholderExt(initRef.current.placeholder)
					: [],
			),
			readOnlyCompartment.current.of(
				initRef.current.readOnly ? EditorState.readOnly.of(true) : [],
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

		// Capture phase so our preventDefault runs before CodeMirror's
		// own drop handler on .cm-content.
		dom.addEventListener("dragover", handleDragOver, true)
		dom.addEventListener("drop", handleDrop, true)
		return () => {
			dom.removeEventListener("dragover", handleDragOver, true)
			dom.removeEventListener("drop", handleDrop, true)
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
			let { from, to } = view.state.selection.main
			view.dispatch({
				changes: { from, to, insert: text },
				selection: { anchor: from + text.length },
			})
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
			showImagePreview: handleImagePreview,
		}
	})

	return (
		<>
			{findPanelOpen && (
				<FindPanel
					view={view}
					query={findQuery}
					caseSensitive={findCase}
					fuzzy={findFuzzy}
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
