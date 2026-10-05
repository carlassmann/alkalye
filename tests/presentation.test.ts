import { describe, expect, test } from "bun:test"
import { slides } from "../src/shared/markdown"
import {
	groupBySlide,
	itemProgress,
	presentationItems,
	slideStart,
	stepItem,
	stepSlide,
	type PresentationItem,
} from "../src/shared/presentation"

function visuals(items: PresentationItem[]) {
	return items.flatMap(item => (item.kind === "visual" ? [item] : []))
}
function notes(items: PresentationItem[]) {
	return items.flatMap(item => (item.kind === "note" ? [item.text] : []))
}
function visible(source: string, line: number) {
	return visuals(presentationItems(source)).some(
		item => line >= item.start && line <= item.end,
	)
}
function highlighted(source: string) {
	return visuals(presentationItems(source)).flatMap(item =>
		Array.from({ length: item.end - item.start + 1 }, (_, i) => item.start + i),
	)
}

describe("slide content follows iA Presenter rules", () => {
	test("headings, indented text, code, images and tables reach the slide", () => {
		for (let source of [
			"# Heading",
			"###### Heading 6",
			"\tTab indented",
			"  Two spaces",
			"\t- List item",
			"\t1. Numbered",
			"\t> Quote",
			"```\nx\n```",
			"![alt](image.png)",
			"| A | B |\n|--|--|\n| 1 | 2 |",
		])
			expect(visible(source, 0)).toBe(true)
	})

	test("plain paragraphs, lists and quotes stay with the speaker", () => {
		for (let source of [
			"#NoSpace",
			" Single space",
			"Regular paragraph",
			"- List item",
			"1. Numbered",
			"- [ ] Task",
			"> Quoted",
		])
			expect(visible(source, 0)).toBe(false)
		expect(notes(presentationItems("- [ ] Task\n> Quoted"))).toEqual([
			"Task",
			"Quoted",
		])
	})

	test("whitespace separators are never selectable items or visual source ranges", () => {
		for (let separator of ["", " ", "  ", "\t", " \t  ", "\r"]) {
			let items = presentationItems(
				`# Title\n${separator}\nFirst note\n${separator}\nSecond note\n${separator}`,
			)
			expect(items).toEqual([
				{ kind: "visual", slide: 0, start: 0, end: 0, source: "# Title" },
				{ kind: "note", slide: 0, line: 2, text: "First note" },
				{ kind: "note", slide: 0, line: 4, text: "Second note" },
			])
			expect(stepItem(items, 0, 1)).toBe(1)
			expect(itemProgress(items, 1)).toBe(2 / 3)
		}
	})

	test("indented whitespace separates visual blocks without extending their ranges", () => {
		expect(visuals(presentationItems("# First\n  \n\t\n# Second"))).toEqual([
			{ kind: "visual", slide: 0, start: 0, end: 0, source: "# First" },
			{ kind: "visual", slide: 0, start: 3, end: 3, source: "# Second" },
		])
	})
	test("blank lines inside fences remain part of their visual block", () => {
		for (let marker of ["```", "~~~"]) {
			let source = `${marker}txt\nfirst\n\n \nlast\n${marker}`
			expect(presentationItems(source)).toEqual([
				{ kind: "visual", slide: 0, start: 0, end: 5, source },
			])
		}
	})
	test("empty spoken quote markers do not become selectable notes", () => {
		expect(notes(presentationItems("# Title\n> \nSpoken"))).toEqual(["Spoken"])
	})
	test("empty and whitespace documents have no items", () => {
		expect(presentationItems("")).toEqual([])
		expect(presentationItems("   \n\t")).toEqual([])
	})
})

