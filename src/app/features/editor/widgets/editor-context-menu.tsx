import { useRef, useState } from "react"
import { syntaxTree } from "@codemirror/language"
import type { EditorView } from "@codemirror/view"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@/app/components/ui/context-menu"
import { altModKey, isMac, modKey } from "@/app/lib/platform"
import { T } from "@/shared/intl/setup"
import { parseWikiLinks } from "../lib/wikilink-parser"
import type { MarkdownEditorRef } from "./editor"

export { EditorContextMenu }

type Range = { from: number; to: number }

type EditorContext = {
	position: number
	selection: Range
	selectedText: string
	linkUrl: string | null
	wikiLinkId: string | null
	isTask: boolean
	image: { url: string; alt: string } | null
}

interface EditorContextMenuProps {
	editor: React.RefObject<MarkdownEditorRef | null>
	children: React.ReactElement
	readOnly?: boolean
	nativeContextMenu?: boolean
	canAddComment?: boolean
	onAddComment: () => void
	onWikilinkClick?: (id: string, newTab: boolean) => void
}

let headingLevels = [1, 2, 3, 4, 5, 6] satisfies Array<1 | 2 | 3 | 4 | 5 | 6>

let emptyContext: EditorContext = {
	position: 0,
	selection: { from: 0, to: 0 },
	selectedText: "",
	linkUrl: null,
	wikiLinkId: null,
	isTask: false,
	image: null,
}

