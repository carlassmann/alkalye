import { nextFence } from "./markdown"
import { project } from "./projection"

interface Range {
	start: number
	end: number
}

let words = new Intl.Segmenter(undefined, { granularity: "word" })

export function expandSelections(
	source: string,
	selections: readonly Range[],
): Range[] {
	let candidates = structuralRanges(source),
		segments = words.segment(source)
	return selections.map(selection => {
		let enclosing = [...candidates, paragraphRange(source, selection)]
		if (selection.start === selection.end) {
			let word = segments.containing(selection.start)
			if (!word?.isWordLike && selection.start > 0)
				word = segments.containing(selection.start - 1)
			if (word?.isWordLike)
				enclosing.push({
					start: word.index,
					end: word.index + word.segment.length,
				})
		}
		return (
			enclosing
				.filter(
					range =>
						range.start <= selection.start &&
						range.end >= selection.end &&
						(range.start < selection.start || range.end > selection.end),
				)
				.sort(
					(a, b) => a.end - a.start - (b.end - b.start) || a.start - b.start,
				)[0] ?? selection
		)
	})
}

function paragraphRange(source: string, selection: Range): Range {
	let start =
		selection.start === 0
			? 0
			: source.lastIndexOf("\n", selection.start - 1) + 1
	let end = source.indexOf("\n", selection.end)
	if (end < 0) end = source.length
	while (start > 0) {
		let previous = start <= 1 ? 0 : source.lastIndexOf("\n", start - 2) + 1
		if (!source.slice(previous, start - 1).trim()) break
		start = previous
	}
	while (end < source.length) {
		let next = source.indexOf("\n", end + 1)
		if (next < 0) next = source.length
		if (!source.slice(end + 1, next).trim()) break
		end = next
	}
	return { start, end }
}

function structuralRanges(source: string): Range[] {
	let ranges: Range[] = [{ start: 0, end: source.length }]
	let links = project(source).links
	let inline: Range[] = [],
		plainStart: number | undefined,
		plainEnd = 0
	function finishPlain() {
		if (plainStart !== undefined)
			ranges.push({ start: plainStart, end: plainEnd })
		plainStart = undefined
	}
	let fence = "",
		fenceStart = 0,
		bodyStart = 0,
		paragraphStart = 0,
		proseStart = 0,
		offset = 0
	for (let line of source.split("\n")) {
		let end = offset + line.length
		let next = nextFence(fence, line)
		if (!fence && next) {
			finishPlain()
			inlineRanges(source.slice(proseStart, offset), proseStart, inline)
			fenceStart = offset
			bodyStart = end + 1
		} else if (fence && !next) {
			proseStart = end + 1
			ranges.push(
				{ start: bodyStart, end: Math.max(bodyStart, offset - 1) },
				{ start: fenceStart, end },
			)
		}
		if (!fence && !next) {
			if (!line.trim()) {
				finishPlain()
				inlineRanges(source.slice(proseStart, offset), proseStart, inline)
				proseStart = end + 1
				if (offset > paragraphStart)
					ranges.push({ start: paragraphStart, end: offset - 1 })
				paragraphStart = end + 1
			} else {
				let prefix = line.match(
					/^\s*(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/,
				)
				if (prefix) {
					finishPlain()
					ranges.push(
						{ start: offset + prefix[0].length, end },
						{ start: offset, end },
					)
				} else if (/^\s{0,3}#{1,6}\s/.test(line)) {
					finishPlain()
					ranges.push({ start: offset, end })
				} else {
					plainStart ??= offset
					plainEnd = end
				}
			}
		}
		fence = next
		offset = end + 1
	}
	finishPlain()
	if (!fence) inlineRanges(source.slice(proseStart), proseStart, inline)
	if (fence)
		ranges.push(
			{ start: bodyStart, end: source.length },
			{ start: fenceStart, end: source.length },
		)
	if (paragraphStart < source.length)
		ranges.push({ start: paragraphStart, end: source.length })
	for (let range of inline) {
		let valid = links.every(
			link =>
				range.end <= link.source.start ||
				range.start >= link.source.end ||
				(range.start <= link.source.start && range.end >= link.source.end) ||
				link.parts.some(
					part =>
						range.start >= part.source &&
						range.end <= part.source + part.length,
				),
		)
		if (valid) ranges.push(range)
	}
	for (let link of links) ranges.push(link.source)
	return ranges
}

function inlineRanges(prose: string, offset: number, ranges: Range[]) {
	let open: { delimiter: string; index: number }[] = []
	for (let index = 0; index < prose.length;) {
		if (prose[index] === "\\") {
			index += 2
			continue
		}
		let delimiter = prose.slice(index).match(/^(?:`+|\*+|_+|~~|==)/)?.[0]
		if (!delimiter) {
			index++
			continue
		}
		if (["*", "_"].includes(delimiter[0] ?? "")) {
			let previous = open.at(-1)?.delimiter
			let length = Math.min(3, delimiter.length)
			if (
				previous &&
				previous[0] === delimiter[0] &&
				previous.length <= delimiter.length &&
				!/\s/.test(prose[index - 1] ?? " ")
			)
				length = previous.length
			delimiter = delimiter.slice(0, length)
		}
		let opened = open.map(entry => entry.delimiter).lastIndexOf(delimiter)
		let start = open[opened]?.index
		if (delimiter[0] === "`") {
			let close = index + delimiter.length
			while (
				(close = prose.indexOf(delimiter, close)) >= 0 &&
				(prose[close - 1] === "`" || prose[close + delimiter.length] === "`")
			)
				close += delimiter.length
			if (close >= 0) {
				ranges.push({
					start: offset + index,
					end: offset + close + delimiter.length,
				})
				index = close + delimiter.length
				continue
			}
		} else if (start !== undefined && !/\s/.test(prose[index - 1] ?? " ")) {
			ranges.push({
				start: offset + start,
				end: offset + index + delimiter.length,
			})
			if (delimiter.length === 3 && ["*", "_"].includes(delimiter[0] ?? ""))
				ranges.push({
					start: offset + start + 1,
					end: offset + index + delimiter.length - 1,
				})
			open.splice(opened)
		} else if (
			!/\s/.test(prose[index + delimiter.length] ?? " ") &&
			!(delimiter[0] === "_" && /\w/.test(prose[index - 1] ?? ""))
		)
			open.push({ delimiter, index })
		index += delimiter.length
	}
}
