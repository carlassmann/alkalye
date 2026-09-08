import { useAccount } from "jazz-tools/react"
import { z } from "zod"
import { parseFrontmatter } from "@/app/features/editor/lib/frontmatter"
import { UserAccount } from "@/schema"
import { type Theme, ThemePreset } from "./schema"
import { type co } from "jazz-tools"

export {
	getThemeName,
	getThemeId,
	getPresetName,
	findThemeByName,
	findThemeById,
	getThemePresets,
	findPresetByName,
	findPresetByAppearance,
	resolveDocumentTheme,
	useDocumentTheme,
	loadThemesForPdf,
}

export type { ResolvedTheme, ThemesQuery, LoadedThemes, ThemePresetType }

type ThemePresetType = z.infer<typeof ThemePreset>

type ResolvedTheme = {
	theme: co.loaded<typeof Theme, ThemesQuery["$each"]> | null
	preset: ThemePresetType | null
	warning: string | null
	isLoading: boolean
}

type ThemesQuery = {
	$each: {
		css: true
		template: true
		slideTemplate: true
		assets: { $each: { data: true } }
	}
}
type LoadedThemes = co.loaded<
	ReturnType<typeof co.list<typeof Theme>>,
	ThemesQuery
>

function getThemeName(content: string): string | null {
	let { frontmatter } = parseFrontmatter(content)
	if (!frontmatter) return null

	let theme = frontmatter.theme
	if (typeof theme !== "string" || !theme.trim()) return null

	return theme.trim()
}

function getThemeId(content: string): string | null {
	let { frontmatter } = parseFrontmatter(content)
	let value = frontmatter?.["theme-id"]
	return typeof value === "string" && value.trim() ? value.trim() : null
}

function getPresetName(content: string): string | null {
	let { frontmatter } = parseFrontmatter(content)
	if (!frontmatter) return null

	let preset = frontmatter.preset
	if (typeof preset !== "string" || !preset.trim()) return null

	return preset.trim()
}

function findThemeByName(
	themes: LoadedThemes | null | undefined,
	themeName: string,
): co.loaded<typeof Theme, ThemesQuery["$each"]> | null {
	if (!themes) return null

	let lowerName = themeName.toLowerCase()
	for (let theme of themes) {
		if (theme?.name?.toLowerCase() === lowerName && theme.$isLoaded) {
			return theme
		}
	}
	return null
}

function findThemeById(
	themes: LoadedThemes | null | undefined,
	themeId: string,
): co.loaded<typeof Theme, ThemesQuery["$each"]> | null {
	if (!themes) return null
	for (let theme of themes) {
		if (theme?.$isLoaded && theme.$jazz.id === themeId) return theme
	}
	return null
}

function getThemePresets(theme: {
	presets?: string | null
}): ThemePresetType[] {
	if (!theme.presets) {
		return []
	}

	try {
		let parsed = JSON.parse(theme.presets) as
			| ThemePresetType[]
			| { presets: ThemePresetType[] }
		let presets = Array.isArray(parsed) ? parsed : (parsed.presets ?? [])
		return presets
	} catch {
		return []
	}
}

function findPresetByName(
	theme: { presets?: string | null },
	presetName: string,
): ThemePresetType | null {
	let presets = getThemePresets(theme)
	if (presets.length === 0) return null

	let lowerName = presetName.toLowerCase()
	for (let preset of presets) {
		if (preset.name.toLowerCase() === lowerName) {
			return preset
		}
	}
	return null
}

function resolveDocumentTheme(params: {
	content: string
	themes: LoadedThemes | null | undefined
	defaultThemeName: string | null
	appearance?: Appearance | null
	themeOverrideId?: string
}): Omit<ResolvedTheme, "isLoading"> {
	let { content, themes, defaultThemeName, appearance, themeOverrideId } =
		params

	let themeName = getThemeName(content)
	let themeId = getThemeId(content)
	let presetName = getPresetName(content)

	let isAppearanceOnlyTheme = themeName === "light" || themeName === "dark"
	let effectiveThemeName = isAppearanceOnlyTheme
		? null
		: (themeName ?? defaultThemeName)

	if (!effectiveThemeName && !themeOverrideId) {
		return { theme: null, preset: null, warning: null }
	}

	let theme = themeOverrideId
		? findThemeById(themes ?? null, themeOverrideId)
		: themeId
			? findThemeById(themes ?? null, themeId)
			: (findThemeById(themes ?? null, effectiveThemeName ?? "") ??
				findThemeByName(themes ?? null, effectiveThemeName ?? ""))
	if (!theme) {
		if (themeOverrideId || themeId || effectiveThemeName?.startsWith("co_"))
			return { theme: null, preset: null, warning: null }
		if (themeName && !isAppearanceOnlyTheme) {
			return {
				theme: null,
				preset: null,
				warning: `Theme "${effectiveThemeName}" not found. Upload it in Settings > Themes.`,
			}
		}
		return { theme: null, preset: null, warning: null }
	}

	let preset: ThemePresetType | null = null
	let warning: string | null = null

	if (presetName) {
		preset = findPresetByName(theme, presetName)
		if (!preset) {
			let presets = getThemePresets(theme)
			if (appearance) {
				preset = findPresetByAppearance(theme, appearance)
			}
			preset = preset ?? presets[0] ?? null
			if (preset) {
				warning = `Preset "${presetName}" not found in theme "${effectiveThemeName}". Using "${preset.name}" instead.`
			}
		}
	} else if (appearance) {
		preset = findPresetByAppearance(theme, appearance)
		if (!preset) {
			let presets = getThemePresets(theme)
			preset = presets[0] ?? null
		}
	}

	return { theme, preset, warning }
}

function useDocumentTheme(
	content: string,
	mode: ThemeMode = "preview",
	appearance?: Appearance | null,
	themeOverrideId?: string,
): ResolvedTheme {
	let me = useAccount(UserAccount, { resolve: themesQuery })

	if (!me.$isLoaded || !me.root?.themes) {
		return { theme: null, preset: null, warning: null, isLoading: true }
	}

	let settings = me.root.settings
	let defaultThemeName = settings
		? mode === "slideshow"
			? (settings.defaultSlideshowTheme ?? null)
			: (settings.defaultPreviewTheme ?? null)
		: null

	let resolved = resolveDocumentTheme({
		content,
		themes: me.root.themes as LoadedThemes,
		defaultThemeName,
		appearance,
		themeOverrideId,
	})

	return { ...resolved, isLoading: false }
}

let themesQuery = {
	root: {
		settings: true,
		themes: {
			$each: {
				css: true,
				template: true,
				slideTemplate: true,
				assets: { $each: { data: true } },
			},
		},
	},
} as const

// Themes carry binary assets (fonts, images), so they are loaded on demand
// when exporting instead of being subscribed eagerly on every editor mount.
async function loadThemesForPdf(me: co.loaded<typeof UserAccount>) {
	let { root } = await me.$jazz.ensureLoaded({ resolve: themesQuery })
	return {
		themes: root.themes,
		defaultPreviewTheme: root.settings?.defaultPreviewTheme ?? null,
	}
}

type ThemeMode = "preview" | "slideshow"
type Appearance = "light" | "dark"

function findPresetByAppearance(
	theme: { presets?: string | null },
	appearance: Appearance,
): ThemePresetType | null {
	let presets = getThemePresets(theme)
	for (let preset of presets) {
		if (preset.appearance === appearance) {
			return preset
		}
	}
	return null
}
