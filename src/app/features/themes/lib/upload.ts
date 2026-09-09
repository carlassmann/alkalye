import JSZip from "jszip"
import { z } from "zod"
import { ThemeType, ThemePreset } from "./schema"
import { sanitizeCss, sanitizeHtml } from "./sanitize"
import { parseThemeSource } from "./source"

export {
	parseThemeMarkdown,
	parseThemeZip,
	validateThemeJson,
	ThemeJsonSchema,
	type ParsedTheme,
	type ParsedThemeAsset,
	type ThemeUploadError,
}

let ThemeJsonSchema = z.object({
	version: z.literal(1),
	name: z.string().min(1, "Theme name is required"),
	author: z.string().optional(),
	description: z.string().optional(),
	type: ThemeType,
	css: z.string().min(1, "CSS file path is required"),
	template: z.string().optional(),
	slideTemplate: z.string().optional(),
	source: z.string().optional(),
	presets: z.string().optional(),
	fonts: z
		.array(
			z.object({
				name: z.string(),
				path: z.string(),
			}),
		)
		.optional(),
	thumbnail: z.string().optional(),
})

type ThemeJson = z.infer<typeof ThemeJsonSchema>

interface ParsedTheme {
	name: string
	author?: string
	description?: string
	type: z.infer<typeof ThemeType>
	css: string
	template?: string
	slideTemplate?: string
	presets?: z.infer<typeof ThemePreset>[]
	assets: ParsedThemeAsset[]
	thumbnail?: File
	source?: string
}

interface ParsedThemeAsset {
	name: string
	mimeType: string
	file: File
}

type ThemeUploadError =
	| { type: "invalid_markdown"; message: string; errors: string[] }
	| { type: "invalid_zip"; message: string }
	| { type: "missing_manifest"; message: string }
	| { type: "invalid_manifest"; message: string; errors: string[] }
	| { type: "missing_css"; message: string }
	| { type: "invalid_presets"; message: string; errors: string[] }
	| { type: "missing_file"; message: string; path: string }

type ParseResult =
	| { ok: true; theme: ParsedTheme }
	| { ok: false; error: ThemeUploadError }

async function parseThemeMarkdown(file: File): Promise<ParseResult> {
	let content = await readFileText(file)
	let source = parseThemeSource(content)
	if (source.errors.length > 0 || !source.css.trim())
		return {
			ok: false,
			error: {
				type: "invalid_markdown",
				message: "Theme source is invalid.",
				errors: source.errors.map(error => error.message),
			},
		}
	let thumbnail = source.metadata?.thumbnail
		? dataUrlToFile(source.metadata.thumbnail, "thumbnail")
		: undefined
	if (source.metadata?.thumbnail && !thumbnail)
		return {
			ok: false,
			error: {
				type: "invalid_markdown",
				message: "Theme thumbnail is invalid.",
				errors: [
					"Thumbnail must be a base64 PNG, JPEG, WebP, GIF, or safe SVG",
				],
			},
		}
	return {
		ok: true,
		theme: {
			name: source.metadata?.name ?? getMarkdownName(content, file.name),
			author: source.metadata?.author,
			description: source.metadata?.description,
			type: source.metadata?.type ?? "both",
			css: sanitizeCss(source.css).sanitized,
			template: source.documentTemplate
				? sanitizeHtml(source.documentTemplate).sanitized
				: undefined,
			slideTemplate: source.slideTemplate
				? sanitizeHtml(source.slideTemplate).sanitized
				: undefined,
			presets: source.metadata?.presets,
			assets: [],
			thumbnail,
			source: content,
		},
	}
}

function dataUrlToFile(dataUrl: string, name: string): File | undefined {
	let match = dataUrl.match(
		/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=]+)$/,
	)
	if (!match) return undefined
	try {
		let binary = atob(match[2])
		if (binary.length > 2_000_000) return undefined
		let bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
		return new File([bytes], name, { type: match[1] })
	} catch {
		return undefined
	}
}

