import { describe, expect, test } from "vitest"
import { mergeDocumentContent } from "./merge-document-content"

describe("mergeDocumentContent", () => {
	test("preserves non-overlapping local and remote edits", () => {
		expect(
			mergeDocumentContent(
				"# Draft\n\nBody",
				"# Draft\n\nLocal Body",
				"# Draft\n\nBody\n\nRemote note",
			),
		).toBe("# Draft\n\nLocal Body\n\nRemote note")
	})

	test("preserves both insertions at the same position", () => {
		expect(mergeDocumentContent("ac", "abc", "a💚c")).toBe("a💚bc")
	})

	test("keeps remote content when there is no local edit", () => {
		expect(mergeDocumentContent("before", "before", "after")).toBe("after")
	})
})
