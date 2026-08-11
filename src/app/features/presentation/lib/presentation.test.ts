import { describe, it, expect } from "vitest"
import {
	parsePresentation,
	getPresentationMode,
	type PresentationItem,
} from "./presentation"

function getBlocks(items: PresentationItem[]) {
	return items
		.filter(i => i.type === "block")
		.map(i => (i as Extract<PresentationItem, { type: "block" }>).block)
}

function getBlocksForSlide(items: PresentationItem[], slideNumber: number) {
	return items
		.filter(i => i.type === "block" && i.slideNumber === slideNumber)
		.map(i => (i as Extract<PresentationItem, { type: "block" }>).block)
}

function getSlideNumbers(items: PresentationItem[]): number[] {
	return [...new Set(items.map(i => i.slideNumber))].sort((a, b) => a - b)
}

function isLineHighlighted(
	items: PresentationItem[],
	lineNum: number,
): boolean {
	return items.some(
		i =>
			i.type === "block" &&
			lineNum >= i.block.startLine &&
			lineNum <= i.block.endLine,
	)
}

describe("parsePresentation - slide content detection (iA rules)", () => {
	describe("headings (always on slide)", () => {
		it("detects h1-h6 headings", () => {
			expect(isLineHighlighted(parsePresentation("# Heading 1"), 0)).toBe(true)
			expect(isLineHighlighted(parsePresentation("## Heading 2"), 0)).toBe(true)
			expect(isLineHighlighted(parsePresentation("### Heading 3"), 0)).toBe(
				true,
			)
			expect(isLineHighlighted(parsePresentation("#### Heading 4"), 0)).toBe(
				true,
			)
			expect(isLineHighlighted(parsePresentation("##### Heading 5"), 0)).toBe(
				true,
			)
			expect(isLineHighlighted(parsePresentation("###### Heading 6"), 0)).toBe(
				true,
			)
		})

		it("requires space after hash", () => {
			expect(isLineHighlighted(parsePresentation("#NoSpace"), 0)).toBe(false)
			expect(isLineHighlighted(parsePresentation("##NoSpace"), 0)).toBe(false)
		})
	})

	describe("tab-indented content (on slide)", () => {
		it("detects tab-indented paragraphs", () => {
			expect(
				isLineHighlighted(parsePresentation("\tThis appears on slide"), 0),
			).toBe(true)
		})

		it("detects tab-indented lists", () => {
			expect(isLineHighlighted(parsePresentation("\t- List item"), 0)).toBe(
				true,
			)
			expect(isLineHighlighted(parsePresentation("\t+ Plus item"), 0)).toBe(
				true,
			)
			expect(isLineHighlighted(parsePresentation("\t* Star item"), 0)).toBe(
				true,
			)
			expect(
				isLineHighlighted(parsePresentation("\t1. Numbered item"), 0),
			).toBe(true)
			expect(isLineHighlighted(parsePresentation("\t- [ ] Task item"), 0)).toBe(
				true,
			)
			expect(
				isLineHighlighted(parsePresentation("\t- [x] Checked task"), 0),
			).toBe(true)
		})

		it("detects tab-indented blockquotes", () => {
			expect(isLineHighlighted(parsePresentation("\t> Quoted text"), 0)).toBe(
				true,
			)
			expect(
				isLineHighlighted(parsePresentation("\t> > Nested quote"), 0),
			).toBe(true)
		})

		it("detects tab-indented definition lists", () => {
			expect(isLineHighlighted(parsePresentation("\tMarkdown"), 0)).toBe(true)
			expect(
				isLineHighlighted(
					parsePresentation("\t: A lightweight markup language"),
					0,
				),
			).toBe(true)
		})
	})

	describe("space-indented content (on slide)", () => {
		it("detects 2+ space indented content", () => {
			expect(isLineHighlighted(parsePresentation("  Two spaces"), 0)).toBe(true)
			expect(isLineHighlighted(parsePresentation("    Four spaces"), 0)).toBe(
				true,
			)
		})

		it("rejects single space", () => {
			expect(isLineHighlighted(parsePresentation(" Single space"), 0)).toBe(
				false,
			)
		})
	})

	describe("code blocks (on slide)", () => {
		it("detects code fence markers", () => {
			expect(isLineHighlighted(parsePresentation("```\nx\n```"), 0)).toBe(true)
			expect(isLineHighlighted(parsePresentation("```js\nx\n```"), 0)).toBe(
				true,
			)
		})

		it("code block content is highlighted", () => {
			let items = parsePresentation("```js\nconst x = 1\ndef hello():\n```")
			expect(isLineHighlighted(items, 1)).toBe(true)
			expect(isLineHighlighted(items, 2)).toBe(true)
		})
	})

	describe("images (on slide)", () => {
		it("detects markdown images", () => {
			expect(
				isLineHighlighted(parsePresentation("![alt text](image.png)"), 0),
			).toBe(true)
			expect(isLineHighlighted(parsePresentation("![](image.png)"), 0)).toBe(
				true,
			)
			expect(
				isLineHighlighted(
					parsePresentation("![Chart](https://example.com/chart.png)"),
					0,
				),
			).toBe(true)
		})
	})

	describe("tables (on slide)", () => {
		it("detects table rows", () => {
			let items = parsePresentation(
				"| Name | Price |\n|:--|--:|\n| Widget | 10$ |",
			)
			expect(isLineHighlighted(items, 0)).toBe(true)
			expect(isLineHighlighted(items, 1)).toBe(true)
			expect(isLineHighlighted(items, 2)).toBe(true)
		})
	})

	describe("teleprompter content (NOT on slide)", () => {
		it("regular paragraphs are teleprompter only", () => {
			expect(
				isLineHighlighted(parsePresentation("Regular paragraph text"), 0),
			).toBe(false)
			expect(
				isLineHighlighted(parsePresentation("This is spoken text"), 0),
			).toBe(false)
		})

		it("non-indented lists are teleprompter only", () => {
			expect(isLineHighlighted(parsePresentation("- List item"), 0)).toBe(false)
			expect(isLineHighlighted(parsePresentation("1. Numbered item"), 0)).toBe(
				false,
			)
			expect(isLineHighlighted(parsePresentation("- [ ] Task"), 0)).toBe(false)
		})

		it("non-indented blockquotes are teleprompter only", () => {
			expect(isLineHighlighted(parsePresentation("> Quoted text"), 0)).toBe(
				false,
			)
		})

		it("empty content returns no items", () => {
			expect(parsePresentation("")).toHaveLength(0)
		})

		it("whitespace-only content returns no items", () => {
			expect(parsePresentation("   ")).toHaveLength(0)
			expect(parsePresentation("\t")).toHaveLength(0)
		})
	})
})

