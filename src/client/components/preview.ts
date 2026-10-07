import { html, translate } from "../language"
import { icon } from "../icons"
import { shortcutLabel } from "../shortcuts"
import type { DocumentOptions } from "./document-renderer"
import { renderDocument } from "./document-renderer"

import { selectionAnchor, type CommentSelection } from "../../shared/documents"
import type { Atom } from "../../shared/model"
import {
	alignPreview,
	renderedRange,
	sourceRange,
} from "../../shared/preview-text"

// Comments as the discussion lists them: the source range they quote, when
// it still exists, and whether they are resolved.
export interface PreviewComments {
	comments: readonly {
		id: string
		fields: Record<string, string>
		range?: { start: number; end: number }
	}[]
	selected?: string
	// Writers may comment on selected preview text while comments are on.
	commentable: boolean
	select?(id: string): void
}

interface PreviewState {
	source: string
	content: HTMLElement
	text?: string
	positions?: number[]
	nodes?: Text[]
	offsets?: WeakMap<Node, number>
	selection: { from: number; to: number } | undefined
	revealed?: string
}
let states = new WeakMap<HTMLElement, PreviewState>()

export function renderPreview(
	host: HTMLElement,
	source: string,
	options: DocumentOptions,
	navigate: (id: string) => void,
	openDrawing?: (id: string) => void,
	comments?: PreviewComments,
) {
	renderDocument(host, source, options)
	let shadow = host.shadowRoot
	if (!shadow) return
	let root = shadow
	let signal = replaceEvents(host)
	root.addEventListener("click", navigateLink, { signal })
	if (!comments) return
	attachStyles(root)
	let slot = root.querySelector<HTMLElement>("[data-content]")
	if (!slot) return
	let content = slot
	let state = states.get(host)
	clearMarks(content)
	if (!state || state.source !== source || state.content !== content) {
		state = {
			source,
			content,
			selection: undefined,
			revealed: state?.source === source ? state.revealed : undefined,
		}
		states.set(host, state)
	}
	state.nodes = undefined
	state.offsets = undefined
	markComments(content, state, comments)
	state.nodes = undefined
	state.offsets = undefined
	updateHeader(host, comments)
	let add = host
		.closest("[data-preview].preview-screen")
		?.querySelector<HTMLElement>(".preview-add-comment")
	// Pressing the button must not clear the selection it comments on.
	add?.addEventListener("mousedown", event => event.preventDefault(), {
		signal,
	})
	let current = state
	document.addEventListener("selectionchange", () => track(current), {
		signal,
	})
	track(current)

	function track(state: PreviewState) {
		// Typing the comment moves the selection into the dialog; the quoted
		// preview text stays until the reader selects something else.
		if (document.activeElement?.closest("dialog, input, textarea")) return
		state.selection = comments?.commentable
			? selectedText(root, state)
			: undefined
		if (add) add.hidden = !state.selection
	}
	function navigateLink(event: Event) {
		let image = event
			.composedPath()
			.find(node => node instanceof HTMLImageElement)
		if (image instanceof HTMLImageElement && image.dataset.asset)
			openDrawing?.(image.dataset.asset)
		let anchor = event
			.composedPath()
			.find(node => node instanceof HTMLAnchorElement)
		if (anchor instanceof HTMLAnchorElement && anchor.dataset.wikilink) {
			event.preventDefault()
			navigate(anchor.dataset.wikilink)
		}
	}
}
export function clearPreviewSelection(host: HTMLElement) {
	let state = states.get(host)
	if (state) state.selection = undefined
	host.ownerDocument.getSelection()?.removeAllRanges()
	let add = host.parentElement?.querySelector<HTMLElement>(
		".preview-add-comment",
	)
	if (add) add.hidden = true
}

export function disposePreview(host: HTMLElement) {
	events.get(host)?.abort()
	events.delete(host)
	states.delete(host)
}
let events = new WeakMap<HTMLElement, AbortController>()
function replaceEvents(host: HTMLElement) {
	events.get(host)?.abort()
	let controller = new AbortController()
	events.set(host, controller)
	return controller.signal
}

