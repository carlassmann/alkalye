import { useAccount } from "jazz-tools/react"
import { createHighlighterCore, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import astroLanguage from "shiki/dist/langs/astro.mjs"
import cssLanguage from "shiki/dist/langs/css.mjs"
import diffLanguage from "shiki/dist/langs/diff.mjs"
import goLanguage from "shiki/dist/langs/go.mjs"
import htmlLanguage from "shiki/dist/langs/html.mjs"
import javascriptLanguage from "shiki/dist/langs/javascript.mjs"
import jsonLanguage from "shiki/dist/langs/json.mjs"
import jsxLanguage from "shiki/dist/langs/jsx.mjs"
import markdownLanguage from "shiki/dist/langs/markdown.mjs"
import pythonLanguage from "shiki/dist/langs/python.mjs"
import rustLanguage from "shiki/dist/langs/rust.mjs"
import shellscriptLanguage from "shiki/dist/langs/shellscript.mjs"
import sqlLanguage from "shiki/dist/langs/sql.mjs"
import svelteLanguage from "shiki/dist/langs/svelte.mjs"
import tomlLanguage from "shiki/dist/langs/toml.mjs"
import tsxLanguage from "shiki/dist/langs/tsx.mjs"
import typescriptLanguage from "shiki/dist/langs/typescript.mjs"
import vueLanguage from "shiki/dist/langs/vue.mjs"
import yamlLanguage from "shiki/dist/langs/yaml.mjs"
import catppuccinLatteTheme from "shiki/dist/themes/catppuccin-latte.mjs"
import catppuccinMochaTheme from "shiki/dist/themes/catppuccin-mocha.mjs"
import githubDarkTheme from "shiki/dist/themes/github-dark.mjs"
import githubLightTheme from "shiki/dist/themes/github-light.mjs"
import vesperTheme from "shiki/dist/themes/vesper.mjs"
import vitesseDarkTheme from "shiki/dist/themes/vitesse-dark.mjs"
import vitesseLightTheme from "shiki/dist/themes/vitesse-light.mjs"
import {
	parseFrontmatter,
	setSyntaxTheme,
} from "@/app/features/editor/lib/frontmatter"
import { UserAccount } from "@/schema"

export {
	SYNTAX_THEME_FAMILIES,
	getSyntaxThemeFamilyId,
	setSyntaxTheme,
	resolveSyntaxTheme,
	useSyntaxTheme,
	loadSyntaxHighlighter,
}

export type {
	SyntaxThemeFamilyId,
	SyntaxThemeFamily,
	SyntaxTheme,
	SyntaxHighlighter,
	SyntaxDecoration,
}

type SyntaxThemeFamilyId = "alkalye" | "github" | "catppuccin" | "vitesse"
type SyntaxTheme =
	| "github-light"
	| "github-dark"
	| "vesper"
	| "catppuccin-latte"
	| "catppuccin-mocha"
	| "vitesse-light"
	| "vitesse-dark"

type SyntaxThemeFamily = {
	id: SyntaxThemeFamilyId
	name: string
	light: SyntaxTheme
	dark: SyntaxTheme
}

type SyntaxDecoration = {
	start: number
	end: number
	properties: { class: string }
}

type SyntaxHighlighter = {
	highlight: (params: {
		code: string
		language?: string
		theme: SyntaxTheme
		decorations?: SyntaxDecoration[]
	}) => string
}

let SYNTAX_THEME_FAMILIES: SyntaxThemeFamily[] = [
	{
		id: "alkalye",
		name: "Alkalye",
		light: "github-light",
		dark: "vesper",
	},
	{
		id: "github",
		name: "GitHub",
		light: "github-light",
		dark: "github-dark",
	},
	{
		id: "catppuccin",
		name: "Catppuccin",
		light: "catppuccin-latte",
		dark: "catppuccin-mocha",
	},
	{
		id: "vitesse",
		name: "Vitesse",
		light: "vitesse-light",
		dark: "vitesse-dark",
	},
]

function getSyntaxThemeFamilyId(content: string): string | null {
	let { frontmatter } = parseFrontmatter(content)
	let value = frontmatter?.["syntax-theme"]
	return typeof value === "string" && value.trim() ? value.trim() : null
}

function resolveSyntaxTheme(params: {
	content: string
	defaultFamilyId?: string | null
	appearance: "light" | "dark"
}): SyntaxTheme {
	let documentFamilyId = getSyntaxThemeFamilyId(params.content)
	let familyId = isSyntaxThemeFamilyId(documentFamilyId)
		? documentFamilyId
		: isSyntaxThemeFamilyId(params.defaultFamilyId)
			? params.defaultFamilyId
			: "github"
	let family = SYNTAX_THEME_FAMILIES.find(
		candidate => candidate.id === familyId,
	)
	return (
		family?.[params.appearance] ??
		(params.appearance === "dark" ? "github-dark" : "github-light")
	)
}

function useSyntaxTheme(
	content: string,
	appearance: "light" | "dark",
): SyntaxTheme {
	let me = useAccount(UserAccount, {
		resolve: { root: { settings: true } },
	})
	let defaultFamilyId = me.$isLoaded
		? me.root?.settings?.syntaxTheme
		: undefined
	return resolveSyntaxTheme({ content, defaultFamilyId, appearance })
}

let highlighterPromise: Promise<HighlighterCore> | null = null

async function loadSyntaxHighlighter(): Promise<SyntaxHighlighter> {
	let highlighter = await getHighlighter()
	return {
		highlight(params) {
			return highlighter.codeToHtml(params.code, {
				lang: resolveCodeLanguage(params.language),
				theme: params.theme,
				decorations: params.decorations,
			})
		},
	}
}

function getHighlighter(): Promise<HighlighterCore> {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighterCore({
			themes: [
				catppuccinLatteTheme,
				catppuccinMochaTheme,
				githubDarkTheme,
				githubLightTheme,
				vesperTheme,
				vitesseDarkTheme,
				vitesseLightTheme,
			],
			langs: [
				astroLanguage,
				cssLanguage,
				diffLanguage,
				goLanguage,
				htmlLanguage,
				javascriptLanguage,
				jsonLanguage,
				jsxLanguage,
				markdownLanguage,
				pythonLanguage,
				rustLanguage,
				shellscriptLanguage,
				sqlLanguage,
				svelteLanguage,
				tomlLanguage,
				tsxLanguage,
				typescriptLanguage,
				vueLanguage,
				yamlLanguage,
			],
			engine: createJavaScriptRegexEngine(),
		})
	}
	return highlighterPromise
}

let supportedLanguages = new Set([
	"astro",
	"bash",
	"cjs",
	"css",
	"cts",
	"diff",
	"go",
	"html",
	"javascript",
	"js",
	"json",
	"jsx",
	"markdown",
	"mjs",
	"mts",
	"python",
	"rust",
	"sh",
	"shell",
	"shellscript",
	"sql",
	"svelte",
	"toml",
	"ts",
	"tsx",
	"typescript",
	"vue",
	"yaml",
	"zsh",
])

function resolveCodeLanguage(language: string | undefined): string {
	let firstToken = language?.trim().split(/\s+/, 1)[0]?.toLowerCase()
	if (!firstToken || firstToken.startsWith("{")) return "text"
	return supportedLanguages.has(firstToken) ? firstToken : "text"
}

function isSyntaxThemeFamilyId(
	value: string | null | undefined,
): value is SyntaxThemeFamilyId {
	if (!value) return false
	return SYNTAX_THEME_FAMILIES.some(family => family.id === value)
}