describe("slides and visual blocks", () => {
	test("slide indices skip frontmatter and empty sections and match slides()", () => {
		let source =
			"---\ntitle: T\n---\n# A\n---\n   \n\n---\nnotes only\n---\n# C"
		let items = presentationItems(source)
		expect(groupBySlide(items).map(group => group.slide)).toEqual([0, 1, 2])
		expect(slides(source)).toHaveLength(3)
		expect(visuals(items).filter(item => item.slide === 1)).toEqual([])
	})

	test("dividers inside code fences do not split slides", () => {
		let items = presentationItems("# A\n```\n---\n```\n---\n# B")
		expect(groupBySlide(items)).toHaveLength(2)
		expect(visuals(items)[0]?.source).toBe("# A\n```\n---\n```")
	})

	test("consecutive visual lines form one block and blank lines split blocks", () => {
		let items = presentationItems(
			"  Kicker\n# Title\n\n# Right\n\n\t- Milk\n\t- Bread",
		)
		expect(visuals(items).map(item => item.source)).toEqual([
			"Kicker\n# Title",
			"# Right",
			"- Milk\n- Bread",
		])
		expect(visuals(items).map(item => [item.start, item.end])).toEqual([
			[0, 1],
			[3, 3],
			[5, 6],
		])
	})

	test("code blocks keep internal blank lines and unclosed fences", () => {
		expect(visuals(presentationItems("```js\na\n\nb\n```"))).toHaveLength(1)
		expect(visuals(presentationItems("# T\n```js\nconst x = 1"))[0]).toEqual({
			kind: "visual",
			slide: 0,
			start: 0,
			end: 2,
			source: "# T\n```js\nconst x = 1",
		})
	})

	test("speaker lines split blocks and keep their document line", () => {
		let items = presentationItems(
			"# Title\n  Subtitle\n\n# Another\nSpeaker notes",
		)
		expect(items.map(item => item.kind)).toEqual(["visual", "visual", "note"])
		expect(items[2]).toEqual({
			kind: "note",
			slide: 0,
			line: 4,
			text: "Speaker notes",
		})
	})

	test("highlighted lines exclude blanks and speaker text", () => {
		let source = `---
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
		expect(highlighted(source)).toEqual([5, 11, 12, 14, 15, 16, 20])
		expect(
			highlighted("# Title\n  - visible\n  - also\n\n- spoken\n- also"),
		).toEqual([0, 1, 2])
	})

	test("a full talk keeps visible bullets and spoken lines per slide", () => {
		let items = presentationItems(`---
mode: present
---

# Opening

Welcome everyone!

---

# Main Point

\t- Key insight 1
\t- Key insight 2

Let me explain...`)
		expect(
			items.map(item => [
				item.slide,
				item.kind === "visual" ? item.source : item.text,
			]),
		).toEqual([
			[0, "# Opening"],
			[0, "Welcome everyone!"],
			[1, "# Main Point"],
			[1, "- Key insight 1\n- Key insight 2"],
			[1, "Let me explain..."],
		])
	})
})

describe("navigation", () => {
	let items = presentationItems(
		"Intro\n# One\nsay\n---\n# Two\na\nb\n---\nonly notes",
	)

	test("items step within bounds and start from the first item", () => {
		expect(stepItem(items, undefined, 1)).toBe(0)
		expect(stepItem(items, 0, -1)).toBe(0)
		expect(stepItem(items, 2, 1)).toBe(3)
		expect(stepItem(items, items.length - 1, 1)).toBe(items.length - 1)
		expect(stepItem([], undefined, 1)).toBeUndefined()
	})

	test("slide jumps land on the first visual block, or the first line", () => {
		expect(slideStart(items, 0)).toBe(1)
		expect(stepSlide(items, 1, 1)).toBe(3)
		expect(stepSlide(items, 3, 1)).toBe(6)
		expect(stepSlide(items, 6, 1)).toBe(6)
		expect(stepSlide(items, 4, -1)).toBe(1)
	})

	test("progress fills each slide's share item by item", () => {
		expect(itemProgress(items, undefined)).toBe(0)
		expect(itemProgress(items, 0)).toBeCloseTo(1 / 9)
		expect(itemProgress(items, 2)).toBeCloseTo(1 / 3)
		expect(itemProgress(items, 4)).toBeCloseTo(1 / 3 + 2 / 9)
		expect(itemProgress(items, 6)).toBe(1)
	})
})
