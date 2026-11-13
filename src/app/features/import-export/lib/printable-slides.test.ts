import { describe, expect, test } from "vitest"
import { JSDOM } from "jsdom"
import { parsePresentation } from "@/app/features/presentation/lib/presentation"
import { buildPrintableSlides, groupPrintedSlides } from "./printable-slides"
import type { PrintTheme } from "./printable-html"

describe("groupPrintedSlides", () => {
	test("gives notes from slides without visuals to the slide on screen", () => {
		let slides = groupPrintedSlides(parsePresentation(deck))

		expect(slides.map(slide => slide.slideNumber)).toEqual([1, 2, 4])
		expect(slides[1].noteLines).toHaveLength(4)
	})

	test("moves notes before the first visual onto the first slide", () => {
		let slides = groupPrintedSlides(
			parsePresentation("Intro words\n\n---\n\n# Title\n\nSay hi"),
		)

		expect(slides).toHaveLength(1)
		expect(slides[0].noteLines).toHaveLength(2)
	})
})

describe("buildPrintableSlides", () => {
	test("prints one fixed-size page per slide in the chosen ratio", async () => {
		let html = await build({ layout: "slides", aspectRatio: "4:3" })
		let document = parse(html)

		expect(document.querySelectorAll(".print-page")).toHaveLength(3)
		expect(
			document.querySelectorAll("[data-print-slide-content]"),
		).toHaveLength(3)
		expect(lastStyle(document)).toContain("size: 960px 720px")
		expect(document.querySelector(".print-notes")).toBe(null)
	})

	test("keeps slide page size when the theme sets its own @page", async () => {
		let html = await build({
			layout: "slides",
			aspectRatio: "16:9",
			theme: { ...emptyTheme, css: "@page { size: A4; margin: 2cm; }" },
		})

		expect(html.lastIndexOf("size: 1280px 720px")).toBeGreaterThan(
			html.indexOf("size: A4"),
		)
	})

	test("prints speaker notes as Markdown under each slide", async () => {
		let html = await build({
			layout: "notes",
			aspectRatio: "16:9",
			wikilinkTitles: new Map([["co_zTalk", "Earlier talk"]]),
		})
		let document = parse(html)
		let notes = Array.from(document.querySelectorAll(".print-notes"))

		expect(notes).toHaveLength(3)
		expect(notes[1].querySelectorAll("li")).toHaveLength(2)
		expect(notes[1].textContent).toContain("Earlier talk")
		expect(notes[1].textContent).toContain("Only notes here")
		expect(
			Array.from(document.querySelectorAll(".print-notes-number")).map(
				footer => footer.textContent,
			),
		).toEqual(["1", "2", "3"])
	})

	test("fills the theme slide template and its slide numbers", async () => {
		let html = await build({
			layout: "slides",
			aspectRatio: "16:9",
			theme: {
				...emptyTheme,
				name: "Branded",
				slideTemplate:
					"<html><head><style>.brand{color:red}</style></head><body><header>Brand</header><main data-content></main><footer data-slide-number></footer></body></html>",
			},
		})
		let document = parse(html)

		expect(
			document.querySelectorAll(
				"main[data-content] [data-print-slide-content]",
			),
		).toHaveLength(3)
		expect(
			Array.from(document.querySelectorAll("footer")).map(
				footer => footer.textContent,
			),
		).toEqual(["1", "2", "4"])
		expect(html).toContain(".brand{color:red}")
	})

	test("drops scripts from notes and slide templates but keeps the fit script", async () => {
		let html = await buildPrintableSlides({
			content: `${deck}\n<img src="x" onerror="alert(1)">`,
			theme: {
				...emptyTheme,
				slideTemplate:
					"<html><body><main data-content></main><script>alert(2)</script></body></html>",
			},
			assets: [],
			defaultSyntaxTheme: null,
			parseHtml: html => new JSDOM(html).window.document,
			layout: "notes",
			aspectRatio: "16:9",
		})
		let document = parse(html)

		expect(html).not.toContain("onerror")
		expect(document.querySelectorAll("script")).toHaveLength(1)
		expect(document.querySelector("script")?.textContent).toContain(
			"slidesFitted",
		)
	})

	test("embeds a fit script that parses as standalone JavaScript", async () => {
		let document = parse(await build({ layout: "slides", aspectRatio: "16:9" }))
		let script = document.querySelector("script")?.textContent ?? ""

		expect(script).toContain("slidesFitted")
		expect(() => new Function(script)).not.toThrow()
	})
})

let emptyTheme: PrintTheme = {
	name: "",
	css: "",
	template: null,
	slideTemplate: null,
	fontFaceRules: "",
	presetVariables: "",
}

function build(
	options: Pick<
		Parameters<typeof buildPrintableSlides>[0],
		"layout" | "aspectRatio" | "wikilinkTitles"
	> & { theme?: PrintTheme },
) {
	return buildPrintableSlides({
		content: deck,
		theme: options.theme ?? null,
		assets: [],
		defaultSyntaxTheme: null,
		parseHtml: html => new JSDOM(html).window.document,
		layout: options.layout,
		aspectRatio: options.aspectRatio,
		wikilinkTitles: options.wikilinkTitles,
	})
}

function parse(html: string) {
	return new JSDOM(html).window.document
}

function lastStyle(document: Document) {
	return (
		Array.from(document.querySelectorAll("style")).at(-1)?.textContent ?? ""
	)
}

let deck = `---
mode: present
---

# Opening

Welcome everyone.

---

## Rules

- Small slices
- Real runtime

See [[co_zTalk]].

---

Only notes here.

---

	Thanks
`
