import { describe, expect, test } from "bun:test"
import {
	alignPreview,
	bestOccurrence,
	renderedRange,
	sourceRange,
} from "../src/shared/preview-text"

let source = `---
title: Notes
---
# Opening **bold** words

See [the guide](https://example.com/guide) and *notes*.

- First item
- Second item with \`code\`

Opening again.`
let rendered =
	"Opening bold wordsSee the guide and notes.First itemSecond item with codeOpening again."

describe("preview text alignment", () => {
	test("a rendered selection maps to its exact source range", () => {
		let from = rendered.indexOf("the guide and notes")
		let range = sourceRange(source, rendered, from, from + 19)
		expect(range && source.slice(range.start, range.end)).toBe(
			"the guide](https://example.com/guide) and *notes",
		)
		let bold = rendered.indexOf("bold")
		let word = sourceRange(source, rendered, bold, bold + 4)
		expect(word && source.slice(word.start, word.end)).toBe("bold")
	})

	test("repeated text resolves to the selected occurrence", () => {
		let from = rendered.lastIndexOf("Opening")
		let range = sourceRange(source, rendered, from, from + 7)
		expect(range?.start).toBe(source.lastIndexOf("Opening"))
	})

	test("frontmatter never absorbs rendered text", () => {
		let positions = alignPreview("---\ntitle: Notes\n---\nNotes", "Notes")
		expect(positions[0]).toBe("---\ntitle: Notes\n---\n".length)
	})

	test("a source comment range highlights its rendered text", () => {
		let positions = alignPreview(source, rendered)
		let start = source.indexOf("Second item")
		let range = renderedRange(positions, start, start + "Second item".length)
		expect(range && rendered.slice(range.from, range.to)).toBe("Second item")
		expect(renderedRange(positions, 0, 3)).toBeUndefined()
	})

	test("text missing from the source does not derail later alignment", () => {
		let wiki = "Read [[abc123]] then continue."
		let shown = "Read Project plan then continue."
		let from = shown.indexOf("continue")
		let range = sourceRange(wiki, shown, from, from + 8)
		expect(range && wiki.slice(range.start, range.end)).toBe("continue")
	})

	test("context chooses between equal quotes", () => {
		let content = "alpha beta. gamma beta."
		expect(
			bestOccurrence(content, "beta", {
				contextBefore: "gamma ",
				contextAfter: ".",
				occurrence: 0,
			}),
		).toBe(content.lastIndexOf("beta"))
		expect(
			bestOccurrence(content, "beta", {
				contextBefore: "",
				contextAfter: "",
				occurrence: 1,
			}),
		).toBe(content.lastIndexOf("beta"))
	})
})
