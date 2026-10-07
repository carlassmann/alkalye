import { TextIndex } from "../shared/text-index"
import type { Replacement } from "../shared/text-index"

export interface ViewportSelection {
	start: number
	end: number
	direction?: "forward" | "backward" | "none"
}
interface ViewportRenderOptions {
	revealSelection: boolean
}
export interface EditorWindow {
	start: number
	end: number
	top: number
	height: number
	direction?: "ltr" | "rtl"
}
export interface EditorViewportOptions {
	painted(viewport: EditorWindow): void
	edited?(edits: Replacement[]): void
	fullDocument?: boolean
}
interface Block extends EditorWindow {
	measured: boolean
	text: string
}

export class EditorViewport {
	readonly scrollElement: HTMLElement
	private text: TextIndex
	private blocks: Block[] = []
	private selection: ViewportSelection = { start: 0, end: 0 }
	private paintedSelection = { start: 0, end: 0 }
	private fragment = ""
	private window: EditorWindow = { start: 0, end: 0, top: 0, height: 0 }
	private spacer = document.createElement("div")
	private measure = document.createElement("pre")
	private abort = new AbortController()
	private resize: ResizeObserver
	private frame = 0
	private composing = false
	private deferred:
		| {
				text: string
				selection?: ViewportSelection
				options?: ViewportRenderOptions
		  }
		| undefined
	private pending: Replacement[] = []
	private intent: { start: number; end: number; type: string } | undefined
	private accessibleDocument: boolean
	private layoutKey = ""
	private acknowledged: string | undefined
	private notify = false
	private paddingTop = 0
	private paddingBottom = 0
	private lineHeight = 1
	private averageWidth = 1
	private contentWidth = 1
	private idleFrame = 0
	private mutation: MutationObserver
	private fragmentHeight = 0
	private fragmentLayout = ""
	private prefix = ""
	private directions = new Map<number, "ltr" | "rtl">()
	private measuredHostStyle = ""
	private measuringContext = document.createElement("canvas").getContext("2d")
	private dragging = false
	private lastInteraction = 0
	private pointerDocument = false
	private selectionDocument = false
	private nativeAcknowledgement = false
	private revision = 0
	private navigationDocument = false
	private denseDocument = false
	private coarsePointer = matchMedia("(pointer: coarse)")

