import { describe, expect, test } from "vitest"
import { splitGraphemes } from "unicode-segmenter/grapheme"
import { calculateDocumentContentPatches } from "./document-diff"

describe("document content diff", () => {
	test("preserves grapheme boundaries", () => {
		let oldContent = "One 👨‍👩‍👧‍👦 line\nSecond line"
		let newContent = "One 👨‍👩‍👧‍👦 revised\nSecond line!"
		let content = Array.from(splitGraphemes(oldContent))

		for (let patch of calculateDocumentContentPatches(
			oldContent,
			newContent,
		).reverse()) {
			content.splice(
				patch.from,
				patch.to - patch.from,
				...splitGraphemes(patch.inserted),
			)
		}

		expect(content.join("")).toBe(newContent)
	})
})
