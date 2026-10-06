import { textSplices } from "./text-splices"
import type { TextSplice } from "./text-splices"

export interface MergedText {
	readonly content: string
	readonly conflict: boolean
}

// Independent character edits merge; competing edits preserve both versions
// through the file conflict workflow.
export function mergeText(
	base: string,
	local: string,
	disk: string,
): MergedText {
	if (local === disk || base === disk)
		return { content: local, conflict: false }
	if (base === local) return { content: disk, conflict: false }
	let characters = Array.from(base)
	let ours = textSplices(characters, Array.from(local))
	let theirs = textSplices(characters, Array.from(disk))
	let combined = [...ours]
	for (let edit of theirs) {
		if (ours.some(other => sameEdit(other, edit))) continue
		if (ours.some(other => touches(other, edit)))
			return { content: local, conflict: true }
		combined.push(edit)
	}
	let result = [...characters]
	for (let edit of combined.sort(
		(a, b) => b.start - a.start || b.remove - a.remove,
	))
		result = [
			...result.slice(0, edit.start),
			...edit.insert,
			...result.slice(edit.start + edit.remove),
		]
	return { content: result.join(""), conflict: false }
}

function touches(a: TextSplice, b: TextSplice) {
	if (!a.remove && !b.remove) return a.start === b.start
	if (!a.remove) return a.start > b.start && a.start < b.start + b.remove
	if (!b.remove) return b.start > a.start && b.start < a.start + a.remove
	return a.start < b.start + b.remove && b.start < a.start + a.remove
}
function sameEdit(a: TextSplice, b: TextSplice) {
	return (
		a.start === b.start &&
		a.remove === b.remove &&
		a.insert.length === b.insert.length &&
		a.insert.every((line, index) => line === b.insert[index])
	)
}
