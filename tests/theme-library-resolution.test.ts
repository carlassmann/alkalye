import { themeName, withThemeName } from "../src/shared/theme-source"
import { expect, test } from "bun:test"
import { libraryThemes, resolveTheme } from "../src/shared/theme-library"

let source =
	'```json theme metadata\n{"name":"New name","type":"both"}\n```\n\n```css theme\n.content { color: red; }\n```'

test("a theme's source controls its name and name-based document lookup", () => {
	let themes = libraryThemes(
		[{ id: "custom", fields: { name: "Stale copy" } }],
		() => source,
	)
	expect(themes[0]?.name).toBe("New name")
	expect(
		resolveTheme({
			header: { theme: "New name" },
			document: [],
			library: themes,
			fallback: "",
		}).source,
	).toBe(source)
	expect(
		resolveTheme({
			header: { theme: "Stale copy" },
			document: [],
			library: themes,
			fallback: "",
		}).warning,
	).toContain("not found")
})

test("a missing explicit theme id warns while appearance-only frontmatter remains valid", () => {
	expect(
		resolveTheme({
			header: { "theme-id": "deleted" },
			document: [],
			library: [],
			fallback: "",
		}).warning,
	).toContain("deleted")
	for (let theme of ["light", "dark"])
		expect(
			resolveTheme({
				header: { theme },
				document: [],
				library: [],
				fallback: "",
			}).warning,
		).toBeUndefined()
})

test("renaming changes the source and preserves other metadata and theme code", () => {
	let original =
		'```json theme metadata\n{"name":"Before","author":"Author","type":"preview","future":true}\n```\n\n```css theme\n.content { color: red; }\n```'
	let renamed = withThemeName(original, "After")
	expect(themeName(renamed)).toBe("After")
	expect(renamed).toContain('"author": "Author"')
	expect(renamed).toContain('"future": true')
	expect(renamed).toContain(".content { color: red; }")
	expect(themeName(withThemeName("# Theme", "Named"))).toBe("Named")
})