async function readFileText(file: File): Promise<string> {
	return await new Promise((resolve, reject) => {
		let reader = new FileReader()
		reader.onload = () => resolve(String(reader.result))
		reader.onerror = () => reject(reader.error)
		reader.readAsText(file)
	})
}

function getMarkdownName(content: string, filename: string): string {
	let heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
	return (
		heading || filename.replace(/\.theme\.md$|\.md$/i, "") || "Imported theme"
	)
}

async function parseThemeZip(file: File): Promise<ParseResult> {
	let zip: JSZip
	try {
		zip = await JSZip.loadAsync(file)
	} catch {
		return {
			ok: false,
			error: {
				type: "invalid_zip",
				message: "Failed to read zip file. Make sure it's a valid zip archive.",
			},
		}
	}

	let plistPath = findIAWriterPlist(zip)
	if (plistPath) {
		return parseIAWriterTemplate(zip, plistPath)
	}

	let templateJsonPath = findIAPresenterTemplate(zip)
	if (templateJsonPath) {
		return parseIAPresenterTheme(zip, templateJsonPath)
	}

	let themeJsonPath = findFile(zip, "theme.json")
	if (!themeJsonPath) {
		return {
			ok: false,
			error: {
				type: "missing_manifest",
				message:
					"theme.json not found. A valid theme must include a theme.json manifest.",
			},
		}
	}

	let basePath = themeJsonPath.includes("/")
		? themeJsonPath.substring(0, themeJsonPath.lastIndexOf("/") + 1)
		: ""

	let themeJsonContent: string
	try {
		themeJsonContent = await zip.file(themeJsonPath)!.async("string")
	} catch {
		return {
			ok: false,
			error: {
				type: "invalid_manifest",
				message: "Failed to read theme.json",
				errors: ["Could not read file contents"],
			},
		}
	}

	let themeJsonResult = validateThemeJson(themeJsonContent)
	if (!themeJsonResult.ok) {
		return {
			ok: false,
			error: themeJsonResult.error,
		}
	}

	let themeJson = themeJsonResult.data

	let cssPath = basePath + themeJson.css
	let cssFile = zip.file(cssPath)
	if (!cssFile) {
		return {
			ok: false,
			error: {
				type: "missing_css",
				message: `CSS file not found: ${themeJson.css}`,
			},
		}
	}

	let css: string
	try {
		let rawCss = await cssFile.async("string")
		let cssResult = sanitizeCss(rawCss)
		css = cssResult.sanitized
	} catch {
		return {
			ok: false,
			error: {
				type: "missing_file",
				message: `Failed to read CSS file: ${themeJson.css}`,
				path: themeJson.css,
			},
		}
	}

	let template: string | undefined
	if (themeJson.template) {
		let templatePath = basePath + themeJson.template
		let templateFile = zip.file(templatePath)
		if (templateFile) {
			try {
				let rawTemplate = await templateFile.async("string")
				let templateResult = sanitizeHtml(rawTemplate)
				template = templateResult.sanitized
			} catch {
				// Template is optional, continue without it
			}
		}
	}

	let slideTemplate: string | undefined
	if (themeJson.slideTemplate) {
		let slideTemplateFile = zip.file(basePath + themeJson.slideTemplate)
		if (slideTemplateFile) {
			try {
				let rawSlideTemplate = await slideTemplateFile.async("string")
				slideTemplate = sanitizeHtml(rawSlideTemplate).sanitized
			} catch {
				// Optional slideshow template
			}
		}
	}

	if (themeJson.source) {
		let sourceFile = zip.file(basePath + themeJson.source)
		if (sourceFile) {
			try {
				let source = parseThemeSource(await sourceFile.async("string"))
				if (source.errors.length === 0) {
					css = sanitizeCss(source.css).sanitized
					template = source.documentTemplate
						? sanitizeHtml(source.documentTemplate).sanitized
						: undefined
					slideTemplate = source.slideTemplate
						? sanitizeHtml(source.slideTemplate).sanitized
						: undefined
				}
			} catch {
				// Keep the compiled files when source.md is unavailable or invalid
			}
		}
	}

	let presets: z.infer<typeof ThemePreset>[] | undefined
	if (themeJson.presets) {
		let presetsPath = basePath + themeJson.presets
		let presetsFile = zip.file(presetsPath)
		if (presetsFile) {
			try {
				let presetsContent = await presetsFile.async("string")
				let presetsJson = JSON.parse(presetsContent)

				let presetsArray = Array.isArray(presetsJson)
					? presetsJson
					: presetsJson.presets

				if (!Array.isArray(presetsArray)) {
					return {
						ok: false,
						error: {
							type: "invalid_presets",
							message: "presets.json must contain an array of presets",
							errors: ["Expected an array of presets"],
						},
					}
				}

				let validatedPresets: z.infer<typeof ThemePreset>[] = []
				let presetErrors: string[] = []

				for (let i = 0; i < presetsArray.length; i++) {
					let result = ThemePreset.safeParse(presetsArray[i])
					if (result.success) {
						validatedPresets.push(result.data)
					} else {
						for (let issue of result.error.issues) {
							presetErrors.push(
								`Preset ${i + 1}: ${issue.path.join(".")} - ${issue.message}`,
							)
						}
					}
				}

				if (presetErrors.length > 0) {
					return {
						ok: false,
						error: {
							type: "invalid_presets",
							message: "Invalid preset definitions in presets.json",
							errors: presetErrors,
						},
					}
				}

				presets = validatedPresets
			} catch (e) {
				return {
					ok: false,
					error: {
						type: "invalid_presets",
						message: "Failed to parse presets.json",
						errors: [e instanceof Error ? e.message : "Invalid JSON"],
					},
				}
			}
		}
	}

	let assets: ParsedThemeAsset[] = []
	if (themeJson.fonts) {
		for (let font of themeJson.fonts) {
			let fontPath = basePath + font.path
			let fontFile = zip.file(fontPath)
			if (fontFile) {
				try {
					let blob = await fontFile.async("blob")
					let mimeType = getFontMimeType(font.path)
					let file = new File([blob], font.name, { type: mimeType })
					assets.push({
						name: font.name,
						mimeType,
						file,
					})
				} catch {
					// skip
				}
			}
		}
	}

	let thumbnail: File | undefined
	if (themeJson.thumbnail) {
		let thumbnailPath = basePath + themeJson.thumbnail
		let thumbnailFile = zip.file(thumbnailPath)
		if (thumbnailFile) {
			try {
				let blob = await thumbnailFile.async("blob")
				let mimeType = getImageMimeType(themeJson.thumbnail)
				thumbnail = new File([blob], "thumbnail", { type: mimeType })
			} catch {
				// skip
			}
		}
	}

	return {
		ok: true,
		theme: {
			name: themeJson.name,
			author: themeJson.author,
			description: themeJson.description,
			type: themeJson.type,
			css,
			template,
			slideTemplate,
			presets,
			assets,
			thumbnail,
		},
	}
}

