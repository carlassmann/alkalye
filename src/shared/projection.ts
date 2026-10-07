import { safeUrl } from "./markdown"
import type { DocumentLink } from "./model"

export let iconPrefix = "\u2003\u2060"

export interface ProjectedLink {
	kind: "link" | "wiki" | "media"
	target: string
	broken: boolean
	iconSpace?: true
	source: { start: number; end: number }
	view: { start: number; end: number }
	parts: { source: number; view: number; length: number }[]
}
export interface Projection {
	source: string
	text: string
	links: ProjectedLink[]
}
export interface ProjectionOptions {
	active?: { start: number; end: number }
	documents?: readonly DocumentLink[]
	iconSpace?: boolean
}

export function identity(source: string): Projection {
	return { source, text: source, links: [] }
}

// A token touched by the selection stays raw so native edits target source characters.
export function project(
	source: string,
	options: ProjectionOptions = {},
): Projection {
	return new Projector().project(source, options)
}

interface TokenLine {
	text: string
	start: number
	literal: boolean
	tokens: LinkToken[]
}
export class Projector {
	private lines: TokenLine[] = []
	private documents = ""
	project(source: string, options: ProjectionOptions = {}) {
		let documents = options.documents ?? []
		let key = documents.map(doc => doc.id + ":" + doc.title).join("\n")
		let changed = key !== this.documents
		this.documents = key
		let texts = source.split("\n"),
			offset = 0,
			first = true
		let prefix = 0,
			suffix = 0
		while (prefix < texts.length && this.lines[prefix]?.text === texts[prefix])
			prefix++
		while (
			suffix < texts.length - prefix &&
			suffix < this.lines.length - prefix &&
			this.lines[this.lines.length - suffix - 1]?.text ===
				texts[texts.length - suffix - 1]
		)
			suffix++
		let fence: { marker: string; length: number } | undefined
		let frontmatter = /^---\r?\n/.test(source)
		let lines: TokenLine[] = [],
			tokens: LinkToken[] = []
		for (let index = 0; index < texts.length; index++) {
			let text = texts[index] ?? "",
				previousFence = fence,
				start = offset
			offset += text.length + 1
			let literal = frontmatter
			if (frontmatter) {
				if (!first && /^(---|\.\.\.)\s*$/.test(text)) frontmatter = false
				first = false
			} else {
				let opening = /^ {0,3}(`{3,}|~{3,})/.exec(text)
				if (fence) {
					if (
						opening?.[1]?.[0] === fence.marker &&
						(opening[1]?.length ?? 0) >= fence.length &&
						!text.slice(opening[0].length).trim()
					)
						fence = undefined
				} else if (opening?.[1])
					fence = { marker: opening[1][0] ?? "`", length: opening[1].length }
				literal =
					Boolean(previousFence) || Boolean(fence) || /^( {4}|\t)/.test(text)
			}
			let previous =
				index >= texts.length - suffix
					? this.lines[this.lines.length - (texts.length - index)]
					: this.lines[index]
			let reusable =
				previous &&
				previous.text === text &&
				previous.literal === literal &&
				!(changed && text.includes("[["))
			let line =
				reusable && previous
					? previous.start === start
						? previous
						: {
								...previous,
								start,
								tokens: previous.tokens.map(token =>
									shift(token, start - previous.start),
								),
							}
					: {
							text,
							start,
							literal,
							tokens: literal ? [] : lineTokens(text, start, documents),
						}
			lines.push(line)
			for (let token of line.tokens) tokens.push(token)
		}
		this.lines = lines
		return projectTokens(source, options, tokens)
	}
}

function projectTokens(
	source: string,
	options: ProjectionOptions,
	tokens: LinkToken[],
) {
	let active = options.active && selectionBounds(source, options.active)
	let links: ProjectedLink[] = []
	let text = "",
		copied = 0
	for (let token of tokens) {
		if (active && token.end >= active.start && token.start <= active.end)
			continue
		text += source.slice(copied, token.start)
		let view = text.length
		let prefix = options.iconSpace ? iconPrefix : ""
		let parts = token.parts.map(part => ({
			source: part.start,
			view: view + prefix.length + part.offset,
			length: part.end - part.start,
		}))
		text += prefix + token.label
		links.push({
			kind: token.kind,
			target: token.target,
			broken: token.broken,
			...(options.iconSpace ? { iconSpace: true } : {}),
			source: { start: token.start, end: token.end },
			view: { start: view, end: text.length },
			parts,
		})
		copied = token.end
	}
	return { source, text: text + source.slice(copied), links }
}

function linkBefore(
	projection: Projection,
	offset: number,
	coordinates: "source" | "view",
) {
	let low = 0,
		high = projection.links.length
	while (low < high) {
		let middle = (low + high) >>> 1
		if ((projection.links[middle]?.[coordinates].start ?? Infinity) < offset)
			low = middle + 1
		else high = middle
	}
	return projection.links[low - 1]
}
export function toView(projection: Projection, offset: number) {
	let link = linkBefore(projection, offset, "source")
	if (!link) return Math.max(0, Math.min(projection.text.length, offset))
	if (offset >= link.source.end)
		return Math.max(
			0,
			Math.min(
				projection.text.length,
				offset + link.view.end - link.source.end,
			),
		)
	let view = link.view.start
	for (let part of link.parts)
		if (offset >= part.source)
			view = part.view + Math.min(offset - part.source, part.length)
	return view
}
export function toSource(
	projection: Projection,
	offset: number,
	bias: "start" | "end" = "start",
) {
	let link = linkBefore(projection, offset, "view")
	if (!link) return Math.max(0, Math.min(projection.source.length, offset))
	if (offset >= link.view.end)
		return Math.max(
			0,
			Math.min(
				projection.source.length,
				offset + link.source.end - link.view.end,
			),
		)
	let part = link.parts.find(
		part => offset >= part.view && offset <= part.view + part.length,
	)
	if (part) return part.source + offset - part.view
	return bias === "start" ? link.source.start : link.source.end
}

// Applies a native textarea edit to the source. The edit is anchored at the
// caret so repeated characters next to a collapsed link cannot shift it into
// hidden Markdown.
export function applyViewEdit(
	projection: Projection,
	next: string,
	caret = next.length,
): Projection {
	let previous = projection.text
	if (previous === next) return projection
	let suffix = 0
	let suffixLimit = Math.min(
		previous.length,
		next.length,
		Math.max(0, next.length - caret),
	)
	while (
		suffix < suffixLimit &&
		previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
	)
		suffix++
	let prefix = 0
	let prefixLimit = Math.min(previous.length, next.length) - suffix
	while (prefix < prefixLimit && previous[prefix] === next[prefix]) prefix++
	return applyViewReplacement(
		projection,
		prefix,
		previous.length - suffix,
		next.slice(prefix, next.length - suffix),
	)
}

export function applyViewReplacement(
	projection: Projection,
	prefix: number,
	viewEnd: number,
	inserted: string,
): Projection {
	let { start, end } = sourceRange(projection, prefix, viewEnd)
	let source =
		projection.source.slice(0, start) + inserted + projection.source.slice(end)
	let sourceShift = inserted.length - (end - start),
		viewShift = inserted.length - (viewEnd - prefix)
	let links: ProjectedLink[] = []
	for (let link of projection.links) {
		if (link.source.end <= start && link.view.end <= prefix) links.push(link)
		else if (link.source.start >= end && link.view.start >= viewEnd)
			links.push(moved(link, sourceShift, viewShift, -1))
		else {
			let part = link.parts.findIndex(
				part =>
					start >= part.source &&
					end <= part.source + part.length &&
					prefix >= part.view &&
					viewEnd <= part.view + part.length,
			)
			// An edit that removes hidden Markdown cannot be expressed in the
			// view the browser already shows; the caller reprojects instead.
			if (part < 0) return identity(source)
			links.push(moved(link, sourceShift, viewShift, part))
		}
	}
	return {
		source,
		text:
			projection.text.slice(0, prefix) +
			inserted +
			projection.text.slice(viewEnd),
		links,
	}
}

export function sourceRange(
	projection: Projection,
	viewStart: number,
	viewEnd: number,
) {
	let start = toSource(projection, viewStart, "start"),
		end = Math.max(start, toSource(projection, viewEnd, "end"))
	for (let link of projection.links) {
		if (!link.iconSpace) continue
		if (
			viewEnd === viewStart &&
			viewStart > link.view.start &&
			viewStart < link.view.start + iconPrefix.length
		)
			start = end = link.source.start
		else if (
			viewEnd > viewStart &&
			viewStart < link.view.start + iconPrefix.length &&
			viewEnd > link.view.start
		) {
			start = Math.min(start, link.source.start)
			end = Math.max(end, link.source.end)
		}
	}
	return { start, end }
}

export function sameProjection(left: Projection, right: Projection) {
	return (
		left.source === right.source &&
		left.text === right.text &&
		left.links.length === right.links.length &&
		left.links.every(
			(link, index) =>
				link.kind === right.links[index]?.kind &&
				link.target === right.links[index]?.target &&
				link.source.start === right.links[index]?.source.start &&
				link.source.end === right.links[index]?.source.end &&
				link.broken === right.links[index]?.broken &&
				link.iconSpace === right.links[index]?.iconSpace,
		)
	)
}

interface LinkToken {
	kind: ProjectedLink["kind"]
	start: number
	end: number
	label: string
	target: string
	broken: boolean
	parts: { start: number; end: number; offset: number }[]
}

function selectionBounds(
	source: string,
	selection: { start: number; end: number },
) {
	return {
		start: Math.max(0, Math.min(source.length, selection.start, selection.end)),
		end: Math.max(
			0,
			Math.min(source.length, Math.max(selection.start, selection.end)),
		),
	}
}

// Moves a link after an edit. The edited part grows or shrinks in place and
// everything after it shifts.
function moved(
	link: ProjectedLink,
	sourceShift: number,
	viewShift: number,
	edited: number,
): ProjectedLink {
	let after = edited < 0
	return {
		...link,
		source: {
			start: link.source.start + (after ? sourceShift : 0),
			end: link.source.end + sourceShift,
		},
		view: {
			start: link.view.start + (after ? viewShift : 0),
			end: link.view.end + viewShift,
		},
		parts: link.parts.map((part, index) =>
			after || index > edited
				? {
						source: part.source + sourceShift,
						view: part.view + viewShift,
						length: part.length,
					}
				: index === edited
					? { ...part, length: part.length + sourceShift }
					: part,
		),
	}
}

function lineTokens(
	line: string,
	base: number,
	documents: readonly DocumentLink[],
) {
	let tokens: LinkToken[] = []
	if (!line.includes("[")) return tokens
	let index = 0
	while (index < line.length) {
		let character = line[index]
		if (character === "\\") {
			index += 2
			continue
		}
		if (character === "`") {
			let run = /^`+/.exec(line.slice(index))?.[0] ?? "`"
			let close = line.indexOf(run, index + run.length)
			index = close < 0 ? index + run.length : close + run.length
			continue
		}
		if (character === "!" && line[index + 1] === "[") {
			let media = markdownLink(line, index + 1)
			if (media) {
				if (media.target.startsWith("asset:") || safeUrl(media.target) !== "#")
					tokens.push(
						shift(
							{
								...media,
								kind: "media",
								start: index,
								label: media.parts.length ? media.label : "Media",
							},
							base,
						),
					)
				index = media.end
			} else index += 2
			continue
		}
		if (character === "[" && line[index + 1] === "[") {
			let wiki = wikiLink(line, index, documents)
			if (wiki) {
				tokens.push(shift(wiki, base))
				index = wiki.end
				continue
			}
		}
		if (character === "[") {
			let link = markdownLink(line, index)
			if (link) {
				if (!link.target.startsWith("asset:") && safeUrl(link.target) !== "#")
					tokens.push(shift(link, base))
				index = link.end
				continue
			}
		}
		index++
	}
	return tokens
}

function wikiLink(
	line: string,
	start: number,
	documents: readonly DocumentLink[],
): LinkToken | undefined {
	let match = /^\[\[([^\]]*)\]\](\w*)/.exec(line.slice(start))
	let inner = match?.[1]
	if (!match || !inner) return
	let pipe = inner.indexOf("|")
	let id = (pipe < 0 ? inner : inner.slice(0, pipe)).trim()
	if (!id) return
	let doc = documents.find(doc => doc.id === id || doc.title === id)
	let suffix = match[2] ?? ""
	let parts: LinkToken["parts"] = []
	let label = ""
	if (pipe >= 0) {
		let alias = inner.slice(pipe + 1)
		let trimmed = alias.trim()
		if (trimmed) {
			let aliasStart = start + 3 + pipe + alias.indexOf(trimmed)
			parts.push({
				start: aliasStart,
				end: aliasStart + trimmed.length,
				offset: 0,
			})
			label = trimmed
		}
	}
	label ||= doc?.title ?? "Document Not Found"
	if (suffix) {
		let suffixStart = start + 4 + inner.length
		parts.push({
			start: suffixStart,
			end: suffixStart + suffix.length,
			offset: label.length,
		})
		label += suffix
	}
	return {
		kind: "wiki",
		start,
		end: start + match[0].length,
		label,
		target: doc?.id ?? id,
		broken: !doc,
		parts,
	}
}