	constructor(
		readonly element: HTMLTextAreaElement,
		source: string,
		private options: EditorViewportOptions,
	) {
		let host = element.parentElement
		if (!host) throw new Error("Editor input must be mounted")
		this.scrollElement = host
		host.dataset.editorViewport = ""
		this.spacer.dataset.viewportSpacer = ""
		this.measure.dataset.viewportMeasure = ""
		this.measure.setAttribute("aria-hidden", "true")
		host.append(this.spacer, this.measure)
		this.text = new TextIndex(source)
		this.accessibleDocument = options.fullDocument ?? false
		element.setAttribute(
			"aria-description",
			"Document editor. Select all and copy include the complete document. Full document input is available in editor preferences.",
		)
		let signal = this.abort.signal
		this.coarsePointer.addEventListener("change", () => this.paint(), {
			signal,
		})
		host.addEventListener(
			"scroll",
			() => {
				this.lastInteraction = performance.now()
				this.schedule()
			},
			{ signal },
		)
		host.addEventListener("beforeinput", event => this.beforeInput(event), {
			signal,
		})
		host.addEventListener("keydown", event => this.keydown(event), { signal })
		for (let type of [
			"beforeinput",
			"keydown",
			"pointerdown",
			"compositionupdate",
		])
			host.addEventListener(
				type,
				() => {
					this.lastInteraction = performance.now()
				},
				{ signal },
			)
		host.addEventListener("copy", event => this.copy(event, false), { signal })
		host.addEventListener("cut", event => this.copy(event, true), { signal })
		host.addEventListener("paste", event => this.paste(event), { signal })
		element.addEventListener("select", () => this.readSelection(), { signal })
		element.addEventListener(
			"pointerdown",
			() => {
				this.readSelection()
				let alreadyFull =
					this.completeDocument() &&
					this.window.start === 0 &&
					this.window.end === this.text.length
				this.pointerDocument = true
				if (alreadyFull) {
					this.dragging = true
					return
				}
				let anchor = this.offsetAtHeight(this.scrollElement.scrollTop)
				let before = this.topAt(anchor) - this.scrollElement.scrollTop
				this.paint()
				this.measure.textContent = this.value + "\u200b"
				let node = this.measure.firstChild
				if (node) {
					let range = document.createRange()
					range.setStart(node, Math.min(anchor, this.text.length))
					range.setEnd(node, Math.min(anchor + 1, this.text.length + 1))
					this.scrollElement.scrollTop =
						this.paddingTop +
						range.getBoundingClientRect().top -
						this.measure.getBoundingClientRect().top -
						before
				}
				this.dragging = true
			},
			{ signal },
		)
		window.addEventListener(
			"pointerup",
			() => {
				if (!this.dragging) return
				this.readSelection(true)
				this.dragging = false
				this.pointerDocument = false
				this.paint()
			},
			{ signal },
		)
		window.addEventListener(
			"pointercancel",
			() => {
				if (!this.dragging) return
				this.readSelection(true)
				this.dragging = false
				this.pointerDocument = false
				this.paint()
			},
			{ signal },
		)
		element.addEventListener(
			"keyup",
			() => {
				this.readSelection()
				if (this.navigationDocument) {
					this.navigationDocument = false
					this.paint()
				}
			},
			{ signal },
		)
		element.addEventListener(
			"compositionstart",
			() => {
				this.readSelection()
				this.reveal(this.selection.end)
				this.composing = true
			},
			{ signal },
		)
		element.addEventListener(
			"compositionend",
			() => {
				this.pending.push(...this.input())
				this.composing = false
				let next = this.deferred
				let revision = this.revision
				this.deferred = undefined
				queueMicrotask(() => {
					if (this.abort.signal.aborted) return
					if (next && this.revision === revision)
						this.render(next.text, next.selection, next.options)
					else this.paint()
					this.remeasure()
				})
			},
			{ signal },
		)
		this.resize = new ResizeObserver(() => {
			if (this.composing) return
			let key = this.styleMeasurement()
			if (key === this.layoutKey) return
			let anchor = this.offsetAtHeight(this.scrollElement.scrollTop)
			let before = this.topAt(anchor)
			this.layoutKey = key
			this.denseDocument = false
			this.rebuild(0)
			let movement = this.topAt(anchor) - before
			if (movement) this.scrollElement.scrollTop += movement
			this.paint()
		})
		this.resize.observe(host)
		this.mutation = new MutationObserver(records => {
			if (
				records.some(
					record =>
						record.target !== host ||
						(host.getAttribute("style") ?? "") !== this.measuredHostStyle,
				)
			)
				this.remeasure()
		})
		this.mutation.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "style"],
		})
		this.mutation.observe(host, {
			attributes: true,
			attributeFilter: ["style"],
		})
		document.fonts.addEventListener(
			"loadingdone",
			() => {
				this.layoutKey = ""
				this.fragmentHeight = 0
				this.measuringContext = document
					.createElement("canvas")
					.getContext("2d")
				this.remeasure()
			},
			{
				signal,
			},
		)
		this.paddingTop = parseFloat(getComputedStyle(element).paddingTop) || 0
		this.paddingBottom =
			parseFloat(getComputedStyle(element).paddingBottom) || 0
		this.layoutKey = this.styleMeasurement()
		this.rebuild(0)
		this.paint()
		this.idle()
		this.notify = true
		this.acknowledged = source
	}
	get viewport() {
		return this.window
	}
	get selectionStart() {
		this.readSelection()
		return this.selection.start
	}
	get selectionEnd() {
		this.readSelection()
		return this.selection.end
	}
	get selectionDirection() {
		return this.selection.direction ?? "none"
	}
	get isComposing() {
		return this.composing
	}
	get value() {
		return this.acknowledged ?? this.text.value
	}
	get scrollTop() {
		return this.scrollElement.scrollTop
	}
	set scrollTop(value: number) {
		this.scrollElement.scrollTop = value
		this.paint()
	}
	focus() {
		this.element.focus({ preventScroll: true })
	}
	remeasure() {
		if (this.composing) return
		let key = this.styleMeasurement()
		if (key === this.layoutKey) return
		let anchor = this.offsetAtHeight(this.scrollElement.scrollTop)
		let before = this.topAt(anchor)
		this.layoutKey = key
		this.denseDocument = false
		this.rebuild(0)
		let movement = this.topAt(anchor) - before
		if (movement) this.scrollElement.scrollTop += movement
		this.paint()
	}
	fullDocument(enabled: boolean) {
		if (this.accessibleDocument === enabled) return
		this.accessibleDocument = enabled
		this.paint()
	}
	revealOffset(offset: number) {
		this.reveal(Math.max(0, Math.min(this.text.length, offset)))
		this.paint()
	}
	setSelectionRange(
		start: number,
		end: number,
		direction?: ViewportSelection["direction"],
	) {
		this.selection = {
			start: Math.max(0, Math.min(this.text.length, start)),
			end: Math.max(0, Math.min(this.text.length, end)),
			direction,
		}
		this.reveal(direction === "backward" ? start : end, true)
	}
	render(
		source: string,
		selection?: ViewportSelection,
		options?: ViewportRenderOptions,
	) {
		this.revision++
		if (this.composing) {
			this.deferred = { text: source, selection, options }
			return
		}
		let previous = this.acknowledged ?? this.text.value
		if (source !== previous) {
			let start = 0,
				end = previous.length,
				tail = source.length
			while (start < end && start < tail && previous[start] === source[start])
				start++
			while (
				end > start &&
				tail > start &&
				previous[end - 1] === source[tail - 1]
			) {
				end--
				tail--
			}
			this.apply({ start, end, insert: source.slice(start, tail) })
		}
		this.acknowledged = source
		this.nativeAcknowledgement = false
		if (selection) this.selection = selection
		if (options?.revealSelection)
			this.reveal(
				this.selection.direction === "backward"
					? this.selection.start
					: this.selection.end,
				true,
			)
		else this.paint()
	}
	acknowledge(source: string, selection?: ViewportSelection) {
		if (!this.nativeAcknowledgement && source !== this.acknowledged) {
			this.render(source, selection)
			return
		}
		this.revision++
		this.nativeAcknowledgement = false
		this.acknowledged = source
		if (selection) this.selection = selection
		this.paint()
	}
	apply(edit: Replacement) {
		let dense = this.denseDocument
		this.denseDocument = false
		this.text.replace(edit)
		this.acknowledged = undefined
		this.directions.clear()
		this.fragmentHeight = 0
		this.rebuild(
			dense ? 0 : this.blockAtOffset(edit.start),
			dense ? undefined : edit,
		)
	}
	input(): Replacement[] {
		let result = this.pending.splice(0)
		if (this.element.value === this.prefix + this.fragment) {
			this.intent = undefined
			return result
		}
		let next = this.element.value.slice(this.prefix.length),
			before = this.fragment
		let start = 0,
			end = before.length,
			tail = next.length
		let intent = this.intent
		this.intent = undefined
		let removed = before.length - next.length
		let deletionStart = intent
			? intent.start === intent.end && intent.type.endsWith("Backward")
				? intent.start - removed
				: intent.start
			: 0
		let deletionEnd = intent
			? intent.start === intent.end && !intent.type.endsWith("Backward")
				? intent.end + removed
				: intent.end
			: 0
		if (
			intent?.type.startsWith("delete") &&
			removed > 0 &&
			deletionStart >= 0 &&
			before.slice(0, deletionStart) === next.slice(0, deletionStart) &&
			next.endsWith(before.slice(deletionEnd))
		) {
			start = deletionStart
			end = deletionEnd
			tail = next.length - (before.length - end)
		} else if (
			intent &&
			intent.type.startsWith("insert") &&
			before.slice(0, intent.start) === next.slice(0, intent.start) &&
			next.endsWith(before.slice(intent.end))
		) {
			start = intent.start
			end = intent.end
			tail = next.length - (before.length - end)
		} else {
			while (start < end && start < tail && before[start] === next[start])
				start++
			while (
				end > start &&
				tail > start &&
				before[end - 1] === next[tail - 1]
			) {
				end--
				tail--
			}
		}
		if (start > 0 && /[\uDC00-\uDFFF]/.test(before[start] ?? next[start] ?? ""))
			start--
		if (/[\uDC00-\uDFFF]/.test(before[end] ?? "")) {
			end++
			tail++
		}
		let edit = {
			start: this.window.start + start,
			end: this.window.start + end,
			insert: next.slice(start, tail),
		}
		this.selection = {
			start:
				this.window.start +
				Math.max(0, this.element.selectionStart - this.prefix.length),
			end:
				this.window.start +
				Math.max(0, this.element.selectionEnd - this.prefix.length),
			direction: this.element.selectionDirection,
		}
		this.apply(edit)
		this.nativeAcknowledgement = true
		this.fragment = next
		result.push(edit)
		if (!this.composing) this.schedule()
		return result
	}
	dispose() {
		this.abort.abort()
		this.resize.disconnect()
		this.mutation.disconnect()
		cancelAnimationFrame(this.frame)
		cancelAnimationFrame(this.idleFrame)
		this.spacer.remove()
		this.measure.remove()
		delete this.scrollElement.dataset.editorViewport
	}
	private styleMeasurement() {
		let outerWidth = this.scrollElement.clientWidth
		let before = getComputedStyle(this.element)
		let paddingLeft = parseFloat(before.paddingLeft)
		let paddingRight = parseFloat(before.paddingRight)
		this.element.style.removeProperty("line-height")
		let style = getComputedStyle(this.element)
		let font = style.font
		let fontSize = parseFloat(style.fontSize)
		let requested = parseFloat(style.lineHeight) || fontSize * 1.8
		let height = Math.round(requested * 64) / 64 + "px"
		let letterSpacing = style.letterSpacing
		let direction = style.direction
		let width = Math.max(1, outerWidth - paddingLeft - paddingRight)
		let properties: [string, string][] = []
		for (let property of [
			"font",
			"letter-spacing",
			"tab-size",
			"white-space",
			"overflow-wrap",
			"word-break",
			"direction",
			"text-align",
			"unicode-bidi",
		])
			properties.push([property, style.getPropertyValue(property)])
		this.element.style.lineHeight = height
		if (
			this.scrollElement.style.getPropertyValue(
				"--editor-native-line-height",
			) !== height
		)
			this.scrollElement.style.setProperty(
				"--editor-native-line-height",
				height,
			)
		this.measuredHostStyle = this.scrollElement.getAttribute("style") ?? ""
		for (let [property, value] of properties)
			this.measure.style.setProperty(property, value)
		this.measure.style.lineHeight = height
		this.measure.style.width = width + "px"
		this.contentWidth = width
		this.lineHeight = parseFloat(height)
		if (this.measuringContext) this.measuringContext.font = font
		this.averageWidth =
			(this.measuringContext?.measureText("M").width ?? fontSize) +
			(parseFloat(letterSpacing) || 0)
		return (
			width + ":" + font + ":" + height + ":" + letterSpacing + ":" + direction
		)
	}
	private blockBoundary(offset: number, start: number) {
		if (offset >= this.text.length || offset <= start) return offset
		let nearby = this.text.slice(offset - 1, offset + 1)
		if (
			nearby.charCodeAt(0) < 128 &&
			nearby.charCodeAt(1) < 128 &&
			nearby !== "\r\n"
		)
			return offset
		let previous = this.text.previousGrapheme(offset)
		let next = this.text.nextGrapheme(previous)
		if (next <= offset) return offset
		return previous > start ? previous : next
	}
	private directionMark(offset: number) {
		if (offset <= 0 || this.text.slice(offset - 1, offset) === "\n") return ""
		let line = this.text.lineAt(offset),
			start = this.text.offsetAtLine(line)
		let direction = this.directions.get(start)
		if (!direction) {
			let end = this.text.offsetAtLine(line + 1)
			for (let cursor = start; cursor < end; cursor += 2048) {
				let first = this.text
					.slice(cursor, Math.min(end, cursor + 2048))
					.match(/\p{Letter}/u)?.[0]
				if (!first) continue
				direction =
					/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u.test(
						first,
					)
						? "rtl"
						: "ltr"
				break
			}
			direction ??= "ltr"
			this.directions.set(start, direction)
		}
		return direction === "rtl" ? "\u200f" : "\u200e"
	}
	private measuredBlock(
		start: number,
		top: number,
		limit = this.text.length,
	): Block {
		let end = this.blockBoundary(Math.min(limit, start + 1024), start)
		end = this.blockBoundary(end, start)
		let part = this.text.slice(start, end)
		let newline = part.lastIndexOf("\n")
		if (newline >= 0 && end < this.text.length) {
			end = start + newline + 1
			part = part.slice(0, newline + 1)
		}
		let prefix = this.directionMark(start)
		this.measure.textContent = prefix + part || "\u200b"
		let node = this.measure.firstChild
		if (end < this.text.length && !part.endsWith("\n") && node) {
			let range = document.createRange()
			range.setStart(node, prefix.length + part.length - 1)
			range.setEnd(node, prefix.length + part.length)
			let lastTop = range.getBoundingClientRect().top
			let low = 0,
				high = part.length - 1
			while (low < high) {
				let middle = (low + high) >>> 1
				range.setStart(node, prefix.length + middle)
				range.setEnd(node, prefix.length + middle + 1)
				if (range.getBoundingClientRect().top < lastTop - 1) low = middle + 1
				else high = middle
			}
			// Splitting dense graphemes before a native row boundary invents blank rows.
			if (!low) this.denseDocument = true
			if (low > 0) {
				end = this.blockBoundary(start + low, start)
				part = this.text.slice(start, end)
				this.measure.textContent = prefix + part || "\u200b"
			}
		}
		let lineHeight = this.lineHeight
		let height = this.measure.getBoundingClientRect().height

		return {
			start,
			end,
			text: part,
			top,
			height: Math.max(lineHeight, height),
			measured: true,
		}
	}
	private estimatedBlock(
		start: number,
		top: number,
		end = Math.min(this.text.length, start + 1024),
	): Block {
		end = this.blockBoundary(end, start)
		let part = this.text.slice(start, end)
		let newline = part.lastIndexOf("\n")
		if (newline >= 0 && end < this.text.length) {
			part = part.slice(0, newline + 1)
			end = start + part.length
		}
		let lines = part.split("\n")
		let rows = lines.reduce(
			(total, line) =>
				total +
				Math.max(
					1,
					Math.ceil((line.length * this.averageWidth) / this.contentWidth),
				),
			0,
		)
		if (part.endsWith("\n")) rows--
		return {
			start,
			end,
			text: part,
			top,
			height: Math.max(1, rows) * this.lineHeight,
			measured: false,
		}
	}
	private refine(index: number, updateScroll = true) {
		let previous = this.blocks[index]
		if (!previous || previous.measured) return
		let anchor = updateScroll
			? this.offsetAtHeight(this.scrollElement.scrollTop)
			: 0
		let before = updateScroll ? this.topAt(anchor) : 0
		let measured = this.measuredBlock(
			previous.start,
			previous.top,
			previous.end,
		)
		this.blocks[index] = measured
		let next = this.blocks[index + 1]
		let top = measured.top + measured.height
		if (next && measured.end !== next.start) {
			next = this.estimatedBlock(measured.end, top, next.end)
			this.blocks[index + 1] = next
		}
		for (let cursor = index + 1; cursor < this.blocks.length; cursor++) {
			let block = this.blocks[cursor]
			if (!block) continue
			block.top = top
			top += block.height
		}
		if (updateScroll) {
			this.spacer.style.height = top + this.paddingBottom + "px"
			let movement = this.topAt(anchor) - before
			if (movement) this.scrollElement.scrollTop += movement
		}
	}
	private idle() {
		if (this.idleFrame || this.abort.signal.aborted || this.completeDocument())
			return
		this.idleFrame = requestAnimationFrame(() => {
			this.idleFrame = 0
			if (
				!this.composing &&
				!this.dragging &&
				performance.now() - this.lastInteraction > 150
			) {
				let index = this.blocks.findIndex(block => !block.measured)
				if (index < 0) return
				this.refine(index)
			}
			this.idle()
		})
	}
	private rebuild(first: number, edit?: Replacement) {
		let previous = this.blocks
		let blocks = previous.slice(0, first)
		let last = blocks.at(-1)
		let start = last?.end ?? 0,
			top = last ? last.top + last.height : this.paddingTop
		let shift = edit ? edit.insert.length - (edit.end - edit.start) : 0
		while (start < this.text.length) {
			if (edit && start >= edit.start + edit.insert.length) {
				let match = previous[this.blockAtOffset(start - shift)]
				if (
					match &&
					match.start + shift === start &&
					this.text.slice(start, match.end + shift) === match.text
				) {
					let movement = top - match.top
					for (let block of previous.slice(this.blockAtOffset(match.start)))
						blocks.push({
							...block,
							start: block.start + shift,
							end: block.end + shift,
							top: block.top + movement,
						})
					let final = blocks.at(-1)
					top = final ? final.top + final.height : top
					break
				}
			}
			let block = this.estimatedBlock(start, top)
			blocks.push(block)
			start = block.end
			top += block.height
		}
		if (!blocks.length) blocks.push(this.estimatedBlock(0, this.paddingTop))
		this.blocks = blocks
		this.spacer.style.height = top + this.paddingBottom + "px"
	}
	private blockAtOffset(offset: number) {
		let low = 0,
			high = this.blocks.length - 1
		while (low < high) {
			let middle = (low + high) >>> 1
			if ((this.blocks[middle]?.end ?? 0) <= offset) low = middle + 1
			else high = middle
		}
		return low
	}
	private blockAtHeight(top: number) {
		let low = 0,
			high = this.blocks.length - 1
		while (low < high) {
			let middle = (low + high) >>> 1
			let block = this.blocks[middle]
			if (block && block.top + block.height <= top) low = middle + 1
			else high = middle
		}
		return low
	}
	private offsetAtHeight(top: number) {
		return this.blocks[this.blockAtHeight(top)]?.start ?? 0
	}
	private topAt(offset: number) {
		return this.blocks[this.blockAtOffset(offset)]?.top ?? 0
	}
	private reveal(offset: number, selectionMoved = false) {
		if (selectionMoved) this.selectionDocument = false
		let index = this.blockAtOffset(offset)
		this.refine(index)
		let block = this.completeDocument()
			? { start: 0, text: this.value, top: this.paddingTop }
			: this.blocks[index]
		let top = block?.top ?? this.paddingTop
		if (block) {
			let prefix = this.directionMark(block.start)
			this.measure.textContent = prefix + block.text + "\u200b"
			let node = this.measure.firstChild
			if (node) {
				let range = document.createRange()
				let relative = Math.max(
					0,
					Math.min(block.text.length, offset - block.start),
				)
				range.setStart(node, prefix.length + relative)
				range.setEnd(node, prefix.length + relative + 1)
				top +=
					range.getBoundingClientRect().top -
					this.measure.getBoundingClientRect().top
			}
		}
		if (
			top < this.scrollElement.scrollTop ||
			top > this.scrollElement.scrollTop + this.scrollElement.clientHeight
		)
			this.scrollElement.scrollTop = Math.max(
				0,
				top - this.scrollElement.clientHeight / 3,
			)
		this.paint(selectionMoved)
	}
	private schedule() {
		if (this.frame || this.composing) return
		this.frame = requestAnimationFrame(() => {
			this.frame = 0
			this.readSelection()
			this.paint()
		})
	}
	private completeDocument() {
		return (
			this.accessibleDocument ||
			this.denseDocument ||
			this.coarsePointer.matches ||
			this.pointerDocument ||
			this.navigationDocument ||
			this.selectionDocument ||
			this.text.length <= 8192
		)
	}
	private paint(selectionMoved = false) {
		if (this.composing || this.dragging) return
		let selected = this.selection.start !== this.selection.end
		if (!selected) this.selectionDocument = false
		else if (selectionMoved) {
			let first = Math.max(
				0,
				this.blockAtHeight(this.scrollElement.scrollTop) - 1,
			)
			let last = Math.min(
				this.blocks.length - 1,
				this.blockAtHeight(
					this.scrollElement.scrollTop + this.scrollElement.clientHeight,
				) + 1,
			)
			this.selectionDocument =
				this.selection.start < (this.blocks[first]?.start ?? 0) ||
				this.selection.end > (this.blocks[last]?.end ?? this.text.length)
		} else if (
			this.selection.start < this.window.start ||
			this.selection.end > this.window.end
		)
			this.selectionDocument = true
		let full = this.completeDocument()
		let scrollTop = this.scrollElement.scrollTop
		let viewportHeight = this.scrollElement.clientHeight
		let first = full ? 0 : Math.max(0, this.blockAtHeight(scrollTop) - 1)
		let last = full
			? this.blocks.length - 1
			: Math.min(
					this.blocks.length - 1,
					this.blockAtHeight(scrollTop + viewportHeight) + 1,
				)
		if (!full) {
			let anchor = this.offsetAtHeight(scrollTop)
			let before = this.topAt(anchor)
			let refined = false
			for (let index = first; index <= last; index++) {
				if (this.blocks[index]?.measured) continue
				this.refine(index, false)
				if (this.denseDocument) {
					this.paint()
					return
				}
				refined = true
			}
			if (refined) {
				let final = this.blocks.at(-1)
				if (final)
					this.spacer.style.height =
						final.top + final.height + this.paddingBottom + "px"
				let movement = this.topAt(anchor) - before
				if (movement) this.scrollElement.scrollTop = scrollTop + movement
			}
		}
		let beginning = this.blocks[first],
			ending = this.blocks[last]
		if (!beginning || !ending) return
		this.window = {
			start: beginning.start,
			end: ending.end,
			top: beginning.top,
			height: ending.top + ending.height - beginning.top,
		}
		if (
			selectionMoved &&
			!full &&
			selected &&
			(this.selection.start < this.window.start ||
				this.selection.end > this.window.end)
		) {
			this.selectionDocument = true
			this.paint()
			return
		}
		let fragment = this.text.slice(this.window.start, this.window.end)
		this.prefix = this.directionMark(this.window.start)
		this.window.direction =
			this.prefix === "\u200f" ? "rtl" : this.prefix ? "ltr" : undefined
		if (
			fragment !== this.fragment ||
			this.fragmentLayout !== this.layoutKey + this.prefix ||
			!this.fragmentHeight
		) {
			this.measure.textContent = this.prefix + fragment + "\u200b"
			this.fragmentHeight = this.measure.getBoundingClientRect().height
			this.fragmentLayout = this.layoutKey + this.prefix
		}
		this.window.height = this.fragmentHeight
		if (full)
			this.spacer.style.height =
				this.fragmentHeight + this.paddingTop + this.paddingBottom + "px"
		if (this.element.value !== this.prefix + fragment)
			this.element.value = this.prefix + fragment
		this.fragment = fragment
		this.element.style.top = this.window.top + "px"
		this.element.style.height = this.window.height + "px"
		this.element.style.paddingTop = "0px"
		this.element.style.paddingBottom = "0px"
		this.element.scrollTop = 0
		this.selection.start = Math.max(
			0,
			Math.min(this.text.length, this.selection.start),
		)
		this.selection.end = Math.max(
			this.selection.start,
			Math.min(this.text.length, this.selection.end),
		)
		let start = Math.max(
			0,
			Math.min(fragment.length, this.selection.start - this.window.start),
		)
		let end = Math.max(
			0,
			Math.min(fragment.length, this.selection.end - this.window.start),
		)
		this.paintedSelection = { start, end }
		if (
			this.element.selectionStart !== this.prefix.length + start ||
			this.element.selectionEnd !== this.prefix.length + end ||
			this.element.selectionDirection !== (this.selection.direction ?? "none")
		)
			this.element.setSelectionRange(
				this.prefix.length + start,
				this.prefix.length + end,
				this.selection.direction,
			)
		if (this.notify) this.options.painted(this.window)
		this.idle()
	}
	private readSelection(force = false) {
		let start = Math.max(0, this.element.selectionStart - this.prefix.length),
			end = Math.max(0, this.element.selectionEnd - this.prefix.length)
		if (
			!force &&
			start === this.paintedSelection.start &&
			end === this.paintedSelection.end
		)
			return
		this.selection = {
			start:
				!force &&
				start === this.paintedSelection.start &&
				this.selection.start < this.window.start
					? this.selection.start
					: this.window.start + start,
			end:
				!force &&
				end === this.paintedSelection.end &&
				this.selection.end > this.window.end
					? this.selection.end
					: this.window.start + end,
			direction: this.element.selectionDirection,
		}
		this.paintedSelection = { start, end }
	}
	private beforeInput(event: Event) {
		if (
			event.target !== this.element ||
			event.defaultPrevented ||
			!(event instanceof InputEvent)
		)
			return
		this.readSelection()
		if (this.element.selectionStart < this.prefix.length)
			this.element.setSelectionRange(
				this.prefix.length,
				Math.max(this.prefix.length, this.element.selectionEnd),
				this.element.selectionDirection,
			)
		this.intent = {
			start: Math.max(0, this.element.selectionStart - this.prefix.length),
			end: Math.max(0, this.element.selectionEnd - this.prefix.length),
			type: event.inputType,
		}
		if (this.element.readOnly) {
			event.preventDefault()
			return
		}
		if (this.composing) return
		let boundaryDelete =
			(event.inputType === "deleteContentBackward" &&
				this.selection.start === this.window.start &&
				this.selection.start > 0) ||
			(event.inputType === "deleteContentForward" &&
				this.selection.end === this.window.end &&
				this.selection.end < this.text.length)
		if (
			!boundaryDelete &&
			this.selection.start >= this.window.start &&
			this.selection.end <= this.window.end
		)
			return
		let insert = event.inputType.startsWith("delete")
			? ""
			: event.inputType === "insertLineBreak"
				? "\n"
				: event.data
		if (insert === null) {
			event.preventDefault()
			this.reveal(this.selection.end)
			return
		}
		if (
			this.selection.start === this.selection.end &&
			event.inputType.startsWith("delete")
		) {
			if (event.inputType === "deleteContentBackward")
				this.selection.start = this.text.previousGrapheme(this.selection.start)
			else if (event.inputType === "deleteContentForward")
				this.selection.end = this.text.nextGrapheme(this.selection.end)
			else {
				event.preventDefault()
				this.reveal(this.selection.end)
				return
			}
		}
		event.preventDefault()
		this.replaceSelection(insert)
	}
	private replaceSelection(insert: string) {
		if (
			this.element.readOnly ||
			(!insert && this.selection.start === this.selection.end)
		)
			return
		let edit = { start: this.selection.start, end: this.selection.end, insert }
		this.apply(edit)
		this.nativeAcknowledgement = true
		let caret = edit.start + insert.length
		this.selection = { start: caret, end: caret }
		this.pending.push(edit)
		this.reveal(caret)
		this.options.edited?.([edit])
		this.element.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertText",
				data: insert,
			}),
		)
	}
	private keydown(event: KeyboardEvent) {
		if (event.target !== this.element || event.defaultPrevented) return
		this.readSelection()
		if (event.key === "Process" || event.isComposing) {
			if (!this.composing) this.reveal(this.selection.end)
			return
		}
		if (
			(event.metaKey || (event.ctrlKey && !/Mac/i.test(navigator.platform))) &&
			event.key.toLowerCase() === "a"
		) {
			event.preventDefault()
			this.selection = { start: 0, end: this.text.length }
			this.selectionDocument = true
			this.paint()
			return
		}
		let focus =
			this.selection.direction === "backward"
				? this.selection.start
				: this.selection.end
		let documentStart =
			(event.ctrlKey && event.key === "Home") ||
			(event.metaKey && event.key === "ArrowUp")
		let documentEnd =
			(event.ctrlKey && event.key === "End") ||
			(event.metaKey && event.key === "ArrowDown")
		if (documentStart || documentEnd) {
			event.preventDefault()
			this.moveSelection(documentStart ? 0 : this.text.length, event.shiftKey)
			return
		}
		if (focus < this.window.start || focus > this.window.end) this.reveal(focus)
		if (
			["ArrowLeft", "ArrowRight"].includes(event.key) &&
			(focus <= this.window.start || focus >= this.window.end) &&
			this.text.length > 8192 &&
			!this.accessibleDocument
		) {
			this.navigationDocument = true
			this.paint()
			return
		}
		let boundaryLeft =
			event.key === "ArrowLeft" && focus <= this.window.start && focus > 0
		let boundaryRight =
			event.key === "ArrowRight" &&
			focus >= this.window.end &&
			focus < this.text.length
		if (
			event.shiftKey &&
			!event.altKey &&
			!event.metaKey &&
			!event.ctrlKey &&
			(boundaryLeft || boundaryRight)
		) {
			event.preventDefault()
			this.moveSelection(
				boundaryLeft
					? this.text.previousGrapheme(focus)
					: this.text.nextGrapheme(focus),
				true,
			)
			return
		}
		if (
			event.shiftKey ||
			event.metaKey ||
			event.ctrlKey ||
			this.selection.start !== this.selection.end
		)
			return
		let offset = this.selection.end
		if (
			event.key === "ArrowLeft" &&
			offset <= this.window.start &&
			offset > 0
		) {
			event.preventDefault()
			this.setSelectionRange(
				this.text.previousGrapheme(offset),
				this.text.previousGrapheme(offset),
			)
		}
		if (
			event.key === "ArrowRight" &&
			offset >= this.window.end &&
			offset < this.text.length
		) {
			event.preventDefault()
			this.setSelectionRange(
				this.text.nextGrapheme(offset),
				this.text.nextGrapheme(offset),
			)
		}
	}
	private moveSelection(focus: number, extend: boolean) {
		if (!extend) {
			this.setSelectionRange(focus, focus)
			return
		}
		let anchor =
			this.selection.direction === "backward"
				? this.selection.end
				: this.selection.start
		this.setSelectionRange(
			Math.min(anchor, focus),
			Math.max(anchor, focus),
			focus < anchor ? "backward" : "forward",
		)
	}
	private copy(event: ClipboardEvent, cut: boolean) {
		if (
			event.target !== this.element ||
			event.defaultPrevented ||
			!event.clipboardData
		)
			return
		this.readSelection()
		event.clipboardData.setData(
			"text/plain",
			this.text.slice(this.selection.start, this.selection.end),
		)
		event.preventDefault()
		if (cut && !this.element.readOnly) this.replaceSelection("")
	}
	private paste(event: ClipboardEvent) {
		if (
			event.target !== this.element ||
			event.defaultPrevented ||
			!event.clipboardData ||
			this.element.readOnly
		)
			return
		event.preventDefault()
		this.readSelection()
		this.replaceSelection(event.clipboardData.getData("text/plain"))
	}
}
