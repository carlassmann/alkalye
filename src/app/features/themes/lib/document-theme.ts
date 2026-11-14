import { useAll, useSession } from "jazz-tools/react"
import { z } from "zod"
import { app } from "@/jazz/schema"
import { useLibrary, type Database } from "@/app/features/documents/lib/library"
import { parseFrontmatter } from "@/app/features/editor/lib/frontmatter"
import { ThemePreset, type ThemeRow, type ThemeAssetRow } from "./schema"
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

export type { ResolvedTheme, LoadedThemes, ThemePresetType }

type ThemePresetType = z.infer<typeof ThemePreset>

type ResolvedTheme = {
	theme: (ThemeRow & { assets?: ThemeAssetRow[] }) | null
	preset: ThemePresetType | null
	warning: string | null
	isLoading: boolean
}
type LoadedThemes = ThemeRow[]
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
): ThemeRow | null {
	if (!themes) return null

	let lowerName = themeName.toLowerCase()
	for (let theme of themes) {
		if (theme.name.toLowerCase() === lowerName) {
			return theme
		}
	}
	return null
}

function findThemeById(
	themes: LoadedThemes | null | undefined,
	themeId: string,
): ThemeRow | null {
	if (!themes) return null
	for (let theme of themes) {
		if (theme.id === themeId) return theme
	}
	return null
}

function getThemePresets(theme: { presets?: unknown }): ThemePresetType[] {
	try {
		let value =
			typeof theme.presets === "string"
				? JSON.parse(theme.presets)
				: theme.presets
		let parsed = z
			.union([
				z.array(ThemePreset),
				z.object({ presets: z.array(ThemePreset) }),
			])
			.safeParse(value)
		return parsed.success
			? Array.isArray(parsed.data)
				? parsed.data
				: parsed.data.presets
			: []
	} catch {
		return []
	}
}
function findPresetByName(
	theme: { presets?: unknown },
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
		? defaultThemeName
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
	let ownerId = useSession()?.user ?? undefined
	let { data: themes = [], isLoading } = useAll(app.themes.where({ ownerId }))
	let { settings } = useLibrary()
	let defaultThemeName =
		(mode === "slideshow"
			? settings?.defaultSlideshowTheme
			: settings?.defaultPreviewTheme) ?? null
	let resolved = resolveDocumentTheme({
		content,
		themes,
		defaultThemeName,
		appearance,
		themeOverrideId,
	})
	let { data: assets = [], isLoading: assetsLoading } = useAll(
		app.themeAssets.where({
			themeId: resolved.theme?.id ?? "00000000-0000-0000-0000-000000000000",
		}),
	)
	return {
		...resolved,
		theme:
			resolved.theme && !assetsLoading ? { ...resolved.theme, assets } : null,
		isLoading: isLoading || assetsLoading,
	}
}
async function loadThemesForPdf(db: Database) {
	let rows = await db.all(app.themes)
	let themes = await Promise.all(
		rows.map(async theme => ({
			...theme,
			assets: await db.all(app.themeAssets.where({ themeId: theme.id })),
		})),
	)
	let settings = await db.one(app.settings)
	return {
		themes,
		defaultPreviewTheme: settings?.defaultPreviewTheme ?? null,
		defaultSlideshowTheme: settings?.defaultSlideshowTheme ?? null,
		defaultSyntaxTheme: settings?.syntaxTheme ?? null,
	}
}

type ThemeMode = "preview" | "slideshow"
type Appearance = "light" | "dark"

function findPresetByAppearance(
	theme: { presets?: unknown },
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
