import { co, z } from "jazz-tools"

export { Theme, ThemeAsset, ThemePreset, ThemeType }

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

// Asset stored within a theme (fonts, images)
let ThemeAsset = co.map({
	name: z.string(),
	mimeType: z.string(),
	data: co.fileStream(),
	createdAt: z.date(),
})

// Theme schema for custom themes
let Theme = co.map({
	version: z.literal(1),
	name: z.string(),
	author: z.string().optional(),
	description: z.string().optional(),
	type: ThemeType,
	css: co.plainText(),
	template: co.optional(co.plainText()),
	slideTemplate: co.optional(co.plainText()),
	sourceDocId: z.string().optional(),
	presets: z.string().optional(),
	assets: co.optional(co.list(ThemeAsset)),
	thumbnail: co.optional(co.image()),
	createdAt: z.date(),
	updatedAt: z.date(),
})
