import { textSplices } from "./text-splices"
import type { TextSplice } from "./text-splices"

export interface MergedText {
	readonly content: string
	readonly conflict: boolean
}

// Three-way merge by line, as version control does: edits from both sides
// combine when they touch different lines; touching or overlapping edits are a
// conflict and keep the local text so nothing is silently discarded.
export function mergeText(
	base: string,
	local: string,
	disk: string,
): MergedText {
	if (local === disk || base === disk)
		return { content: local, conflict: false }
	if (base === local) return { content: disk, conflict: false }
	let lines = splitLines(base)
	let ours = textSplices(lines, splitLines(local))
	let theirs = textSplices(lines, splitLines(disk))
	let combined = [...ours]
	for (let edit of theirs) {
		if (ours.some(other => sameEdit(other, edit))) continue
		if (ours.some(other => touches(other, edit)))
			return { content: local, conflict: true }
		combined.push(edit)
	}
	let result = [...lines]
	for (let edit of combined.sort((a, b) => b.start - a.start))
		result.splice(edit.start, edit.remove, ...edit.insert)
	return { content: result.join(""), conflict: false }
}

function splitLines(text: string) {
	return text ? text.split(/(?<=\n)/) : []
}
function touches(a: TextSplice, b: TextSplice) {
	return a.start <= b.start + b.remove && b.start <= a.start + a.remove
}
function sameEdit(a: TextSplice, b: TextSplice) {
	return (
		a.start === b.start &&
		a.remove === b.remove &&
		a.insert.length === b.insert.length &&
		a.insert.every((line, index) => line === b.insert[index])
	)
}