function validateThemeJson(
	content: string,
): { ok: true; data: ThemeJson } | { ok: false; error: ThemeUploadError } {
	let json: unknown
	try {
		json = JSON.parse(content)
	} catch {
		return {
			ok: false,
			error: {
				type: "invalid_manifest",
				message: "theme.json is not valid JSON",
				errors: ["Failed to parse JSON"],
			},
		}
	}

	let result = ThemeJsonSchema.safeParse(json)
	if (!result.success) {
		let errors = result.error.issues.map(
			issue => `${issue.path.join(".")}: ${issue.message}`,
		)
		return {
			ok: false,
			error: {
				type: "invalid_manifest",
				message: "theme.json validation failed",
				errors,
			},
		}
	}

	return { ok: true, data: result.data }
}

function findFile(zip: JSZip, filename: string): string | null {
	// Check root level first
	if (zip.file(filename)) {
		return filename
	}

	// Check one level deep (common for zips with a top-level folder)
	let found: string | null = null
	zip.forEach((path, entry) => {
		if (entry.dir) return
		if (path.endsWith("/" + filename) && path.split("/").length === 2) {
			found = path
		}
	})

	return found
}

function getFontMimeType(path: string): string {
	let ext = path.toLowerCase().split(".").pop()
	let mimeTypes: Record<string, string> = {
		woff2: "font/woff2",
		woff: "font/woff",
		ttf: "font/ttf",
		otf: "font/otf",
	}
	return mimeTypes[ext || ""] || "font/woff2"
}

