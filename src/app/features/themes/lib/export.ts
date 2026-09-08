import JSZip from "jszip"
import { type co, FileStream } from "jazz-tools"
import { z } from "zod"
import { Theme, ThemeAsset, ThemePreset, ThemeType } from "./schema"
import { sanitizeFilename } from "@/app/features/import-export/lib/export"
import { Document } from "@/app/features/documents/lib/schema"

export { exportTheme, type ThemeExportQuery }

// Query to load all theme data needed for export
type ThemeExportQuery = {
	css: true
	template: true
	slideTemplate: true
	thumbnail: { original: true }
	assets: { $each: { data: true } }
}

type LoadedThemeForExport = co.loaded<typeof Theme, ThemeExportQuery>
type LoadedAsset = co.loaded<typeof ThemeAsset, { data: true }>

interface ThemeManifest {
	version: 1
	name: string
	author?: string
	description?: string
	type: z.infer<typeof ThemeType>
	css: string
	template?: string
	slideTemplate?: string
	source?: string
	presets?: string
	fonts?: { name: string; path: string }[]
	thumbnail?: string
}

async function exportTheme(theme: LoadedThemeForExport): Promise<void> {
	let zip = new JSZip()

	// Build theme.json manifest
	let fonts: { name: string; path: string }[] = []
	let manifest: ThemeManifest = {
		version: 1,
		name: theme.name,
		type: theme.type,
		css: "styles.css",
	}

	if (theme.author) manifest.author = theme.author
	if (theme.description) manifest.description = theme.description

	// Add CSS file
	let cssContent = theme.css?.toString() ?? ""
	zip.file("styles.css", cssContent)

	// Add template if present
	if (theme.template) {
		let templateContent = theme.template.toString()
		if (templateContent) {
			zip.file("template.html", templateContent)
			manifest.template = "template.html"
		}
	}
	if (theme.slideTemplate) {
		let slideTemplateContent = theme.slideTemplate.toString()
		if (slideTemplateContent) {
			zip.file("slide.html", slideTemplateContent)
			manifest.slideTemplate = "slide.html"
		}
	}

	if (theme.sourceDocId) {
		let source = await Document.load(theme.sourceDocId, {
			resolve: { content: true },
		})
		if (source.$isLoaded && source.content?.$isLoaded) {
			zip.file("source.md", source.content.toString())
			manifest.source = "source.md"
		}
	}

	// Add presets if present
	if (theme.presets) {
		try {
			let presetsArray = JSON.parse(theme.presets) as z.infer<
				typeof ThemePreset
			>[]
			// Write presets in the standard format: { presets: [...] }
			zip.file(
				"presets.json",
				JSON.stringify({ presets: presetsArray }, null, 2),
			)
			manifest.presets = "presets.json"
		} catch {
			// Skip invalid presets
		}
	}

	// Add font assets
	if (theme.assets?.$isLoaded && theme.assets.length > 0) {
		let fontsFolder = zip.folder("fonts")!
		for (let asset of Array.from(theme.assets)) {
			if (!asset?.$isLoaded) continue
			let themeAsset = asset as LoadedAsset
			if (!themeAsset.data?.$isLoaded) continue

			let fontData = await readFileStreamAsArrayBuffer(themeAsset.data)
			if (fontData) {
				let extension = getExtensionFromMimeType(themeAsset.mimeType)
				let fileName = `${themeAsset.name}${extension}`
				fontsFolder.file(fileName, fontData)
				fonts.push({
					name: themeAsset.name,
					path: `fonts/${fileName}`,
				})
			}
		}
	}

	if (fonts.length > 0) {
		manifest.fonts = fonts
	}

	// Add thumbnail if present
	if (theme.thumbnail?.$isLoaded && theme.thumbnail.original?.$isLoaded) {
		let thumbnailBlob = theme.thumbnail.original.toBlob()
		if (thumbnailBlob) {
			let extension = getExtensionFromMimeType(thumbnailBlob.type)
			let fileName = `thumbnail${extension}`
			zip.file(fileName, thumbnailBlob)
			manifest.thumbnail = fileName
		}
	}

	// Add theme.json manifest
	zip.file("theme.json", JSON.stringify(manifest, null, 2))

	// Generate and download zip
	let blob = await zip.generateAsync({ type: "blob" })
	let url = URL.createObjectURL(blob)
	let a = document.createElement("a")
	a.href = url
	a.download = `${sanitizeFilename(theme.name)}.zip`
	a.click()
	URL.revokeObjectURL(url)
}

async function readFileStreamAsArrayBuffer(
	fileStream: FileStream,
): Promise<ArrayBuffer | null> {
	try {
		let blob = fileStream.toBlob()
		if (!blob) return null
		return await blob.arrayBuffer()
	} catch {
		return null
	}
}

function getExtensionFromMimeType(mimeType: string): string {
	let mimeToExt: Record<string, string> = {
		"font/woff2": ".woff2",
		"font/woff": ".woff",
		"font/ttf": ".ttf",
		"font/otf": ".otf",
		"image/png": ".png",
		"image/jpeg": ".jpg",
		"image/gif": ".gif",
		"image/webp": ".webp",
		"image/svg+xml": ".svg",
	}
	return mimeToExt[mimeType] || ""
}
