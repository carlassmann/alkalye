import { z } from "zod"
import type { schema } from "jazz-tools"
import { app } from "@/jazz/schema"

export { ThemePreset, ThemeType }
export type { ThemeRow, ThemeAssetRow }
type ThemeRow = schema.RowOf<typeof app.themes>
type ThemeAssetRow = schema.RowOf<typeof app.themeAssets>

// Theme types: 'preview' for document preview, 'slideshow' for presentations, 'both' for both
let ThemeType = z.enum(["preview", "slideshow", "both"])

// Color preset for slideshow themes
let ThemePreset = z.object({
	name: z.string(),
	appearance: z.enum(["light", "dark"]),
	colors: z.object({
		background: z.string(),
		foreground: z.string(),
		accent: z.string(),
		// Additional accent colors for richer color palettes (accent-2 through accent-6)
		accents: z.array(z.string()).optional(),
		heading: z.string().optional(),
		link: z.string().optional(),
		codeBackground: z.string().optional(),
	}),
	fonts: z
		.object({
			title: z.string().optional(),
			body: z.string().optional(),
		})
		.optional(),
})