describe("getPresentationMode", () => {
	it("returns true for mode: present", () => {
		expect(getPresentationMode("---\nmode: present\n---\n# Slide")).toBe(true)
	})

	it("returns true for mode: presentation", () => {
		expect(getPresentationMode("---\nmode: presentation\n---\n# Slide")).toBe(
			true,
		)
	})

	it("returns true with extra frontmatter fields", () => {
		expect(
			getPresentationMode("---\ntitle: My Presentation\nmode: present\n---\n"),
		).toBe(true)
		expect(
			getPresentationMode(
				"---\ntitle: My Presentation\nmode: presentation\n---\n",
			),
		).toBe(true)
	})

	it("returns false without frontmatter", () => {
		expect(getPresentationMode("# Just a doc")).toBe(false)
	})

	it("returns false for other modes", () => {
		expect(getPresentationMode("---\nmode: draft\n---\n")).toBe(false)
	})
})

describe("parsePresentation - slide splitting", () => {
	it("splits by --- dividers", () => {
		let items = parsePresentation("# Slide 1\n---\n# Slide 2")
		let slideNums = getSlideNumbers(items)
		expect(slideNums).toEqual([1, 2])
	})

	it("skips frontmatter dividers", () => {
		let items = parsePresentation(
			"---\ntitle: Test\n---\n# Slide 1\n---\n# Slide 2",
		)
		let slideNums = getSlideNumbers(items)
		expect(slideNums).toEqual([1, 2])
	})

	it("sections without slide content still get slide numbers", () => {
		// Note: --- needs blank line before to be divider (not setext heading)
		let items = parsePresentation(
			"# Slide 1\n\n---\n\njust teleprompter text\n\n---\n\n# Slide 3",
		)
		let slideNums = getSlideNumbers(items)
		expect(slideNums).toEqual([1, 2, 3])
		// Slide 2 has teleprompter line but no block
		expect(getBlocksForSlide(items, 2)).toHaveLength(0)
	})
})

