import type { DocumentLink } from "../../shared/model"
import type { ProjectedLink, Projection } from "../../shared/projection"
import { frontmatterBlock, nextFence, escape } from "../../shared/markdown"
import { localizeMarkup } from "../language"
import type { IconName } from "../icons"
import { highlightLine } from "./editor-syntax"

interface Selection {
	start: number
	end: number
	caret?: boolean
}
interface Line {
	text: string
	start: number
	end: number
	node: HTMLSpanElement
	key: string
	points: { node: Node; start: number; end: number }[]
}

// Line nodes retain native wrapping and text offsets. Unchanged lines keep their
// DOM, so typing never rebuilds or measures the rest of the document.
export class EditorOverlay {
	private host: HTMLElement
	private lines: Line[] = []
	private source = ""
	private documents = ""
	private marks = ""
	private media = ""
	private projection: Projection | undefined
	private hovered = new Set<HTMLElement>()

	constructor(host: HTMLElement) {
		this.host = host
	}
	update(
		projection: Projection,
		documents: readonly DocumentLink[],
		mediaIcon: ((url: string) => IconName) | undefined,
		selections: readonly Selection[],
	) {
		let source = projection.text
		let documentsKey = documents.map(doc => doc.id + ":" + doc.title).join("\n")
		let marks = JSON.stringify(selections)
		let mediaNames = new Map(
			projection.links
				.filter(link => link.kind === "media")
				.map(link => [link.target, mediaIcon?.(link.target) ?? "image"]),
		)
		let media = JSON.stringify([...mediaNames])
		if (
			this.projection === projection &&
			this.documents === documentsKey &&
			this.marks === marks &&
			this.media === media
		)
			return false
		this.projection = projection
		let documentChanged = this.documents !== documentsKey
		this.documents = documentsKey
		this.marks = marks
		this.media = media
		let texts =
			source === this.source
				? this.lines.map(line => line.text)
				: source.split("\n")
		this.source = source
		let prefix = 0
		while (prefix < texts.length && this.lines[prefix]?.text === texts[prefix])
			prefix++
		let suffix = 0
		while (
			suffix < texts.length - prefix &&
			suffix < this.lines.length - prefix &&
			this.lines[this.lines.length - suffix - 1]?.text ===
				texts[texts.length - suffix - 1]
		)
			suffix++
		let before = this.lines
		let offset = 0,
			linkIndex = 0,
			selectionIndex = 0,
			fence = ""
		let headerEnd = frontmatterBlock(source)?.[0].length ?? 0
		let changed = false
		let lines: Line[] = []
		let used = new Set<Line>()
		for (let index = 0; index < texts.length; index++) {
			let text = texts[index] ?? ""
			let old =
				index < prefix
					? before[index]
					: index >= texts.length - suffix
						? before[before.length - (texts.length - index)]
						: index < before.length - suffix
							? before[index]
							: undefined
			let line = old && !used.has(old) ? old : this.createLine()
			used.add(line)
			let start = offset
			offset += text.length + 1
			line.text = text
			line.start = start
			line.end = offset
			let previousFence = fence
			if (start >= headerEnd) fence = nextFence(fence, text)
			let literal =
				start < headerEnd ||
				Boolean(previousFence) ||
				Boolean(fence) ||
				/^( {4}|\t)/.test(text)
			let links: ProjectedLink[] = []
			while ((projection.links[linkIndex]?.view.start ?? Infinity) < offset) {
				let link = projection.links[linkIndex++]
				if (link && link.view.start >= start && link.view.end < offset)
					links.push({
						...link,
						source: {
							start: link.view.start - start,
							end: link.view.end - start,
						},
						view: {
							start: link.view.start - start,
							end: link.view.end - start,
						},
					})
			}
			while ((selections[selectionIndex]?.end ?? Infinity) < start)
				selectionIndex++
			let selected: Selection[] = []
			for (
				let selectedIndex = selectionIndex;
				selectedIndex < selections.length;
				selectedIndex++
			) {
				let range = selections[selectedIndex]
				if (!range || range.start >= offset) break
				if (
					range.end < start ||
					(range.start !== range.end && range.end === start)
				)
					continue
				selected.push({
					start: Math.max(0, range.start - start),
					end: Math.min(text.length + 1, range.end - start),
					caret: range.start === range.end,
				})
			}
			let key = JSON.stringify([
				text,
				literal,
				selections.length > 0,
				selected,
				links.map(link => [
					link.kind,
					link.target,
					link.broken,
					link.iconSpace,
					link.view.start,
					link.view.end,
					mediaNames.get(link.target),
				]),
			])
			if (line.key !== key || (documentChanged && text.includes("[["))) {
				line.key = key
				line.node.innerHTML = selections.length
					? selectedMarkup(text + "\n", selected)
					: highlightLine(
							text,
							0,
							links,
							literal,
							documents,
							target => mediaNames.get(target) ?? "image",
						) + "\n"
				line.points = textPoints(line.node)
				changed = true
			}
			lines.push(line)
		}
		let retained = new Set(lines)
		for (let line of before)
			if (!retained.has(line)) {
				line.node.remove()
				changed = true
			}
		let cursor = this.host.firstChild
		for (let line of lines) {
			if (line.node !== cursor) {
				this.host.insertBefore(line.node, cursor)
				changed = true
			}
			cursor = line.node.nextSibling
		}
		this.lines = lines
		return changed
	}
	lineBounds(offset: number) {
		let line = this.lines[this.lineAt(offset)]
		return { start: line?.start ?? 0, end: line?.end ?? 0 }
	}
	point(offset: number) {
		let index = this.lineAt(offset)
		let line = this.lines[index]
		if (!line) return { node: this.host, offset: 0 }
		let local = offset - line.start
		let low = 0,
			high = line.points.length
		while (low < high) {
			let middle = (low + high) >>> 1
			if ((line.points[middle]?.end ?? 0) <= local) low = middle + 1
			else high = middle
		}
		let entry = line.points[low] ?? line.points.at(-1)
		return entry
			? {
					node: entry.node,
					offset: Math.max(
						0,
						Math.min(local - entry.start, entry.end - entry.start),
					),
				}
			: { node: line.node, offset: 0 }
	}
	visible(top: number, bottom: number) {
		let low = 0,
			high = this.lines.length
		while (low < high) {
			let middle = (low + high) >>> 1
			if (
				(this.lines[middle]?.node.getBoundingClientRect().bottom ?? Infinity) <
				top
			)
				low = middle + 1
			else high = middle
		}
		let first = Math.max(0, low - 1)
		low = first
		high = this.lines.length
		while (low < high) {
			let middle = (low + high) >>> 1
			if (
				(this.lines[middle]?.node.getBoundingClientRect().top ?? Infinity) <=
				bottom
			)
				low = middle + 1
			else high = middle
		}
		return {
			start: this.lines[first]?.start ?? 0,
			end: this.lines[Math.min(this.lines.length - 1, low)]?.end ?? 0,
		}
	}
	hover(offsets: number[]) {
		let next = new Set<HTMLElement>()
		for (let offset of offsets) {
			let element =
				this.point(offset).node.parentElement?.closest<HTMLElement>(
					".syntax-link",
				)
			if (element) next.add(element)
		}
		for (let element of this.hovered)
			if (!next.has(element)) element.classList.remove("is-hovered")
		for (let element of next)
			if (!this.hovered.has(element)) element.classList.add("is-hovered")
		this.hovered = next
	}
	private lineAt(offset: number) {
		let low = 0,
			high = this.lines.length
		while (low < high) {
			let middle = (low + high) >>> 1
			if ((this.lines[middle]?.end ?? 0) <= offset) low = middle + 1
			else high = middle
		}
		return Math.min(low, this.lines.length - 1)
	}
	private createLine(): Line {
		let node = document.createElement("span")
		node.dataset.editorLine = ""
		return { text: "", start: 0, end: 0, node, key: "", points: [] }
	}
}

function textPoints(host: HTMLElement) {
	let walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
	let points: Line["points"] = []
	let offset = 0
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		let length = node.textContent?.length ?? 0
		points.push({ node, start: offset, end: offset + length })
		offset += length
	}
	return points
}
function selectedMarkup(text: string, selections: Selection[]) {
	let markup = "",
		position = 0
	for (let range of selections) {
		markup +=
			escape(text.slice(position, range.start)) +
			localizeMarkup(range.caret ? '<mark class="local-caret">' : "<mark>") +
			escape(text.slice(range.start, range.end)) +
			"</mark>"
		position = range.end
	}
	return markup + escape(text.slice(position))
}
