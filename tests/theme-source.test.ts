import { expect, test } from "bun:test"
import { compileTheme } from "../src/shared/markdown"
import {
	defaultThemeSource,
	lineRange,
	themeSourceProblems,
	withThemeName,
} from "../src/shared/theme-source"

test("theme source problems name the line they start on", () => {
	expect(themeSourceProblems(defaultThemeSource)).toEqual([])
	expect(
		themeSourceProblems("# Theme\n\n```css theme\nh1 { color: red; }"),
	).toEqual([{ line: 3, message: "Unclosed css theme fence" }])
	expect(
		themeSourceProblems(
			"# Theme\n\n```html slide\n<section>No slot</section>\n```",
		),
	).toEqual([
		{ line: 3, message: "A template needs exactly one data-content slot" },
	])
	expect(
		themeSourceProblems(
			"```css theme\n.a {}\n```\n\n```css theme\n.b { background: url(asset:missing.png); }\n```",
		),
	).toEqual([{ line: 6, message: "Missing theme asset: missing.png" }])
	expect(() => compileTheme("```json theme metadata\n{\n```")).toThrow(
		"Invalid theme metadata at line 1",
	)
})

test("a source line's range excludes its line break", () => {
	let source = "first\nsecond\n\nfourth"
	let range = lineRange(source, 2)
	expect(source.slice(range.start, range.end)).toBe("second")
	expect(lineRange(source, 3)).toEqual({ start: 13, end: 13 })
	expect(source.slice(lineRange(source, 4).start)).toBe("fourth")
	expect(lineRange(source, 9)).toEqual({
		start: source.length,
		end: source.length,
	})
})

test("the default theme names itself through source metadata", () => {
	let named = withThemeName(defaultThemeSource, "Custom theme 3")
	let compiled = compileTheme(named)
	expect(compiled.metadata.name).toBe("Custom theme 3")
	expect(compiled.css).toContain(':scope[data-appearance="dark"]')
})