describe("parsePresentation - slide content extraction", () => {
	it("extracts headings with depth", () => {
		let items = parsePresentation("# H1\n## H2\n### H3")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "H1",
				segments: [{ type: "text", text: "H1" }],
			},
			{
				type: "heading",
				depth: 2,
				text: "H2",
				segments: [{ type: "text", text: "H2" }],
			},
			{
				type: "heading",
				depth: 3,
				text: "H3",
				segments: [{ type: "text", text: "H3" }],
			},
		])
	})

	it("extracts space-indented text", () => {
		let items = parsePresentation("# Hey\n  Text on Slide")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "Hey",
				segments: [{ type: "text", text: "Hey" }],
			},
			{
				type: "text",
				text: "Text on Slide",
				segments: [{ type: "text", text: "Text on Slide" }],
			},
		])
	})

	it("extracts tab-indented unordered lists", () => {
		let items = parsePresentation("# Shopping\n\t- Milk\n\t- Bread")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "Shopping",
				segments: [{ type: "text", text: "Shopping" }],
			},
			{
				type: "list",
				items: [
					{ text: "Milk", segments: [{ type: "text", text: "Milk" }] },
					{ text: "Bread", segments: [{ type: "text", text: "Bread" }] },
				],
				ordered: false,
			},
		])
	})

	it("extracts tab-indented ordered lists", () => {
		let items = parsePresentation("# Steps\n\t1. First\n\t2. Second")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "Steps",
				segments: [{ type: "text", text: "Steps" }],
			},
			{
				type: "list",
				items: [
					{ text: "First", segments: [{ type: "text", text: "First" }] },
					{ text: "Second", segments: [{ type: "text", text: "Second" }] },
				],
				ordered: true,
			},
		])
	})

	it("extracts tab-indented blockquotes", () => {
		let items = parsePresentation("# Quote\n\t> To be or not to be")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "Quote",
				segments: [{ type: "text", text: "Quote" }],
			},
			{
				type: "blockquote",
				text: "To be or not to be",
				segments: [{ type: "text", text: "To be or not to be" }],
			},
		])
	})

	it("extracts tables", () => {
		let items = parsePresentation("# Data\n| A | B |\n|--|--|\n| 1 | 2 |")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "Data",
				segments: [{ type: "text", text: "Data" }],
			},
			{
				type: "table",
				rows: [
					["A", "B"],
					["1", "2"],
				],
			},
		])
	})

	it("extracts code blocks with language", () => {
		let items = parsePresentation("# Code\n```js\nconst x = 1\n```")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "Code",
				segments: [{ type: "text", text: "Code" }],
			},
			{ type: "code", text: "const x = 1", language: "js" },
		])
	})

	it("extracts language from code fence metadata", () => {
		let items = parsePresentation(
			"# Code\n```ts {1} title=demo\nlet x = 1\n```",
		)
		let blocks = getBlocks(items)

		expect(blocks[0].content[1]).toEqual({
			type: "code",
			text: "let x = 1",
			language: "ts",
		})
	})

	it("extracts code blocks without language", () => {
		let items = parsePresentation("# Code\n```\nsome code\n```")
		let blocks = getBlocks(items)

		expect(blocks[0].content[1]).toEqual({
			type: "code",
			text: "some code",
			language: undefined,
		})
	})

	it("extracts multiline code blocks", () => {
		let items = parsePresentation(
			"# Code\n```python\ndef hello():\n    print('hi')\n```",
		)
		let blocks = getBlocks(items)

		expect(blocks[0].content[1]).toEqual({
			type: "code",
			text: "def hello():\n    print('hi')",
			language: "python",
		})
	})

	it("extracts images", () => {
		let items = parsePresentation("# Diagram\n![Flow chart](chart.png)")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "Diagram",
				segments: [{ type: "text", text: "Diagram" }],
			},
			{ type: "image", alt: "Flow chart", src: "chart.png" },
		])
	})
})

