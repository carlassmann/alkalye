import { type co } from "jazz-tools"
import { type Theme, type ThemeAsset } from "./schema"
import { type ThemesQuery, type ThemePresetType } from "./document-theme"

export {
	buildThemeStyles,
	buildThemeStylesAsync,
	tryBuildThemeStyles,
	tryCachedThemeStyles,
	tryCachedThemeStylesAsync,
	renderTemplateWithContent,
	tryRenderTemplateWithContent,
	getCachedThemeStyles,
	getCachedThemeStylesAsync,
	cleanupThemeCache,
	scopeThemeCss,
	type ThemeStyles,
	type ThemeRenderResult,
}

type LoadedTheme = co.loaded<typeof Theme, ThemesQuery["$each"]>
type LoadedAsset = co.loaded<typeof ThemeAsset, { data: true }>

type ThemeStyles = {
	css: string
	cssHash: string
	fontFaceRules: string
	presetVariables: string
	blobUrls: string[]
}

type CacheEntry = {
	styles: ThemeStyles
	themeUpdatedAt: number
}

let themeStylesCache = new Map<string, CacheEntry>()

type ThemeRenderResult =
	| { ok: true; styles: ThemeStyles }
	| { ok: false; error: string }

function scopeThemeCss(css: string, scopeSelector: string): string {
	if (!css.trim()) return ""

	let imports: string[] = []
	let scopedCss = css.replace(/^\s*@import[\s\S]*?;/gim, importRule => {
		imports.push(importRule.trim())
		return ""
	})
	let scoped = `@scope (${scopeSelector}) {\n${scopedCss.replace(/:root\b/g, ":scope")}\n}`
	return imports.length > 0 ? `${imports.join("\n")}\n${scoped}` : scoped
}

function getCachedThemeStyles(
	theme: LoadedTheme,
	preset: ThemePresetType | null,
): ThemeStyles {
	let themeId = theme.$jazz.id
	let presetName = preset?.name ?? null
	let cacheKey = getCacheKey(themeId, presetName)
	let themeUpdatedAt = theme.updatedAt?.getTime() ?? 0

	let cached = themeStylesCache.get(cacheKey)
	if (cached && cached.themeUpdatedAt === themeUpdatedAt) {
		return cached.styles
	}

	if (cached) {
		for (let url of cached.styles.blobUrls) {
			URL.revokeObjectURL(url)
		}
	}

	let styles = buildThemeStyles(theme, preset)
	themeStylesCache.set(cacheKey, { styles, themeUpdatedAt })

	return styles
}

function cleanupThemeCache(themeId: string): void {
	for (let [key, entry] of themeStylesCache) {
		if (key.startsWith(`${themeId}:`)) {
			for (let url of entry.styles.blobUrls) {
				URL.revokeObjectURL(url)
			}
			themeStylesCache.delete(key)
		}
	}
}

function buildThemeStyles(
	theme: LoadedTheme,
	preset: ThemePresetType | null,
): ThemeStyles {
	let blobUrls: string[] = []
	let fontFaceRules = ""
	let presetVariables = ""

	if (theme.assets?.$isLoaded) {
		for (let asset of theme.assets.values()) {
			if (!asset?.$isLoaded) continue
			let loaded = asset as LoadedAsset
			if (!loaded.data?.$isLoaded) continue
			if (!loaded.mimeType.startsWith("font/")) continue

			let blob = loaded.data.toBlob()
			if (!blob) continue

			let url = URL.createObjectURL(blob)
			blobUrls.push(url)

			fontFaceRules += `
@font-face {
	font-family: "${loaded.name}";
	src: url("${url}") format("${getFontFormat(loaded.mimeType)}");
	font-display: swap;
}
`
		}
	}

	if (preset) {
		presetVariables = buildPresetVariables(preset)
	}

	let css = theme.css?.toString() ?? ""

	return {
		css,
		cssHash: hashText(css),
		fontFaceRules,
		presetVariables,
		blobUrls,
	}
}

function tryBuildThemeStyles(
	theme: LoadedTheme,
	preset: ThemePresetType | null,
): ThemeRenderResult {
	try {
		let styles = buildThemeStyles(theme, preset)
		return { ok: true, styles }
	} catch (error) {
		let errorMessage =
			error instanceof Error ? error.message : "Unknown error building theme"
		console.error(
			`[Theme Error] Failed to build styles for theme "${theme.name}":`,
			error,
		)
		return { ok: false, error: errorMessage }
	}
}

