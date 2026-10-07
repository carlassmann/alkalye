import { TextIndex } from "./text-index"
import type { Replacement } from "./text-index"
export interface EditorSample {
	kind: string
	handler: number
	frame: number
	characters: number
}
export class ViewportEditor {
	readonly element: HTMLTextAreaElement
	readonly viewport: HTMLDivElement
	readonly samples: EditorSample[] = []
	private text: TextIndex
	private rows = 0
	private start = 0
	private end = 0
	private first = 0
	private rendered = ""
	private selection = { start: 0, end: 0 }
	private paintedSelection = { start: 0, end: 0 }
	private composing = false
	private deferredExternal: Replacement[] = []
	private deferredSource: string | undefined
	private frame = 0
	private spacer: HTMLDivElement
	private inputAt = 0
	private inputSelection:
		{ start: number; end: number; type: string } | undefined
	constructor(
		host: HTMLElement,
		source: string,
		readonly bounded: boolean,
		readonly options: { onEdit?(edit: Replacement): void } = {},
	) {
		this.text = new TextIndex(source)
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
		this.element.addEventListener("beforeinput", event => {
			this.inputAt = performance.now()
			this.inputSelection =
				event instanceof InputEvent
					? {
							start: this.element.selectionStart,
							end: this.element.selectionEnd,
							type: event.inputType,
						}
					: undefined
			if (this.element.readOnly) {
				event.preventDefault()
				return
			}
			let outside =
				this.selection.start < this.start || this.selection.end > this.end
			if (!outside) return
			if (event instanceof InputEvent && !this.composing) {
				if (
					event.inputType.startsWith("delete") &&
					this.selection.start === this.selection.end &&
					!["deleteContentBackward", "deleteContentForward"].includes(
						event.inputType,
					)
				) {
					event.preventDefault()
					this.select(this.selection.start)
					return
				}
				let insert = event.inputType.startsWith("delete")
					? ""
					: event.inputType === "insertLineBreak"
						? "\n"
						: event.data
				if (insert !== null) {
					if (
						event.inputType.startsWith("delete") &&
						this.selection.start === this.selection.end
					) {
						if (event.inputType.endsWith("Backward"))
							this.selection.start = this.text.previousGrapheme(
								this.selection.start,
							)
						else this.selection.end = this.text.nextGrapheme(this.selection.end)
					}
					event.preventDefault()
					this.replaceSelection(insert)
					return
				}
			}
			event.preventDefault()
			this.select(this.selection.start, this.selection.end)
		})
		this.element.addEventListener("keydown", event => this.keydown(event))
		this.element.addEventListener("copy", event => {
			if (this.selection.start === this.selection.end) return
			event.preventDefault()
			event.clipboardData?.setData(
				"text/plain",
				this.text.slice(this.selection.start, this.selection.end),
			)
		})
		this.element.addEventListener("cut", event => {
			if (this.selection.start === this.selection.end) return
			event.preventDefault()
			event.clipboardData?.setData(
				"text/plain",
				this.text.slice(this.selection.start, this.selection.end),
			)
			if (!this.element.readOnly) this.replaceSelection("")
		})
		this.element.addEventListener("paste", event => {
			if (this.element.readOnly) {
				event.preventDefault()
				return
			}
			let insert = event.clipboardData?.getData("text/plain")
			if (insert === undefined) return
			event.preventDefault()
			this.replaceSelection(insert)
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
		this.element.addEventListener("select", () =>
			this.readNativeSelection(false),
		)
		this.element.addEventListener("selectionchange", () =>
			this.readNativeSelection(false),
		)
		this.element.addEventListener("pointerup", () =>
			this.readNativeSelection(true),
		)
		this.element.addEventListener("keyup", event => {
			if (
				!event.ctrlKey &&
				!event.metaKey &&
				!["Control", "Meta"].includes(event.key)
			)
				this.readNativeSelection(true)
		})
		this.element.addEventListener("compositionstart", () => {
			this.prepareComposition()
			this.composing = true
		})
		this.element.addEventListener("compositionend", () => {
			this.composing = false
			let deferred = this.deferredExternal
			this.deferredExternal = []
			for (let edit of deferred) this.applyExternal(edit)
			if (this.deferredSource !== undefined) {
				let source = this.deferredSource
				this.deferredSource = undefined
				this.updateSource(source)
			}
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
	get length() {
		return this.text.length
	}
	get isComposing() {
		return this.composing
	}
	get value() {
		return this.text.value
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
	private readNativeSelection(force: boolean) {
		if (document.activeElement !== this.element) return
		if (
			!force &&
			(this.selection.start < this.start || this.selection.end > this.end) &&
			this.element.selectionStart === this.paintedSelection.start &&
			this.element.selectionEnd === this.paintedSelection.end
		)
			return
		this.selection = {
			start: this.start + this.element.selectionStart,
			end: this.start + this.element.selectionEnd,
		}
	}
	private prepareComposition() {
		if (this.selection.start >= this.start && this.selection.end <= this.end)
			return
		if (this.selection.start !== this.selection.end && !this.element.readOnly)
			this.replaceSelection("")
		else this.select(this.selection.start, this.selection.end)
	}
	private rebaseDeferred(edit: Replacement) {
		let delta = edit.insert.length - (edit.end - edit.start)
		function moved(offset: number) {
			return offset < edit.start
				? offset
				: offset >= edit.end
					? offset + delta
					: edit.start + edit.insert.length
		}
		this.deferredExternal = this.deferredExternal.map(remote => ({
			...remote,
			start: moved(remote.start),
			end: moved(remote.end),
		}))
	}
	private replaceSelection(insert: string) {
		if (this.element.readOnly) return
		let edit = { ...this.selection, insert }
		if (edit.start === edit.end && !edit.insert) return
		this.rebaseDeferred(edit)
		this.text.replace(edit)
		this.selection = {
			start: edit.start + insert.length,
			end: edit.start + insert.length,
		}
		this.index()
		this.select(this.selection.start)
		this.options.onEdit?.(edit)
	}
	private keydown(event: KeyboardEvent) {
		if (this.composing) return
		if (event.key === "Process" || event.keyCode === 229 || event.isComposing) {
			this.prepareComposition()
			return
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
			event.preventDefault()
			this.selection = { start: 0, end: this.text.length }
			this.paint(true)
			return
		}
		if (
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			event.shiftKey ||
			this.selection.start !== this.selection.end
		)
			return
		let head = this.selection.end,
			row = this.rowAt(head)
		let offset: number | undefined
		if (
			event.key === "ArrowLeft" &&
			this.element.selectionStart === 0 &&
			head > 0
		)
			offset = this.text.previousGrapheme(head)
		if (
			event.key === "ArrowRight" &&
			this.element.selectionEnd === this.rendered.length &&
			head < this.text.length
		)
			offset = this.text.nextGrapheme(head)
		if (
			(event.key === "ArrowDown" && row >= this.first + 46) ||
			(event.key === "ArrowUp" && row <= this.first + 1)
		) {
			let next = Math.max(
				0,
				Math.min(this.rows - 1, row + (event.key === "ArrowDown" ? 1 : -1)),
			)
			let end =
				next + 1 >= this.rows ? this.text.length : this.offsetAt(next + 1)
			if (this.text.slice(end - 1, end) === "\n") end--
			offset = Math.min(end, this.offsetAt(next) + head - this.offsetAt(row))
		}
		if (offset !== undefined) {
			event.preventDefault()
			this.select(offset)
		}
	}
	applyExternal(edit: Replacement) {
		if (this.composing) {
			this.deferredExternal.push(edit)
			return
		}
		this.text.replace(edit)
		function moved(offset: number) {
			return offset <= edit.start
				? offset
				: offset >= edit.end
					? offset + edit.insert.length - (edit.end - edit.start)
					: edit.start + edit.insert.length
		}
		this.selection = {
			start: moved(this.selection.start),
			end: moved(this.selection.end),
		}
		this.index()
		this.paint(true)
	}
	updateSource(source: string) {
		if (this.composing) {
			this.deferredSource = source
			this.deferredExternal = []
			return
		}
		this.text = new TextIndex(source)
		this.selection = {
			start: Math.min(this.selection.start, this.text.length),
			end: Math.min(this.selection.end, this.text.length),
		}
		this.index()
		this.paint(true)
	}
	private index() {
		this.rows = this.text.rows
		this.spacer.style.height = this.bounded
			? `${(this.rows + 1) * 24}px`
			: "0px"
	}
	private offsetAt(row: number) {
		return this.text.offsetAtRow(row)
	}
	private rowAt(offset: number) {
		return this.text.rowAt(offset)
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
			: this.text.length
		if (first + 48 >= this.rows) this.end = this.text.length
		this.rendered = this.text.slice(this.start, this.end)
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
		if (this.element.readOnly) {
			this.paint(true)
			return
		}
		let start = this.inputAt || performance.now()
		let next = this.element.value
		let from = 0,
			oldEnd = this.rendered.length,
			newEnd = next.length
		let hint = this.inputSelection
		this.inputSelection = undefined
		let hinted = false
		if (hint) {
			let start = hint.start,
				end = hint.end
			if (start === end && next.length < this.rendered.length) {
				if (hint.type.endsWith("Backward"))
					start -= this.rendered.length - next.length
				else end += this.rendered.length - next.length
			}
			let inserted = next.length - (this.rendered.length - (end - start))
			if (
				start >= 0 &&
				end <= this.rendered.length &&
				inserted >= 0 &&
				next.startsWith(this.rendered.slice(0, start)) &&
				next.endsWith(this.rendered.slice(end))
			) {
				from = start
				oldEnd = end
				newEnd = start + inserted
				hinted = true
			}
		}
		if (!hinted) {
			while (
				from < oldEnd &&
				from < newEnd &&
				this.rendered[from] === next[from]
			)
				from++
			while (
				oldEnd > from &&
				newEnd > from &&
				this.rendered[oldEnd - 1] === next[newEnd - 1]
			) {
				oldEnd--
				newEnd--
			}
			if (
				from > 0 &&
				/[\ud800-\udbff]/.test(this.rendered[from - 1] ?? "") &&
				/[\udc00-\udfff]/.test(this.rendered[from] ?? "")
			)
				from--
			if (
				oldEnd < this.rendered.length &&
				/[\ud800-\udbff]/.test(this.rendered[oldEnd - 1] ?? "") &&
				/[\udc00-\udfff]/.test(this.rendered[oldEnd] ?? "")
			) {
				oldEnd++
				newEnd++
			}
		}
		let edit = {
			start: this.start + from,
			end: this.start + oldEnd,
			insert: next.slice(from, newEnd),
		}
		this.rebaseDeferred(edit)
		this.text.replace(edit)
		this.options.onEdit?.(edit)
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