function EditorContextMenu({
	editor,
	children,
	readOnly,
	nativeContextMenu,
	canAddComment,
	onAddComment,
	onWikilinkClick,
}: EditorContextMenuProps) {
	let savedSelection = useRef<Range | null>(null)
	let [context, setContext] = useState(emptyContext)
	let hasSelection = context.selection.from !== context.selection.to
	let hasContextualItems = Boolean(
		context.linkUrl || context.wikiLinkId || context.isTask || context.image,
	)
	let canReadClipboard =
		typeof navigator !== "undefined" &&
		typeof navigator.clipboard?.readText === "function"

	function handleOpenChange(open: boolean) {
		if (!open) return
		savedSelection.current = editor.current?.getSelection() ?? null
	}

	function runAction(action: () => void) {
		if (savedSelection.current) {
			editor.current?.restoreSelection(savedSelection.current)
		}
		action()
	}

	function runAtContextPosition(action: () => void) {
		editor.current?.restoreSelection({
			from: context.position,
			to: context.position,
		})
		action()
	}

	async function copyLink() {
		if (!context.linkUrl) return
		try {
			await navigator.clipboard.writeText(context.linkUrl)
		} catch {
			return
		}
	}

	return (
		<ContextMenu onOpenChange={handleOpenChange}>
			<ContextMenuTrigger
				className="select-text"
				render={children}
				style={{ WebkitTouchCallout: nativeContextMenu ? "default" : "none" }}
				onTouchStart={event => {
					if (nativeContextMenu) event.preventBaseUIHandler()
				}}
				onContextMenu={event => {
					if (nativeContextMenu || event.shiftKey) {
						event.preventBaseUIHandler()
						event.nativeEvent.stopImmediatePropagation()
						return
					}

					let view = editor.current?.getEditor()
					if (!view) return
					let position = view.posAtCoords({
						x: event.clientX,
						y: event.clientY,
					})
					if (position === null) return

					let selection = view.state.selection.main
					if (position < selection.from || position > selection.to) {
						view.dispatch({ selection: { anchor: position } })
					}

					let nextContext = getEditorContext(view, position)
					savedSelection.current = nextContext.selection
					setContext(nextContext)
				}}
			/>
			<ContextMenuContent className="min-w-56">
				{context.linkUrl && (
					<>
						<ContextMenuItem
							onClick={() =>
								window.open(
									context.linkUrl ?? "",
									"_blank",
									"noopener,noreferrer",
								)
							}
						>
							<T k="editor.menu.openLink" />
						</ContextMenuItem>
						<ContextMenuItem onClick={copyLink}>
							<T k="editor.menu.copyLink" />
						</ContextMenuItem>
					</>
				)}
				{context.wikiLinkId && onWikilinkClick && (
					<>
						<ContextMenuItem
							onClick={() => onWikilinkClick(context.wikiLinkId ?? "", false)}
						>
							<T k="editor.menu.openDocument" />
						</ContextMenuItem>
						<ContextMenuItem
							onClick={() => onWikilinkClick(context.wikiLinkId ?? "", true)}
						>
							<T k="editor.menu.openDocumentNewTab" />
						</ContextMenuItem>
					</>
				)}
				{context.isTask && !readOnly && (
					<ContextMenuItem
						onClick={() =>
							runAtContextPosition(() => editor.current?.toggleTaskComplete())
						}
					>
						<T k="editor.menu.toggleComplete" />
						<ContextMenuShortcut>{altModKey}X</ContextMenuShortcut>
					</ContextMenuItem>
				)}
				{context.image && (
					<ContextMenuItem
						onClick={() =>
							editor.current?.showImagePreview(
								context.image?.url ?? "",
								context.image?.alt ?? "",
							)
						}
					>
						<T k="editor.menu.previewImage" />
					</ContextMenuItem>
				)}
				{hasContextualItems && <ContextMenuSeparator />}

				<ContextMenuItem
					disabled={readOnly || !hasSelection}
					onClick={() => runAction(() => editor.current?.cut())}
				>
					<T k="editor.menu.cut" />
					<ContextMenuShortcut>{modKey}X</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuItem
					disabled={!hasSelection}
					onClick={() => runAction(() => editor.current?.copy())}
				>
					<T k="editor.menu.copy" />
					<ContextMenuShortcut>{modKey}C</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuItem
					disabled={readOnly || !canReadClipboard}
					onClick={() => runAction(() => editor.current?.paste())}
				>
					<T k="editor.menu.paste" />
					<ContextMenuShortcut>{modKey}V</ContextMenuShortcut>
				</ContextMenuItem>

				{hasSelection && (
					<>
						<ContextMenuSeparator />
						{canAddComment && !readOnly && (
							<ContextMenuItem onClick={() => runAction(onAddComment)}>
								<T k="comments.add" />
								<ContextMenuShortcut>{altModKey}M</ContextMenuShortcut>
							</ContextMenuItem>
						)}
						<ContextMenuItem
							onClick={() => editor.current?.openFind(context.selectedText)}
						>
							<T k="editor.menu.findSelection" />
							<ContextMenuShortcut>{modKey}F</ContextMenuShortcut>
						</ContextMenuItem>
					</>
				)}

				{!readOnly && (
					<>
						<ContextMenuSeparator />
						<ContextMenuSub>
							<ContextMenuSubTrigger>
								<T k="editor.menu.format" />
							</ContextMenuSubTrigger>
							<ContextMenuSubContent>
								<FormatMenu editor={editor} runAction={runAction} />
							</ContextMenuSubContent>
						</ContextMenuSub>
						<ContextMenuSub>
							<ContextMenuSubTrigger>
								<T k="editor.menu.insert" />
							</ContextMenuSubTrigger>
							<ContextMenuSubContent>
								<ContextMenuItem
									onClick={() => runAction(() => editor.current?.insertLink())}
								>
									<T k="editor.menu.addLink" />
									<ContextMenuShortcut>{modKey}K</ContextMenuShortcut>
								</ContextMenuItem>
								<ContextMenuItem
									onClick={() => runAction(() => editor.current?.insertImage())}
								>
									<T k="editor.menu.addImage" />
									<ContextMenuShortcut>{altModKey}K</ContextMenuShortcut>
								</ContextMenuItem>
								<ContextMenuItem
									onClick={() =>
										runAction(() => editor.current?.insertCodeBlock())
									}
								>
									<T k="editor.menu.codeBlock" />
									<ContextMenuShortcut>{altModKey}C</ContextMenuShortcut>
								</ContextMenuItem>
							</ContextMenuSubContent>
						</ContextMenuSub>
					</>
				)}

				<ContextMenuSeparator />
				<ContextMenuItem disabled className="max-w-64 whitespace-normal">
					{isMac ? (
						<T k="editor.menu.nativeHintMac" />
					) : (
						<T k="editor.menu.nativeHint" />
					)}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}

interface FormatMenuProps {
	editor: React.RefObject<MarkdownEditorRef | null>
	runAction: (action: () => void) => void
}

function FormatMenu({ editor, runAction }: FormatMenuProps) {
	return (
		<>
			<ContextMenuItem
				onClick={() => runAction(() => editor.current?.toggleBold())}
			>
				<T k="editor.menu.bold" />
				<ContextMenuShortcut>{modKey}B</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuItem
				onClick={() => runAction(() => editor.current?.toggleItalic())}
			>
				<T k="editor.menu.italic" />
				<ContextMenuShortcut>{modKey}I</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuItem
				onClick={() => runAction(() => editor.current?.toggleStrikethrough())}
			>
				<T k="editor.menu.strikethrough" />
				<ContextMenuShortcut>{modKey}⇧X</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuItem
				onClick={() => runAction(() => editor.current?.toggleInlineCode())}
			>
				<T k="editor.menu.code" />
				<ContextMenuShortcut>{modKey}E</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuSub>
				<ContextMenuSubTrigger>
					<T k="editor.menu.headings" />
				</ContextMenuSubTrigger>
				<ContextMenuSubContent>
					{headingLevels.map(level => (
						<ContextMenuItem
							key={level}
							onClick={() => runAction(() => editor.current?.setHeading(level))}
						>
							<T k="editor.menu.heading" /> {level}
							<ContextMenuShortcut>
								{altModKey}
								{level}
							</ContextMenuShortcut>
						</ContextMenuItem>
					))}
				</ContextMenuSubContent>
			</ContextMenuSub>
			<ContextMenuSub>
				<ContextMenuSubTrigger>
					<T k="editor.menu.lists" />
				</ContextMenuSubTrigger>
				<ContextMenuSubContent>
					<ContextMenuItem
						onClick={() => runAction(() => editor.current?.toggleBulletList())}
					>
						<T k="editor.menu.unordered" />
						<ContextMenuShortcut>{altModKey}L</ContextMenuShortcut>
					</ContextMenuItem>
					<ContextMenuItem
						onClick={() => runAction(() => editor.current?.toggleOrderedList())}
					>
						<T k="editor.menu.ordered" />
						<ContextMenuShortcut>{altModKey}O</ContextMenuShortcut>
					</ContextMenuItem>
					<ContextMenuItem
						onClick={() => runAction(() => editor.current?.toggleTaskList())}
					>
						<T k="editor.menu.taskListLabel" />
						<ContextMenuShortcut>{altModKey}⇧L</ContextMenuShortcut>
					</ContextMenuItem>
				</ContextMenuSubContent>
			</ContextMenuSub>
			<ContextMenuItem
				onClick={() => runAction(() => editor.current?.toggleBlockquote())}
			>
				<T k="editor.menu.blockquote" />
				<ContextMenuShortcut>{altModKey}Q</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuItem
				onClick={() => runAction(() => editor.current?.setBody())}
			>
				<T k="editor.menu.body" />
				<ContextMenuShortcut>{altModKey}0</ContextMenuShortcut>
			</ContextMenuItem>
		</>
	)
}

function getEditorContext(view: EditorView, position: number): EditorContext {
	let selection = view.state.selection.main
	let linkUrl: string | null = null
	let image: EditorContext["image"] = null
	let node = syntaxTree(view.state).resolveInner(position, -1)
	let current: typeof node | null = node

	while (current) {
		if (current.name === "Link") {
			let urlNode = current.getChild("URL")
			if (urlNode) linkUrl = view.state.sliceDoc(urlNode.from, urlNode.to)
		}
		if (current.name === "Image") {
			let markup = view.state.sliceDoc(current.from, current.to)
			let match = markup.match(/^!\[([^\]]*)]\(([^)]*)\)$/)
			if (match) image = { alt: match[1], url: match[2] }
		}
		current = current.parent
	}

	let wikiLinkId: string | null = null
	for (let wikiLink of parseWikiLinks(view.state.doc.toString())) {
		if (position >= wikiLink.from && position <= wikiLink.to) {
			wikiLinkId = wikiLink.id
			break
		}
	}

	let line = view.state.doc.lineAt(position)
	let isTask = /^\s*[-*]\s\[[ xX]\]\s/.test(line.text)
	let selectedText =
		selection.from === selection.to
			? ""
			: view.state.sliceDoc(selection.from, selection.to)

	return {
		position,
		selection: { from: selection.from, to: selection.to },
		selectedText,
		linkUrl,
		wikiLinkId,
		isTask,
		image,
	}
}