describe("parsePresentation - visual blocks", () => {
	it("creates single block when no blank lines", () => {
		let items = parsePresentation("## Carl Assmann\n# Amazing TypeScript Talk")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 2,
				text: "Carl Assmann",
				segments: [{ type: "text", text: "Carl Assmann" }],
			},
			{
				type: "heading",
				depth: 1,
				text: "Amazing TypeScript Talk",
				segments: [{ type: "text", text: "Amazing TypeScript Talk" }],
			},
		])
	})

	it("creates multiple blocks separated by blank lines", () => {
		let items = parsePresentation("# left side\n\n# right side")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(2)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "left side",
				segments: [{ type: "text", text: "left side" }],
			},
		])
		expect(blocks[1].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "right side",
				segments: [{ type: "text", text: "right side" }],
			},
		])
	})

	it("preserves line numbers in blocks", () => {
		let items = parsePresentation("# First\n\n# Second\n\n# Third")
		let blocks = getBlocks(items)

		expect(blocks[0].startLine).toBe(0)
		expect(blocks[0].endLine).toBe(0)
		expect(blocks[1].startLine).toBe(2)
		expect(blocks[1].endLine).toBe(2)
		expect(blocks[2].startLine).toBe(4)
		expect(blocks[2].endLine).toBe(4)
	})

	it("handles kicker pattern (subtitle above title)", () => {
		let items = parsePresentation("  Introduction\n# Main Title")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "text",
				text: "Introduction",
				segments: [{ type: "text", text: "Introduction" }],
			},
			{
				type: "heading",
				depth: 1,
				text: "Main Title",
				segments: [{ type: "text", text: "Main Title" }],
			},
		])
	})

	it("groups code block as single block", () => {
		let items = parsePresentation("```js\nconst x = 1\nconst y = 2\n```")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{ type: "code", text: "const x = 1\nconst y = 2", language: "js" },
		])
	})

	it("does not split code block at internal blank lines", () => {
		let items = parsePresentation("```js\nconst x = 1\n\nconst y = 2\n```")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content[0]).toEqual({
			type: "code",
			text: "const x = 1\n\nconst y = 2",
			language: "js",
		})
	})

	it("teleprompter-only text appears as line items", () => {
		let items = parsePresentation("# Title\n\nThis is teleprompter text")

		let blocks = items.filter(i => i.type === "block")
		let lines = items.filter(i => i.type === "line")

		expect(blocks).toHaveLength(1)
		expect(lines).toHaveLength(1)
		expect(lines[0].type === "line" && lines[0].text).toBe(
			"This is teleprompter text",
		)
	})

	it("keeps non-indented list items as teleprompter lines", () => {
		let items = parsePresentation(`---
mode: present
title: QA Teleprompter
---
# Slide One

Opening line

---

# Slide Two

- First
- Second

---

# Slide Three

Closing line`)

		let slideTwoLines = items.flatMap(item =>
			item.type === "line" && item.slideNumber === 2 ? [item.text] : [],
		)

		expect(slideTwoLines).toEqual(["First", "Second"])
	})

	it("handles mixed content - teleprompter text as separate items", () => {
		let items = parsePresentation(
			"# Title\n  Subtitle\n\n# Another\nSpeaker notes",
		)

		let blocks = getBlocks(items)
		let lines = items.filter(i => i.type === "line")

		expect(blocks).toHaveLength(2)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "Title",
				segments: [{ type: "text", text: "Title" }],
			},
			{
				type: "text",
				text: "Subtitle",
				segments: [{ type: "text", text: "Subtitle" }],
			},
		])
		expect(blocks[1].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "Another",
				segments: [{ type: "text", text: "Another" }],
			},
		])
		expect(lines).toHaveLength(1)
		expect(lines[0].type === "line" && lines[0].text).toBe("Speaker notes")
	})

	it("creates blocks across slide sections", () => {
		let items = parsePresentation("# Slide 1\n\n# Block 2\n---\n# Slide 2")

		expect(getBlocksForSlide(items, 1)).toHaveLength(2)
		expect(getBlocksForSlide(items, 2)).toHaveLength(1)
	})
})

