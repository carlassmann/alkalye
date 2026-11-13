import { Marked, type Token, type Tokens } from "marked"
import {
	createWikilinkExtension,
	type WikilinkTitleResolver,
} from "@/app/features/import-export"

export {
	buildPreviewTextMap,
	rawRangeToRenderedRange,
	renderedRangeToRawRange,
	type PreviewTextMap,
	type PreviewTextRange,
}

type PreviewTextMap = {
	text: string
	ranges: PreviewTextRange[]
}

type PreviewTextMapBuilder = PreviewTextMap & {
	wikilinkResolver?: WikilinkTitleResolver
}

type PreviewTextRange = {
	renderedFrom: number
	renderedTo: number
	rawTextFrom: number
	rawTextTo: number
	rawOuterFrom: number
	rawOuterTo: number
	atomic: boolean
}

function buildPreviewTextMap(
	markdown: string,
	wikilinkResolver?: WikilinkTitleResolver,
): PreviewTextMap {
	let map: PreviewTextMapBuilder = { text: "", ranges: [], wikilinkResolver }
	let parser = new Marked()
	parser.setOptions({ gfm: true, breaks: true })
	if (wikilinkResolver) parser.use(createWikilinkExtension(wikilinkResolver))
	let cursor = 0
	for (let token of parser.lexer(markdown)) {
		let tokenStart = findTokenStart(markdown, token.raw, cursor)
		appendToken(map, token, tokenStart)
		cursor = tokenStart + token.raw.length
	}
	return { text: map.text, ranges: map.ranges }
}

function rawRangeToRenderedRange(
	map: PreviewTextMap,
	rawFrom: number,
	rawTo: number,
) {
	let renderedRanges = map.ranges
		.map(range => getOverlappingRenderedRange(range, rawFrom, rawTo))
		.filter(range => range !== null)
	if (renderedRanges.length === 0) return null
	let renderedFrom = Math.min(...renderedRanges.map(range => range.from))
	let renderedTo = Math.max(...renderedRanges.map(range => range.to))
	return {
		from: renderedFrom,
		to: renderedTo,
		text: map.text.slice(renderedFrom, renderedTo),
	}
}

function renderedRangeToRawRange(
	map: PreviewTextMap,
	renderedFrom: number,
	renderedTo: number,
) {
	let rawRanges = map.ranges
		.map(range => getOverlappingRawRange(range, renderedFrom, renderedTo))
		.filter(rawRange => rawRange !== null)
	if (rawRanges.length === 0) return null
	return {
		from: Math.min(...rawRanges.map(range => range.from)),
		to: Math.max(...rawRanges.map(range => range.to)),
	}
}

function appendToken(
	map: PreviewTextMapBuilder,
	token: Token,
	rawStart: number,
) {
	if (isWikilinkToken(token)) {
		let title =
			token.alias ?? map.wikilinkResolver?.(token.docId).title ?? token.docId
		appendVisibleText(map, title, rawStart, rawStart + token.raw.length, true)
		return
	}
	if (isHiddenToken(token)) return
	if (isListToken(token)) {
		appendListToken(map, token, rawStart)
		return
	}
	if (isTableToken(token)) {
		appendTableToken(map, token, rawStart)
		return
	}
	if (hasTokenChildren(token)) {
		let firstChildRange = map.ranges.length
		appendTokenSequence(map, token.tokens, token.raw, rawStart)
		if (usesOuterRange(token)) {
			expandChildOuterRanges(
				map,
				firstChildRange,
				rawStart,
				rawStart + token.raw.length,
			)
		}
		return
	}
	if (hasVisibleText(token)) {
		appendVisibleText(map, token.text, rawStart, rawStart + token.raw.length)
	}
}

function appendListToken(
	map: PreviewTextMapBuilder,
	token: Tokens.List,
	rawStart: number,
) {
	let cursor = 0
	for (let item of token.items) {
		let itemStart = rawStart + findTokenStart(token.raw, item.raw, cursor)
		appendTokenSequence(map, item.tokens, item.raw, itemStart)
		cursor = itemStart - rawStart + item.raw.length
	}
}

function appendTableToken(
	map: PreviewTextMapBuilder,
	token: Tokens.Table,
	rawStart: number,
) {
	for (let cell of token.header) {
		appendTokenSequence(map, cell.tokens, token.raw, rawStart)
	}
	for (let row of token.rows) {
		for (let cell of row) {
			appendTokenSequence(map, cell.tokens, token.raw, rawStart)
		}
	}
}

