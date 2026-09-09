import { expect, test } from "vitest"
import { parse } from "css-tree"
import { scopeThemeCss } from "./renderer"

test("keeps embedded font declarations usable outside the theme scope", () => {
	let css = `/* @font-face { ignored } */
@import url("https://fonts.googleapis.com/css2?family=Inter");
@font-face { font-family: "Braces } font"; src: url("data:font/woff2;base64,d09GMg=="); }
:root { color: red; }
.document::after { content: "@font-face { literal }"; }`
	let scoped = scopeThemeCss(css, '[data-theme-scope="test"]')
	let stylesheet = parse(scoped)
	if (stylesheet.type !== "StyleSheet") throw new Error("Expected stylesheet")
	let rules = stylesheet.children.toArray()
	expect(
		rules.map(rule => (rule.type === "Atrule" ? rule.name : rule.type)),
	).toEqual(["import", "font-face", "scope"])
	expect(scoped).toContain(":scope { color: red; }")
	expect(scoped).toContain('content: "@font-face { literal }"')
})