describe("iA Presenter real-world examples", () => {
	it("slide with heading and teleprompter notes", () => {
		let items = parsePresentation(`# Welcome to the Presentation

This is what I'll say to introduce the topic.
The audience won't see this text.`)

		let blocks = getBlocks(items)
		let lines = items.filter(i => i.type === "line")

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "heading",
				depth: 1,
				text: "Welcome to the Presentation",
				segments: [{ type: "text", text: "Welcome to the Presentation" }],
			},
		])
		expect(lines).toHaveLength(2)
	})

	it("slide with visible bullet points", () => {
		let items = parsePresentation(`# Shopping List

Here's what we need:

\t- Milk
\t- Bread
\t- Eggs`)

		let blocks = getBlocks(items)
		let lines = items.filter(i => i.type === "line")

		expect(blocks).toHaveLength(2)
		expect(blocks[1].content[0]).toEqual({
			type: "list",
			items: [
				{ text: "Milk", segments: [{ type: "text", text: "Milk" }] },
				{ text: "Bread", segments: [{ type: "text", text: "Bread" }] },
				{ text: "Eggs", segments: [{ type: "text", text: "Eggs" }] },
			],
			ordered: false,
		})
		expect(lines).toHaveLength(1)
	})

	it("slide with visible blockquote", () => {
		let items = parsePresentation(`# Quote

\t> The only way to do great work
\t> is to love what you do.`)

		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(2)
		expect(blocks[1].content[0]).toEqual({
			type: "blockquote",
			text: "The only way to do great work\nis to love what you do.",
			segments: [
				{
					type: "text",
					text: "The only way to do great work\nis to love what you do.",
				},
			],
		})
	})

	it("slide with code", () => {
		let items = parsePresentation(`# Hello World

Here's the code:

\`\`\`python
print("Hello!")
\`\`\``)

		let blocks = getBlocks(items)
		let lines = items.filter(i => i.type === "line")

		expect(blocks).toHaveLength(2)
		expect(blocks[1].content[0]).toEqual({
			type: "code",
			text: 'print("Hello!")',
			language: "python",
		})
		expect(lines).toHaveLength(1)
	})

	it("slide with image", () => {
		let items = parsePresentation(`# Architecture

![System diagram](diagram.png)

As you can see here...`)

		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(2)
		expect(blocks[1].content[0]).toEqual({
			type: "image",
			alt: "System diagram",
			src: "diagram.png",
		})
	})

	it("slide with image and indented text in same visual block", () => {
		let items = parsePresentation(`![alt](image.png)
  Hello World!`)

		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{ type: "image", alt: "alt", src: "image.png" },
			{
				type: "text",
				text: "Hello World!",
				segments: [{ type: "text", text: "Hello World!" }],
			},
		])
	})

	it("full presentation with frontmatter", () => {
		let items = parsePresentation(`---
mode: present
title: My Talk
---

# Opening

Welcome everyone!

---

# Main Point

\t- Key insight 1
\t- Key insight 2

Let me explain...

---

# Closing

Thank you!`)

		let slideNums = getSlideNumbers(items)
		expect(slideNums).toEqual([1, 2, 3])

		let slide2Blocks = getBlocksForSlide(items, 2)
		expect(slide2Blocks).toHaveLength(2)
		expect(slide2Blocks[1].content[0]).toEqual({
			type: "list",
			items: [
				{
					text: "Key insight 1",
					segments: [{ type: "text", text: "Key insight 1" }],
				},
				{
					text: "Key insight 2",
					segments: [{ type: "text", text: "Key insight 2" }],
				},
			],
			ordered: false,
		})
	})

	it("two-column layout with blank line separator", () => {
		let items = parsePresentation(`# Left Column

# Right Column`)

		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(2)
		expect(blocks[0].content[0]).toEqual({
			type: "heading",
			depth: 1,
			text: "Left Column",
			segments: [{ type: "text", text: "Left Column" }],
		})
		expect(blocks[1].content[0]).toEqual({
			type: "heading",
			depth: 1,
			text: "Right Column",
			segments: [{ type: "text", text: "Right Column" }],
		})
	})

	it("title with kicker (subtitle above)", () => {
		let items = parsePresentation(`  Carl Assmann
# TypeScript Best Practices`)

		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toEqual([
			{
				type: "text",
				text: "Carl Assmann",
				segments: [{ type: "text", text: "Carl Assmann" }],
			},
			{
				type: "heading",
				depth: 1,
				text: "TypeScript Best Practices",
				segments: [{ type: "text", text: "TypeScript Best Practices" }],
			},
		])
	})
})

