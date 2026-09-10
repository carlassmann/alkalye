import { readFileSync } from "node:fs"
import { persistDocumentContentSynchronously } from "@/app/features/documents/lib/background-document-save"
import { beforeEach, describe, expect, it } from "vitest"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { Document, Theme, UserAccount } from "@/schema"
import {
	bindThemeSource,
	getThemeSourceId,
	parseThemeSource,
	serializeThemeSource,
	syncThemeFromSource,
} from "./source"
import { serializePortableAssetFence } from "./portable-assets"
import { createDefaultTheme, getDefaultThemeSource } from "./default-theme"
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

	it("resolves embedded assets in CSS and HTML regardless of fence order", () => {
		let asset = serializePortableAssetFence({
			path: "images/pixel.gif",
			mimeType: "image/gif",
			base64: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
		})
		let result = parseThemeSource(`\`\`\`css theme
.theme { background-image: url(asset:images/pixel.gif); }
\`\`\`
\`\`\`html document
<main data-content><img src="asset:images/pixel.gif"></main>
\`\`\`

${asset}`)

		expect(result.errors).toEqual([])
		expect(result.css).toContain("data:image/gif;base64,")
		expect(result.documentTemplate).toContain("data:image/gif;base64,")
	})

	it("reports invalid, duplicate, and unresolved portable assets", () => {
		let result = parseThemeSource(`\`\`\`css theme
.theme { background-image: url(asset:images/missing.png); }
\`\`\`
\`\`\`base64 asset images/logo.png image/png
not base64
\`\`\`
\`\`\`base64 asset images/logo.png image/png
YWJj
\`\`\`
\`\`\`base64 asset images/logo.png image/png
YWJj
\`\`\``)

		expect(result.errors.map(error => error.message)).toEqual([
			"Invalid base64 for images/logo.png",
			"Duplicate asset path: images/logo.png",
			"Unresolved asset reference: images/missing.png",
		])
	})

	it("rejects unsafe embedded SVG", () => {
		let result =
			parseThemeSource(`\`\`\`base64 asset images/logo.svg image/svg+xml
PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+
\`\`\``)

		expect(result.errors).toEqual([
			{
				line: 1,
				kind: "base64 asset",
				message: "Unsafe SVG asset: images/logo.svg",
			},
		])
	})

	it("rejects namespace-prefixed SVG script elements", () => {
		let result =
			parseThemeSource(`\`\`\`base64 asset images/logo.svg image/svg+xml
PHN2ZzpzdmcgeG1sbnM6c3ZnPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHN2ZzpzY3JpcHQ+YWxlcnQoMSk8L3N2ZzpzY3JpcHQ+PC9zdmc6c3ZnPg==
\`\`\``)

		expect(result.errors[0]?.message).toBe("Unsafe SVG asset: images/logo.svg")
	})
})

describe("serializeThemeSource", () => {
	it("keeps the editable default source concise and override-focused", () => {
		let source = getDefaultThemeSource()
		let parsed = parseThemeSource(source)

		expect(parsed.errors).toEqual([])
		expect(parsed.css).toContain(':scope[data-appearance="light"]')
		expect(parsed.css).toContain("--theme-accent")
		expect(parsed.css).not.toContain("@layer theme-base")
		expect(source.length).toBeLessThan(1_500)
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

	it("replaces starter overrides before applying later source edits", async () => {
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
		expect(theme.css.toString()).toBe(parseThemeSource(fullSource).css)
		expect(await syncThemeFromSource(account, sourceId, fullSource)).toBe(true)

		let pastedSource = bindThemeSource(
			readFileSync("themes/syntwin.theme.md", "utf8"),
			theme.$jazz.id,
		)
		persistDocumentContentSynchronously(source, pastedSource)
		expect(source.content.toString()).toBe(pastedSource)
		expect(await syncThemeFromSource(account, sourceId, pastedSource)).toBe(
			true,
		)
		let pastedTheme = await Theme.load(theme.$jazz.id, {
			resolve: { css: true, template: true },
		})
		if (!pastedTheme.$isLoaded) throw new Error("Theme did not load")
		expect(pastedTheme.css.toString()).toContain("--syntwin-paper")
		expect(pastedTheme.template?.toString()).toContain("syntwin-wordmark")
		expect(pastedTheme.css.toString()).toContain("data:font/woff2;base64,")

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
	it("keeps pasted sources bound to the destination theme without discarding metadata", () => {
		let source =
			"---\ntitle: Imported\ntheme-source: original\ntags: branding\n---\n\n```css theme\nh1 {}\n```"
		let bound = bindThemeSource(source, "destination")
		expect(getThemeSourceId(bound)).toBe("destination")
		expect(bound).toContain("title: Imported")
		expect(bound).toContain("tags: branding")
		expect(parseThemeSource(bound).css).toBe("h1 {}")
		expect(bindThemeSource(bound, "destination")).toBe(bound)
	})

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
