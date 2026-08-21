import { describe, expect, it } from "vitest"
import { getDocumentHeadings } from "./document-navigation"

describe("document outline", () => {
	it("collects ATX and setext headings with positions", () => {
		let content = "# Title\n\nCopy\n\nSection\n---\n\n### Detail"

		expect(getDocumentHeadings(content)).toEqual([
			{ level: 1, title: "Title", from: 0, line: 1 },
			{ level: 2, title: "Section", from: 15, line: 5 },
			{ level: 3, title: "Detail", from: 28, line: 8 },
		])
	})

	it("ignores headings inside fenced code", () => {
		let content = "# Visible\n\n```md\n# Hidden\n```\n\n## Also visible"

		expect(getDocumentHeadings(content).map(heading => heading.title)).toEqual([
			"Visible",
			"Also visible",
		])
	})

	it("supports tilde fences and closing hashes", () => {
		let content = "~~~\n## Hidden\n~~~\n## Visible ##"

		expect(getDocumentHeadings(content)).toEqual([
			{ level: 2, title: "Visible", from: 18, line: 4 },
		])
	})

	it("requires a closing fence at least as long as its opener", () => {
		let content = "````\n# Hidden\n```\n## Still hidden\n````\n# Visible"

		expect(getDocumentHeadings(content).map(heading => heading.title)).toEqual([
			"Visible",
		])
	})

	it("does not close a fence when text follows the marker", () => {
		let content =
			"```\n# Hidden\n``` not closed\n## Still hidden\n```\n# Visible"

		expect(getDocumentHeadings(content).map(heading => heading.title)).toEqual([
			"Visible",
		])
	})

	it("ignores frontmatter without shifting heading positions", () => {
		let content = "---\ntags: qa, sync\n---\n# Visible"

		expect(getDocumentHeadings(content)).toEqual([
			{ level: 1, title: "Visible", from: 23, line: 4 },
		])
	})

	it("does not treat thematic breaks as setext heading text", () => {
		let content = "* * *\n---\n\n---\n-\n\n# Visible"

		expect(getDocumentHeadings(content).map(heading => heading.title)).toEqual([
			"Visible",
		])
	})
})
