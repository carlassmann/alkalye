import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import { editLines, lineBounds } from "../../shared/lines"
import { selectionAnchor } from "../../shared/documents"
import { setMarkup } from "../dom"
import {
	html,
	joinMarkup,
	localizeMarkup,
	rawMarkup,
	translate,
} from "../language"
import { pasteMarkdown } from "../paste"
import { shortcutLabel } from "../shortcuts"
import { openContextMenu } from "./context-menu"
import type { MenuEntry, MenuItem } from "./context-menu"
import { mountLineActions } from "./line-actions"
import { icon } from "../icons"
import type { IconName } from "../icons"

import { formatSelection, sortTasks } from "../../shared/authoring"
import { escape, safeUrl } from "../../shared/markdown"
import { iconPrefix } from "../../shared/projection"
import type { ProjectedLink } from "../../shared/projection"
import { SourceTextarea } from "../source-textarea"
import type {
	Atom,
	DocumentLink,
	Operation,
	Presence,
} from "../../shared/model"
import type { EditorPreferences } from "../../shared/preferences"
export interface EditorOptions {
	isDrawing(id: string): boolean
	openDrawing(id: string): void
	content: string
	atoms: Atom[]
	editable: boolean
	preferences: EditorPreferences
	documents(): readonly DocumentLink[]
	openDocument(id: string, newTab?: boolean): void
	previewImage?(url: string, alt: string): void
	mediaIcon?(url: string): IconName
	canComment?(): boolean
	createLinkedDocument(title: string): Promise<string>
	report(error: unknown): void
	comments(): { start: number; end: number }[]
	change(
		content: string,
		base?: Atom[],
	): { atoms: Atom[]; operation: Operation | null } | undefined
	undo(redo: boolean): void
	select(): void
	requestAsset(): void
	attach(files: File[]): void
	command(action: string): void
	find(query: string): void
}
export class EditorElement extends HTMLElement {
	private options: EditorOptions | undefined
	private view: ReturnType<typeof createEditorView> | undefined
	private lifetime: Fiber.Fiber<never, never> | undefined

	configure(options: EditorOptions) {
		this.options = options
		if (this.isConnected && !this.lifetime) this.connectedCallback()
	}
	connectedCallback() {
		let options = this.options
		if (!options || this.lifetime) return
		this.dataset.editor = ""
		this.classList.add("editor-wrap")
		let host = this
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let tasks = yield* FiberSet.make()
					let fork = yield* FiberSet.runtime(tasks)()
					let view = yield* Effect.acquireRelease(
						Effect.sync(() => createEditorView(host, options, fork)),
						view =>
							Effect.sync(() => {
								view.dispose()
								if (host.view === view) host.view = undefined
							}),
					)
					host.view = view
					return yield* Effect.never
				}),
			),
		)
	}
	disconnectedCallback() {
		let lifetime = this.lifetime
		if (!lifetime) return
		if (this.view && this.options)
			Object.assign(this.options, this.view.state())
		this.lifetime = undefined
		Effect.runFork(Fiber.interrupt(lifetime))
	}
	connectedMoveCallback() {}
	// Markdown source with source-coordinate selection. The native #editor
	// textarea shows inactive links collapsed, so its value and offsets differ.
	get source() {
		return this.view?.text
	}
	update(content: string, atoms: Atom[], editable: boolean) {
		this.view?.update(content, atoms, editable)
	}
	command(action: string) {
		this.view?.command(action)
	}
	format(action: string) {
		this.view?.format(action)
	}
	insert(value: string) {
		this.view?.insert(value)
	}
	insertCodeBlock() {
		this.view?.insertCodeBlock()
	}
	chooseCompletion(index: number) {
		this.view?.chooseCompletion(index)
	}
	presence(people: Presence[]) {
		this.view?.presence(people)
	}
	preferences(preferences: EditorPreferences) {
		this.view?.preferences(preferences)
	}
	selectRange(start: number, end = start) {
		this.view?.selectRange(start, end)
	}
	attachmentSelection() {
		return this.view?.attachmentSelection()
	}
	selectionAnchor() {
		return this.view?.selectionAnchor()
	}
}
customElements.define("alkalye-editor", EditorElement)

export function mountEditor(host: HTMLElement, options: EditorOptions) {
	let editor = document.createElement("alkalye-editor")
	if (!(editor instanceof EditorElement))
		throw new Error("Editor element is not registered")
	editor.configure(options)
	host.replaceChildren(editor)
	return editor
}

