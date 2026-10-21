import type { ChangeSet, Text } from "@codemirror/state"
import { splitGraphemes } from "unicode-segmenter/grapheme"
import {
	applyContentPatchesInBoundedTransactions,
	applyDocumentContentPatches,
	type LoadedAnchorDocument,
} from "@/app/features/comments/lib/comments"
import type { BackgroundSaveDocument } from "./background-document-save"
import type { DocumentContentPatch } from "./document-save-protocol"
import {
	cacheDocumentText,
	readDocumentText,
	type TextEntries,
} from "./document-text"
import { syncDocumentMetadata } from "./metadata"

export { captureDocumentSaveBase, composeDocumentEdits, persistDocumentEdits }
export type { DocumentSaveBase, DocumentEdits, EditorChange }

type EditorChange = { changes: ChangeSet; before: Text; after: Text }
type DocumentSaveBase = {
	documentId: string
	contentId: string
	entries: TextEntries
	text: string
}
type DocumentEdits = {
	base: DocumentSaveBase
	changes: ChangeSet
	after: Text
}
type OffsetRun = { index: number; offset: number }
type EntryOffsets = { editor: OffsetRun[]; text: OffsetRun[]; length: number }

let offsetsByEntries = new WeakMap<TextEntries, EntryOffsets>()

function captureDocumentSaveBase(
	doc: BackgroundSaveDocument,
): DocumentSaveBase {
	return {
		documentId: doc.$jazz.id,
		contentId: doc.content.$jazz.id,
		entries: doc.content.$jazz.raw.entries(),
		text: readDocumentText(doc.content),
	}
}

function composeDocumentEdits(
	base: DocumentSaveBase,
	previous: DocumentEdits | undefined,
	change: EditorChange,
): DocumentEdits | undefined {
	if (previous) {
		if (previous.after !== change.before) return
		return {
			base: previous.base,
			changes: previous.changes.compose(change.changes),
			after: change.after,
		}
	}
	if (base.text.replace(/\r\n?/g, "\n") !== change.before.toString()) return
	return { base, changes: change.changes, after: change.after }
}

function persistDocumentEdits(
	doc: BackgroundSaveDocument,
	edits: DocumentEdits,
): string | undefined {
	let { base, changes } = edits
	if (
		doc.$jazz.id !== base.documentId ||
		doc.content.$jazz.id !== base.contentId
	)
		return
	let baseOffsets = entryOffsets(base.entries)
	if (offsetAt(baseOffsets.editor, baseOffsets.length) !== changes.length)
		return
	let replacements: DocumentContentPatch[] = []
	let valid = true
	changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
		let start = boundaryIndex(baseOffsets, from)
		let end = boundaryIndex(baseOffsets, to)
		if (start === undefined || end === undefined) {
			valid = false
			return
		}
		let text = inserted.toString()
		let surrounding = [
			base.entries[start - 1]?.value,
			text,
			base.entries[end]?.value,
		].filter(value => value !== undefined && value !== "")
		let graphemes = surrounding.flatMap(value =>
			Array.from(splitGraphemes(value)),
		)
		if (
			Array.from(splitGraphemes(surrounding.join(""))).length !==
			graphemes.length
		) {
			valid = false
			return
		}
		replacements.push({ from: start, to: end, inserted: text })
	})
	if (!valid) return
	let current = doc.content.$jazz.raw.entries()
	let patches =
		current === base.entries
			? replacements
			: rebasePatches(base.entries, current, replacements)
	if (!patches) return
	if (patches.length === 0) return readDocumentText(doc.content)
	let currentOffsets =
		current === base.entries ? baseOffsets : entryOffsets(current)
	let content = readDocumentText(doc.content)
	for (let patch of [...patches].reverse()) {
		content =
			content.slice(0, offsetAt(currentOffsets.text, patch.from)) +
			patch.inserted +
			content.slice(offsetAt(currentOffsets.text, patch.to))
	}
	if (hasLoadedCommentAnchors(doc)) {
		applyDocumentContentPatches(doc, content, patches)
	} else {
		applyContentPatchesInBoundedTransactions(doc.content, patches)
	}
	cacheDocumentText(doc.content, content)
	doc.$jazz.set("updatedAt", new Date())
	syncDocumentMetadata(doc)
	return content
}

