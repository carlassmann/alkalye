import { type co, FileStream, z } from "jazz-tools"
import { Theme, ThemePreset } from "./schema"
import { sanitizeFilename } from "@/app/features/import-export/lib/export"
import { Document } from "@/app/features/documents/lib/schema"
import {
	serializeThemeSource,
	parseThemeSource,
	withThemeSourceMetadata,
	type ThemeSourceMetadata,
} from "./source"
import { serializePortableAssetFence } from "./portable-assets"

export { exportTheme, serializePortableTheme, type ThemeExportQuery }

type ThemeExportQuery = {
	css: true
	template: true
	slideTemplate: true
	thumbnail: { original: true }
	assets: { $each: { data: true } }
}

type LoadedThemeForExport = co.loaded<typeof Theme, ThemeExportQuery>

async function serializePortableTheme(
	theme: LoadedThemeForExport,
	sourceOverride?: string,
	validateSource?: (source: string) => unknown,
): Promise<string> {
	let source = sourceOverride ?? (await loadEditableSource(theme))
	let metadata: ThemeSourceMetadata = {
		name: theme.name,
		type: theme.type,
		author: theme.author,
		description: theme.description,
	}
	let sourceMetadata = parseThemeSource(source, {
		validateTemplate: () => null,
	}).metadata
	if (sourceMetadata) {
		if (sourceMetadata.thumbnail) metadata.thumbnail = sourceMetadata.thumbnail
	} else if (theme.thumbnailDataUrl) {
		metadata.thumbnail = theme.thumbnailDataUrl
	} else if (
		theme.thumbnail?.$isLoaded &&
		theme.thumbnail.original?.$isLoaded
	) {
		let thumbnail = theme.thumbnail.original.toBlob()
		if (!thumbnail) throw new Error("Unable to read theme thumbnail")
		metadata.thumbnail = fileStreamToDataUrl(
			theme.thumbnail.original,
			thumbnail.type || "image/png",
		)
	}
	if (theme.presets) {
		let presets = z
			.union([
				z.array(ThemePreset),
				z.object({ presets: z.array(ThemePreset) }),
			])
			.parse(JSON.parse(theme.presets))
		metadata.presets = Array.isArray(presets) ? presets : presets.presets
	}
	let sections = [stripThemeSourceId(source).trimEnd()]
	let fontFaces: string[] = []
	if (theme.assets && !theme.assets.$isLoaded)
		throw new Error("Theme assets are not loaded")
	for (let asset of theme.assets ?? []) {
		if (!asset?.$isLoaded || !asset.data?.$isLoaded)
			throw new Error("Theme asset is unavailable")
		let data = asset.data.getChunks()
		if (!data?.finished)
			throw new Error(`Unable to read theme asset: ${asset.name}`)
		let path = `legacy/${asset.$jazz.id}`
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

function fileStreamToDataUrl(fileStream: FileStream, mimeType: string): string {
	let data = fileStream.getChunks()
	if (!data?.finished) throw new Error("Unable to read theme thumbnail")
	if (
		!(
			"image/png" === mimeType ||
			"image/jpeg" === mimeType ||
			"image/webp" === mimeType ||
			"image/gif" === mimeType ||
			"image/svg+xml" === mimeType
		)
	)
		throw new Error(`Unsupported theme thumbnail MIME type: ${mimeType}`)
	let byteLength = data.chunks.reduce((total, bytes) => total + bytes.length, 0)
	if (byteLength > 2_000_000) throw new Error("Theme thumbnail exceeds 2 MB")
	let binary = ""
	for (let bytes of data.chunks)
		for (let index = 0; index < bytes.length; index += 0x8000)
			binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
	return `data:${mimeType};base64,${btoa(binary)}`
}

async function loadEditableSource(
	theme: LoadedThemeForExport,
): Promise<string> {
	if (theme.sourceDocId) {
		let source = await Document.load(theme.sourceDocId, {
			resolve: { content: true },
			loadAs: theme.$jazz.loadedAs,
		})
		if (!source.$isLoaded || !source.content?.$isLoaded)
			throw new Error("Theme source is unavailable")
		return source.content.toString()
	}
	return serializeThemeSource({
		css: theme.css.toString(),
		documentTemplate: theme.template?.toString(),
		slideTemplate: theme.slideTemplate?.toString(),
	})
}

function stripThemeSourceId(source: string): string {
	return source.replace(
		/^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?)/,
		(block: string) => {
			let withoutId = block.replace(/^theme-source\s*:.*\r?\n/gm, "")
			return /^---\r?\n\s*---(?:\r?\n)?$/.test(withoutId) ? "" : withoutId
		},
	)
}

async function exportTheme(theme: LoadedThemeForExport): Promise<void> {
	let content = await serializePortableTheme(theme)
	let blob = new Blob([content], { type: "text/markdown" })
	let url = URL.createObjectURL(blob)
	let link = document.createElement("a")
	link.href = url
	link.download = `${sanitizeFilename(theme.name)}.theme.md`
	link.click()
	URL.revokeObjectURL(url)
}
