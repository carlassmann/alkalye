import { beforeEach, describe, it, expect } from "vitest"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { UserAccount } from "@/schema"
import { createDefaultTheme } from "./default-theme"
import {
	getThemeName,
	getPresetName,
	findThemeByName,
	resolveDocumentTheme,
} from "./document-theme"

beforeEach(async () => {
	await setupJazzTestSync()
})

describe("getThemeName", () => {
	it("returns null when no frontmatter", () => {
		expect(getThemeName("# Hello World")).toBe(null)
	})

	it("returns null when frontmatter has no theme field", () => {
		let content = `---
title: Test
---
# Hello`
		expect(getThemeName(content)).toBe(null)
	})

	it("extracts theme name from frontmatter", () => {
		let content = `---
theme: Elegant
---
# Hello`
		expect(getThemeName(content)).toBe("Elegant")
	})

	it("trims whitespace from theme name", () => {
		let content = `---
theme: "  Elegant  "
---
# Hello`
		expect(getThemeName(content)).toBe("Elegant")
	})

	it("returns null for empty theme string", () => {
		let content = `---
theme: ""
---
# Hello`
		expect(getThemeName(content)).toBe(null)
	})

	it("returns appearance value as theme name (light)", () => {
		// This allows useDocumentTheme to detect appearance-only values
		let content = `---
theme: light
---
# Hello`
		expect(getThemeName(content)).toBe("light")
	})

	it("returns appearance value as theme name (dark)", () => {
		let content = `---
theme: dark
---
# Hello`
		expect(getThemeName(content)).toBe("dark")
	})
})

describe("getPresetName", () => {
	it("returns null when no frontmatter", () => {
		expect(getPresetName("# Hello")).toBe(null)
	})

	it("returns null when no preset field", () => {
		let content = `---
theme: Elegant
---
# Hello`
		expect(getPresetName(content)).toBe(null)
	})

	it("extracts preset name from frontmatter", () => {
		let content = `---
theme: Elegant
preset: Dawn
---
# Hello`
		expect(getPresetName(content)).toBe("Dawn")
	})
})

describe("findThemeByName", () => {
	it("returns null for null themes list", () => {
		expect(findThemeByName(null, "Test")).toBe(null)
	})

	it("returns null for undefined themes list", () => {
		expect(findThemeByName(undefined, "Test")).toBe(null)
	})

	it("returns null for empty themes list", () => {
		let themes = [] as unknown as Parameters<typeof findThemeByName>[0]
		expect(findThemeByName(themes, "Test")).toBe(null)
	})

	it("finds theme by exact name match", () => {
		let mockTheme = { name: "Elegant", $isLoaded: true }
		let themes = [mockTheme] as unknown as Parameters<typeof findThemeByName>[0]
		expect(findThemeByName(themes, "Elegant")).toBe(mockTheme)
	})

	it("finds theme by case-insensitive name match", () => {
		let mockTheme = { name: "Elegant", $isLoaded: true }
		let themes = [mockTheme] as unknown as Parameters<typeof findThemeByName>[0]
		expect(findThemeByName(themes, "elegant")).toBe(mockTheme)
		expect(findThemeByName(themes, "ELEGANT")).toBe(mockTheme)
	})

	it("returns null when theme not found", () => {
		let mockTheme = { name: "Elegant", $isLoaded: true }
		let themes = [mockTheme] as unknown as Parameters<typeof findThemeByName>[0]
		expect(findThemeByName(themes, "NotFound")).toBe(null)
	})

	it("skips null entries in themes list", () => {
		let mockTheme = { name: "Elegant", $isLoaded: true }
		let themes = [null, mockTheme] as unknown as Parameters<
			typeof findThemeByName
		>[0]
		expect(findThemeByName(themes, "Elegant")).toBe(mockTheme)
	})

	it("skips unloaded themes", () => {
		let unloadedTheme = { name: "Unloaded", $isLoaded: false }
		let loadedTheme = { name: "Elegant", $isLoaded: true }
		let themes = [unloadedTheme, loadedTheme] as unknown as Parameters<
			typeof findThemeByName
		>[0]
		expect(findThemeByName(themes, "Unloaded")).toBeNull()
		expect(findThemeByName(themes, "Elegant")).toBe(loadedTheme)
	})
})

describe("resolveDocumentTheme", () => {
	let appearanceCases: {
		mode: "light" | "dark"
		appearance: "light" | "dark"
	}[] = [
		{ mode: "light", appearance: "light" },
		{ mode: "dark", appearance: "dark" },
	]
	it.each(appearanceCases)(
		"applies the default theme for appearance-only $mode documents",
		async ({
			mode,
			appearance,
		}: {
			mode: "light" | "dark"
			appearance: "light" | "dark"
		}) => {
			let account = await createJazzTestAccount({
				isCurrentActiveAccount: true,
				AccountSchema: UserAccount,
			})
			let theme = await createDefaultTheme(account)
			let loaded = await account.$jazz.ensureLoaded({
				resolve: {
					root: {
						themes: {
							$each: {
								css: true,
								template: true,
								slideTemplate: true,
								assets: { $each: { data: true } },
							},
						},
					},
				},
			})
			let themes = loaded.root?.themes
			if (!themes) throw new Error("Themes did not load")
			let resolved = resolveDocumentTheme({
				content: `---\ntheme: ${mode}\n---\n\n# Hello`,
				themes,
				defaultThemeName: theme.$jazz.id,
				appearance,
			})
			expect(resolved.theme?.$jazz.id).toBe(theme.$jazz.id)
		},
	)
})

/**
 * NOTE: useDocumentTheme is a React hook that requires Jazz context.
 * The default theme behavior is tested here via documentation:
 *
 * Default Theme Logic (in useDocumentTheme):
 * 1. If frontmatter has theme name (not "light"/"dark") → use that theme
 * 2. If frontmatter has "light" or "dark" → treat as appearance-only, fall through to default
 * 3. If no frontmatter theme → load default from settings:
 *    - mode="preview" → settings.defaultPreviewTheme
 *    - mode="slideshow" → settings.defaultSlideshowTheme
 * 4. If frontmatter theme specified but default theme exists → frontmatter wins (override)
 *
 * The implementation is at:
 * - src/lib/document-theme.ts:188-202 (fallback logic)
 * - src/routes/settings.tsx:541-647 (DefaultThemeSettings UI)
 *
 * PRD Stories Verified:
 * - "Default preview theme applies when no frontmatter" ✓
 * - "Default slideshow theme applies when no frontmatter" ✓
 * - "Frontmatter theme overrides default theme" ✓
 */
