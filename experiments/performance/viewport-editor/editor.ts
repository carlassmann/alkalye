export interface EditorSample {
	kind: string
	handler: number
	frame: number
	characters: number
}
interface Paragraph {
	start: number
	end: number
	row: number
	rows: number
}
export class ViewportEditor {
	readonly element: HTMLTextAreaElement
	readonly viewport: HTMLDivElement
	readonly samples: EditorSample[] = []
	private source: string
	private paragraphs: Paragraph[] = []
	private rows = 0
	private start = 0
	private end = 0
	private first = 0
	private rendered = ""
	private selection = { start: 0, end: 0 }
	private paintedSelection = { start: 0, end: 0 }
	private composing = false
	private frame = 0
	private spacer: HTMLDivElement
	private inputAt = 0
	constructor(
		host: HTMLElement,
		source: string,
		readonly bounded: boolean,
	) {
		this.source = source
		this.viewport = document.createElement("div")
		this.viewport.className = "viewport"
		this.viewport.dataset.viewportEditor = ""
		this.spacer = document.createElement("div")
		this.spacer.className = "spacer"
		this.element = document.createElement("textarea")
		this.element.setAttribute("aria-label", "Experimental document editor")
		this.element.spellcheck = false
		this.element.wrap = "soft"
		this.viewport.append(this.spacer, this.element)
		host.append(this.viewport)
		this.index()
		this.paint(true)
		this.element.addEventListener("beforeinput", () => {
			this.inputAt = performance.now()
			if (this.selection.end < this.start || this.selection.start > this.end)
				this.select(this.selection.start, this.selection.end)
		})
		this.element.addEventListener("input", event => this.input(event))
		if (!bounded)
			this.element.addEventListener("scroll", () =>
				this.samples.push({
					kind: "scroll",
					handler: 0,
					frame: 0,
					characters: 0,
				}),
			)
		this.element.addEventListener("select", () => {
			if (document.activeElement !== this.element) return
			if (
				this.element.selectionStart === this.paintedSelection.start &&
				this.element.selectionEnd === this.paintedSelection.end
			)
				return
			this.selection = {
				start: this.start + this.element.selectionStart,
				end: this.start + this.element.selectionEnd,
			}
		})
		this.element.addEventListener("compositionstart", () => {
			this.composing = true
		})
		this.element.addEventListener("compositionend", () => {
			this.composing = false
			this.paint(true)
		})
		this.viewport.addEventListener("scroll", () => {
			if (this.frame || this.composing) return
			this.frame = requestAnimationFrame(() => {
				this.frame = 0
				let start = performance.now()
				this.paint(false)
				this.samples.push({
					kind: "scroll",
					handler: performance.now() - start,
					frame: 0,
					characters: this.element.value.length,
				})
			})
		})
	}
	get value() {
		return this.source
	}
	get range() {
		return { ...this.selection }
	}
	get window() {
		return { start: this.start, end: this.end, rows: this.rows }
	}
	select(start: number, end = start) {
		this.selection = { start, end }
		let row = this.rowAt(end)
		this.viewport.scrollTop = Math.max(0, (row - 8) * 24)
		this.paint(true)
		this.element.focus({ preventScroll: true })
		this.element.setSelectionRange(
			Math.max(0, start - this.start),
			Math.max(0, end - this.start),
		)
	}
	private index() {
		let start = 0,
			row = 0
		this.paragraphs = this.source.split("\n").map(text => {
			let rows = Math.max(1, Math.ceil(text.length / 72))
			let paragraph = { start, end: start + text.length, row, rows }
			start += text.length + 1
			row += rows
			return paragraph
		})
		this.rows = row
		this.spacer.style.height = this.bounded ? `${(row + 1) * 24}px` : "0px"
	}
	private paragraphAt(value: number, field: "row" | "start") {
		let low = 0,
			high = this.paragraphs.length
		while (low < high) {
			let middle = (low + high) >>> 1
			if ((this.paragraphs[middle]?.[field] ?? Infinity) <= value)
				low = middle + 1
			else high = middle
		}
		return this.paragraphs[Math.max(0, low - 1)]
	}
	private offsetAt(row: number) {
		let paragraph = this.paragraphAt(row, "row")
		return paragraph
			? Math.min(paragraph.end, paragraph.start + (row - paragraph.row) * 72)
			: 0
	}
	private rowAt(offset: number) {
		let paragraph = this.paragraphAt(offset, "start")
		return paragraph
			? paragraph.row + Math.floor((offset - paragraph.start) / 72)
			: 0
	}
	private paint(force: boolean) {
		if (this.composing) return
		let first = this.bounded
			? Math.max(0, Math.floor(this.viewport.scrollTop / 24) - 8)
			: 0
		if (!force && first === this.first) return
		this.first = first
		this.start = this.offsetAt(first)
		this.end = this.bounded
			? this.offsetAt(Math.min(this.rows, first + 48))
			: this.source.length
		if (first + 48 >= this.rows) this.end = this.source.length
		this.rendered = this.source.slice(this.start, this.end)
		this.element.value = this.rendered
		this.element.style.top = `${first * 24}px`
		this.element.style.overflow = this.bounded ? "hidden" : "auto"
		this.element.style.height = this.bounded ? "1200px" : "600px"
		let start = Math.max(
			0,
			Math.min(this.rendered.length, this.selection.start - this.start),
		)
		let end = Math.max(
			start,
			Math.min(this.rendered.length, this.selection.end - this.start),
		)
		this.paintedSelection = { start, end }
		this.element.setSelectionRange(start, end)
	}
	private input(event: Event) {
		let start = this.inputAt || performance.now()
		let next = this.element.value
		this.source =
			this.source.slice(0, this.start) + next + this.source.slice(this.end)
		this.selection = {
			start: this.start + this.element.selectionStart,
			end: this.start + this.element.selectionEnd,
		}
		this.rendered = next
		this.end = this.start + next.length
		this.index()
		if (!this.composing) this.paint(true)
		let sample = {
			kind: event instanceof InputEvent ? event.inputType : "input",
			handler: performance.now() - start,
			frame: 0,
			characters: this.element.value.length,
		}
		this.samples.push(sample)
		requestAnimationFrame(() => {
			sample.frame = performance.now() - start
		})
	}
}
