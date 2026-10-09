import { calcPatch } from "fast-myers-diff"
import { splitGraphemes } from "unicode-segmenter/grapheme"
import type { DocumentContentPatch } from "./document-save-protocol"

export { calculateDocumentContentPatches }

function calculateDocumentContentPatches(
	oldEntries: string[],
	newContent: string,
): DocumentContentPatch[] {
	let newGraphemes = Array.from(splitGraphemes(newContent))
	let from = 0
	while (
		from < oldEntries.length &&
		from < newGraphemes.length &&
		oldEntries[from] === newGraphemes[from]
	)
		from++
	let oldEnd = oldEntries.length
	let newEnd = newGraphemes.length
	while (
		oldEnd > from &&
		newEnd > from &&
		oldEntries[oldEnd - 1] === newGraphemes[newEnd - 1]
	) {
		oldEnd--
		newEnd--
	}
	if (Math.max(oldEnd - from, newEnd - from) > 4_000) {
		return [
			{ from, to: oldEnd, inserted: newGraphemes.slice(from, newEnd).join("") },
		]
	}
	return Array.from(
		calcPatch(oldEntries, newGraphemes),
		([from, to, inserted]) => ({
			from,
			to,
			inserted: inserted.join(""),
		}),
	)
}
