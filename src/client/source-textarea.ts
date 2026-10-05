import type { DocumentLink } from "../shared/model"
import {
	applyViewEdit,
	identity,
	project,
	sameProjection,
	toSource,
	toView,
} from "../shared/projection"
import type { Projection } from "../shared/projection"

export type ProjectionMode = "project" | "raw" | "hold"
export interface SourceTextareaOptions {
	documents(): readonly DocumentLink[]
	mode(): ProjectionMode
	caretTop(): number | undefined
	painted(): void
}
type Direction = "forward" | "backward" | "none"

// The native textarea shows a projection with inactive links collapsed. Every
// offset and value read or written here is in Markdown source coordinates.
export class SourceTextarea {
	readonly element: HTMLTextAreaElement
	private options: SourceTextareaOptions
	private current: Projection

	constructor(
		element: HTMLTextAreaElement,
		source: string,
		options: SourceTextareaOptions,
	) {
		this.element = element
		this.options = options
		this.current = identity(source)
		element.value = source
	}
	get projection() {
		return this.current
	}
	get value() {
		return this.current.source
	}
	set value(source: string) {
		this.render(source, { start: source.length, end: source.length })
	}
	get selectionStart() {
		return toSource(this.current, this.element.selectionStart, "start")
	}
	get selectionEnd() {
		if (this.element.selectionStart === this.element.selectionEnd)
			return this.selectionStart
		return Math.max(
			this.selectionStart,
			toSource(this.current, this.element.selectionEnd, "end"),
		)
	}
	get selectionDirection() {
		return this.element.selectionDirection
	}
	get readOnly() {
		return this.element.readOnly
	}
	focus() {
		this.element.focus()
	}
	dispatchEvent(event: Event) {
		return this.element.dispatchEvent(event)
	}
	toView(offset: number) {
		return toView(this.current, offset)
	}
	toSource(offset: number, bias: "start" | "end" = "start") {
		return toSource(this.current, offset, bias)
	}
	setSelectionRange(start: number, end: number, direction?: Direction) {
		this.render(this.current.source, { start, end, direction })
	}
	setRangeText(
		text: string,
		start = this.selectionStart,
		end = this.selectionEnd,
		mode: SelectionMode = "preserve",
	) {
		let selection = { start: this.selectionStart, end: this.selectionEnd }
		let source =
			this.current.source.slice(0, start) +
			text +
			this.current.source.slice(end)
		let next = start + text.length
		if (mode === "select") selection = { start, end: next }
		else if (mode === "start") selection = { start, end: start }
		else if (mode === "end") selection = { start: next, end: next }
		else {
			let shift = text.length - (end - start)
			let adjust = (offset: number) =>
				offset >= end ? offset + shift : offset > start ? start : offset
			selection = {
				start: adjust(selection.start),
				end: adjust(selection.end),
			}
		}
		this.render(source, selection)
	}
	replace(source: string, start: number, end = start) {
		this.render(source, { start, end })
	}
	// Absorbs a native edit, which only the browser has applied so far.
	input() {
		let previous = this.current,
			view = this.element.value
		let next = applyViewEdit(previous, view, this.element.selectionEnd)
		if (next.text === view) {
			this.current = next
			return next.source
		}
		let tail = view.length - this.element.selectionEnd
		let caret =
			next.source.length -
			previous.source.length +
			toSource(previous, previous.text.length - tail, "end")
		this.render(next.source, { start: caret, end: caret })
		return next.source
	}
	// Reprojects when the selection moved to other tokens or document titles
	// changed. Returns whether the textarea was rewritten.
	sync() {
		if (this.options.mode() === "hold") return false
		let selection = {
			start: this.selectionStart,
			end: this.selectionEnd,
			direction: this.element.selectionDirection,
		}
		let next = this.projectionFor(this.current.source, selection)
		if (sameProjection(next, this.current)) return false
		this.apply(next, selection)
		return true
	}
	private render(
		source: string,
		selection: { start: number; end: number; direction?: Direction },
	) {
		let length = source.length
		let bounded = {
			start: Math.max(0, Math.min(length, selection.start)),
			end: Math.max(0, Math.min(length, selection.end)),
			direction: selection.direction,
		}
		this.apply(this.projectionFor(source, bounded), bounded)
	}
	private projectionFor(
		source: string,
		active: { start: number; end: number },
	) {
		if (this.options.mode() === "raw") return identity(source)
		return project(source, {
			active,
			documents: this.options.documents(),
			iconSpace: true,
		})
	}
	// Rewriting the value collapses or expands text above the caret, so the
	// caret's vertical position in the content is held steady.
	private apply(
		next: Projection,
		selection: { start: number; end: number; direction?: Direction },
	) {
		let element = this.element
		let rewrite = element.value !== next.text
		let scroll = element.scrollTop
		let before = rewrite ? this.options.caretTop() : undefined
		this.current = next
		if (rewrite) element.value = next.text
		this.options.painted()
		element.setSelectionRange(
			toView(next, selection.start),
			toView(next, selection.end),
			selection.direction,
		)
		if (!rewrite) return
		let after = this.options.caretTop()
		element.scrollTop =
			scroll +
			(before === undefined || after === undefined ? 0 : after - before)
	}
}