// The selected preview text as a comment anchor in the source, so a comment
// made in the preview quotes and follows the same text as one made in the
// editor.
export function previewCommentSelection(
	host: HTMLElement,
	atoms: readonly Atom[],
	source: string,
): CommentSelection | undefined {
	let state = states.get(host)
	if (!state?.selection || state.source !== source) return
	let range = sourceRange(
		source,
		prepareText(state),
		state.selection.from,
		state.selection.to,
		prepareAlignment(state),
	)
	if (!range) return
	return selectionAnchor(
		atoms,
		source,
		source.slice(range.start, range.end),
		range.start,
	)
}

function attachStyles(root: ShadowRoot) {
	if (root.querySelector("link[data-preview-styles]")) return
	let link = document.createElement("link")
	link.rel = "stylesheet"
	link.href = "/components/preview.css"
	link.dataset.previewStyles = ""
	root.prepend(link)
}

// Whitespace-only text between blocks is layout, not content.
function textNodes(content: HTMLElement) {
	let walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
	let nodes: Text[] = []
	for (let node = walker.nextNode(); node; node = walker.nextNode())
		if (
			node instanceof Text &&
			(node.data.trim() ||
				node.parentElement?.closest("pre, code, mark.preview-comment-range") ||
				(node.previousSibling instanceof Element &&
					node.previousSibling.matches("mark.preview-comment-range")) ||
				(node.nextSibling instanceof Element &&
					node.nextSibling.matches("mark.preview-comment-range")))
		)
			nodes.push(node)
	return nodes
}
function prepareText(state: PreviewState) {
	if (state.nodes) return state.text ?? ""
	let nodes = textNodes(state.content)
	let offsets = new WeakMap<Node, number>()
	let parts: string[] = []
	let length = 0
	for (let node of nodes) {
		offsets.set(node, length)
		parts.push(node.data)
		length += node.data.length
	}
	let text = parts.join("")
	if (state.text !== undefined && state.text !== text)
		state.positions = undefined
	state.text = text
	state.nodes = nodes
	state.offsets = offsets
	return text
}
function prepareAlignment(state: PreviewState) {
	let text = prepareText(state)
	return (state.positions ??= alignPreview(state.source, text))
}
function textOffset(state: PreviewState, container: Node, offset: number) {
	let found = state.offsets?.get(container)
	if (found !== undefined) return found + offset
	let boundary = document.createRange()
	boundary.setStart(container, offset)
	let seen = 0
	for (let node of state.nodes ?? []) {
		if (boundary.comparePoint(node, 0) > 0) return seen
		seen += node.data.length
	}
	return seen
}
function selectedText(root: ShadowRoot, state: PreviewState) {
	let selection = document.getSelection()
	if (!selection?.rangeCount) return
	let [range] = selection.getComposedRanges({ shadowRoots: [root] })
	if (!range || range.collapsed) return
	if (!state.content.contains(range.startContainer)) return
	if (!state.content.contains(range.endContainer)) return
	let rendered = prepareText(state)
	let from = textOffset(state, range.startContainer, range.startOffset)
	let to = textOffset(state, range.endContainer, range.endOffset)
	let text = rendered.slice(from, to)
	let leading = text.length - text.trimStart().length
	let trailing = text.length - text.trimEnd().length
	if (!text.trim()) return
	return { from: from + leading, to: to - trailing }
}

function clearMarks(content: HTMLElement) {
	for (let mark of content.querySelectorAll("mark.preview-comment-range")) {
		let parent = mark.parentNode
		if (!parent) continue
		mark.replaceWith(...mark.childNodes)
		parent.normalize()
	}
}

function markComments(
	content: HTMLElement,
	state: PreviewState,
	comments: PreviewComments,
) {
	for (let comment of comments.comments) {
		if (!comment.range) continue
		let range = renderedRange(
			prepareAlignment(state),
			comment.range.start,
			comment.range.end,
		)
		if (!range) continue
		let seen = 0
		let segments: { node: Text; start: number; end: number }[] = []
		for (let node of textNodes(content)) {
			let next = seen + node.data.length
			if (next > range.from && seen < range.to)
				segments.push({
					node,
					start: Math.max(0, range.from - seen),
					end: Math.min(node.data.length, range.to - seen),
				})
			seen = next
		}
		for (let segment of segments.reverse())
			wrapSegment(segment, comment, comments)
	}
	if (state.revealed === comments.selected) return
	state.revealed = comments.selected
	let selected = [...content.querySelectorAll<HTMLElement>("mark")].find(
		mark => mark.dataset.commentId === comments.selected,
	)
	selected?.scrollIntoView({
		block: "center",
		inline: "nearest",
		behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
			? "instant"
			: "smooth",
	})
}