describe("edge cases", () => {
	it("handles empty content", () => {
		let items = parsePresentation("")
		expect(items).toHaveLength(0)
	})

	it("handles content with only teleprompter text", () => {
		let items = parsePresentation("just text\nno slides here")
		let blocks = getBlocks(items)
		expect(blocks).toHaveLength(0)
		// But there should be line items
		expect(items.filter(i => i.type === "line")).toHaveLength(2)
	})

	it("handles whitespace-only sections", () => {
		let items = parsePresentation("# A\n---\n   \n\n---\n# B")
		let slideNums = getSlideNumbers(items)
		// Empty sections are skipped, so we get slides 1 and 2
		expect(slideNums).toEqual([1, 2])
	})

	it("handles unclosed code block", () => {
		let items = parsePresentation("# Title\n```js\nconst x = 1")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content).toHaveLength(2)
		expect(blocks[0].content[1].type).toBe("code")
	})

	it("handles slide with only indented content", () => {
		let items = parsePresentation("\t- Point 1\n\t- Point 2")
		let blocks = getBlocks(items)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].content[0]).toEqual({
			type: "list",
			items: [
				{ text: "Point 1", segments: [{ type: "text", text: "Point 1" }] },
				{ text: "Point 2", segments: [{ type: "text", text: "Point 2" }] },
			],
			ordered: false,
		})
	})
})

