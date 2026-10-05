import { frontmatterBlock } from "./markdown"

// Preview text is the source with Markdown syntax removed, so its characters
// appear in the source in order. Aligning the two lets a selection in the
// preview anchor a comment in the source, and a comment's source range
// highlight its rendered text, as the original's preview text map did.

export interface TextContext {
	contextBefore: string
	contextAfter: string
	occurrence: number
}

let reach = 2000
let run = 4

export function alignPreview(source: string, rendered: string) {
	let header = frontmatterBlock(source)
	let cursor = header ? header[0].length : 0
	let positions = new Array<number>(rendered.length).fill(-1)
	for (let index = 0; index < rendered.length; index++) {
		let found = find(source, rendered, index, cursor)
		if (found < 0) continue
		positions[index] = found
		cursor = found + 1
	}
	return positions
}

function find(source: string, rendered: string, index: number, from: number) {
	let length = Math.min(run, rendered.length - index)
	let limit = Math.min(source.length - length, from + reach)
	for (let start = from; start <= limit; start++)
		if (matches(source, start, rendered, index, length)) return start
	// Text that is not in the source, like a resolved wiki link title, must not
	// pull the alignment far ahead.
	let near = Math.min(source.length - 1, from + 8)
	for (let start = from; start <= near; start++)
		if (same(source[start], rendered[index])) return start
	return -1
}

function matches(
	source: string,
	start: number,
	rendered: string,
	index: number,
	length: number,
) {
	for (let offset = 0; offset < length; offset++)
		if (!same(source[start + offset], rendered[index + offset])) return false
	return true
}

function same(a: string | undefined, b: string | undefined) {
	if (a === undefined || b === undefined) return false
	return a === b || (/\s/.test(a) && /\s/.test(b))
}

export function sourceRange(
	source: string,
	rendered: string,
	from: number,
	to: number,
	positions = alignPreview(source, rendered),
) {
	let mapped = positions.slice(from, to).filter(position => position >= 0)
	let first = mapped[0],
		last = mapped[mapped.length - 1]
	if (first !== undefined && last !== undefined && last >= first)
		return { start: first, end: last + 1 }
	let text = rendered.slice(from, to).trim()
	let start = bestOccurrence(source, text, {
		contextBefore: rendered.slice(Math.max(0, from - 80), from),
		contextAfter: rendered.slice(to, to + 80),
		occurrence: countOccurrences(rendered.slice(0, from), text),
	})
	return start < 0 ? undefined : { start, end: start + text.length }
}

export function renderedRange(
	positions: readonly number[],
	start: number,
	end: number,
) {
	let from = -1,
		to = -1
	for (let [index, position] of positions.entries())
		if (position >= start && position < end) {
			if (from < 0) from = index
			to = index + 1
		}
	return from < 0 ? undefined : { from, to }
}

export function countOccurrences(content: string, text: string) {
	if (!text) return 0
	let count = 0
	for (
		let index = content.indexOf(text);
		index >= 0;
		index = content.indexOf(text, index + text.length)
	)
		count++
	return count
}

// The occurrence whose surroundings best match the selection's, else the
// occurrence with the same index.
export function bestOccurrence(
	content: string,
	text: string,
	context: TextContext,
) {
	if (!text) return -1
	let starts: number[] = []
	for (
		let index = content.indexOf(text);
		index >= 0;
		index = content.indexOf(text, index + text.length)
	)
		starts.push(index)
	if (!starts.length) return -1
	let best = -1,
		bestScore = 0
	for (let start of starts) {
		let score =
			overlap(content.slice(0, start), context.contextBefore, true) +
			overlap(content.slice(start + text.length), context.contextAfter, false)
		if (score > bestScore) {
			bestScore = score
			best = start
		}
	}
	return best >= 0 ? best : (starts[context.occurrence] ?? starts[0] ?? -1)
}

function overlap(content: string, context: string, before: boolean) {
	if (!context.trim()) return 0
	for (
		let length = Math.min(content.length, context.length);
		length > 0;
		length--
	)
		if (
			before
				? content.slice(-length) === context.slice(-length)
				: content.slice(0, length) === context.slice(0, length)
		)
			return length
	return 0
}
