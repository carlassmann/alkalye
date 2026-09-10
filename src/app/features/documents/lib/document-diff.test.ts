import { describe, expect, test } from "vitest"
import { splitGraphemes } from "unicode-segmenter/grapheme"
import { calculateDocumentContentPatches } from "./document-diff"

describe("document content diff", () => {
	test("bounds patch work for a large replacement while preserving surrounding text", () => {
		let prefix = "Title 👨‍👩‍👧‍👦\n"
		let suffix = "\nKeep this footer"
		let oldContent =
			prefix + "color: red;\npadding: 2rem;\n".repeat(400) + suffix
		let newContent =
			prefix + "background: blue;\nmargin: 1px;\n".repeat(300) + suffix
		let entries = Array.from(splitGraphemes(oldContent))
		let patches = calculateDocumentContentPatches(entries, newContent)
		expect(patches.length).toBeLessThan(100)
		for (let patch of patches.reverse()) {
			expect(patch.from).toBeGreaterThanOrEqual(
				Array.from(splitGraphemes(prefix)).length,
			)
			expect(patch.to).toBeLessThanOrEqual(
				Array.from(splitGraphemes(oldContent.slice(0, -suffix.length))).length,
			)
			entries.splice(
				patch.from,
				patch.to - patch.from,
				...splitGraphemes(patch.inserted),
			)
		}
		expect(entries.join("")).toBe(newContent)
	})

	test("preserves grapheme boundaries", () => {
		let oldContent = "One 👨‍👩‍👧‍👦 line\nSecond line"
		let newContent = "One 👨‍👩‍👧‍👦 revised\nSecond line!"
		let content = Array.from(splitGraphemes(oldContent))

		for (let patch of calculateDocumentContentPatches(
			content,
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

	test("uses persisted entry indexes when graphemes merge across saves", () => {
		let content = ["e", "\u0301", "x"]
		let newContent = "e\u0301!x"

		for (let patch of calculateDocumentContentPatches(
			content,
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
