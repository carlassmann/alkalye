import type { co } from "jazz-tools"

export { readDocumentText, cacheDocumentText }
export type { DocumentText, TextEntries }

type DocumentText = co.loaded<ReturnType<typeof co.plainText>>
type TextEntries = ReturnType<DocumentText["$jazz"]["raw"]["entries"]>

let textByEntries = new WeakMap<TextEntries, string>()

function readDocumentText(content: DocumentText) {
	let entries = content.$jazz.raw.entries()
	let text = textByEntries.get(entries)
	if (text === undefined) {
		text = entries.map(entry => entry.value).join("")
		textByEntries.set(entries, text)
	}
	return text
}

function cacheDocumentText(content: DocumentText, text: string) {
	textByEntries.set(content.$jazz.raw.entries(), text)
}