function getImageMimeType(path: string): string {
	let ext = path.toLowerCase().split(".").pop()
	let mimeTypes: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		webp: "image/webp",
		svg: "image/svg+xml",
	}
	return mimeTypes[ext || ""] || "image/png"
}

interface IAWriterPlist {
	CFBundleName?: string
	IATemplateDocumentFile?: string
	IATemplateDescription?: string
	IATemplateAuthor?: string
}

function findIAWriterPlist(zip: JSZip): string | null {
	let found: string | null = null
	zip.forEach((path, entry) => {
		if (entry.dir) return
		if (
			path.endsWith("/Contents/Info.plist") ||
			path === "Contents/Info.plist"
		) {
			found = path
		}
	})
	return found
}

function parsePlist(content: string): IAWriterPlist {
	let result: IAWriterPlist = {}

	let keyRegex = /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g
	let match: RegExpExecArray | null

	while ((match = keyRegex.exec(content)) !== null) {
		let key = match[1]
		let value = match[2]

		if (key === "CFBundleName") {
			result.CFBundleName = value
		} else if (key === "IATemplateDocumentFile") {
			result.IATemplateDocumentFile = value
		} else if (key === "IATemplateDescription") {
			result.IATemplateDescription = value
		} else if (key === "IATemplateAuthor") {
			result.IATemplateAuthor = value
		}
	}

	return result
}

function extractCssPathsFromHtml(html: string): string[] {
	// Extract CSS file paths from <link rel="stylesheet" href="...">
	let paths: string[] = []
	let linkRegex = /<link[^>]+href=["']([^"']+)["'][^>]*>/gi
	let match: RegExpExecArray | null

	while ((match = linkRegex.exec(html)) !== null) {
		let href = match[1]
		if (
			!href.startsWith("http://") &&
			!href.startsWith("https://") &&
			!href.startsWith("//")
		) {
			paths.push(href)
		}
	}

	return paths
}

function extractImportsFromCss(
	css: string,
	basePath: string,
	zip: JSZip,
): string[] {
	let paths: string[] = []
	let importRegex = /@import\s+['"]([^'"]+)['"]/g
	let match: RegExpExecArray | null

	while ((match = importRegex.exec(css)) !== null) {
		let importPath = match[1]
		if (
			!importPath.startsWith("http://") &&
			!importPath.startsWith("https://") &&
			!importPath.startsWith("//")
		) {
			let fullPath = basePath + importPath
			if (zip.file(fullPath)) {
				paths.push(importPath)
			}
		}
	}

	return paths
}

