import { Marked } from "marked"
import markedFootnote from "marked-footnote"
import markedShiki from "marked-shiki"
import { type co } from "jazz-tools"
import { type Theme, type ThemeAsset } from "@/schema"
import { parseFrontmatter } from "@/app/features/editor/lib/frontmatter"
import {
	findThemeByName,
	findThemeById,
	getThemeName,
	getThemeId,
	getPresetName,
	findPresetByName,
	getThemePresets,
	findPresetByAppearance,
	type LoadedThemes,
	type ThemesQuery,
	type ThemePresetType,
} from "@/app/features/themes/lib/document-theme"
import { scopeThemeCss } from "@/app/features/themes/lib/renderer"
import { getDocumentTitle } from "@/app/features/documents/lib/title"
import type { PrintableAsset } from "@/app/features/assets"
import { createTableContinuationExtension } from "./marked-table-continuation"
import {
	blobToBase64,
	replaceAssetSources,
	type HtmlParser,
} from "./print-media"
import {
	loadSyntaxHighlighter,
	resolveSyntaxTheme,
	type SyntaxTheme,
} from "@/app/features/syntax-highlighting"

export {
	buildPrintableDocument,
	renderPrintableMarkdown,
	resolvePrintTheme,
	toPrintTheme,
	buildPresetVariables,
	PRINT_THEME_SCOPE,
	type PrintTheme,
	type HtmlParser,
}

type LoadedTheme = co.loaded<typeof Theme, ThemesQuery["$each"]>
type LoadedAsset = co.loaded<typeof ThemeAsset, { data: true }>

type PrintTheme = {
	name: string
	css: string
	template: string | null
	fontFaceRules: string
	presetVariables: string
}

let PRINT_THEME_SCOPE = `[data-theme-scope="print"]`

async function buildPrintableDocument(params: {
	content: string
	theme: PrintTheme | null
	assets: PrintableAsset[]
	defaultSyntaxTheme: string | null
	parseHtml: HtmlParser
}): Promise<string> {
	let { content, theme, assets, defaultSyntaxTheme, parseHtml } = params
	let { body } = parseFrontmatter(content)
	let syntaxTheme = resolveSyntaxTheme({
		content,
		defaultFamilyId: defaultSyntaxTheme,
		appearance: "light",
	})
	let htmlContent = await renderPrintableMarkdown(
		body,
		assets,
		syntaxTheme,
		parseHtml,
	)
	return buildPrintableHtml({
		title: getDocumentTitle(content),
		htmlContent,
		theme,
		parseHtml,
	})
}

function resolvePrintTheme(params: {
	content: string
	themes: LoadedThemes | undefined
	defaultPreviewTheme: string | null
}): { theme: LoadedTheme | null; preset: ThemePresetType | null } {
	let { content, themes, defaultPreviewTheme } = params
	let themeName = getThemeName(content)
	let themeId = getThemeId(content)
	let presetName = getPresetName(content)

	let isAppearanceOnlyTheme = themeName === "light" || themeName === "dark"
	let effectiveThemeName = isAppearanceOnlyTheme ? null : themeName

	if (!effectiveThemeName && defaultPreviewTheme) {
		effectiveThemeName = defaultPreviewTheme
	}

	let theme = themeId
		? findThemeById(themes ?? null, themeId)
		: effectiveThemeName
			? (findThemeById(themes ?? null, effectiveThemeName) ??
				findThemeByName(themes ?? null, effectiveThemeName))
			: null
	if (!theme) return { theme: null, preset: null }
	if (presetName) return { theme, preset: findPresetByName(theme, presetName) }
	let preset =
		findPresetByAppearance(theme, "light") ?? getThemePresets(theme)[0] ?? null
	return { theme, preset }
}

async function toPrintTheme(
	theme: LoadedTheme,
	preset: ThemePresetType | null,
): Promise<PrintTheme> {
	let css = theme.css?.$isLoaded ? theme.css.toString() : ""
	return {
		name: theme.name,
		css: theme.sourceDocId ? scopeThemeCss(css, PRINT_THEME_SCOPE) : css,
		template: theme.template?.$isLoaded ? theme.template.toString() : null,
		fontFaceRules: await buildFontFaceRulesBase64(theme),
		presetVariables: preset ? buildPresetVariables(preset) : "",
	}
}

