import type { Selection } from "./authoring"
import { editLines } from "./lines"
import { frontmatterBlock, nextFence } from "./markdown"

export function proseAt(source: string, offset: number) {
	let headerEnd = frontmatterBlock(source)?.[0].length ?? 0
	if (offset < headerEnd) return false
	let start = source.slice(0, offset).lastIndexOf("\n") + 1
	let fence = ""
	for (let line of source.slice(headerEnd, start).split("\n"))
		fence = nextFence(fence, line)
	return !fence
}

export function typingEdit(
	source: string,
	selection: Selection,
	key: "Enter" | "Tab" | "ShiftTab" | "Backspace" | "Delete",
	smartPairs = true,
) {
	let { start, end } = selection
	let lineStart = source.slice(0, start).lastIndexOf("\n") + 1
	let lineEnd = source.indexOf("\n", start)
	if (lineEnd < 0) lineEnd = source.length
	let line = source.slice(lineStart, lineEnd)
	let prose = proseAt(source, start)
	if (key === "Backspace" || key === "Delete") {
		if (start !== end) return
		let before = source.slice(lineStart, start),
			after = source.slice(start, lineEnd)
		let pairs: Record<string, string> = {
			"(": ")",
			"[": "]",
			"{": "}",
			"'": "'",
			'"': '"',
			"`": "`",
		}
		let opening = before.slice(-1),
			closing = pairs[opening]
		let marker =
			smartPairs && closing && after.startsWith(closing) ? opening : undefined
		if (prose) {
			let leftTicks = before.match(/`+$/)?.[0],
				rightTicks = after.match(/^`+/)?.[0]
			marker =
				leftTicks && leftTicks === rightTicks
					? leftTicks
					: (["**", "__", "~~", "==", "*", "_"].find(
							value => before.endsWith(value) && after.startsWith(value),
						) ?? marker)
		}
		if (!marker && key === "Delete" && prose) {
			let ticks = after.match(/^`+/)?.[0]
			let closing = [
				...(ticks ? [ticks] : []),
				"**",
				"__",
				"~~",
				"==",
				"*",
				"_",
			].find(
				value =>
					after.startsWith(value) && (before.split(value).length - 1) % 2 === 1,
			)
			if (closing) return replace(source, start, start + closing.length, "")
		}
		if (marker)
			return replace(source, start - marker.length, start + marker.length, "")
		return
	}
	let table = prose ? tableEdit(source, selection, key) : undefined
	if (table) return table
	if (key === "Tab" || key === "ShiftTab") {
		let multiline = source.slice(start, end).includes("\n")
		if (!multiline && prose && !/^\s*(?:[-*+]\s|\d+[.)]\s)/.test(line)) return
		return editLines(source, selection, key === "Tab" ? "indent" : "outdent")
	}
	if (!prose) return
	let before = source.slice(lineStart, start)
	let list = before.match(/^([ \t]*(?:>[ \t]*)*)([-*+] |\d+[.)] )(\[[ xX]\] )?/)
	if (list) {
		let prefix = list[0]
		if (/^\d/.test(list[2] ?? ""))
			prefix =
				(list[1] ?? "") +
				`${parseInt(list[2] ?? "0") + 1}${list[2]?.trim().slice(-1) ?? "."} ` +
				(list[3] ?? "")
		prefix = prefix.replace(/\[[xX]\]/, "[ ]")
		if (before.trim() === list[0].trim())
			return replace(source, start - list[0].length, end, "")
		return replace(source, start, end, "\n" + prefix)
	}
	let quote = before.match(/^([ \t]*(?:>[ \t]*)+)/)?.[0]
	if (quote)
		return before.trim() === quote.trim()
			? replace(source, start - quote.length, end, "")
			: replace(source, start, end, "\n" + quote)
}

function replace(source: string, start: number, end: number, value: string) {
	let cursor = start + value.length
	return {
		source: source.slice(0, start) + value + source.slice(end),
		selection: { start: cursor, end: cursor },
	}
}

function tableEdit(
	source: string,
	selection: Selection,
	key: "Enter" | "Tab" | "ShiftTab",
) {
	let lines = source.split("\n"),
		starts: number[] = [],
		offset = 0
	for (let line of lines) {
		starts.push(offset)
		offset += line.length + 1
	}
	let current = starts.findIndex(
		(start, index) =>
			selection.start >= start &&
			selection.start <= start + (lines[index]?.length ?? 0),
	)
	if (current < 0 || !isTableRow(lines[current] ?? "")) return
	let first = current,
		last = current
	while (first > 0 && isTableRow(lines[first - 1] ?? "")) first--
	while (last + 1 < lines.length && isTableRow(lines[last + 1] ?? "")) last++
	let cells: Selection[] = []
	for (let index = first; index <= last; index++) {
		let line = lines[index] ?? "",
			from = starts[index] ?? 0
		if (isDelimiterRow(line)) continue
		let pipes = pipeOffsets(line)
		for (let cell = 0; cell + 1 < pipes.length; cell++) {
			let start = (pipes[cell] ?? 0) + 1,
				end = pipes[cell + 1] ?? line.length
			while (start < end && line[start] === " ") start++
			while (end > start && line[end - 1] === " ") end--
			cells.push({ start: from + start, end: from + end })
		}
	}
	if (key !== "Enter") {
		let cell = cells.findIndex(
			range => selection.start >= range.start && selection.start <= range.end,
		)
		if (cell < 0) {
			if (!isDelimiterRow(lines[current] ?? "")) return
			let target =
				key === "Tab"
					? cells.find(range => range.start > (starts[current] ?? 0))
					: [...cells]
							.reverse()
							.find(range => range.end < (starts[current] ?? 0))
			if (target) return { source, selection: target }
		} else {
			let next = cells[cell + (key === "Tab" ? 1 : -1)]
			if (next) return { source, selection: next }
			if (key === "ShiftTab") return
		}
	}
	let line = lines[current] ?? ""
	let insertLine = isDelimiterRow(lines[current + 1] ?? "")
		? current + 1
		: current
	let position = (starts[insertLine] ?? 0) + (lines[insertLine]?.length ?? 0)
	let row = "|" + "  |".repeat(pipeOffsets(line).length - 1)
	let result = replace(source, position, position, "\n" + row)
	return {
		source: result.source,
		selection: { start: position + 3, end: position + 3 },
	}
}

function isDelimiterRow(line: string) {
	return /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(line)
}

function isTableRow(line: string) {
	let trimmed = line.trim()
	return (
		trimmed.startsWith("|") &&
		trimmed.endsWith("|") &&
		pipeOffsets(line).length > 1
	)
}

function pipeOffsets(line: string) {
	let pipes: number[] = []
	for (let index = 0; index < line.length; index++) {
		if (line[index] === "\\") {
			index++
			continue
		}
		if (line[index] === "`") {
			let run = line.slice(index).match(/^`+/)?.[0] ?? "`"
			let closing = line.indexOf(run, index + run.length)
			while (
				closing >= 0 &&
				(line[closing - 1] === "`" || line[closing + run.length] === "`")
			)
				closing = line.indexOf(run, closing + run.length)
			if (closing >= 0) {
				index = closing + run.length - 1
				continue
			}
		}
		if (line[index] === "|") pipes.push(index)
	}
	return pipes
}
