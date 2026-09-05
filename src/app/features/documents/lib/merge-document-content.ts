import { ChangeSet, Text } from "@codemirror/state"
import { diff } from "fast-myers-diff"

export { mergeDocumentContent }

function mergeDocumentContent(
	baseContent: string,
	localContent: string,
	remoteContent: string,
) {
	if (baseContent === remoteContent) return localContent
	if (baseContent === localContent) return remoteContent

	let localChanges = changesBetween(baseContent, localContent)
	let remoteChanges = changesBetween(baseContent, remoteContent)
	return localChanges
		.map(remoteChanges, false)
		.apply(Text.of(remoteContent.split("\n")))
		.toString()
}

function changesBetween(before: string, after: string) {
	let beforeCodePoints = Array.from(before)
	let afterCodePoints = Array.from(after)
	let beforeOffsets = codePointOffsets(beforeCodePoints)
	let afterOffsets = codePointOffsets(afterCodePoints)
	let changes = Array.from(
		diff(beforeCodePoints, afterCodePoints),
		([fromBefore, toBefore, fromAfter, toAfter]) => ({
			from: beforeOffsets[fromBefore] ?? before.length,
			to: beforeOffsets[toBefore] ?? before.length,
			insert: after.slice(
				afterOffsets[fromAfter] ?? after.length,
				afterOffsets[toAfter] ?? after.length,
			),
		}),
	)
	return ChangeSet.of(changes, before.length)
}

function codePointOffsets(codePoints: string[]) {
	let offsets = [0]
	for (let codePoint of codePoints) {
		offsets.push((offsets.at(-1) ?? 0) + codePoint.length)
	}
	return offsets
}