async function renderPrintableMarkdown(
	content: string,
	assets: PrintableAsset[],
	syntaxTheme: SyntaxTheme,
	parseHtml?: HtmlParser,
): Promise<string> {
	let highlighter = await loadSyntaxHighlighter(syntaxTheme)
	let marked = new Marked()
	marked.use(
		markedShiki({
			highlight(code, language) {
				return highlighter.highlight({
					code,
					language,
					theme: syntaxTheme,
				})
			},
		}),
	)
	marked.use(markedFootnote())
	marked.use(createTableContinuationExtension())
	marked.setOptions({ gfm: true, breaks: true })
	let parsedHtml = await marked.parse(content)
	return replaceAssetSources(parsedHtml, assets, parseHtml)
}

function buildPresetVariables(preset: ThemePresetType): string {
	let vars: string[] = []
	let { colors, fonts } = preset

	vars.push(`--preset-background: ${colors.background}`)
	vars.push(`--preset-foreground: ${colors.foreground}`)
	vars.push(`--preset-accent: ${colors.accent}`)

	vars.push(`--preset-accent-1: ${colors.accent}`)
	if (colors.accents) {
		for (let i = 0; i < Math.min(colors.accents.length, 5); i++) {
			vars.push(`--preset-accent-${i + 2}: ${colors.accents[i]}`)
		}
	}

	if (colors.heading) vars.push(`--preset-heading: ${colors.heading}`)
	if (colors.link) vars.push(`--preset-link: ${colors.link}`)
	if (colors.codeBackground)
		vars.push(`--preset-code-background: ${colors.codeBackground}`)

	if (fonts?.title) vars.push(`--preset-font-title: ${fonts.title}`)
	if (fonts?.body) vars.push(`--preset-font-body: ${fonts.body}`)

	vars.push(`--preset-appearance: ${preset.appearance}`)

	vars.push(`--theme-background: ${colors.background}`)
	vars.push(`--theme-foreground: ${colors.foreground}`)
	vars.push(`--theme-accent: ${colors.accent}`)

	return `:root {\n\t${vars.join(";\n\t")};\n}`
}

