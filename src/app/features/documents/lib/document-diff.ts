import { calcPatch } from "fast-myers-diff"
import { splitGraphemes } from "unicode-segmenter/grapheme"
import type { DocumentContentPatch } from "./document-save-protocol"

export { calculateDocumentContentPatches }

function calculateDocumentContentPatches(
	oldEntries: string[],
	newContent: string,
): DocumentContentPatch[] {
	let newGraphemes = Array.from(splitGraphemes(newContent))
	return Array.from(
		calcPatch(oldEntries, newGraphemes),
		([from, to, inserted]) => ({
			from,
			to,
			inserted: inserted.join(""),
		}),
	)
}
