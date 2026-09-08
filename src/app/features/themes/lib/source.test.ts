import { beforeEach, describe, expect, it } from "vitest"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { Document, Theme, UserAccount } from "@/schema"
import {
	getThemeSourceId,
	parseThemeSource,
	serializeThemeSource,
	syncThemeFromSource,
} from "./source"
import {
	createDefaultTheme,
	getDefaultThemeCss,
	getDefaultThemeSource,
} from "./default-theme"
import { scopeThemeCss } from "./renderer"

describe("parseThemeSource", () => {
	it("concatenates CSS fences in source order and reads both templates", () => {
		let result = parseThemeSource(`prose
\`\`\`css theme
first {}
\`\`\`
\`\`\`css theme
second {}
\`\`\`
\`\`\`html document
<article><main data-content></main></article>
\`\`\`
\`\`\`html slide
<section><main data-document></main><footer data-slide-number></footer></section>
\`\`\``)

		expect(result.css).toBe("first {}\n\nsecond {}")
		expect(result.documentTemplate).toContain("data-content")
		expect(result.slideTemplate).toContain("data-slide-number")
		expect(result.errors).toEqual([])
	})

	it("ignores ordinary, tilde, and four-backtick fences", () => {
		let result = parseThemeSource(`\`\`\`\`markdown
\`\`\`css theme
nested {}
\`\`\`
\`\`\`\`

~~~markdown
\`\`\`css theme
nested tilde {}
\`\`\`
~~~

\`\`\`css theme
kept {}
\`\`\``)

		expect(result.css).toBe("kept {}")
		expect(result.errors).toEqual([])
	})

	it("reports duplicate templates for each surface", () => {
		let result = parseThemeSource(`\`\`\`html document
<main data-content></main>
\`\`\`
\`\`\`html document
<main data-content></main>
\`\`\`
\`\`\`html slide
<main data-content></main>
\`\`\`
\`\`\`html slide
<main data-content></main>
\`\`\``)

		expect(result.errors).toHaveLength(2)
		expect(result.errors.map(error => error.message)).toEqual([
			"Only one html document fence is allowed",
			"Only one html slide fence is allowed",
		])
	})

	it("reports unclosed and invalid template fences", () => {
		let unclosed = parseThemeSource(`\`\`\`css theme
body {}
`)
		expect(unclosed.errors).toEqual([
			{ line: 1, kind: "css theme", message: "Unclosed css theme fence" },
		])

		let invalid = parseThemeSource(`\`\`\`html document
<main data-content><style>bad</style></main>
\`\`\``)
		expect(invalid.errors).toHaveLength(1)
		expect(invalid.errors[0]?.message).toContain("style")
	})

	it("reports a missing slot while allowing surrounding markup", () => {
		let result = parseThemeSource(`\`\`\`html slide
<section><header>Title</header><main></main><footer>End</footer></section>
\`\`\``)

		expect(result.errors).toEqual([
			{
				line: 1,
				kind: "html slide",
				message: "HTML templates need a data-content slot",
			},
		])
	})

	it("ignores comment slots and rejects ambiguous multiple slots", () => {
		let comment = parseThemeSource(`\`\`\`html document
<!-- <main data-content></main> -->
<article><main data-document></main></article>
\`\`\``)
		expect(comment.errors).toEqual([])

		let multiple = parseThemeSource(`\`\`\`html document
<main data-content></main><aside data-document></aside>
\`\`\``)
		expect(multiple.errors).toHaveLength(1)
		expect(multiple.errors[0]?.message).toContain("one")
	})

	it("rejects slots on elements removed by HTML sanitization", () => {
		let result = parseThemeSource(`\`\`\`html document
<script data-content></script>
\`\`\``)

		expect(result.errors).toEqual([
			{
				line: 1,
				kind: "html document",
				message: "HTML templates need a data-content slot",
			},
		])
	})
})

describe("serializeThemeSource", () => {
	it("keeps the editable default source and applied baseline identical", () => {
		expect(parseThemeSource(getDefaultThemeSource())).toMatchObject({
			css: getDefaultThemeCss(),
			errors: [],
		})
	})

	it("round-trips CSS and optional templates", () => {
		let source = serializeThemeSource({
			css: "body { color: red }",
			documentTemplate: "<main data-content></main>",
			slideTemplate: "<main data-document></main>",
		})

		expect(parseThemeSource(source)).toEqual({
			css: "body { color: red }",
			documentTemplate: "<main data-content></main>",
			slideTemplate: "<main data-document></main>",
			errors: [],
		})
	})
})

describe("theme source sync", () => {
	beforeEach(async () => {
		await setupJazzTestSync()
	})

	it("replaces a default baseline before applying later source edits", async () => {
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		let theme = await createDefaultTheme(account)
		let sourceId = theme.sourceDocId
		expect(sourceId).toBeDefined()
		if (!sourceId) throw new Error("Default theme source was not created")

		let source = await Document.load(sourceId, { resolve: { content: true } })
		expect(source.$isLoaded).toBe(true)
		if (!source.$isLoaded) throw new Error("Default theme source did not load")
		let fullSource = source.content.toString()
		expect(await syncThemeFromSource(account, sourceId, fullSource)).toBe(true)

		let shortSource = createThemeSourceContent(
			theme.$jazz.id,
			"h1 { color: red; }",
		)
		expect(await syncThemeFromSource(account, sourceId, shortSource)).toBe(true)

		let editedSource = createThemeSourceContent(
			theme.$jazz.id,
			"h1 { color: blue; }",
		)
		expect(await syncThemeFromSource(account, sourceId, editedSource)).toBe(
			true,
		)

		let reloadedTheme = await Theme.load(theme.$jazz.id, {
			resolve: { css: true },
		})
		expect(reloadedTheme.$isLoaded).toBe(true)
		if (!reloadedTheme.$isLoaded) throw new Error("Default theme did not load")
		expect(reloadedTheme.css.toString()).toBe("h1 { color: blue; }")
	})
})

describe("getThemeSourceId", () => {
	it("reads only the theme-source frontmatter field", () => {
		expect(
			getThemeSourceId(`---
title: Theme
theme-source: co_theme_123
---

body`),
		).toBe("co_theme_123")
		expect(getThemeSourceId("# Theme\n\nbody")).toBeNull()
		expect(getThemeSourceId('---\ntheme-source: "  "\n---')).toBeNull()
	})
})

describe("scopeThemeCss", () => {
	it("keeps imports global and scopes root and element rules", () => {
		let scoped = scopeThemeCss(
			'@import url("https://fonts.googleapis.com/css2");\n:root { --accent: red; }\nh1 { color: var(--accent); }',
			"[data-theme-scope=preview]",
		)

		expect(scoped).toContain(
			'@import url("https://fonts.googleapis.com/css2");',
		)
		expect(scoped).toContain("@scope ([data-theme-scope=preview])")
		expect(scoped).toContain(":scope { --accent: red; }")
		expect(scoped).toContain("h1 { color: var(--accent); }")
	})
})

function createThemeSourceContent(themeId: string, css: string): string {
	return [
		"---",
		"title: Theme source",
		`theme-source: ${themeId}`,
		"---",
		"",
		"```css theme",
		css,
		"```",
		"",
	].join("\n")
}