function markdownLink(line: string, start: number): LinkToken | undefined {
	let depth = 0,
		index = start
	for (; index < line.length; index++) {
		let character = line[index]
		if (character === "\\") index++
		else if (character === "[") depth++
		else if (character === "]" && --depth === 0) break
	}
	if (depth || line[index + 1] !== "(") return
	let labelEnd = index
	index += 2
	while (line[index] === " ") index++
	let target = ""
	if (line[index] === "<") {
		let close = line.indexOf(">", index)
		if (close < 0) return
		target = line.slice(index + 1, close)
		index = close + 1
	} else {
		let targetStart = index,
			parentheses = 0
		for (; index < line.length; index++) {
			let character = line[index]
			if (character === "\\") index++
			else if (character === "(") parentheses++
			else if (character === ")" && parentheses-- === 0) break
			else if (character === " ") break
		}
		if (parentheses > 0) return
		target = line.slice(targetStart, index)
	}
	let title = /^(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/.exec(
		line.slice(index),
	)
	if (!title || !target) return
	let label = line.slice(start + 1, labelEnd)
	return {
		kind: "link",
		start,
		end: index + title[0].length,
		label: label || "Web Link",
		target,
		broken: false,
		parts: label ? [{ start: start + 1, end: labelEnd, offset: 0 }] : [],
	}
}

function shift(token: LinkToken, base: number): LinkToken {
	return {
		...token,
		start: token.start + base,
		end: token.end + base,
		parts: token.parts.map(part => ({
			...part,
			start: part.start + base,
			end: part.end + base,
		})),
	}
}
