import type { schema } from "jazz-tools"
import { app } from "@/jazz/schema"
export { getDefaultDocumentCss, getSlideshowBaseCss } from "./lib/default-theme"
export { sanitizeHtml } from "./lib/sanitize"
export {
	useDocumentTheme,
	tryCachedThemeStylesAsync,
	ThemePicker,
	PresetPicker,
}
export type { ResolvedTheme, ThemeStyles }
type ThemeRow = schema.RowOf<typeof app.themes>
type ResolvedTheme = {
	theme: ThemeRow | null
	preset: string | null
	warning?: string
}
type ThemeStyles = {
	css: string
	presetVariables: string
	fontFaceRules: string
}
function useDocumentTheme(..._args: unknown[]): ResolvedTheme {
	// v2-todo(themes): resolve custom themes and presets.
	return { theme: null, preset: null }
}
async function tryCachedThemeStylesAsync(
	..._args: unknown[]
): Promise<{ ok: true; styles: ThemeStyles } | { ok: false; error: string }> {
	return {
		ok: true,
		styles: { css: "", presetVariables: "", fontFaceRules: "" },
	}
}
function ThemePicker(_props: {
	content: string
	getContent?: () => string
	onThemeChange?: (content: string) => void
	onPresetChange?: (content: string) => void
	disabled?: boolean
}) {
	// v2-todo(themes): restore theme picker data.
	return null
}
function PresetPicker(_props: {
	content: string
	getContent?: () => string
	onThemeChange?: (content: string) => void
	onPresetChange?: (content: string) => void
	disabled?: boolean
}) {
	// v2-todo(themes): restore preset picker data.
	return null
}

export { scopeThemeCss } from "./lib/scope"