function buildPrintableHtml(params: {
	title: string
	htmlContent: string
	theme: PrintTheme | null
	parseHtml: HtmlParser
}): string {
	let { title, htmlContent, theme, parseHtml } = params
	let documentContent = `<article class="content">${htmlContent}</article>`
	let rendered = theme?.template
		? renderTemplateWithContent(theme.template, documentContent, parseHtml)
		: null
	let bodyContent = createPrintableThemeRoot(
		theme?.name ?? "",
		rendered ?? documentContent,
	)
	let fontFaceRules = theme?.fontFaceRules ?? ""
	let presetVariables = theme?.presetVariables ?? ""
	let themeCss = theme?.css ?? ""

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(title)}</title>
	<style>
		/* Disable all animations for print */
		*, *::before, *::after {
			animation: none !important;
			transition: none !important;
		}

		/* Reset and base styles */
		*, *::before, *::after {
			box-sizing: border-box;
		}

		html {
			font-size: 16px;
			line-height: 1.6;
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}

		body {
			margin: 0;
			padding: 2rem;
			font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			color: #171717;
			background: #ffffff;
		}

		/* Print-specific styles */
		@media print {
			body {
				padding: 0;
				background: white;
				color: black;
			}

			@page {
				margin: 2cm;
				size: A4;
			}

			/* Prevent page breaks inside these elements */
			h1, h2, h3, h4, h5, h6 {
				page-break-after: avoid;
				break-after: avoid;
			}

			pre, blockquote, figure, table {
				page-break-inside: avoid;
				break-inside: avoid;
			}
		}

		/* Prose styles for content (default, theme CSS overrides) */
		article {
			max-width: 65ch;
			margin: 0 auto;
		}

		article h1, article h2, article h3, article h4, article h5, article h6 {
			font-weight: 600;
			line-height: 1.3;
			margin-top: 1.5em;
			margin-bottom: 0.5em;
		}

		article h1 { font-size: 2rem; margin-top: 0; }
		article h2 { font-size: 1.5rem; }
		article h3 { font-size: 1.25rem; }
		article h4 { font-size: 1.125rem; }

		article p {
			margin: 1em 0;
		}

		article a {
			color: inherit;
			text-decoration: underline;
		}

		article ul, article ol {
			padding-left: 1.5em;
			margin: 1em 0;
		}

		article li {
			margin: 0.25em 0;
		}

		article blockquote {
			margin: 1em 0;
			padding-left: 1em;
			border-left: 3px solid currentColor;
			opacity: 0.8;
		}

		article pre {
			background: #f5f5f5;
			padding: 1em;
			border-radius: 0.5em;
			overflow-x: auto;
			font-size: 0.875em;
			line-height: 1.5;
		}

		article code {
			font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace;
			font-size: 0.875em;
		}

		article :not(pre) > code {
			background: #f5f5f5;
			padding: 0.2em 0.4em;
			border-radius: 0.25em;
		}

		article img {
			max-width: 100%;
			height: auto;
			border-radius: 0.5em;
		}

		article figure {
			margin: 1em 0;
		}

		article figcaption {
			text-align: center;
			font-size: 0.875em;
			opacity: 0.7;
			margin-top: 0.5em;
		}

		article table {
			width: 100%;
			border-collapse: collapse;
			margin: 1em 0;
		}

		article th, article td {
			border: 1px solid #e5e5e5;
			padding: 0.5em;
			text-align: left;
		}

		article th {
			background: #f5f5f5;
			font-weight: 600;
		}

		article hr {
			border: none;
			border-top: 1px solid #e5e5e5;
			margin: 2em 0;
		}

		/* Task list styles */
		article ul:has(input[type="checkbox"]) {
			list-style: none;
			padding-left: 0;
		}

		article ul:has(input[type="checkbox"]) li {
			display: flex;
			align-items: flex-start;
			gap: 0.5em;
		}

		article input[type="checkbox"] {
			margin-top: 0.3em;
		}
	</style>
	${fontFaceRules ? `<style>\n${fontFaceRules}\n</style>` : ""}
	${presetVariables ? `<style>\n${presetVariables}\n</style>` : ""}
	${themeCss ? `<style>\n${themeCss}\n</style>` : ""}
</head>
<body>
	${bodyContent}
</body>
</html>`
}

function createPrintableThemeRoot(themeName: string, content: string): string {
	return `<div data-theme-scope="print" data-appearance="light"><div class="theme document" data-theme="${escapeHtml(themeName)}" data-appearance="light">${content}</div></div>`
}

function renderTemplateWithContent(
	template: string,
	content: string,
	parseHtml: HtmlParser,
): string | null {
	let doc = parseHtml(template)

	let placeholder = doc.querySelector("[data-content], [data-document]")
	if (!placeholder) return null

	placeholder.innerHTML = content

	let headStyles = Array.from(doc.head.querySelectorAll("style"))
		.map(s => s.outerHTML)
		.join("\n")

	let bodyHtml = doc.body.innerHTML
	return headStyles ? bodyHtml + "\n" + headStyles : bodyHtml
}

async function buildFontFaceRulesBase64(theme: LoadedTheme): Promise<string> {
	if (!theme.assets?.$isLoaded) return ""

	let rules: string[] = []

	for (let asset of theme.assets.values()) {
		if (!asset?.$isLoaded) continue
		let loaded: LoadedAsset = asset
		if (!loaded.data?.$isLoaded) continue
		if (!loaded.mimeType.startsWith("font/")) continue

		let blob = loaded.data.toBlob()
		if (!blob) continue

		let base64 = await blobToBase64(blob)
		let dataUri = `data:${loaded.mimeType};base64,${base64}`

		rules.push(`
@font-face {
	font-family: "${loaded.name}";
	src: url("${dataUri}") format("${getFontFormat(loaded.mimeType)}");
	font-display: swap;
}`)
	}

	return rules.join("\n")
}

function getFontFormat(mimeType: string): string {
	let formats: Record<string, string> = {
		"font/woff2": "woff2",
		"font/woff": "woff",
		"font/ttf": "truetype",
		"font/otf": "opentype",
	}
	return formats[mimeType] ?? "woff2"
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;")
}