function tryCachedThemeStyles(
	theme: LoadedTheme,
	preset: ThemePresetType | null,
): ThemeRenderResult {
	try {
		let styles = getCachedThemeStyles(theme, preset)
		return { ok: true, styles }
	} catch (error) {
		let errorMessage =
			error instanceof Error ? error.message : "Unknown error building theme"
		console.error(
			`[Theme Error] Failed to build styles for theme "${theme.name}":`,
			error,
		)
		return { ok: false, error: errorMessage }
	}
}

async function getCachedThemeStylesAsync(
	theme: LoadedTheme,
	preset: ThemePresetType | null,
): Promise<ThemeStyles> {
	let themeId = theme.$jazz.id
	let presetName = preset?.name ?? null
	let cacheKey = getCacheKey(themeId, presetName)
	let themeUpdatedAt = theme.updatedAt?.getTime() ?? 0

	let cached = themeStylesCache.get(cacheKey)
	if (cached && cached.themeUpdatedAt === themeUpdatedAt) {
		return cached.styles
	}

	if (cached) {
		for (let url of cached.styles.blobUrls) {
			URL.revokeObjectURL(url)
		}
	}

	let styles = await buildThemeStylesAsync(theme, preset)
	themeStylesCache.set(cacheKey, { styles, themeUpdatedAt })

	return styles
}

async function buildThemeStylesAsync(
	theme: LoadedTheme,
	preset: ThemePresetType | null,
): Promise<ThemeStyles> {
	let blobUrls: string[] = []
	let fontFaceRules = ""
	let presetVariables = ""

	if (preset) {
		presetVariables = buildPresetVariables(preset)
	}

	await yieldToMain()

	if (theme.assets?.$isLoaded) {
		let assets = Array.from(theme.assets.values())
		for (let i = 0; i < assets.length; i++) {
			let asset = assets[i]
			if (!asset?.$isLoaded) continue
			let loaded = asset as LoadedAsset
			if (!loaded.data?.$isLoaded) continue
			if (!loaded.mimeType.startsWith("font/")) continue

			let blob = loaded.data.toBlob()
			if (!blob) continue

			let url = URL.createObjectURL(blob)
			blobUrls.push(url)

			fontFaceRules += `
@font-face {
	font-family: "${loaded.name}";
	src: url("${url}") format("${getFontFormat(loaded.mimeType)}");
	font-display: swap;
}
`
			if (i % 3 === 2) {
				await yieldToMain()
			}
		}
	}

	let css = theme.css?.toString() ?? ""

	return {
		css,
		cssHash: hashText(css),
		fontFaceRules,
		presetVariables,
		blobUrls,
	}
}

async function tryCachedThemeStylesAsync(
	theme: LoadedTheme,
	preset: ThemePresetType | null,
): Promise<ThemeRenderResult> {
	try {
		let styles = await getCachedThemeStylesAsync(theme, preset)
		return { ok: true, styles }
	} catch (error) {
		let errorMessage =
			error instanceof Error ? error.message : "Unknown error building theme"
		console.error(
			`[Theme Error] Failed to build styles for theme "${theme.name}":`,
			error,
		)
		return { ok: false, error: errorMessage }
	}
}

type TemplateRenderResult =
	| { ok: true; html: string }
	| { ok: false; error: string }

function renderTemplateWithContent(
	template: string,
	content: string,
): string | null {
	let parser = new DOMParser()
	let doc = parser.parseFromString(template, "text/html")

	let placeholder = doc.querySelector("[data-content], [data-document]")
	if (!placeholder) return null

	placeholder.innerHTML = content

	let headStyles = Array.from(doc.head.querySelectorAll("style"))
		.map(s => s.outerHTML)
		.join("\n")

	let bodyHtml = doc.body.innerHTML
	return headStyles ? bodyHtml + "\n" + headStyles : bodyHtml
}

function tryRenderTemplateWithContent(
	template: string,
	content: string,
	themeName: string,
): TemplateRenderResult {
	try {
		let html = renderTemplateWithContent(template, content)
		if (html === null) {
			console.error(
				`[Theme Error] Template for theme "${themeName}" is missing [data-document] placeholder`,
			)
			return {
				ok: false,
				error: "Template is missing [data-document] placeholder",
			}
		}
		return { ok: true, html }
	} catch (error) {
		let errorMessage =
			error instanceof Error
				? error.message
				: "Unknown error rendering template"
		console.error(
			`[Theme Error] Failed to render template for theme "${themeName}":`,
			error,
		)
		return { ok: false, error: errorMessage }
	}
}

function getCacheKey(themeId: string, presetName: string | null): string {
	return `${themeId}:${presetName ?? "__default__"}`
}

function hashText(value: string): string {
	let hash = 2166136261
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index)
		hash = Math.imul(hash, 16777619)
	}
	return String(hash >>> 0)
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

function yieldToMain(): Promise<void> {
	return new Promise(resolve => {
		setTimeout(resolve, 0)
	})
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