function createEditorView(
	wrapper: HTMLElement,
	options: EditorOptions,
	fork: (task: Effect.Effect<unknown, never>) => unknown,
) {
	wrapper.replaceChildren()
	let listeners = new AbortController()
	let paintFrame = 0
	let textarea = document.createElement("textarea")
	textarea.id = "editor"
	textarea.setAttribute("aria-label", translate("Start writing…"))
	textarea.placeholder = translate("Start writing…")
	textarea.setAttribute(
		"aria-description",
		"Tab indents. Press Escape, then Tab to move focus.",
	)
	textarea.spellcheck = options.preferences.spellcheck
	textarea.lang = options.preferences.spellcheckLanguage
	let highlight = document.createElement("pre")
	highlight.id = "highlight"
	highlight.setAttribute("aria-hidden", "true")
	let menu = document.createElement("div")
	menu.id = "completion-menu"
	menu.className = "completion-menu"
	menu.setAttribute("role", "listbox")
	menu.hidden = true
	let collaborators = document.createElement("div")
	collaborators.className = "collaborators"
	collaborators.setAttribute("aria-hidden", "true")
	let links = document.createElement("div")
	links.dataset.editorLinks = ""
	let activeLine = document.createElement("span")
	activeLine.className = "active-line"
	activeLine.setAttribute("aria-hidden", "true")
	wrapper.append(activeLine, highlight, menu, textarea, collaborators, links)
	let people: Presence[] = []
	let editable = options.editable
	let atoms = options.atoms
	let composing = false
	let dragging = false
	let releaseTab = false
	let rawPaste = false
	let lastTouch = 0
	let contextMenu: { close(): void } | undefined
	let completionItems: {
		label: string
		start: number
		end: number
		value: string
		create?: string
	}[] = []
	let secondarySelections: {
		start: number
		end: number
	}[] = []
	let text = new SourceTextarea(textarea, options.content, {
		documents: options.documents,
		mode: () =>
			composing || dragging
				? "hold"
				: secondarySelections.length
					? "raw"
					: "project",
		caretTop,
		painted: updateHighlight,
	})
	textarea.readOnly = !editable
	textarea.oninput = () => {
		let source = text.input()
		updateHighlight()
		if (composing) return
		let edit = options.change(source, atoms)
		if (edit)
			update(edit.atoms.map(atom => atom.value).join(""), edit.atoms, editable)
		else text.sync()
		if (options.preferences.autocomplete) showCompletions()
	}
	textarea.addEventListener(
		"compositionstart",
		() => {
			composing = true
		},
		{ signal: listeners.signal },
	)
	textarea.addEventListener(
		"compositionend",
		() => {
			text.input()
			let base = atoms
			let edit = options.change(text.value, base)
			composing = false
			if (edit) {
				let removed = new Set(edit.operation?.remove ?? [])
				let local = base.filter(atom => !removed.has(atom.id))
				let inserted = edit.operation?.insert ?? []
				let after = inserted[0]?.after
				let index = after ? local.findIndex(atom => atom.id === after) + 1 : 0
				local.splice(index, 0, ...inserted)
				atoms = local
				update(
					edit.atoms.map(atom => atom.value).join(""),
					edit.atoms,
					editable,
				)
			} else text.sync()
		},
		{ signal: listeners.signal },
	)
	// Selection changes reproject only after pointer release, keeping a drag stable.
	textarea.addEventListener(
		"pointerdown",
		() => {
			dragging = true
		},
		{ signal: listeners.signal },
	)
	for (let type of ["pointerup", "pointercancel"])
		window.addEventListener(
			type,
			() => {
				if (!dragging) return
				dragging = false
				text.sync()
			},
			{ signal: listeners.signal },
		)
	document.addEventListener(
		"selectionchange",
		() => {
			if (document.activeElement === textarea && !text.sync()) paintActiveLine()
		},
		{ signal: listeners.signal },
	)
	textarea.addEventListener("copy", copySource, { signal: listeners.signal })
	textarea.addEventListener("cut", copySource, { signal: listeners.signal })
	textarea.onselect = () => {
		paintActiveLine()
		options.select()
	}
	textarea.onscroll = () => {
		highlight.scrollTop = textarea.scrollTop
		highlight.scrollLeft = textarea.scrollLeft
		paintPresence()
		paintActiveLine()
	}
	textarea.onclick = event => {
		if (!(event.metaKey || event.ctrlKey)) return
		let context = editorContext(text.value, text.selectionStart)
		if (context.wiki) options.openDocument(context.wiki.trim())
		else if (context.url && safeUrl(context.url) !== "#")
			window.open(context.url, "_blank", "noopener,noreferrer")
	}
	textarea.addEventListener(
		"touchstart",
		() => {
			lastTouch = Date.now()
		},
		{ signal: listeners.signal, passive: true },
	)
	textarea.addEventListener("contextmenu", openEditorMenu, {
		signal: listeners.signal,
	})
	textarea.onkeydown = editorKeydown
	textarea.onbeforeinput = multiInput
	textarea.onpaste = event => {
		let files = [...(event.clipboardData?.files ?? [])]
		if (files.length) {
			event.preventDefault()
			options.attach(files)
			return
		}
		if (rawPaste || !editable || !options.preferences.smartPaste) {
			rawPaste = false
			return
		}
		let plain = event.clipboardData?.getData("text/plain") ?? "",
			rich = event.clipboardData?.getData("text/html") ?? ""
		let selected = text.value.slice(text.selectionStart, text.selectionEnd)
		let converted = pasteMarkdown(plain, rich, selected)
		if (converted !== plain) {
			event.preventDefault()
			insert(converted)
		}
	}
	menu.onclick = event => {
		if (!(event.target instanceof Element)) return
		let button = event.target.closest<HTMLButtonElement>("[data-complete]")
		if (button) {
			event.stopPropagation()
			chooseCompletion(Number(button.dataset.complete))
		}
	}
	let lineActions = mountLineActions(text, {
		requestAsset: options.requestAsset,
		isDrawing: options.isDrawing,
		openDrawing: options.openDrawing,
		openDocument: options.openDocument,
		documents: options.documents,
	})
	let layout = new ResizeObserver(() => {
		paintPresence()
		paintActiveLine()
	})
	layout.observe(textarea)
	document.fonts.addEventListener(
		"loadingdone",
		() => {
			paintPresence()
			paintActiveLine()
		},
		{ signal: listeners.signal },
	)
	updateHighlight()
	text.sync()
	lineActions.update()
	preferences(options.preferences)
	return {
		text,
		state() {
			return { content: text.value, atoms, editable }
		},
		dispose() {
			listeners.abort()
			layout.disconnect()
			contextMenu?.close()
			cancelAnimationFrame(paintFrame)
			lineActions.dispose()
			for (let node of [textarea, menu]) {
				node.oninput = null
				node.onselect = null
				node.onscroll = null
				node.onclick = null
				node.onkeydown = null
				node.onbeforeinput = null
				node.onpaste = null
			}
		},
		update,
		format,
		command,
		insert,
		insertCodeBlock,
		chooseCompletion,
		presence,
		preferences,
		selectRange,
		attachmentSelection() {
			if (composing || !inSync()) return
			return {
				atoms,
				start: text.selectionStart,
				end: text.selectionEnd,
			}
		},
		selectionAnchor() {
			if (composing || !inSync()) return
			return selectionAnchor(
				atoms,
				text.value,
				text.value.slice(text.selectionStart, text.selectionEnd),
				text.selectionStart,
			)
		},
	}
	function selectRange(start: number, end = start) {
		textarea.focus()
		text.setSelectionRange(start, end)
		highlight.scrollTop = textarea.scrollTop
		highlight.scrollLeft = textarea.scrollLeft
		let from = point(textarea.selectionStart),
			range = document.createRange()
		range.setStart(from.node, from.offset)
		range.collapse(true)
		let bounds = range.getBoundingClientRect(),
			view = textarea.getBoundingClientRect()
		textarea.scrollTop += bounds.top - view.top - view.height / 3
		highlight.scrollTop = textarea.scrollTop
		paintActiveLine()
	}
	function paintActiveLine() {
		paintLinks()
		activeLine.hidden = !options.preferences.highlightCurrentLine
		if (activeLine.hidden) return
		let from = point(textarea.selectionStart),
			range = document.createRange()
		range.setStart(from.node, from.offset)
		range.collapse(true)
		let bounds = range.getBoundingClientRect()
		if (!bounds.height) {
			let length = from.node.textContent?.length ?? 0
			if (from.offset < length) range.setEnd(from.node, from.offset + 1)
			else if (from.offset) range.setStart(from.node, from.offset - 1)
			bounds = range.getClientRects()[0] ?? range.getBoundingClientRect()
		}
		if (!bounds.height) return
		let view = wrapper.getBoundingClientRect()
		activeLine.style.top = `${bounds.top - view.top}px`
		activeLine.style.height = `${bounds.height || parseFloat(getComputedStyle(textarea).lineHeight)}px`
	}
	function preferences(next: EditorPreferences) {
		options.preferences = next
		textarea.spellcheck = next.spellcheck
		textarea.lang = next.spellcheckLanguage
		wrapper.dataset.strikethrough = String(next.strikethroughDoneTasks)
		wrapper.dataset.fade = String(next.fadeDoneTasks)
		updateHighlight()
	}
	function presence(next: Presence[]) {
		people = next
		paintPresence()
	}
	function caretTop() {
		if (!highlight.isConnected) return
		let from = point(textarea.selectionStart),
			range = document.createRange()
		range.setStart(from.node, from.offset)
		range.collapse(true)
		return (
			range.getBoundingClientRect().top -
			highlight.getBoundingClientRect().top +
			highlight.scrollTop
		)
	}
	function copySource(event: ClipboardEvent) {
		let start = text.selectionStart,
			end = text.selectionEnd
		let source = text.value.slice(start, end)
		if (
			composing ||
			!event.clipboardData ||
			source ===
				textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
		)
			return
		event.preventDefault()
		event.clipboardData.setData("text/plain", source)
		if (event.type !== "cut" || !editable || !inSync()) return
		text.setRangeText("", start, end, "end")
		textarea.dispatchEvent(new Event("input"))
	}
	function point(offset: number) {
		let walker = document.createTreeWalker(highlight, NodeFilter.SHOW_TEXT)
		let last: Node = highlight
		let node = walker.nextNode()
		while (node) {
			let length = node.textContent?.length ?? 0
			if (offset < length) return { node, offset }
			offset -= length
			last = node
			node = walker.nextNode()
		}
		return { node: last, offset: last.textContent?.length ?? 0 }
	}
	function paintLinks() {
		let existing = [...links.querySelectorAll("a")]
		let count = 0
		let bounds = wrapper.getBoundingClientRect()
		for (let link of text.projection.links) {
			if (link.broken) continue
			let from = point(link.view.start),
				to = point(link.view.end)
			let range = document.createRange()
			range.setStart(from.node, from.offset)
			range.setEnd(to.node, to.offset)
			let label = text.projection.text.slice(
				link.view.start + (link.iconSpace ? iconPrefix.length : 0),
				link.view.end,
			)
			let first = true
			for (let rectangle of range.getClientRects()) {
				if (!rectangle.width || !rectangle.height) continue
				let anchor = existing[count++] ?? document.createElement("a")
				anchor.dataset.kind = link.kind
				anchor.href =
					link.kind === "wiki"
						? "/app/doc/" + encodeURIComponent(link.target)
						: link.kind === "media"
							? "#"
							: safeUrl(link.target)
				anchor.rel = "noopener noreferrer"
				if (link.kind === "link") anchor.target = "_blank"
				else anchor.removeAttribute("target")
				if (link.kind === "media") anchor.setAttribute("role", "button")
				else anchor.removeAttribute("role")
				anchor.setAttribute("aria-label", label)
				anchor.title = link.kind === "link" ? link.target : label
				anchor.tabIndex = first ? 0 : -1
				if (!first) anchor.setAttribute("aria-hidden", "true")
				else anchor.removeAttribute("aria-hidden")
				first = false
				anchor.style.cssText = `left:${rectangle.left - bounds.left}px;top:${rectangle.top - bounds.top}px;width:${rectangle.width}px;height:${rectangle.height}px`
				anchor.onpointerdown = event => {
					if (event.pointerType === "mouse") event.preventDefault()
					if (!event.shiftKey) return
					event.preventDefault()
					let start =
						text.selectionDirection === "backward"
							? text.selectionEnd
							: text.selectionStart
					let end = clickedOffset(event)
					text.focus()
					text.setSelectionRange(
						Math.min(start, end),
						Math.max(start, end),
						end < start ? "backward" : "forward",
					)
					options.select()
				}
				anchor.onclick = event => {
					if (event.shiftKey) {
						event.preventDefault()
						return
					}
					if (link.kind === "media") {
						event.preventDefault()
						options.previewImage?.(link.target, label)
						return
					}
					if (
						link.kind !== "wiki" ||
						event.ctrlKey ||
						event.metaKey ||
						event.shiftKey ||
						event.altKey
					)
						return
					event.preventDefault()
					options.openDocument(link.target)
				}
				anchor.oncontextmenu = event =>
					openEditorMenu(event, link.parts[0]?.source ?? link.source.start)
				if (anchor.parentElement !== links) links.append(anchor)
			}
		}
		for (let anchor of existing.slice(count)) anchor.remove()
	}
	function paintPresence() {
		collaborators.replaceChildren()
		let bounds = wrapper.getBoundingClientRect()
		for (let comment of options.comments()) {
			let from = point(text.toView(comment.start)),
				to = point(text.toView(comment.end)),
				range = document.createRange()
			range.setStart(from.node, from.offset)
			range.setEnd(to.node, to.offset)
			for (let rectangle of range.getClientRects()) {
				let mark = document.createElement("span")
				mark.className = "comment-highlight"
				mark.style.cssText = `left:${rectangle.left - bounds.left}px;top:${rectangle.top - bounds.top}px;width:${rectangle.width}px;height:${rectangle.height}px`
				collaborators.append(mark)
			}
		}
		for (let person of people) {
			let start = Math.max(0, Math.min(text.value.length, person.cursor))
			let end = Math.max(
				start,
				Math.min(text.value.length, person.selectionEnd ?? start),
			)
			let from = point(text.toView(start)),
				to = point(text.toView(end))
			let range = document.createRange()
			range.setStart(from.node, from.offset)
			range.setEnd(to.node, to.offset)
			let hue =
				[...person.actor].reduce(
					(sum, character) => sum + character.charCodeAt(0),
					0,
				) % 360
			let rectangles = [...range.getClientRects()]
			for (let rectangle of rectangles) {
				if (!rectangle.width) continue
				let selection = document.createElement("span")
				selection.className = "remote-selection"
				selection.style.cssText = `left:${rectangle.left - bounds.left}px;top:${rectangle.top - bounds.top}px;width:${rectangle.width}px;height:${rectangle.height}px;--person:hsl(${hue} 65% 65%)`
				collaborators.append(selection)
			}
			range.collapse(true)
			let rectangle = range.getBoundingClientRect()
			if (!rectangle.height) continue
			let caret = document.createElement("span")
			caret.className = "remote-caret"
			caret.style.cssText = `left:${rectangle.left - bounds.left}px;top:${rectangle.top - bounds.top}px;height:${rectangle.height}px;--person:hsl(${hue} 65% 65%)`
			let name = document.createElement("small")
			name.textContent = person.name
			caret.append(name)
			collaborators.append(caret)
		}
	}
	function update(content: string, nextAtoms: Atom[], nextEditable: boolean) {
		editable = nextEditable
		textarea.readOnly = !editable
		if (composing) {
			return
		}
		if (text.value !== content) {
			let start = anchor(text.selectionStart),
				end = anchor(text.selectionEnd)
			text.replace(
				content,
				position(start, nextAtoms),
				position(end, nextAtoms),
			)
		} else if (!text.sync()) updateHighlight()
		atoms = nextAtoms
		lineActions.update()
		paintPresence()
	}
	function anchor(offset: number) {
		let length = 0,
			previous = ""
		for (let atom of atoms) {
			if (length >= offset) break
			length += atom.value.length
			previous = atom.id
		}
		return previous
	}
	function position(id: string, nextAtoms: Atom[]) {
		if (!id) return 0
		let offset = 0
		for (let atom of nextAtoms) {
			offset += atom.value.length
			if (atom.id === id) return offset
		}
		let previous = atoms.findIndex(atom => atom.id === id)
		for (let index = previous - 1; index >= 0; index--) {
			let old = atoms[index]
			if (old && nextAtoms.some(atom => atom.id === old.id))
				return position(old.id, nextAtoms)
		}
		return 0
	}
	function updateHighlight() {
		cancelAnimationFrame(paintFrame)
		paintFrame = requestAnimationFrame(paintActiveLine)
		let editor = text
		if (!secondarySelections.length) {
			let { text: view, links } = editor.projection
			setMarkup(
				highlight,
				sourceHighlight(view, options.documents(), links, options.mediaIcon),
			)
			return
		}
		let position = 0,
			html = ""
		for (let selection of [...secondarySelections].sort(
			(a, b) => a.start - b.start,
		)) {
			html +=
				escape(editor.value.slice(position, selection.start)) +
				localizeMarkup("<mark>") +
				escape(editor.value.slice(selection.start, selection.end)) +
				"</mark>"
			position = selection.end
		}
		setMarkup(highlight, html + escape(editor.value.slice(position)) + "\n")
	}
	function command(action: string) {
		if (listeners.signal.aborted || composing || !inSync()) return
		if (action === "copy-text") {
			if (text.selectionStart === text.selectionEnd) return
			writeClipboard(text.value.slice(text.selectionStart, text.selectionEnd))
			return
		}
		if (!editable || composing || !inSync()) return
		if (action === "cut") return cut()
		if (action === "paste") return paste()
		if (action === "body") return format("body")
		if (action === "sort-tasks") {
			let sorted = sortTasks(text.value)
			if (sorted === text.value) return
			text.replace(sorted, text.selectionStart, text.selectionEnd)
			textarea.dispatchEvent(new Event("input"))
		} else applyLineEdit(action)
		textarea.focus()
	}
	function format(action: string) {
		let editor = text
		if (!editable || composing || listeners.signal.aborted || !inSync()) return
		let result = formatSelection(
			editor.value,
			{ start: editor.selectionStart, end: editor.selectionEnd },
			action,
		)
		editor.focus()
		editor.replace(result.source, result.selection.start, result.selection.end)
		editor.dispatchEvent(new Event("input"))
	}
	function insert(value: string) {
		let editor = text
		if (!editable || composing || listeners.signal.aborted || !inSync()) return
		editor.setRangeText(
			value,
			editor.selectionStart,
			editor.selectionEnd,
			"end",
		)
		editor.focus()
		editor.dispatchEvent(new Event("input", { bubbles: true }))
	}
	function insertCodeBlock() {
		if (!editable) return
		let before = text.value.slice(0, text.selectionStart)
		insert((before && !before.endsWith("\n") ? "\n" : "") + "```\n\n```")
		text.setSelectionRange(text.selectionEnd - 4, text.selectionEnd - 4)
	}
	function openEditorMenu(event: MouseEvent, sourcePosition?: number) {
		// Alt, touch and IME composition keep the browser menu for spelling,
		// selection handles and candidate pickers.
		if (
			event.altKey ||
			composing ||
			!inSync() ||
			matchMedia("(pointer: coarse)").matches ||
			Date.now() - lastTouch < 2000 ||
			(event instanceof PointerEvent && event.pointerType === "touch")
		)
			return
		let clicked = sourcePosition ?? clickedOffset(event)
		if (clicked < text.selectionStart || clicked > text.selectionEnd)
			text.setSelectionRange(clicked, clicked)
		let lineStart = text.value.lastIndexOf("\n", clicked - 1) + 1
		let clickedAnchor = anchor(Math.min(text.value.length, lineStart + 1))
		let selected = text.value.slice(text.selectionStart, text.selectionEnd)
		let context = editorContext(text.value, clicked)
		if (
			!selected &&
			!context.url &&
			!context.wiki &&
			!context.task &&
			!context.image
		)
			return
		let platform = /Mac/i.test(navigator.platform) ? "mac" : "other"
		let key = (id: string) => shortcutLabel(id, platform)
		let clipboardKey = (letter: string) =>
			platform === "mac" ? "⌘" + letter : "Ctrl+" + letter
		let formattingIcons: Record<string, IconName> = {
			bold: "bold",
			italic: "italic",
			strike: "type",
			code: "code",
			bullet: "list",
			ordered: "list",
			task: "list-todo",
			quote: "message-square",
			clear: "type",
			link: "link",
		}
		let action = (label: string, command: string, id?: string): MenuItem => ({
			icon: formattingIcons[command] ?? "heading",
			label,
			shortcut: id && key(id),
			run: () => format(command),
		})
		let entries: MenuEntry[] = []
		let url = context.url
		if (url)
			entries.push(
				{
					label: "Open link",
					icon: "external-link",
					run: () => void window.open(url, "_blank", "noopener,noreferrer"),
				},
				{ label: "Copy link", icon: "copy", run: () => writeClipboard(url) },
			)
		let wiki = context.wiki
		if (wiki) {
			let id =
				options.documents().find(doc => doc.id === wiki || doc.title === wiki)
					?.id ?? wiki
			entries.push(
				{
					label: "Open document",
					icon: "file-text",
					run: () => options.openDocument(id),
				},
				{
					label: "Open document in new tab",
					icon: "external-link",
					run: () => options.openDocument(id, true),
				},
			)
		}
		let image = context.image
		if (image && options.previewImage)
			entries.push({
				label: "Preview image",
				icon: "image",
				run: () => options.previewImage?.(image.url, image.alt),
			})
		if (context.task && editable)
			entries.push({
				label: "Toggle complete",
				icon: "check",
				shortcut: key("toggleTask"),
				run: () => {
					let offset = anchorOffset(clickedAnchor)
					if (
						offset === undefined ||
						!editable ||
						composing ||
						!inSync() ||
						!editorContext(text.value, offset).task
					)
						return
					text.setSelectionRange(offset, offset)
					format("complete")
				},
			})
		if (entries.length) entries.push("separator")
		entries.push(
			{
				label: "Cut",
				icon: "scissors",
				shortcut: clipboardKey("X"),
				disabled: !editable || !selected,
				run: cut,
			},
			{
				label: "Copy",
				icon: "copy",
				shortcut: clipboardKey("C"),
				disabled: !selected,
				run: () =>
					writeClipboard(
						text.value.slice(text.selectionStart, text.selectionEnd),
					),
			},
			{
				label: "Paste",
				icon: "clipboard",
				shortcut: clipboardKey("V"),
				disabled:
					!editable || typeof navigator.clipboard?.readText !== "function",
				run: paste,
			},
		)
		if (selected) {
			entries.push("separator")
			if (editable && (options.canComment?.() ?? true))
				entries.push({
					label: "Add comment",
					icon: "message-square-plus",
					shortcut: key("comment"),
					run: () => options.command("comment"),
				})
			entries.push({
				label: "Find selection",
				icon: "search",
				shortcut: key("find"),
				run: () => options.find(selected),
			})
		}
		if (editable)
			entries.push(
				"separator",
				{
					label: "Format",
					icon: "type",
					items: [
						action("Bold", "bold", "bold"),
						action("Italic", "italic", "italic"),
						action("Strikethrough", "strike", "strikethrough"),
						action("Inline code", "code", "inlineCode"),
						"separator",
						{
							label: "Headings",
							icon: "heading",
							items: [1, 2, 3, 4, 5, 6].map(level =>
								action(`Heading ${level}`, `h${level}`, `heading${level}`),
							),
						},
						{
							label: "Lists",
							icon: "list",
							items: [
								action("Bullet list", "bullet", "bulletList"),
								action("Numbered list", "ordered", "orderedList"),
								action("Task list", "task", "taskList"),
							],
						},
						action("Quote", "quote", "blockquote"),
						action("Body text", "clear", "body"),
					],
				},
				{
					label: "Insert",
					icon: "plus",
					items: [
						action("Link", "link", "link"),
						{
							label: "Attachment",
							icon: "image-plus",
							shortcut: key("image"),
							run: () => options.command("asset"),
						},
						{
							label: "Code block",
							icon: "code-xml",
							shortcut: key("codeBlock"),
							run: insertCodeBlock,
						},
						{
							label: "Whiteboard",
							icon: "pen-tool",
							run: () => options.command("new-whiteboard"),
						},
					],
				},
			)
		entries.push("separator", {
			note:
				platform === "mac"
					? "Hold ⌥ while right-clicking for the browser menu."
					: "Hold Alt while right-clicking for the browser menu.",
		})
		contextMenu = openContextMenu(event, entries)
	}
	function clickedOffset(event: MouseEvent) {
		if (
			(event instanceof PointerEvent && event.pointerType === "") ||
			(!event.clientX && !event.clientY)
		)
			return text.selectionStart
		let textareaPointer = textarea.style.pointerEvents
		let highlightPointer = highlight.style.pointerEvents
		let linksVisibility = links.style.visibility
		try {
			textarea.style.pointerEvents = "none"
			highlight.style.pointerEvents = "auto"
			links.style.visibility = "hidden"
			let caret = document.caretPositionFromPoint?.(
				event.clientX,
				event.clientY,
			)
			let legacy = caret
				? undefined
				: document.caretRangeFromPoint?.(event.clientX, event.clientY)
			let node = caret?.offsetNode ?? legacy?.startContainer
			let offset = caret?.offset ?? legacy?.startOffset
			if (!node || offset === undefined || !highlight.contains(node))
				return text.selectionStart
			let range = document.createRange()
			range.setStart(highlight, 0)
			range.setEnd(node, offset)
			return text.toSource(
				Math.min(textarea.value.length, range.toString().length),
			)
		} finally {
			textarea.style.pointerEvents = textareaPointer
			highlight.style.pointerEvents = highlightPointer
			links.style.visibility = linksVisibility
		}
	}
	function writeClipboard(text: string) {
		fork(
			Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
				Effect.catch(error => Effect.sync(() => options.report(error))),
			),
		)
	}
	function cut() {
		let range = captureSelection()
		if (!range?.text) return
		let copied = range.text
		fork(
			Effect.tryPromise(() => navigator.clipboard.writeText(copied)).pipe(
				Effect.tap(() => Effect.sync(() => replaceCaptured(range, ""))),
				Effect.catch(error => Effect.sync(() => options.report(error))),
			),
		)
	}
	function paste() {
		let range = captureSelection()
		if (!range) return
		fork(
			Effect.tryPromise(() => navigator.clipboard.readText()).pipe(
				Effect.tap(pasted => Effect.sync(() => replaceCaptured(range, pasted))),
				Effect.catch(error => Effect.sync(() => options.report(error))),
			),
		)
	}
	// Clipboard promises can outlive remote edits, so the range is held as atom
	// anchors and resolved against the document once the clipboard settles.
	function captureSelection() {
		if (!editable || composing || !inSync()) return
		return {
			start: anchor(text.selectionStart),
			end: anchor(text.selectionEnd),
			text: text.value.slice(text.selectionStart, text.selectionEnd),
		}
	}
	function replaceCaptured(
		range: { start: string; end: string; text: string },
		replacement: string,
	) {
		if (listeners.signal.aborted || !editable || composing || !inSync()) return
		let start = anchorOffset(range.start),
			end = anchorOffset(range.end)
		if (
			start === undefined ||
			end === undefined ||
			text.value.slice(start, end) !== range.text
		)
			return
		text.setSelectionRange(start, end)
		insert(replacement)
	}
	function inSync() {
		return atoms.map(atom => atom.value).join("") === text.value
	}
	function anchorOffset(id: string) {
		if (!id) return 0
		let offset = 0
		for (let atom of atoms) {
			offset += atom.value.length
			if (atom.id === id) return offset
		}
	}
	function editorKeydown(event: KeyboardEvent) {
		if (!(event.currentTarget instanceof HTMLTextAreaElement)) return
		if (event.isComposing) return
		let editor = text
		rawPaste =
			(event.metaKey || event.ctrlKey) &&
			event.shiftKey &&
			event.key.toLowerCase() === "v"
		if (event.key === "Escape") {
			event.preventDefault()
			event.stopPropagation()
			releaseTab = true
			menu.hidden = true
			secondarySelections = []
			selectionsChanged()
		}
		if (!menu.hidden && event.key === "Enter") {
			event.preventDefault()
			chooseCompletion(0)
			return
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
			event.preventDefault()
			selectNextOccurrence(text)
			return
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
			event.preventDefault()
			options.undo(event.shiftKey)
			return
		}
		let mod = event.metaKey || event.ctrlKey,
			key = event.key.toLowerCase()
		if (mod && key === "y") {
			event.preventDefault()
			options.undo(true)
			return
		}
		if (mod && event.shiftKey && key === "l") {
			event.preventDefault()
			if (editor.selectionStart === editor.selectionEnd)
				selectNextOccurrence(text)
			let selected = editor.value.slice(
				editor.selectionStart,
				editor.selectionEnd,
			)
			secondarySelections = []
			if (selected)
				for (
					let index = editor.value.indexOf(selected);
					index >= 0;
					index = editor.value.indexOf(selected, index + selected.length)
				) {
					if (index !== editor.selectionStart)
						secondarySelections.push({
							start: index,
							end: index + selected.length,
						})
				}
			selectionsChanged()
			return
		}
		if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
			event.preventDefault()
			let direction = event.key === "ArrowDown" ? "down" : "up"
			if (mod) addCursor(direction === "down" ? 1 : -1)
			else applyLineEdit((event.shiftKey ? "duplicate-" : "move-") + direction)
			return
		}
		if (mod && event.shiftKey && key === "k") {
			event.preventDefault()
			applyLineEdit("delete")
			return
		}
		if (mod && event.key === "Enter") {
			event.preventDefault()
			applyLineEdit(event.shiftKey ? "insert-above" : "insert-below")
			return
		}
		if (
			event.ctrlKey &&
			!event.metaKey &&
			!event.shiftKey &&
			!event.altKey &&
			key === "l"
		) {
			event.preventDefault()
			let selection = lineBounds(editor.value, {
				start: editor.selectionStart,
				end: editor.selectionEnd,
			})
			editor.setSelectionRange(selection.start, selection.end)
			return
		}
		if (mod && ["[", "]"].includes(event.key)) {
			event.preventDefault()
			applyLineEdit(event.key === "]" ? "indent" : "outdent")
			return
		}
		if (event.key === "Tab") {
			if (!options.preferences.tabIndent) return
			if (releaseTab) {
				releaseTab = false
				return
			}
			event.preventDefault()
			applyLineEdit(event.shiftKey ? "outdent" : "indent")
			return
		}
		if (event.key === "Enter" && event.shiftKey) {
			event.preventDefault()
			insert("  \n")
			return
		}
		if (event.key === "Enter" && !event.shiftKey) {
			let before = editor.value.slice(0, editor.selectionStart),
				line = before.slice(before.lastIndexOf("\n") + 1),
				match = line.match(/^(\s*)([-*+] |\d+\. )(\[[ xX]\] )?/)
			if (match) {
				event.preventDefault()
				let prefix = match[0]
				if (/^\d/.test(match[2] ?? ""))
					prefix = (match[1] ?? "") + `${parseInt(match[2] ?? "0") + 1}. `
				prefix = prefix.replace(/\[[xX]\]/, "[ ]")
				if (line.trim() === match[0].trim()) {
					editor.setSelectionRange(
						editor.selectionStart - match[0].length,
						editor.selectionStart,
					)
					insert("\n")
				} else insert("\n" + prefix)
			}
		}
	}
	function showCompletions() {
		let editor = text
		let before = editor.value.slice(0, editor.selectionStart),
			link = before.match(/\[\[([^\]\n]*)$/),
			slash = before.match(/(?:^|\n)\/([\w -]*)$/)
		completionItems = []
		if (link) {
			completionItems = options
				.documents()
				.filter(
					doc =>
						!doc.archived &&
						doc.title.toLowerCase().includes((link[1] ?? "").toLowerCase()),
				)
				.slice(0, 8)
				.map(doc => ({
					label: doc.title,
					start: editor.selectionStart - (link[0]?.length ?? 0),
					end:
						editor.selectionStart +
						(editor.value.slice(editor.selectionStart).startsWith("]]")
							? 2
							: 0),
					value: `[[${doc.id}]]`,
				}))
			let title = link[1]?.trim()
			if (
				title &&
				!options
					.documents()
					.some(doc => doc.title.toLowerCase() === title.toLowerCase())
			)
				completionItems.push({
					label: translate("Create document") + ": " + title,
					create: title,
					start: editor.selectionStart - link[0].length,
					end:
						editor.selectionStart +
						(editor.value.slice(editor.selectionStart).startsWith("]]")
							? 2
							: 0),
					value: "",
				})
		} else if (slash) {
			let commands: [string, string][] = [
				["Heading 1", "# "],
				["Heading 2", "## "],
				["Heading 3", "### "],
				["Task list", "- [ ] "],
				["Bullet list", "- "],
				["Quote", "> "],
				["Table", "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |"],
				["Code block", "```ts\n\n```"],
				["Slide break", "---\n"],
				["Presentation", "---\nmode: present\nsize: M\n---\n\n# "],
			]
			completionItems = commands
				.filter(([label]) =>
					label.toLowerCase().includes((slash[1] ?? "").toLowerCase()),
				)
				.map(([label, value]) => ({
					label,
					value,
					start: editor.selectionStart - (slash[1]?.length ?? 0) - 1,
					end: editor.selectionStart,
				}))
		}
		menu.hidden = !completionItems.length
		setMarkup(
			menu,
			joinMarkup(
				completionItems.map(
					(item, index) =>
						html`<button role="option" data-complete="${index}">
							${item.label}
						</button>`,
				),
				"",
			),
		)
	}
	function chooseCompletion(index: number) {
		let editor = text,
			item = completionItems[index]
		if (!item) return
		completionItems = []
		if (item.create) {
			let source = editor.value
			menu.hidden = true
			let title = item.create
			fork(
				Effect.tryPromise(() => options.createLinkedDocument(title)).pipe(
					Effect.tap(id =>
						Effect.sync(() => {
							if (!textarea.isConnected || editor.value !== source) return
							editor.setSelectionRange(item.start, item.end)
							insert(`[[${id}]]`)
						}),
					),
					Effect.catch(error => Effect.sync(() => options.report(error))),
				),
			)
			return
		}
		editor.setSelectionRange(item.start, item.end)
		insert(item.value)
		menu.hidden = true
	}
	function selectNextOccurrence(editor: SourceTextarea) {
		let start = editor.selectionStart,
			end = editor.selectionEnd
		if (start === end) {
			while (start > 0 && /[\w]/.test(editor.value[start - 1] ?? "")) start--
			while (end < editor.value.length && /[\w]/.test(editor.value[end] ?? ""))
				end++
			editor.setSelectionRange(start, end)
			return
		}
		let selected = editor.value.slice(start, end),
			last = Math.max(end, ...secondarySelections.map(range => range.end)),
			next = editor.value.indexOf(selected, last)
		if (next >= 0)
			secondarySelections.push({ start: next, end: next + selected.length })
		selectionsChanged()
	}
	function multiInput(event: InputEvent) {
		if (
			event.inputType === "historyUndo" ||
			event.inputType === "historyRedo"
		) {
			event.preventDefault()
			options.undo(event.inputType === "historyRedo")
			return
		}
		if (
			event.inputType === "insertText" &&
			editable &&
			!event.isComposing &&
			!secondarySelections.length
		) {
			let pairs: Record<string, string> = {
				"(": ")",
				"[": "]",
				"{": "}",
				'"': '"',
				"'": "'",
				"`": "`",
			}
			let marker = event.data ?? "",
				closing = pairs[marker]
			let start = text.selectionStart,
				end = text.selectionEnd,
				selected = text.value.slice(start, end)
			if (
				options.preferences.smartPairs &&
				!selected &&
				[")", "]", "}", '"', "'", "`"].includes(marker) &&
				text.value[start] === marker
			) {
				event.preventDefault()
				text.setSelectionRange(start + 1, start + 1)
				return
			}
			if (
				(options.preferences.smartPairs &&
					closing &&
					(marker !== "`" || selected)) ||
				(options.preferences.markerWrapping &&
					selected &&
					["*", "_", "~", "`"].includes(marker))
			) {
				if (
					!selected &&
					["'", '"'].includes(marker) &&
					/[\p{L}\p{N}]/u.test(text.value[start - 1] ?? "")
				)
					return
				event.preventDefault()
				text.setRangeText(
					marker + selected + (closing ?? marker),
					start,
					end,
					"end",
				)
				text.setSelectionRange(start + 1, start + 1 + selected.length)
				textarea.dispatchEvent(new Event("input"))
				return
			}
		}
		let editor = text
		if (
			!(event.currentTarget instanceof HTMLTextAreaElement) ||
			!secondarySelections.length ||
			event.isComposing
		)
			return
		if (
			![
				"insertText",
				"deleteContentBackward",
				"deleteContentForward",
				"insertLineBreak",
			].includes(event.inputType)
		)
			return
		event.preventDefault()
		let ranges = [
			{ start: editor.selectionStart, end: editor.selectionEnd },
			...secondarySelections,
		].sort((a, b) => a.start - b.start)
		let typed =
			event.inputType === "insertLineBreak" ? "\n" : (event.data ?? "")
		let source = editor.value
		let boundaries = Array.from(
			new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
				source,
			),
			segment => segment.index,
		)
		let edits = ranges.map(range => {
			let { start, end } = range
			if (start === end && event.inputType === "deleteContentBackward")
				start = boundaries.filter(index => index < start).pop() ?? 0
			if (start === end && event.inputType === "deleteContentForward")
				end = boundaries.find(index => index > end) ?? source.length
			return { start, end }
		})
		let offset = 0,
			positions: {
				start: number
				end: number
			}[] = []
		for (let edit of edits) {
			let cursor = edit.start + offset + typed.length
			positions.push({ start: cursor, end: cursor })
			offset += typed.length - (edit.end - edit.start)
		}
		for (let edit of [...edits].reverse())
			source = source.slice(0, edit.start) + typed + source.slice(edit.end)
		secondarySelections = positions.slice(1)
		let primary = positions[0]
		editor.replace(source, primary?.start ?? 0, primary?.end ?? 0)
		editor.dispatchEvent(new Event("input"))
	}
	function applyLineEdit(command: string) {
		if (!editable) return
		let result = editLines(
			text.value,
			{ start: text.selectionStart, end: text.selectionEnd },
			command,
		)
		text.replace(result.source, result.selection.start, result.selection.end)
		textarea.dispatchEvent(new Event("input"))
	}
	function addCursor(direction: number) {
		let bounds = lineBounds(text.value, {
			start: text.selectionStart,
			end: text.selectionEnd,
		})
		let column = text.selectionStart - bounds.start
		let next =
			direction > 0
				? bounds.end + 1
				: text.value.slice(0, bounds.start - 1).lastIndexOf("\n") + 1
		if (
			next < 0 ||
			next > text.value.length ||
			(direction < 0 && bounds.start === 0)
		)
			return
		let end = text.value.indexOf("\n", next)
		if (end < 0) end = text.value.length
		let offset = Math.min(next + column, end)
		if (!secondarySelections.some(range => range.start === offset))
			secondarySelections.push({ start: offset, end: offset })
		selectionsChanged()
	}
	function selectionsChanged() {
		if (!text.sync()) updateHighlight()
	}
}
function editorContext(source: string, offset: number) {
	let start = source.lastIndexOf("\n", offset - 1) + 1
	let end = source.indexOf("\n", offset)
	let line = source.slice(start, end < 0 ? source.length : end),
		column = offset - start
	let within = (match: RegExpExecArray) =>
		column >= match.index && column <= match.index + match[0].length
	let wiki = [...line.matchAll(/\[\[([^\]\n]+)\]\]/g)].find(within)
	let image = [
		...line.matchAll(/!\[([^\]\n]*)\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g),
	].find(within)
	let link = [
		...line.matchAll(
			/!?\[[^\]\n]*\]\(<?((?:https?:|mailto:)[^)\s>]+)[^)]*\)|<?(https?:\/\/[^\s<>)\]]+)/g,
		),
	].find(within)
	return {
		url: image ? undefined : (link?.[1] ?? link?.[2]),
		image:
			image && image[2] && safeUrl(image[2]) !== "#"
				? { url: image[2], alt: image[1] ?? "" }
				: undefined,
		wiki: wiki && (wiki[1] ?? "").split("|")[0],
		task: /^\s*[-*+] \[[ xX]\]/.test(line),
	}
}
export function sourceHighlight(
	source: string,
	documents: readonly DocumentLink[] = [],
	links: readonly ProjectedLink[] = [],
	mediaIcon?: (target: string) => IconName,
) {
	let offset = 0
	return (
		source
			.split("\n")
			.map(line => {
				let start = offset
				offset += line.length + 1
				let collapsed = links.filter(
					link => link.view.start >= start && link.view.end <= offset - 1,
				)
				let content = lineMarkup(line, start, collapsed, undefined, mediaIcon)
				if (/^\s*[-*+] \[x\]/i.test(line))
					return html`<span class="done-task">${rawMarkup(content)}</span>`
				let heading = content.match(/^(#{1,6})(\s.*)$/)
				if (heading)
					return html`<span class="syntax-heading"
						><span class="syntax-marker">${heading[1] ?? ""}</span
						>${rawMarkup(heading[2] ?? "")}</span
					>`
				if (/^---\s*$|^```/.test(line))
					return html`<span class="syntax-marker">${rawMarkup(content)}</span>`
				if (/^>/.test(line))
					return html`<span class="syntax-quote">${rawMarkup(content)}</span>`
				return lineMarkup(line, start, collapsed, documents, mediaIcon)
			})
			.join("\n") + "\n"
	)
}
// Inline decoration runs on raw stretches only, so its patterns never reach
// into the markup of a collapsed link.
function lineMarkup(
	line: string,
	start: number,
	links: readonly ProjectedLink[],
	documents?: readonly DocumentLink[],
	mediaIcon?: (target: string) => IconName,
) {
	let content = "",
		position = 0
	for (let link of [...links, undefined]) {
		let raw = escape(
			line.slice(position, link ? link.view.start - start : undefined),
		)
		content += documents ? decorate(raw, documents) : raw
		if (!link) break
		let name: IconName =
			link.kind === "wiki"
				? link.broken
					? "file-warning"
					: "file-symlink"
				: link.kind === "media"
					? (mediaIcon?.(link.target) ?? "image")
					: "link"
		let label = line.slice(
			link.view.start - start + (link.iconSpace ? iconPrefix.length : 0),
			link.view.end - start,
		)
		content += html`<span
			class="${link.broken ? "syntax-link syntax-link-broken" : "syntax-link"}"
			title="${link.target}"
			>${link.iconSpace ? html`<span class="syntax-link-icon" data-icon="${name}" aria-hidden="true">${iconPrefix}${icon(name)}</span>` : ""}<span
				class="syntax-link-label"
				>${label}</span
			></span
		>`.value
		position = link.view.end - start
	}
	return content
}
function decorate(content: string, documents: readonly DocumentLink[]) {
	return content
		.replace(
			/\*\*(.+?)\*\*/g,
			localizeMarkup(
				'<span class="syntax-bold"><span class="syntax-marker">**</span>$1<span class="syntax-marker">**</span></span>',
			),
		)
		.replace(
			/(`[^`]+`)/g,
			localizeMarkup('<span class="syntax-code">$1</span>'),
		)
		.replace(/(\[\[.*?\]\])/g, (value: string) => {
			let token = value.slice(2, -2).split("|")[0]
			let doc = documents.find(doc => doc.id === token || doc.title === token)
			return html`<span class="syntax-link" title="${doc?.title ?? token}"
				>${rawMarkup(value)}</span
			>`.value
		})
}
