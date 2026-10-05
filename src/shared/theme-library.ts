import { compileTheme } from "./markdown"
import { resolvePreset } from "./themes"
import type { ThemeKind } from "./themes"

// The original's account theme library: themes uploaded or created once in
// Settings serve every document. A document names its theme in frontmatter
// (`theme-id` or `theme`); without one, the account's default preview or
// slideshow theme applies.

export interface ThemeRecord {
	id: string
	fields: Record<string, string>
}
export interface ThemeEntry {
	id: string
	name: string
	source: string
}
export interface LibraryTheme extends ThemeEntry {
	kind: ThemeKind
	author: string
	invalid: boolean
}

export let themeLibraryTitle = "Themes"

// Devices must agree on the birth operations; this source and actor are stable.
export function themeLibraryBirth(subject: string) {
	return {
		workspace: "personal-" + subject,
		document: "theme-library-" + subject,
		actor: subject + "-theme-library-v1",
		source:
			"---\ntitle: Themes\n---\n\nYour theme library. Manage its themes in Settings › Editor › Themes.\n",
	}
}

export function libraryThemes(
	records: readonly ThemeRecord[],
	text: (id: string) => string,
): LibraryTheme[] {
	return records.map(record => {
		let source = text(record.id)
		let metadata: { name?: string; author?: string; type?: ThemeKind } = {}
		let invalid = false
		try {
			metadata = compileTheme(source).metadata
		} catch {
			invalid = true
		}
		return {
			id: record.id,
			name: metadata.name?.trim() || record.fields.name || "Custom theme",
			source,
			kind: metadata.type ?? "both",
			author: metadata.author ?? "",
			invalid,
		}
	})
}

export function themesFor(themes: readonly LibraryTheme[], mode: ThemeKind) {
	return themes.filter(theme => theme.kind === "both" || theme.kind === mode)
}

export interface ResolvedTheme {
	source: string
	warning?: string
}

export function resolveTheme(options: {
	header: Readonly<Record<string, string>>
	document: readonly ThemeEntry[]
	library: readonly ThemeEntry[]
	// The account's default theme for the current view, by id.
	fallback: string
	appearance?: string
}): ResolvedTheme {
	let id = options.header["theme-id"]?.trim() ?? ""
	let name = options.header.theme?.trim() ?? ""
	let appearanceOnly = name === "light" || name === "dark"
	let requested = id || (appearanceOnly ? "" : name)
	let themes = [...options.document, ...options.library]
	let theme = requested
		? (themes.find(theme => theme.id === requested) ??
			(id
				? undefined
				: themes.find(
						theme => theme.name.toLowerCase() === requested.toLowerCase(),
					)))
		: options.fallback
			? options.library.find(theme => theme.id === options.fallback)
			: undefined
	if (!theme)
		return requested
			? {
					source: "",
					warning: `Theme "${requested}" not found. Upload it in Settings > Themes.`,
				}
			: { source: "" }
	let preset = options.header.preset?.trim() ?? ""
	if (preset) {
		try {
			let presets = compileTheme(theme.source).metadata.presets
			let fallback = resolvePreset(presets, preset, options.appearance)
			if (
				fallback &&
				!presets.some(
					candidate => candidate.name.toLowerCase() === preset.toLowerCase(),
				)
			)
				return {
					source: theme.source,
					warning: `Preset "${preset}" not found in theme "${theme.name}". Using "${fallback.name}" instead.`,
				}
		} catch {}
	}
	return { source: theme.source }
}
