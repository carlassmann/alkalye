import { app } from "@/jazz/schema"
import type { Database } from "@/app/features/documents/lib/library"
import { createThemeSourceDocument, serializeThemeSource } from "./source"
import { getDefaultThemeSource } from "./default-theme"
import { parseThemeSource } from "./source"
import type { ParsedTheme } from "./upload"
export { createTheme, createDefaultTheme }
async function createTheme(db: Database, ownerId: string, parsed: ParsedTheme) {
	let now = new Date()
	let write = db.insert(app.themes, {
		ownerId,
		name: parsed.name,
		author: parsed.author,
		description: parsed.description,
		type: parsed.type,
		css: parsed.css,
		template: parsed.template,
		slideTemplate: parsed.slideTemplate,
		presets: parsed.presets,
		thumbnailDataUrl: parsed.thumbnailDataUrl,
		createdAt: now,
		updatedAt: now,
	})
	await write.wait({ tier: "local" })
	let theme = write.value
	for (let asset of parsed.assets) {
		let write = await db.insertStreaming(app.themeAssets, {
			themeId: theme.id,
			name: asset.name,
			mimeType: asset.mimeType,
			data: asset.file.stream(),
			createdAt: now,
		})
		await write.wait({ tier: "local" })
	}
	if (parsed.thumbnail && !parsed.thumbnailDataUrl) {
		let write = await db.updateStreaming(app.themes, theme.id, {
			thumbnail: parsed.thumbnail.stream(),
		})
		await write.wait({ tier: "local" })
	}
	let source = await createThemeSourceDocument(db, ownerId, {
		themeId: theme.id,
		name: theme.name,
		source:
			parsed.source ??
			serializeThemeSource({
				css: parsed.css,
				documentTemplate: parsed.template,
				slideTemplate: parsed.slideTemplate,
			}),
	})
	await db
		.update(app.themes, theme.id, { sourceDocId: source.id })
		.wait({ tier: "local" })
	return { ...theme, sourceDocId: source.id }
}
async function createDefaultTheme(db: Database, ownerId: string) {
	let source = getDefaultThemeSource()
	let parsed = parseThemeSource(source)
	return createTheme(db, ownerId, {
		name: `Custom theme ${(await db.all(app.themes.where({ ownerId }).select("id"))).length + 1}`,
		type: "both",
		css: parsed.css,
		source,
		assets: [],
	})
}
