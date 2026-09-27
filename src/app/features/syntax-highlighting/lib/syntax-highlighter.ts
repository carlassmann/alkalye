import {
	createHighlighterCore,
	type HighlighterCore,
	type ThemeInput,
} from "shiki/core"
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
import type { SyntaxTheme, SyntaxHighlighter } from "./syntax-highlighting"

export { loadHighlighter }

let highlighterPromise: Promise<HighlighterCore> | null = null
let themeLoadPromises = new Map<SyntaxTheme, Promise<void>>()

async function loadHighlighter(
	theme: SyntaxTheme,
	themeInput: ThemeInput,
): Promise<SyntaxHighlighter> {
	let highlighter = await getHighlighter()
	await loadTheme(highlighter, theme, themeInput)
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

function loadTheme(
	highlighter: HighlighterCore,
	theme: SyntaxTheme,
	themeInput: ThemeInput,
): Promise<void> {
	if (highlighter.getLoadedThemes().includes(theme)) return Promise.resolve()
	let existingPromise = themeLoadPromises.get(theme)
	if (existingPromise) return existingPromise
	let promise = highlighter.loadTheme(themeInput).catch(error => {
		themeLoadPromises.delete(theme)
		throw error
	})
	themeLoadPromises.set(theme, promise)
	return promise
}

function getHighlighter(): Promise<HighlighterCore> {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighterCore({
			themes: [],
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
		}).catch(error => {
			highlighterPromise = null
			throw error
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
	"md",
	"mjs",
	"mts",
	"python",
	"py",
	"rust",
	"rs",
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
	"yml",
	"zsh",
])

function resolveCodeLanguage(language: string | undefined): string {
	let firstToken = language?.trim().split(/\s+/, 1)[0]?.toLowerCase()
	if (!firstToken || firstToken.startsWith("{")) return "text"
	return supportedLanguages.has(firstToken) ? firstToken : "text"
}
