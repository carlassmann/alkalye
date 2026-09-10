import { expect, test } from "vitest"
import { parse } from "css-tree"
import { scopeThemeCss } from "./renderer"

test("keeps embedded font declarations usable outside the theme scope", () => {
	let css = `/* @font-face { ignored } */
@import url("https://fonts.googleapis.com/css2?family=Inter");
@font-face { font-family: "Braces } font"; src: url("data:font/woff2;base64,d09GMg=="); }
:root { color: red; }
.document::after { content: ":root @font-face { literal }"; }`
	let scoped = scopeThemeCss(css, '[data-theme-scope="test"]')
	let stylesheet = parse(scoped)
	if (stylesheet.type !== "StyleSheet") throw new Error("Expected stylesheet")
	let rules = stylesheet.children.toArray()
	expect(
		rules.map(rule => (rule.type === "Atrule" ? rule.name : rule.type)),
	).toEqual(["import", "font-face", "scope"])
	expect(scoped).toContain(":scope { color: red; }")
	expect(scoped).toContain('content: ":root @font-face { literal }"')
})

test("keeps print page rules global without leaking conditional element styles", () => {
	let scoped = scopeThemeCss(
		`@media print {
		@page { margin: 18mm; @bottom-center { content: "Every page"; } }
		.document { color: black; }
	}`,
		'[data-theme-scope="print"]',
	)
	let stylesheet = parse(scoped)
	if (stylesheet.type !== "StyleSheet") throw new Error("Expected stylesheet")
	let rules = stylesheet.children.toArray()
	let media = rules[0]
	expect(media.type).toBe("Atrule")
	if (media.type !== "Atrule") throw new Error("Expected media rule")
	expect(media.name).toBe("media")
	expect(
		media.block?.children
			.toArray()
			.map(rule => (rule.type === "Atrule" ? rule.name : rule.type)),
	).toEqual(["page"])
	let scope = rules[1]
	if (scope.type !== "Atrule") throw new Error("Expected scope rule")
	expect(scope.name).toBe("scope")
	expect(scoped.slice(scoped.indexOf("@scope"))).toContain(
		".document { color: black; }",
	)
	expect(scoped.slice(scoped.indexOf("@scope"))).not.toContain("@page")
})