async function parseIAWriterTemplate(
	zip: JSZip,
	plistPath: string,
): Promise<ParseResult> {
	let contentsPath = plistPath.substring(0, plistPath.lastIndexOf("/") + 1)
	let resourcesPath = contentsPath + "Resources/"

	let plistContent: string
	try {
		plistContent = await zip.file(plistPath)!.async("string")
	} catch {
		return {
			ok: false,
			error: {
				type: "invalid_manifest",
				message: "Failed to read Info.plist",
				errors: ["Could not read file contents"],
			},
		}
	}

	let plist = parsePlist(plistContent)

	if (!plist.CFBundleName) {
		return {
			ok: false,
			error: {
				type: "invalid_manifest",
				message:
					"Invalid iA Writer template: missing CFBundleName in Info.plist",
				errors: ["CFBundleName is required"],
			},
		}
	}

	if (!plist.IATemplateDocumentFile) {
		return {
			ok: false,
			error: {
				type: "invalid_manifest",
				message:
					"Invalid iA Writer template: missing IATemplateDocumentFile in Info.plist",
				errors: ["IATemplateDocumentFile is required"],
			},
		}
	}

	let templateFileName = plist.IATemplateDocumentFile + ".html"
	let templatePath = resourcesPath + templateFileName
	let templateFile = zip.file(templatePath)

	if (!templateFile) {
		return {
			ok: false,
			error: {
				type: "missing_file",
				message: `Template file not found: ${templateFileName}`,
				path: templatePath,
			},
		}
	}

	let rawTemplate: string
	try {
		rawTemplate = await templateFile.async("string")
	} catch {
		return {
			ok: false,
			error: {
				type: "missing_file",
				message: `Failed to read template file: ${templateFileName}`,
				path: templatePath,
			},
		}
	}

	let cssFilePaths = extractCssPathsFromHtml(rawTemplate)

	let cssContents: string[] = []
	let processedCssFiles = new Set<string>()

	async function processCssFile(cssFileName: string): Promise<void> {
		if (processedCssFiles.has(cssFileName)) return
		processedCssFiles.add(cssFileName)

		let cssPath = resourcesPath + cssFileName
		let cssFile = zip.file(cssPath)
		if (!cssFile) return

		try {
			let cssContent = await cssFile.async("string")

			let imports = extractImportsFromCss(cssContent, resourcesPath, zip)
			for (let importPath of imports) {
				await processCssFile(importPath)
			}

			let cleanedCss = cssContent.replace(
				/@import\s+['"][^'"]+['"]\s*[^;]*;?/g,
				"",
			)
			if (cleanedCss.trim()) {
				cssContents.push(`/* Source: ${cssFileName} */\n${cleanedCss}`)
			}
		} catch {
			// skip
		}
	}

	for (let cssFilePath of cssFilePaths) {
		await processCssFile(cssFilePath)
	}

	if (!processedCssFiles.has("style.css")) {
		await processCssFile("style.css")
	}

	let combinedCss = cssContents.join("\n\n")

	if (!combinedCss.trim()) {
		return {
			ok: false,
			error: {
				type: "missing_css",
				message: "No CSS files found in iA Writer template",
			},
		}
	}

	let sanitizedCss = sanitizeCss(combinedCss).sanitized
	let sanitizedTemplate = sanitizeHtml(rawTemplate).sanitized

	let assets: ParsedThemeAsset[] = []
	let fontExtensions = [".woff2", ".woff", ".ttf", ".otf"]

	for (let [path, entry] of Object.entries(zip.files)) {
		if (entry.dir) continue
		if (!path.startsWith(resourcesPath)) continue

		let ext = path.toLowerCase().substring(path.lastIndexOf("."))
		if (fontExtensions.includes(ext)) {
			try {
				let blob = await entry.async("blob")
				let fileName = path.substring(path.lastIndexOf("/") + 1)
				let mimeType = getFontMimeType(fileName)
				let file = new File([blob], fileName, { type: mimeType })
				assets.push({
					name: fileName,
					mimeType,
					file,
				})
			} catch {
				// skip
			}
		}
	}

	return {
		ok: true,
		theme: {
			name: plist.CFBundleName,
			author: plist.IATemplateAuthor,
			description: plist.IATemplateDescription,
			type: "preview",
			css: sanitizedCss,
			template: sanitizedTemplate,
			presets: undefined,
			assets,
			thumbnail: undefined,
		},
	}
}

let IAPresenterTemplateSchema = z.object({
	name: z.string(),
	author: z.string().optional(),
	description: z.string().optional(),
	css: z.string().optional(),
	presets: z.string().optional(),
})

type IAPresenterTemplate = z.infer<typeof IAPresenterTemplateSchema>

function findIAPresenterTemplate(zip: JSZip): string | null {
	let hasThemeJson = false
	let templateJsonPath: string | null = null

	zip.forEach((path, entry) => {
		if (entry.dir) return
		let filename = path.split("/").pop()
		if (filename === "theme.json") {
			hasThemeJson = true
		}
		if (filename === "template.json" && !templateJsonPath) {
			templateJsonPath = path
		}
	})

	if (hasThemeJson) return null
	return templateJsonPath
}

