import { z } from "zod"
import { app } from "@/jazz/schema"
import type { Database } from "@/app/features/documents/lib/library"
import { ThemePreset, type ThemeRow, type ThemeAssetRow } from "./schema"
import { sanitizeFilename } from "@/app/features/import-export/lib/export"
import { setFrontmatterField } from "@/app/features/editor/lib/frontmatter"
import {
	serializeThemeSource,
	parseThemeSource,
	withThemeSourceMetadata,
	type ThemeSourceMetadata,
} from "./source"
import { serializePortableAssetFence } from "./portable-assets"
export { exportTheme, serializePortableTheme }
type LoadedThemeForExport = ThemeRow & {
	assets?: ThemeAssetRow[]
	sourceContent?: string
}
async function serializePortableTheme(
	theme: LoadedThemeForExport,
	sourceOverride?: string,
	validateSource?: (source: string) => unknown,
): Promise<string> {
	let source = sourceOverride ?? (await loadEditableSource(theme))
	let metadata: ThemeSourceMetadata = {
		name: theme.name,
		type: theme.type,
		author: theme.author ?? undefined,
		description: theme.description ?? undefined,
	}
	let sourceMetadata = parseThemeSource(source, {
		validateTemplate: () => null,
	}).metadata
	if (sourceMetadata) {
		if (sourceMetadata.thumbnail) metadata.thumbnail = sourceMetadata.thumbnail
	} else if (theme.thumbnailDataUrl) {
		metadata.thumbnail = theme.thumbnailDataUrl
	} else if (theme.thumbnail) {
		let binary = ""
		for (let index = 0; index < theme.thumbnail.length; index += 0x8000)
			binary += String.fromCharCode(
				...theme.thumbnail.subarray(index, index + 0x8000),
			)
		metadata.thumbnail = `data:image/png;base64,${btoa(binary)}`
	}
	if (theme.presets) {
		let presets = z
			.union([
				z.array(ThemePreset),
				z.object({ presets: z.array(ThemePreset) }),
			])
			.parse(
				typeof theme.presets === "string"
					? JSON.parse(theme.presets)
					: theme.presets,
			)
		metadata.presets = Array.isArray(presets) ? presets : presets.presets
	}
	let sections = [stripThemeSourceId(source).trimEnd()]
	let fontFaces: string[] = []
	for (let asset of theme.assets ?? []) {
		let data = { chunks: [asset.data] }
		let path = `legacy/${asset.id}`
		while (source.includes(path)) path += "-copy"
		let binary = ""
		for (let bytes of data.chunks)
			for (let index = 0; index < bytes.length; index += 0x8000)
				binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
		sections.push(
			serializePortableAssetFence({
				path,
				mimeType: asset.mimeType,
				base64: btoa(binary),
			}),
		)
		if (asset.mimeType.startsWith("font/"))
			fontFaces.push(
				`@font-face {\n  font-family: ${JSON.stringify(asset.name)};\n  src: url("asset:${path}");\n  font-display: swap;\n}`,
			)
	}
	if (fontFaces.length)
		sections.push("```css theme\n" + fontFaces.join("\n\n") + "\n```")
	let portable = withThemeSourceMetadata(sections.join("\n\n"), metadata)
	let validation = parseThemeSource(
		portable,
		validateSource ? { validateTemplate: () => null } : undefined,
	)
	if (validation.errors.length > 0)
		throw new Error(
			`Theme export is not portable: ${validation.errors[0]?.message}`,
		)
	validateSource?.(portable)
	return portable
}

async function loadEditableSource(
	theme: LoadedThemeForExport,
): Promise<string> {
	if (theme.sourceContent) return theme.sourceContent
	return serializeThemeSource({
		css: theme.css.toString(),
		documentTemplate: theme.template ?? undefined,
		slideTemplate: theme.slideTemplate ?? undefined,
	})
}

function stripThemeSourceId(source: string): string {
	return setFrontmatterField(source, "theme-source", null)
}

async function exportTheme(db: Database, theme: ThemeRow): Promise<void> {
	let assets = await db.all(app.themeAssets.where({ themeId: theme.id }))
	let source = theme.sourceDocId
		? await db.one(app.documents.where({ id: theme.sourceDocId }))
		: null
	let content = await serializePortableTheme({
		...theme,
		assets,
		sourceContent: source?.content,
	})
	let blob = new Blob([content], { type: "text/markdown" })
	let url = URL.createObjectURL(blob)
	let link = document.createElement("a")
	link.href = url
	link.download = `${sanitizeFilename(theme.name)}.theme.md`
	link.click()
	URL.revokeObjectURL(url)
}
