import { calcPatch } from "fast-myers-diff"
import { splitGraphemes } from "unicode-segmenter/grapheme"
import type { DocumentContentPatch } from "./document-save-protocol"

export { calculateDocumentContentPatches }

function calculateDocumentContentPatches(
	oldContent: string,
	newContent: string,
): DocumentContentPatch[] {
	let changed = getChangedSpan(oldContent, newContent)
	let boundaries = getOldGraphemeBoundaries(
		oldContent,
		changed.from,
		changed.oldTo,
	)
	let sharedSuffixLength = oldContent.length - boundaries.to
	let newTo = newContent.length - sharedSuffixLength
	let current = Array.from(
		splitGraphemes(oldContent.slice(boundaries.from, boundaries.to)),
	)
	let next = Array.from(
		splitGraphemes(newContent.slice(boundaries.from, newTo)),
	)
	return Array.from(calcPatch(current, next), ([from, to, inserted]) => ({
		from: boundaries.graphemeOffset + from,
		to: boundaries.graphemeOffset + to,
		inserted: inserted.join(""),
	}))
}

function getChangedSpan(oldContent: string, newContent: string) {
	let from = 0
	let sharedLength = Math.min(oldContent.length, newContent.length)
	while (from < sharedLength && oldContent[from] === newContent[from]) from++

	let suffix = 0
	while (
		suffix < sharedLength - from &&
		oldContent[oldContent.length - suffix - 1] ===
			newContent[newContent.length - suffix - 1]
	) {
		suffix++
	}
	return { from, oldTo: oldContent.length - suffix }
}

function getOldGraphemeBoundaries(content: string, from: number, to: number) {
	let offset = 0
	let graphemeOffset = 0
	let safeFrom = 0
	let safeTo = content.length
	let foundTo = false

	for (let grapheme of splitGraphemes(content)) {
		let nextOffset = offset + grapheme.length
		if (nextOffset <= from) {
			safeFrom = nextOffset
			graphemeOffset++
		}
		if (!foundTo && nextOffset >= to) {
			safeTo = nextOffset
			foundTo = true
		}
		offset = nextOffset
		if (foundTo && offset >= to) break
	}

	return { from: safeFrom, to: safeTo, graphemeOffset }
}
