import { describe, expect, it } from "vitest"
import {
	loadSyntaxHighlighter,
	resolveSyntaxTheme,
	SYNTAX_THEME_FAMILIES,
} from "./syntax-highlighting"

describe("syntax theme resolution", () => {
	it("uses document, global, and GitHub themes in precedence order", () => {
		expect(
			resolveSyntaxTheme({
				content: "---\nsyntax-theme: catppuccin\n---\n",
				defaultFamilyId: "github",
				appearance: "dark",
			}),
		).toBe("catppuccin-mocha")

		expect(
			resolveSyntaxTheme({
				content: "# Document",
				defaultFamilyId: "vitesse",
				appearance: "light",
			}),
		).toBe("vitesse-light")

		expect(
			resolveSyntaxTheme({
				content: "---\nsyntax-theme: removed-family\n---\n",
				defaultFamilyId: "github",
				appearance: "dark",
			}),
		).toBe("github-dark")

		expect(
			resolveSyntaxTheme({
				content: "# Document",
				appearance: "dark",
			}),
		).toBe("github-dark")
	})

	it.each([
		["alkalye", "alkalye-light", "alkalye-dark"],
		["catppuccin", "catppuccin-latte", "catppuccin-mocha"],
		["catppuccin-frappe", "catppuccin-latte", "catppuccin-frappe"],
		["catppuccin-macchiato", "catppuccin-latte", "catppuccin-macchiato"],
		["everforest", "everforest-light", "everforest-dark"],
		["github", "github-light", "github-dark"],
		["github-default", "github-light-default", "github-dark-default"],
		["github-dimmed", "github-light-default", "github-dark-dimmed"],
		[
			"github-high-contrast",
			"github-light-high-contrast",
			"github-dark-high-contrast",
		],
		["gruvbox", "gruvbox-light-medium", "gruvbox-dark-medium"],
		["gruvbox-hard", "gruvbox-light-hard", "gruvbox-dark-hard"],
		["gruvbox-soft", "gruvbox-light-soft", "gruvbox-dark-soft"],
		["kanagawa", "kanagawa-lotus", "kanagawa-wave"],
		["kanagawa-dragon", "kanagawa-lotus", "kanagawa-dragon"],
		["material", "material-theme-lighter", "material-theme"],
		["material-darker", "material-theme-lighter", "material-theme-darker"],
		["material-ocean", "material-theme-lighter", "material-theme-ocean"],
		[
			"material-palenight",
			"material-theme-lighter",
			"material-theme-palenight",
		],
		["min", "min-light", "min-dark"],
		["one", "one-light", "one-dark-pro"],
		["rose-pine", "rose-pine-dawn", "rose-pine"],
		["rose-pine-moon", "rose-pine-dawn", "rose-pine-moon"],
		["slack", "slack-ochin", "slack-dark"],
		["solarized", "solarized-light", "solarized-dark"],
		["vitesse", "vitesse-light", "vitesse-dark"],
		["vitesse-black", "vitesse-light", "vitesse-black"],
		["vs-code", "light-plus", "dark-plus"],
	])("resolves the %s family for both appearances", (family, light, dark) => {
		expect(
			resolveSyntaxTheme({
				content: `---\nsyntax-theme: ${family}\n---\n`,
				appearance: "light",
			}),
		).toBe(light)
		expect(
			resolveSyntaxTheme({
				content: `---\nsyntax-theme: ${family}\n---\n`,
				appearance: "dark",
			}),
		).toBe(dark)
	})

	it.each([
		...new Set(
			SYNTAX_THEME_FAMILIES.flatMap(family => [family.light, family.dark]),
		),
	])("loads and renders the %s theme", async theme => {
		let highlighter = await loadSyntaxHighlighter(theme)
		let html = highlighter.highlight({
			code: "const answer = 42",
			language: "js",
			theme,
		})
		expect(html).toContain('<span style="color:')
	})

	it("highlights common Markdown language aliases", async () => {
		let highlighter = await loadSyntaxHighlighter("github-dark")

		for (let [language, code] of [
			["md", "# Heading"],
			["py", "def greet(): pass"],
			["rs", "fn main() {}"],
			["yml", "enabled: true"],
		]) {
			let html = highlighter.highlight({
				code,
				language,
				theme: "github-dark",
			})
			expect(html).toContain('<span style="color:')
		}
	})
})