function appendTokenSequence(
	map: PreviewTextMapBuilder,
	tokens: Token[],
	source: string,
	rawStart: number,
) {
	let cursor = 0
	for (let token of tokens) {
		let tokenStart = rawStart + findTokenStart(source, token.raw, cursor)
		appendToken(map, token, tokenStart)
		cursor = tokenStart - rawStart + token.raw.length
	}
}

function appendVisibleText(
	map: PreviewTextMapBuilder,
	text: string,
	rawTextFrom: number,
	rawTextTo: number,
	atomic = false,
) {
	if (!text) return
	let renderedFrom = map.text.length
	map.text += text
	map.ranges.push({
		renderedFrom,
		renderedTo: map.text.length,
		rawTextFrom,
		rawTextTo,
		rawOuterFrom: rawTextFrom,
		rawOuterTo: rawTextTo,
		atomic,
	})
}

function expandChildOuterRanges(
	map: PreviewTextMapBuilder,
	fromIndex: number,
	rawOuterFrom: number,
	rawOuterTo: number,
) {
	for (let i = fromIndex; i < map.ranges.length; i++) {
		let range = map.ranges[i]
		range.rawOuterFrom = rawOuterFrom
		range.rawOuterTo = rawOuterTo
	}
}

function getOverlappingRawRange(
	range: PreviewTextRange,
	renderedFrom: number,
	renderedTo: number,
) {
	let from = Math.max(renderedFrom, range.renderedFrom)
	let to = Math.min(renderedTo, range.renderedTo)
	if (from >= to) return null

	if (from === range.renderedFrom && to === range.renderedTo) {
		return { from: range.rawOuterFrom, to: range.rawOuterTo }
	}
	if (range.atomic) return { from: range.rawOuterFrom, to: range.rawOuterTo }

	return {
		from: range.rawTextFrom + (from - range.renderedFrom),
		to: range.rawTextFrom + (to - range.renderedFrom),
	}
}

function getOverlappingRenderedRange(
	range: PreviewTextRange,
	rawFrom: number,
	rawTo: number,
) {
	let fullOuter = rawFrom <= range.rawOuterFrom && range.rawOuterTo <= rawTo
	if (fullOuter) return { from: range.renderedFrom, to: range.renderedTo }
	if (
		range.atomic &&
		rangesOverlap(rawFrom, rawTo, range.rawOuterFrom, range.rawOuterTo)
	)
		return { from: range.renderedFrom, to: range.renderedTo }

	let from = Math.max(rawFrom, range.rawTextFrom)
	let to = Math.min(rawTo, range.rawTextTo)
	if (from >= to) return null

	return {
		from: range.renderedFrom + (from - range.rawTextFrom),
		to: range.renderedFrom + (to - range.rawTextFrom),
	}
}

function findTokenStart(source: string, raw: string, from: number) {
	let index = source.indexOf(raw, from)
	return index >= 0 ? index : from
}

function isListToken(token: Token): token is Tokens.List {
	return token.type === "list" && "items" in token && Array.isArray(token.items)
}

function isTableToken(token: Token): token is Tokens.Table {
	return (
		token.type === "table" &&
		"header" in token &&
		Array.isArray(token.header) &&
		"rows" in token &&
		Array.isArray(token.rows)
	)
}

function isHiddenToken(token: Token) {
	return (
		token.type === "br" ||
		token.type === "checkbox" ||
		token.type === "def" ||
		token.type === "hr" ||
		token.type === "image" ||
		token.type === "space"
	)
}

function usesOuterRange(token: Token) {
	return (
		token.type === "del" ||
		token.type === "em" ||
		token.type === "link" ||
		token.type === "strong"
	)
}

function hasTokenChildren(token: Token): token is Token & { tokens: Token[] } {
	return "tokens" in token && Array.isArray(token.tokens)
}

function hasVisibleText(token: Token): token is Token & { text: string } {
	return "text" in token && typeof token.text === "string"
}

type WikilinkToken = Token & {
	type: "wikilink"
	docId: string
	alias?: string
}

function isWikilinkToken(token: Token): token is WikilinkToken {
	return (
		token.type === "wikilink" &&
		"docId" in token &&
		typeof token.docId === "string"
	)
}

function rangesOverlap(aFrom: number, aTo: number, bFrom: number, bTo: number) {
	return aFrom < bTo && bFrom < aTo
}