async function parseIAPresenterTheme(
	zip: JSZip,
	templateJsonPath: string,
): Promise<ParseResult> {
	let basePath = templateJsonPath.includes("/")
		? templateJsonPath.substring(0, templateJsonPath.lastIndexOf("/") + 1)
		: ""

	let templateJsonContent: string
	try {
		templateJsonContent = await zip.file(templateJsonPath)!.async("string")
	} catch {
		return {
			ok: false,
			error: {
				type: "invalid_manifest",
				message: "Failed to read template.json",
				errors: ["Could not read file contents"],
			},
		}
	}

	let templateJson: IAPresenterTemplate
	try {
		let parsed = JSON.parse(templateJsonContent)
		let result = IAPresenterTemplateSchema.safeParse(parsed)
		if (!result.success) {
			return {
				ok: false,
				error: {
					type: "invalid_manifest",
					message: "Invalid template.json format",
					errors: result.error.issues.map(
						issue => `${issue.path.join(".")}: ${issue.message}`,
					),
				},
			}
		}
		templateJson = result.data
	} catch (e) {
		return {
			ok: false,
			error: {
				type: "invalid_manifest",
				message: "template.json is not valid JSON",
				errors: [e instanceof Error ? e.message : "Invalid JSON"],
			},
		}
	}

	let cssContent: string | undefined
	let cssFilesToTry = [
		templateJson.css,
		"styles.css",
		"theme.css",
		"style.css",
	].filter(Boolean) as string[]

	for (let cssFileName of cssFilesToTry) {
		let cssPath = basePath + cssFileName
		let cssFile = zip.file(cssPath)
		if (cssFile) {
			try {
				let rawCss = await cssFile.async("string")
				cssContent = sanitizeCss(rawCss).sanitized
				break
			} catch {
				// skip
			}
		}
	}

	if (!cssContent) {
		return {
			ok: false,
			error: {
				type: "missing_css",
				message: "No CSS file found in iA Presenter theme",
			},
		}
	}

	let presets: z.infer<typeof ThemePreset>[] | undefined
	let presetsFileName = templateJson.presets || "presets.json"
	let presetsPath = basePath + presetsFileName
	let presetsFile = zip.file(presetsPath)

	if (presetsFile) {
		try {
			let presetsContent = await presetsFile.async("string")
			let presetsJson = JSON.parse(presetsContent)

			let presetsArray = Array.isArray(presetsJson)
				? presetsJson
				: presetsJson.presets || presetsJson.colors || presetsJson.themes

			if (Array.isArray(presetsArray)) {
				let validatedPresets: z.infer<typeof ThemePreset>[] = []

				for (let preset of presetsArray) {
					let converted = convertIAPresenterPreset(preset)
					if (converted) {
						validatedPresets.push(converted)
					}
				}

				if (validatedPresets.length > 0) {
					presets = validatedPresets
				}
			}
		} catch {
			// skip
		}
	}

	let assets: ParsedThemeAsset[] = []
	let fontExtensions = [".woff2", ".woff", ".ttf", ".otf"]

	for (let [path, entry] of Object.entries(zip.files)) {
		if (entry.dir) continue
		if (!path.startsWith(basePath)) continue

		let ext = path.toLowerCase().substring(path.lastIndexOf("."))
		if (fontExtensions.includes(ext)) {
			try {
				let blob = await entry.async("blob")
				let fileName = path.substring(path.lastIndexOf("/") + 1)
				let mimeType = getFontMimeType(fileName)
				let file = new File([blob], fileName, { type: mimeType })
				assets.push({
					name: fileName,
					mimeType,
					file,
				})
			} catch {
				// skip
			}
		}
	}

	let thumbnail: File | undefined
	let thumbnailNames = [
		"thumbnail.png",
		"thumbnail.jpg",
		"preview.png",
		"preview.jpg",
	]
	for (let thumbName of thumbnailNames) {
		let thumbPath = basePath + thumbName
		let thumbFile = zip.file(thumbPath)
		if (thumbFile) {
			try {
				let blob = await thumbFile.async("blob")
				let mimeType = getImageMimeType(thumbName)
				thumbnail = new File([blob], "thumbnail", { type: mimeType })
				break
			} catch {
				// skip
			}
		}
	}

	return {
		ok: true,
		theme: {
			name: templateJson.name,
			author: templateJson.author,
			description: templateJson.description,
			type: "slideshow",
			css: cssContent,
			template: undefined,
			presets,
			assets,
			thumbnail,
		},
	}
}