function wrapSegment(
	segment: { node: Text; start: number; end: number },
	comment: PreviewComments["comments"][number],
	comments: PreviewComments,
) {
	if (segment.start >= segment.end) return
	let selected = segment.node
	if (segment.end < selected.length) selected.splitText(segment.end)
	if (segment.start > 0) selected = selected.splitText(segment.start)
	let mark = document.createElement("mark")
	let id = comment.id
	mark.className = "preview-comment-range"
	mark.dataset.commentId = id
	mark.classList.toggle(
		"preview-comment-range-resolved",
		comment.fields.resolved === "true",
	)
	mark.classList.toggle(
		"preview-comment-range-selected",
		comments.selected === id,
	)
	let select = comments.select
	if (select) {
		mark.role = "button"
		mark.tabIndex = 0
		mark.addEventListener("click", event => {
			event.preventDefault()
			select(id)
		})
		mark.addEventListener("keydown", event => {
			if (event.key !== "Enter" && event.key !== " ") return
			event.preventDefault()
			select(id)
		})
	}
	selected.replaceWith(mark)
	mark.append(selected)
}

function updateHeader(host: HTMLElement, comments: PreviewComments) {
	let count = host
		.closest("[data-preview].preview-screen")
		?.querySelector<HTMLElement>(".preview-comment-count")
	if (!count) return
	let open = comments.comments.filter(
		comment => comment.fields.resolved !== "true",
	).length
	count.textContent = String(open)
	count.hidden = !open
}

export function previewMarkup(
	title: string,
	editorHref: string,
	comments: boolean,
	appearance = "system",
) {
	let options = translate("Preview options")
	let theme = (
		value: string,
		label: string,
		name: "sun" | "moon" | "sun-moon",
	) =>
		html`<button
			type="button"
			role="menuitemradio"
			data-action="appearance-${value}"
			aria-checked="${String(appearance === value)}"
		>
			${icon(name)}<span>${translate(label)}</span>${icon("check")}
		</button>`
	return html`<section data-preview class="preview-screen">
		<header class="preview-header">
			<a class="preview-back" href="${editorHref}">${translate("Editor")}</a>
			<span id="preview-title" class="preview-title">${title}</span>
			<div class="preview-actions">
				${
					comments
						? html`<button
								type="button"
								data-action="preview-comments"
								aria-label="${translate("Comments")}"
								title="${translate("Comments")}"
								aria-expanded="false"
							>
								${icon("message-square")}<span
									class="preview-comment-count"
									hidden
								></span>
							</button>`
						: ""
				}
				<alkalye-menu align="end">
					<button type="button" aria-label="${options}" title="${options}">
						${icon("ellipsis")}
					</button>
					<div
						id="preview-options"
						class="menu-popover"
						popover
						role="menu"
						aria-label="${options}"
					>
						<a href="${editorHref}" role="menuitem"
							>${icon("pencil")}<span>${translate("Editor")}</span
							><kbd>${shortcutLabel("preview", platform())}</kbd></a
						>
						<hr />
						<div class="preview-menu-label" role="presentation">
							${translate("Theme")}
						</div>
						${theme("light", "Light", "sun")}${theme("dark", "Dark", "moon")}${theme("system", "System", "sun-moon")}
					</div>
				</alkalye-menu>
			</div>
		</header>
		<div class="preview-scroll">
			<div data-preview id="preview" class="preview-paper"></div>
		</div>
		${
			comments
				? html`<button
						type="button"
						class="preview-add-comment"
						data-action="comment"
						aria-label="${translate("Add comment")}"
						title="${translate("Add comment")}"
						hidden
					>
						${icon("message-square-plus")}
					</button>`
				: ""
		}
	</section>`
}

function platform() {
	return /Mac|iPhone|iPad/i.test(navigator.platform) ? "mac" : "other"
}
