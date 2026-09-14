import { describe, expect, it } from "vitest"
import { mergeFileContent } from "./merge-file-content"

describe("merging external file edits", () => {
	it("keeps independent edits from both editors", () => {
		expect(
			mergeFileContent("first\nlast", "FIRST\nlast", "first\nLAST"),
		).toEqual({ content: "FIRST\nLAST", conflict: false })
	})

	it("preserves the local draft when edits overlap", () => {
		expect(mergeFileContent("one two", "one mine", "one theirs")).toEqual({
			content: "one mine",
			conflict: true,
		})
	})
})