function convertIAPresenterPreset(
	preset: Record<string, unknown>,
): z.infer<typeof ThemePreset> | null {
	let name = preset.name as string | undefined
	if (!name || typeof name !== "string") {
		name = (preset.title as string) || (preset.label as string) || "Unnamed"
	}

	let appearance: "light" | "dark" = "light"
	if (preset.appearance === "dark" || preset.mode === "dark") {
		appearance = "dark"
	} else if (preset.appearance === "light" || preset.mode === "light") {
		appearance = "light"
	} else {
		let bg = extractColor(preset, ["background", "backgroundColor", "bg"])
		if (bg && isColorDark(bg)) {
			appearance = "dark"
		}
	}

	let background = extractColor(preset, ["background", "backgroundColor", "bg"])
	let foreground = extractColor(preset, [
		"foreground",
		"color",
		"text",
		"textColor",
		"fg",
	])
	let accent = extractColor(preset, [
		"accent",
		"accentColor",
		"primary",
		"highlight",
	])

	let colors = preset.colors as Record<string, unknown> | undefined
	if (colors && typeof colors === "object") {
		background = background || extractColor(colors, ["background", "bg"])
		foreground =
			foreground || extractColor(colors, ["foreground", "text", "fg"])
		accent = accent || extractColor(colors, ["accent", "primary"])
	}

	if (!background || !foreground) {
		return null
	}

	accent = accent || foreground

	let heading = extractColor(preset, ["heading", "headingColor", "h1"])
	let link = extractColor(preset, ["link", "linkColor", "a"])
	let codeBackground = extractColor(preset, [
		"codeBackground",
		"code",
		"codeBlock",
		"codeBg",
	])

	let accents: string[] = []
	let accentFields = ["accent2", "accent3", "accent4", "accent5", "accent6"]
	for (let field of accentFields) {
		let color = extractColor(preset, [field])
		if (color) {
			accents.push(color)
		}
	}

	let fonts: { title?: string; body?: string } | undefined
	let titleFont = preset.titleFont || preset.headingFont || preset.title_font
	let bodyFont = preset.bodyFont || preset.textFont || preset.body_font

	if (titleFont || bodyFont) {
		fonts = {}
		if (typeof titleFont === "string") fonts.title = titleFont
		if (typeof bodyFont === "string") fonts.body = bodyFont
	}

	return {
		name,
		appearance,
		colors: {
			background,
			foreground,
			accent,
			accents: accents.length > 0 ? accents : undefined,
			heading,
			link,
			codeBackground,
		},
		fonts,
	}
}

function extractColor(
	obj: Record<string, unknown>,
	keys: string[],
): string | undefined {
	for (let key of keys) {
		let value = obj[key]
		if (typeof value === "string" && value.trim()) {
			return value.trim()
		}
	}
	return undefined
}

function isColorDark(color: string): boolean {
	let hex = color.toLowerCase().replace("#", "")

	if (hex.length === 3) {
		hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
	}

	if (hex.length !== 6 || !/^[0-9a-f]+$/.test(hex)) {
		return false
	}

	let r = parseInt(hex.substring(0, 2), 16)
	let g = parseInt(hex.substring(2, 4), 16)
	let b = parseInt(hex.substring(4, 6), 16)

	let luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

	return luminance < 0.5
}