function rebasePatches(
	base: TextEntries,
	current: TextEntries,
	replacements: DocumentContentPatch[],
) {
	let positions = new Map(
		current.map((entry, index) => [entryId(entry), index]),
	)
	let patches: DocumentContentPatch[] = []
	for (let replacement of replacements) {
		let next = base[replacement.to]
		let previous = base[replacement.from - 1]
		let nextIndex = next ? positions.get(entryId(next)) : undefined
		let previousIndex = previous ? positions.get(entryId(previous)) : undefined
		let insertionIndex =
			nextIndex ?? (previousIndex === undefined ? undefined : previousIndex + 1)
		if (insertionIndex === undefined) {
			if (replacement.from === 0 && replacement.to === base.length)
				insertionIndex = 0
			else return
		}
		let removed = new Set(
			base.slice(replacement.from, replacement.to).map(entryId),
		)
		let start: number | undefined
		for (let index = 0; index <= current.length; index++) {
			let entry = current[index]
			if (entry && removed.has(entryId(entry))) start ??= index
			else if (start !== undefined) {
				patches.push({ from: start, to: index, inserted: "" })
				start = undefined
			}
		}
		if (replacement.inserted)
			patches.push({
				from: insertionIndex,
				to: insertionIndex,
				inserted: replacement.inserted,
			})
	}
	return patches.sort(
		(left, right) => left.from - right.from || left.to - right.to,
	)
}

function entryId(entry: TextEntries[number]) {
	let { sessionID, txIndex, changeIdx } = entry.opID
	return `${sessionID}/${txIndex}/${changeIdx}`
}

function entryOffsets(entries: TextEntries) {
	let cached = offsetsByEntries.get(entries)
	if (cached) return cached
	let editor: OffsetRun[] = [{ index: 0, offset: 0 }]
	let text: OffsetRun[] = [{ index: 0, offset: 0 }]
	let editorExtra = 0
	let textExtra = 0
	for (let index = 0; index < entries.length; index++) {
		let value = entries[index]?.value ?? ""
		if (value.length === 1) continue
		let editorLength = value.replace(/\r\n?/g, "\n").length
		if (editorLength !== 1) {
			editorExtra += editorLength - 1
			editor.push({ index: index + 1, offset: index + 1 + editorExtra })
		}
		textExtra += value.length - 1
		text.push({ index: index + 1, offset: index + 1 + textExtra })
	}
	let offsets = { editor, text, length: entries.length }
	offsetsByEntries.set(entries, offsets)
	return offsets
}

function offsetAt(runs: OffsetRun[], index: number) {
	let low = 0
	let high = runs.length - 1
	while (low < high) {
		let middle = (low + high + 1) >>> 1
		if ((runs[middle]?.index ?? Infinity) <= index) low = middle
		else high = middle - 1
	}
	let run = runs[low]
	return run ? run.offset + index - run.index : index
}

function boundaryIndex(offsets: EntryOffsets, offset: number) {
	if (offsets.editor.length === 1)
		return offset <= offsets.length ? offset : undefined
	let low = 0
	let high = offsets.length
	while (low < high) {
		let middle = (low + high) >>> 1
		if (offsetAt(offsets.editor, middle) < offset) low = middle + 1
		else high = middle
	}
	return offsetAt(offsets.editor, low) === offset ? low : undefined
}

function hasLoadedCommentAnchors(
	doc: BackgroundSaveDocument,
): doc is LoadedAnchorDocument {
	return (
		doc.comments === undefined ||
		(doc.comments.$isLoaded && doc.comments.every(thread => thread.$isLoaded))
	)
}
