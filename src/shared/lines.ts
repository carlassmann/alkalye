import type { Selection } from "./authoring"

export function lineBounds(source: string, selection: Selection) {
	let start = source.slice(0, selection.start).lastIndexOf("\n") + 1
	let end = source.indexOf("\n", Math.max(selection.start, selection.end - 1))
	return { start, end: end < 0 ? source.length : end }
}

export function editLines(
	source: string,
	selection: Selection,
	command: string,
) {
	let { start, end } = lineBounds(source, selection),
		block = source.slice(start, end)
	let before = source.slice(0, start),
		after = source.slice(end)
	if (command === "indent" || command === "outdent") {
		let lines = block.split("\n")
		let changedLines = lines.map(line =>
			command === "indent" ? "\t" + line : line.replace(/^(\t| {1,2})/, ""),
		)
		let changed = changedLines.join("\n")
		let firstChange = (changedLines[0]?.length ?? 0) - (lines[0]?.length ?? 0)
		return {
			source: before + changed + after,
			selection: {
				start: Math.max(start, selection.start + firstChange),
				end: Math.max(start, selection.end + changed.length - block.length),
			},
		}
	}
	if (command === "delete") {
		let from = end === source.length && start > 0 ? start - 1 : start
		let to = Math.min(source.length, end + 1)
		return {
			source: source.slice(0, from) + source.slice(to),
			selection: { start: from, end: from },
		}
	}
	if (command === "insert-above" || command === "insert-below") {
		let position = command === "insert-above" ? start : end
		let cursor = position + (command === "insert-below" ? 1 : 0)
		return {
			source: source.slice(0, position) + "\n" + source.slice(position),
			selection: { start: cursor, end: cursor },
		}
	}
	if (command === "duplicate-up" || command === "duplicate-down") {
		let position = command === "duplicate-up" ? start : start + block.length + 1
		let shift = position - start
		return {
			source: before + block + "\n" + block + after,
			selection: { start: selection.start + shift, end: selection.end + shift },
		}
	}
	if (command === "move-up" && start > 0) {
		let previous = before.slice(0, -1).lastIndexOf("\n") + 1
		return {
			source:
				source.slice(0, previous) +
				block +
				"\n" +
				before.slice(previous, -1) +
				after,
			selection: {
				start: selection.start + previous - start,
				end: selection.end + previous - start,
			},
		}
	}
	if (command === "move-down" && after) {
		let next = after.indexOf("\n", 1)
		if (next < 0) next = after.length
		let following = after.slice(1, next),
			shift = following.length + 1
		return {
			source: before + following + "\n" + block + after.slice(next),
			selection: { start: selection.start + shift, end: selection.end + shift },
		}
	}
	return { source, selection }
}
