import { frontmatterBlock } from "./markdown"

// A presentation is read top to bottom as a sequence of items. Visual items
// are the blocks the audience sees; note items are the presenter's spoken
// lines. Slide indices match `slides()` so presence stays a slide index.

export type PresentationItem =
	| {
			kind: "visual"
			slide: number
			start: number
			end: number
			source: string
	  }
	| { kind: "note"; slide: number; line: number; text: string }

export interface SlideGroup {
	slide: number
	first: number
	items: PresentationItem[]
}

export function presentationItems(source: string): PresentationItem[] {
	let items: PresentationItem[] = []
	let slide = 0
	for (let section of sections(source)) {
		if (!section.some(line => line.text.trim())) continue
		items.push(...sectionItems(section, slide))
		slide++
	}
	return items
}

export function groupBySlide(items: PresentationItem[]): SlideGroup[] {
	let groups: SlideGroup[] = []
	for (let [index, item] of items.entries()) {
		let group = groups[groups.length - 1]
		if (group?.slide === item.slide) group.items.push(item)
		else groups.push({ slide: item.slide, first: index, items: [item] })
	}
	return groups
}

export function slideStart(items: PresentationItem[], slide: number) {
	let visual = items.findIndex(
		item => item.slide === slide && item.kind === "visual",
	)
	return visual >= 0 ? visual : items.findIndex(item => item.slide === slide)
}

export function stepItem(
	items: PresentationItem[],
	index: number | undefined,
	delta: number,
) {
	if (!items.length) return undefined
	if (index === undefined) return 0
	return Math.max(0, Math.min(items.length - 1, index + delta))
}

export function stepSlide(
	items: PresentationItem[],
	index: number | undefined,
	delta: number,
) {
	let groups = groupBySlide(items)
	let current = groups.findIndex(
		group => group.slide === items[index ?? -1]?.slide,
	)
	let target = groups[Math.max(0, Math.min(groups.length - 1, current + delta))]
	if (!target) return index
	return slideStart(items, target.slide)
}

// Each slide owns an equal share of the bar; items fill their slide's share.
export function itemProgress(
	items: PresentationItem[],
	index: number | undefined,
) {
	let item = items[index ?? -1]
	if (!item || index === undefined) return 0
	let groups = groupBySlide(items)
	let position = groups.findIndex(group => group.slide === item.slide)
	let group = groups[position]
	if (!group) return 0
	let within = (index - group.first + 1) / group.items.length
	return (position + within) / groups.length
}

interface SourceLine {
	text: string
	number: number
}

function sections(source: string) {
	let header = frontmatterBlock(source)
	let offset = header ? header[0].split("\n").length - 1 : 0
	let body = header ? source.slice(header[0].length) : source
	let result: SourceLine[][] = [[]]
	let fence = ""
	for (let [index, raw] of body.split("\n").entries()) {
		let text = raw.replace(/\r$/, "")
		fence = nextFence(fence, text)
		if (!fence && /^---\s*$/.test(text)) result.push([])
		else result[result.length - 1]?.push({ text, number: offset + index })
	}
	return result
}

function sectionItems(lines: SourceLine[], slide: number) {
	let items: PresentationItem[] = []
	let block: SourceLine[] = []
	let fence = ""
	function flush() {
		let first = block[0],
			last = block[block.length - 1]
		if (first && last)
			items.push({
				kind: "visual",
				slide,
				start: first.number,
				end: last.number,
				source: block.map(line => line.text).join("\n"),
			})
		block = []
	}
	for (let line of lines) {
		let opened = fence
		fence = nextFence(fence, line.text)
		if (!opened && !fence && !line.text.trim()) flush()
		else if (opened || fence || isVisual(line.text))
			block.push({ ...line, text: outdent(line.text) })
		else {
			flush()
			let text = spoken(line.text)
			if (!text) continue
			items.push({
				kind: "note",
				slide,
				line: line.number,
				text,
			})
		}
	}
	flush()
	return items
}

function isVisual(line: string) {
	return /^#{1,6}\s|^\s*!\[|^\s*\||^(\t| {2,})/.test(line)
}

function outdent(line: string) {
	return line.replace(/^(\t| {2})/, "")
}

function spoken(line: string) {
	return line
		.trim()
		.replace(/^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
		.replace(/^>\s?/, "")
}

function nextFence(current: string, line: string) {
	if (current)
		return new RegExp(`^\\s*${current[0]}{${current.length},}\\s*$`).test(line)
			? ""
			: current
	return line.match(/^\s*(`{3,}|~{3,})/)?.[1] ?? ""
}
