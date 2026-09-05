import { describe, expect, test } from "vitest"
import {
	MAX_RICH_MARKDOWN_LENGTH,
	usesRichMarkdown,
} from "./editor-performance"

describe("editor performance mode", () => {
	test("uses the lightweight editor at and above the large-document limit", () => {
		expect(usesRichMarkdown(MAX_RICH_MARKDOWN_LENGTH - 1)).toBe(true)
		expect(usesRichMarkdown(MAX_RICH_MARKDOWN_LENGTH)).toBe(false)
		expect(usesRichMarkdown(MAX_RICH_MARKDOWN_LENGTH + 1)).toBe(false)
	})
})