describe("editor decorations - line highlighting", () => {
	// Helper to get all highlighted line numbers
	function getHighlightedLines(items: PresentationItem[]): number[] {
		let lines: number[] = []
		for (let item of items) {
			if (item.type === "block") {
				for (let i = item.block.startLine; i <= item.block.endLine; i++) {
					lines.push(i)
				}
			}
		}
		return [...new Set(lines)].sort((a, b) => a - b)
	}

	it("only highlights heading, not blank lines around it", () => {
		let content = `---
mode: present
---

# Title

teleprompter text`
		// Lines: 0-2 frontmatter, 3 empty, 4 heading, 5 empty, 6 teleprompter
		let items = parsePresentation(content)
		let highlighted = getHighlightedLines(items)

		expect(highlighted).toEqual([4])
		expect(isLineHighlighted(items, 3)).toBe(false) // empty before
		expect(isLineHighlighted(items, 4)).toBe(true) // heading
		expect(isLineHighlighted(items, 5)).toBe(false) // empty after
		expect(isLineHighlighted(items, 6)).toBe(false) // teleprompter
	})

	it("highlights heading and indented text together, not blank line between", () => {
		let content = `# Title
  Subtitle on slide

teleprompter`
		// Lines: 0 heading, 1 indented, 2 empty, 3 teleprompter
		let items = parsePresentation(content)
		let highlighted = getHighlightedLines(items)

		expect(highlighted).toEqual([0, 1])
		expect(isLineHighlighted(items, 2)).toBe(false) // empty
		expect(isLineHighlighted(items, 3)).toBe(false) // teleprompter
	})

	it("does not highlight blank lines between visual blocks", () => {
		let content = `# First Block

# Second Block`
		// Lines: 0 heading, 1 empty, 2 heading
		let items = parsePresentation(content)
		let highlighted = getHighlightedLines(items)

		expect(highlighted).toEqual([0, 2])
		expect(isLineHighlighted(items, 1)).toBe(false) // blank line
	})

	it("highlights entire code block including fences", () => {
		let content = `# Title

\`\`\`js
const x = 1
const y = 2
\`\`\`

teleprompter`
		// Lines: 0 heading, 1 empty, 2 fence, 3-4 code, 5 fence, 6 empty, 7 teleprompter
		let items = parsePresentation(content)
		let highlighted = getHighlightedLines(items)

		expect(highlighted).toContain(0) // heading
		expect(highlighted).toContain(2) // opening fence
		expect(highlighted).toContain(3) // code
		expect(highlighted).toContain(4) // code
		expect(highlighted).toContain(5) // closing fence
		expect(isLineHighlighted(items, 1)).toBe(false) // empty before code
		expect(isLineHighlighted(items, 6)).toBe(false) // empty after code
		expect(isLineHighlighted(items, 7)).toBe(false) // teleprompter
	})

	it("does not highlight teleprompter text between slide content", () => {
		let content = `# First heading

teleprompter line 1
teleprompter line 2

# Second heading`
		// Lines: 0 heading, 1 empty, 2-3 teleprompter, 4 empty, 5 heading
		let items = parsePresentation(content)
		let highlighted = getHighlightedLines(items)

		expect(highlighted).toEqual([0, 5])
		expect(isLineHighlighted(items, 2)).toBe(false)
		expect(isLineHighlighted(items, 3)).toBe(false)
	})

	it("handles complex example with frontmatter and multiple slides", () => {
		let content = `---
title: Demo
mode: present
---

# Hello Jazz

This is teleprompter.

---

# Slide 2
  indented subtitle

\`\`\`tsx
code here
\`\`\`

teleprompter between

# Another heading`
		let items = parsePresentation(content)

		// Lines: 0-3 frontmatter, 4 empty, 5 heading, 6 empty, 7 teleprompter, 8 empty, 9 ---, 10 empty,
		//        11 heading, 12 indented, 13 empty, 14-16 code, 17 empty, 18 teleprompter, 19 empty, 20 heading

		// Slide 1
		expect(isLineHighlighted(items, 4)).toBe(false) // empty after frontmatter
		expect(isLineHighlighted(items, 5)).toBe(true) // # Hello Jazz
		expect(isLineHighlighted(items, 6)).toBe(false) // empty
		expect(isLineHighlighted(items, 7)).toBe(false) // teleprompter

		// Slide 2
		expect(isLineHighlighted(items, 10)).toBe(false) // empty after ---
		expect(isLineHighlighted(items, 11)).toBe(true) // # Slide 2
		expect(isLineHighlighted(items, 12)).toBe(true) // indented subtitle
		expect(isLineHighlighted(items, 13)).toBe(false) // empty
		expect(isLineHighlighted(items, 14)).toBe(true) // ```tsx
		expect(isLineHighlighted(items, 15)).toBe(true) // code here
		expect(isLineHighlighted(items, 16)).toBe(true) // ```
		expect(isLineHighlighted(items, 17)).toBe(false) // empty
		expect(isLineHighlighted(items, 18)).toBe(false) // teleprompter between
		expect(isLineHighlighted(items, 19)).toBe(false) // empty
		expect(isLineHighlighted(items, 20)).toBe(true) // # Another heading
	})

	it("handles table highlighting", () => {
		let content = `# Data

| A | B |
|---|---|
| 1 | 2 |

notes`
		// Lines: 0 heading, 1 empty, 2-4 table, 5 empty, 6 notes
		let items = parsePresentation(content)

		expect(isLineHighlighted(items, 0)).toBe(true) // heading
		expect(isLineHighlighted(items, 1)).toBe(false) // empty
		expect(isLineHighlighted(items, 2)).toBe(true) // table header
		expect(isLineHighlighted(items, 3)).toBe(true) // table separator
		expect(isLineHighlighted(items, 4)).toBe(true) // table row
		expect(isLineHighlighted(items, 5)).toBe(false) // empty
		expect(isLineHighlighted(items, 6)).toBe(false) // notes
	})

	it("handles image highlighting", () => {
		let content = `# Title

![alt](image.png)

notes`
		// Lines: 0 heading, 1 empty, 2 image, 3 empty, 4 notes
		let items = parsePresentation(content)

		expect(isLineHighlighted(items, 0)).toBe(true)
		expect(isLineHighlighted(items, 1)).toBe(false)
		expect(isLineHighlighted(items, 2)).toBe(true)
		expect(isLineHighlighted(items, 3)).toBe(false)
		expect(isLineHighlighted(items, 4)).toBe(false)
	})

	it("does not highlight non-indented lists", () => {
		let content = `# Title

- item 1
- item 2`
		// Lines: 0 heading, 1 empty, 2-3 non-indented list
		let items = parsePresentation(content)

		expect(isLineHighlighted(items, 0)).toBe(true) // heading
		expect(isLineHighlighted(items, 2)).toBe(false) // non-indented list
		expect(isLineHighlighted(items, 3)).toBe(false) // non-indented list
	})

	it("does not highlight non-indented list after indented list (marked merges them)", () => {
		let content = `# Title
  - visible
  - also visible

- teleprompter
- also teleprompter`
		// Lines: 0 heading, 1-2 indented, 3-4 empty, 5-6 non-indented
		let items = parsePresentation(content)

		expect(isLineHighlighted(items, 0)).toBe(true) // heading
		expect(isLineHighlighted(items, 1)).toBe(true) // indented
		expect(isLineHighlighted(items, 2)).toBe(true) // indented
		expect(isLineHighlighted(items, 3)).toBe(false) // empty
		expect(isLineHighlighted(items, 4)).toBe(false) // empty
		expect(isLineHighlighted(items, 5)).toBe(false) // non-indented
		expect(isLineHighlighted(items, 6)).toBe(false) // non-indented
	})

	it("highlights standalone tab-indented lists", () => {
		let content = `# Title

\t- indented item 1
\t- indented item 2`
		// Lines: 0 heading, 1 empty, 2-3 indented list
		let items = parsePresentation(content)

		expect(isLineHighlighted(items, 0)).toBe(true) // heading
		expect(isLineHighlighted(items, 2)).toBe(true) // indented list
		expect(isLineHighlighted(items, 3)).toBe(true) // indented list
	})
})
