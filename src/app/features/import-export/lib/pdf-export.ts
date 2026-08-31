import { Marked } from "marked"
import { type co } from "jazz-tools"
import { type Theme, type ThemeAsset } from "@/schema"
import { parseFrontmatter } from "@/app/features/editor/lib/frontmatter"
import {
	findThemeByName,
	getThemeName,
	getPresetName,
	findPresetByName,
	getThemePresets,
	findPresetByAppearance,
	type LoadedThemes,
	type ThemesQuery,
	type ThemePresetType,
} from "@/app/features/themes/lib/document-theme"
import { getDocumentTitle } from "@/app/features/documents/lib/title"
import type { PrintableAsset } from "@/app/features/assets"
import { replaceAssetSources } from "./print-media"

export { printToPdf }

type LoadedTheme = co.loaded<typeof Theme, ThemesQuery["$each"]>
type LoadedAsset = co.loaded<typeof ThemeAsset, { data: true }>

async function printToPdf(params: {
	content: string
	themes: LoadedThemes | undefined
	defaultPreviewTheme: string | null
	assets: PrintableAsset[]
}) {
	let { content, themes, defaultPreviewTheme, assets } = params
	let { body } = parseFrontmatter(content)
	let title = getDocumentTitle(content)

	let themeName = getThemeName(content)
	let presetName = getPresetName(content)

	let isAppearanceOnlyTheme = themeName === "light" || themeName === "dark"
	let effectiveThemeName = isAppearanceOnlyTheme ? null : themeName

	if (!effectiveThemeName && defaultPreviewTheme) {
		effectiveThemeName = defaultPreviewTheme
	}

	let theme = effectiveThemeName
		? findThemeByName(themes ?? null, effectiveThemeName)
		: null
	let preset = null

	if (theme && presetName) {
		preset = findPresetByName(theme, presetName)
	} else if (theme) {
		preset = findPresetByAppearance(theme, "light")
		if (!preset) {
			let presets = getThemePresets(theme)
			preset = presets[0] ?? null
		}
	}

	let marked = new Marked()
	marked.setOptions({ gfm: true, breaks: true })
	let parsedHtml = await marked.parse(body)
	let htmlContent = await replaceAssetSources(parsedHtml, assets)

	let printableHtml = await buildPrintableHtml({
		title,
		htmlContent,
		theme,
		preset,
	})

	openPrintWindow(printableHtml)
}

async function buildPrintableHtml(params: {
	title: string
	htmlContent: string
	theme: LoadedTheme | null
	preset: ThemePresetType | null
}): Promise<string> {
	let { title, htmlContent, theme, preset } = params

	let fontFaceRules = ""
	let presetVariables = ""
	let themeCss = ""
	let bodyContent = ""

	if (theme) {
		fontFaceRules = await buildFontFaceRulesBase64(theme)

		if (preset) {
			presetVariables = buildPresetVariables(preset)
		}

		// Get CSS if loaded
		if (theme.css?.$isLoaded) {
			themeCss = theme.css.toString()
		}

		// Try to render with theme template
		if (theme.template?.$isLoaded) {
			let templateHtml = theme.template.toString()
			let rendered = renderTemplateWithContent(templateHtml, htmlContent)
			if (rendered) {
				bodyContent = `<div data-theme="${theme.name}">${rendered}</div>`
			}
		}
	}

	// Fall back to default structure if no template or template failed
	if (!bodyContent) {
		let themeName = theme?.name ?? ""
		bodyContent = `<div data-theme="${themeName}"><article>${htmlContent}</article></div>`
	}

	let html = `<!DOCTYPE html>
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

	return html
}

function openPrintWindow(html: string): void {
	let printWindow = window.open("", "_blank")
	if (!printWindow) {
		let blob = new Blob([html], { type: "text/html" })
		let url = URL.createObjectURL(blob)
		window.open(url, "_blank")
		return
	}

	let parsed = new DOMParser().parseFromString(html, "text/html")
	let imported = printWindow.document.importNode(parsed.documentElement, true)
	printWindow.document.replaceChild(
		imported,
		printWindow.document.documentElement,
	)
	void printWhenReady(printWindow)
}

async function printWhenReady(printWindow: Window) {
	if (printWindow.document.fonts?.ready) {
		await printWindow.document.fonts.ready
	}
	await waitForImages(printWindow.document)
	printWindow.print()
}

function waitForImages(document: Document): Promise<void[]> {
	return Promise.all(
		Array.from(document.images).map(image => {
			if (image.complete) return Promise.resolve()
			return new Promise<void>(resolve => {
				let timeout = window.setTimeout(finish, 5_000)

				function finish() {
					window.clearTimeout(timeout)
					image.removeEventListener("load", finish)
					image.removeEventListener("error", finish)
					resolve()
				}

				image.addEventListener("load", finish)
				image.addEventListener("error", finish)
			})
		}),
	)
}

function renderTemplateWithContent(
	template: string,
	content: string,
): string | null {
	let parser = new DOMParser()
	let doc = parser.parseFromString(template, "text/html")

	let placeholder = doc.querySelector("[data-document]")
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
		let loaded = asset as LoadedAsset
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

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		let reader = new FileReader()
		reader.onloadend = () => {
			let result = reader.result
			if (typeof result !== "string") {
				reject(new Error("Could not read blob"))
				return
			}
			let base64 = result.split(",")[1]
			resolve(base64)
		}
		reader.onerror = reject
		reader.readAsDataURL(blob)
	})
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
