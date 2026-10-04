import { safeUrl } from "./markdown"
import type { DocumentLink } from "./model"

export interface ProjectedLink {
	kind: "link" | "wiki"
	target: string
	broken: boolean
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
}

export function identity(source: string): Projection {
	return { source, text: source, links: [] }
}

// A token touched by the selection stays raw so native edits target source characters.
export function project(
	source: string,
	options: ProjectionOptions = {},
): Projection {
	let active = options.active && selectionBounds(source, options.active)
	let links: ProjectedLink[] = []
	let text = "",
		copied = 0
	for (let token of linkTokens(source, options.documents ?? [])) {
		if (active && token.end >= active.start && token.start <= active.end)
			continue
		text += source.slice(copied, token.start)
		let view = text.length
		let parts = token.parts.map(part => ({
			source: part.start,
			view: view + part.offset,
			length: part.end - part.start,
		}))
		text += token.label
		links.push({
			kind: token.kind,
			target: token.target,
			broken: token.broken,
			source: { start: token.start, end: token.end },
			view: { start: view, end: text.length },
			parts,
		})
		copied = token.end
	}
	return { source, text: text + source.slice(copied), links }
}

export function toView(projection: Projection, offset: number) {
	let delta = 0
	for (let link of projection.links) {
		if (offset <= link.source.start) break
		if (offset >= link.source.end) {
			delta = link.view.end - link.source.end
			continue
		}
		let view = link.view.start
		for (let part of link.parts)
			if (offset >= part.source)
				view = part.view + Math.min(offset - part.source, part.length)
		return view
	}
	return Math.max(0, Math.min(projection.text.length, offset + delta))
}

export function toSource(
	projection: Projection,
	offset: number,
	bias: "start" | "end" = "start",
) {
	let delta = 0
	for (let link of projection.links) {
		if (offset <= link.view.start) break
		if (offset >= link.view.end) {
			delta = link.source.end - link.view.end
			continue
		}
		let part = link.parts.find(
			part => offset >= part.view && offset <= part.view + part.length,
		)
		if (part) return part.source + offset - part.view
		return bias === "start" ? link.source.start : link.source.end
	}
	return Math.max(0, Math.min(projection.source.length, offset + delta))
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
	let viewEnd = previous.length - suffix
	let start = toSource(projection, prefix, "start"),
		end = Math.max(start, toSource(projection, viewEnd, "end"))
	let inserted = next.slice(prefix, next.length - suffix)
	let source =
		projection.source.slice(0, start) + inserted + projection.source.slice(end)
	let sourceShift = inserted.length - (end - start),
		viewShift = next.length - previous.length
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
	return { source, text: next, links }
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
				link.broken === right.links[index]?.broken,
		)
	)
}

interface LinkToken {
	kind: "link" | "wiki"
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

function linkTokens(source: string, documents: readonly DocumentLink[]) {
	let tokens: LinkToken[] = []
	let offset = 0
	let fence: { marker: string; length: number } | undefined
	let frontmatter = /^---\r?\n/.test(source)
	let first = true
	for (let line of source.split("\n")) {
		let start = offset
		offset += line.length + 1
		if (frontmatter) {
			if (!first && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false
			first = false
			continue
		}
		let opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)
		if (fence) {
			let marker = fence.marker
			if (
				opening?.[1]?.[0] === marker &&
				(opening[1]?.length ?? 0) >= fence.length &&
				!line.slice(opening[0].length).trim()
			)
				fence = undefined
			continue
		}
		if (opening?.[1]) {
			fence = { marker: opening[1][0] ?? "`", length: opening[1].length }
			continue
		}
		if (/^( {4}|\t)/.test(line)) continue
		tokens.push(...lineTokens(line, start, documents))
	}
	return tokens
}

function lineTokens(
	line: string,
	base: number,
	documents: readonly DocumentLink[],
) {
	let tokens: LinkToken[] = []
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
			index = markdownLink(line, index + 1)?.end ?? index + 2
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
