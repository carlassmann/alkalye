import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Buffer } from "node:buffer"
import { JSDOM } from "jsdom"
import { buildPrintableDocument } from "@/app/features/import-export/lib/printable-html"
import { ConfigError } from "@/cli/errors"
import { compileLocalPrintTheme, isLocalThemePath } from "./export"
import { embedLocalImages } from "./local-images"
import { chromeCandidates, findChrome } from "./pdf"

let tempDirs: string[] = []

afterEach(async () => {
	for (let dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true })
	}
})

describe("local print themes", () => {
	test("compiles the bundled letter theme with embedded fonts", async () => {
		let theme = await compileLocalPrintTheme("themes/letter.theme.md")

		expect(theme.name).toBe("Letter")
		expect(theme.css).toContain('@scope ([data-theme-scope="print"])')
		expect(theme.css.match(/data:font\/woff2;base64,/g)).toHaveLength(2)
		expect(theme.css).not.toContain("asset:")
	})

	test("treats paths, not theme names, as local themes", () => {
		expect(isLocalThemePath("letter.theme.md")).toBe(true)
		expect(isLocalThemePath("./themes/custom.md")).toBe(true)
		expect(isLocalThemePath("Syntwin")).toBe(false)
		expect(isLocalThemePath("co_zTheme123")).toBe(false)
	})
})

describe("printable document", () => {
	test("renders a letter with footnotes and continued table rows", async () => {
		let theme = await compileLocalPrintTheme("themes/letter.theme.md")
		let html = await buildPrintableDocument({
			content: letter,
			theme,
			assets: [],
			defaultSyntaxTheme: null,
			parseHtml: html => new JSDOM(html).window.document,
		})
		let document = new JSDOM(html).window.document

		expect(document.querySelector('[data-theme="Letter"] .content')).not.toBe(
			null,
		)
		expect(document.querySelectorAll("table")).toHaveLength(1)
		expect(document.querySelectorAll("tbody")).toHaveLength(2)
		expect(
			Array.from(document.querySelectorAll("tbody:last-child td")).map(cell => [
				cell.textContent,
				cell.getAttribute("align"),
			]),
		).toEqual([
			["", "left"],
			["Summe", "left"],
			["480 €", "right"],
		])
		expect(document.querySelector(".footnotes li")?.textContent).toContain(
			"IBAN",
		)
		expect(document.body.textContent).not.toContain("[^1]")
	})

	test("keeps a lone pipe paragraph that follows no table", async () => {
		let html = await buildPrintableDocument({
			content: "Text\n\n| a | b |",
			theme: null,
			assets: [],
			defaultSyntaxTheme: null,
			parseHtml: html => new JSDOM(html).window.document,
		})

		expect(html).not.toContain("<table>")
		expect(html).toContain("| a | b |")
	})

	test("starts a new table when a pipe block has its own header", async () => {
		let html = await buildPrintableDocument({
			content:
				"| a | b |\n|---|---|\n| 1 | 2 |\n\n| c | d |\n|---|---|\n| 3 | 4 |",
			theme: null,
			assets: [],
			defaultSyntaxTheme: null,
			parseHtml: html => new JSDOM(html).window.document,
		})
		let document = new JSDOM(html).window.document

		expect(document.querySelectorAll("table")).toHaveLength(2)
		expect(document.body.textContent).not.toContain("---")
	})

	test("drops scripts and event handlers from raw Markdown HTML", async () => {
		let html = await buildPrintableDocument({
			content: '<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">',
			theme: null,
			assets: [],
			defaultSyntaxTheme: null,
			parseHtml: html => new JSDOM(html).window.document,
		})

		expect(html).not.toContain("<script")
		expect(html).not.toContain("onerror")
		expect(html).toContain('<img src="x">')
	})
})

describe("local images", () => {
	test("embeds images relative to the Markdown file and keeps remote ones", async () => {
		let dir = await mkdtemp(join(tmpdir(), "alkalye-images-"))
		tempDirs.push(dir)
		await writeFile(join(dir, "logo one.png"), "png-bytes")

		let html = await embedLocalImages(
			'<img src="logo%20one.png"><img src="missing.png"><img src="https://example.com/a.png">',
			dir,
		)

		expect(html).toContain(
			`src="data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}"`,
		)
		expect(html).toContain('src="missing.png"')
		expect(html).toContain('src="https://example.com/a.png"')
	})
})

describe("chrome discovery", () => {
	test("prefers the configured executable", () => {
		expect(
			chromeCandidates({ ALKALYE_CHROME: "/opt/chrome", PATH: "/usr/bin" }),
		).toEqual(["/opt/chrome"])
	})

	test("searches PATH for chromium builds", () => {
		expect(chromeCandidates({ PATH: "/usr/bin" })).toContain(
			"/usr/bin/chromium",
		)
	})

	test("reports a missing browser as a config error", async () => {
		let dir = await mkdtemp(join(tmpdir(), "alkalye-chrome-test-"))
		tempDirs.push(dir)
		let executable = join(dir, "chrome")
		await writeFile(executable, "")

		await expect(findChrome([executable])).resolves.toBe(executable)
		await expect(findChrome([join(dir, "missing")])).rejects.toBeInstanceOf(
			ConfigError,
		)
	})
})

let letter = `22\\. Oktober 2026

        Assmann Holding UG
        80995 München

**Rechnung**

| Pos. | Beschreibung | Preis |
|:--|:--|--:|
| 1 | Webhosting | 40 € |

| | **Summe** | **480 €** |

Zahlbar auf das unten angegebene Konto.[^1]

[^1]: IBAN: DE24 7007 0362 0096 3462 00
`
