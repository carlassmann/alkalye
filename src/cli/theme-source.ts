import { z } from "zod"
import { JSDOM } from "jsdom"
import {
	sanitizeCss,
	sanitizeHtmlWithWindow,
} from "@/app/features/themes/lib/sanitize"
import {
	parsePortableAssetFence,
	resolvePortableAssetReferences,
	type PortableAsset,
} from "@/app/features/themes/lib/portable-assets"
export { compileThemeSource }
let ThemeType = z.enum(["preview", "slideshow", "both"])
let ThemePreset = z.object({
	name: z.string(),
	appearance: z.enum(["light", "dark"]),
	colors: z.object({
		background: z.string(),
		foreground: z.string(),
		accent: z.string(),
		accents: z.array(z.string()).optional(),
		heading: z.string().optional(),
		link: z.string().optional(),
		codeBackground: z.string().optional(),
	}),
	fonts: z
		.object({ title: z.string().optional(), body: z.string().optional() })
		.optional(),
})
let ThemeSourceMetadataSchema = z.object({
	name: z.string().trim().min(1).optional(),
	author: z.string().optional(),
	description: z.string().optional(),
	thumbnail: z
		.string()
		.refine(value => {
			let match = value.match(
				/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,(.*)$/,
			)
			return (
				!!match &&
				parsePortableAssetFence(`base64 asset thumbnail ${match[1]}`, match[2])
					.type === "asset"
			)
		}, "Thumbnail must be a valid base64 PNG, JPEG, WebP, GIF, or safe SVG up to 2 MB")
		.optional(),
	type: ThemeType.optional(),
	presets: z.array(ThemePreset).optional(),
})
type ThemeSourceMetadata = z.infer<typeof ThemeSourceMetadataSchema>

type ThemeSource = {
	metadata?: ThemeSourceMetadata
	css: string
	documentTemplate?: string
	slideTemplate?: string
	errors: ThemeSourceError[]
}

type ThemeSourceError = {
	line: number
	kind:
		| "css theme"
		| "html document"
		| "html slide"
		| "base64 asset"
		| "json theme metadata"
	message: string
}

type ThemeSourceOptions = {
	validateTemplate?: (html: string) => string | null
}

function compileThemeSource(source: string) {
	let parsed = parseThemeSource(source)
	if (parsed.errors.length)
		throw new Error(
			parsed.errors
				.map(error => `Line ${error.line}: ${error.message}`)
				.join("\n"),
		)
	if (!hasThemeDefinition(parsed))
		throw new Error("Theme source needs a CSS, HTML, or theme metadata fence")
	let window = new JSDOM("").window
	return {
		metadata: parsed.metadata,
		css: sanitizeCss(parsed.css).sanitized,
		template: parsed.documentTemplate
			? sanitizeHtmlWithWindow(window, parsed.documentTemplate).sanitized
			: undefined,
		slideTemplate: parsed.slideTemplate
			? sanitizeHtmlWithWindow(window, parsed.slideTemplate).sanitized
			: undefined,
	}
}
function parseThemeSource(
	content: string,
	options: ThemeSourceOptions = {},
): ThemeSource {
	let lines = content.split(/\r?\n/)
	let cssBlocks: string[] = []
	let documentTemplate: string | undefined
	let slideTemplate: string | undefined
	let errors: ThemeSourceError[] = []
	let assets = new Map<string, PortableAsset>()
	let assetBytes = 0
	let metadata: ThemeSourceMetadata | undefined
	let metadataSeen = false
	let templateFences: {
		kind: "html document" | "html slide"
		line: number
		value: string
	}[] = []

	for (let index = 0; index < lines.length; index++) {
		let tildeOpening = lines[index].match(/^\s{0,3}(~{3,})(.*)$/)
		if (tildeOpening) {
			let tildeCount = tildeOpening[1].length
			for (index = index + 1; index < lines.length; index++) {
				let tildeClosing = lines[index].match(/^\s{0,3}(~{3,})\s*$/)
				if (tildeClosing && tildeClosing[1].length >= tildeCount) break
			}
			continue
		}

		let opening = lines[index].match(/^\s{0,3}(`{3,})(.*)$/)
		if (!opening) continue

		let tickCount = opening[1].length
		let info = opening[2].trim()
		let kind = isThemeFence(info, tickCount) ? info : null
		let isMetadata = tickCount === 3 && info === "json theme metadata"
		let isPortableAsset = tickCount === 3 && info.startsWith("base64 asset")
		let startLine = index + 1
		let body: string[] = []
		let closed = false
		for (index = index + 1; index < lines.length; index++) {
			let closing = lines[index].match(/^\s{0,3}(`{3,})\s*$/)
			if (closing && closing[1].length >= tickCount) {
				closed = true
				break
			}
			body.push(lines[index])
		}

		if (!closed && (kind || isPortableAsset || isMetadata)) {
			errors.push({
				line: startLine,
				kind: kind ?? (isMetadata ? "json theme metadata" : "base64 asset"),
				message: `Unclosed ${kind ?? "base64 asset"} fence`,
			})
			break
		}

		if (isMetadata) {
			try {
				if (metadataSeen)
					throw new Error("Only one json theme metadata fence is allowed")
				metadataSeen = true
				metadata = ThemeSourceMetadataSchema.parse(JSON.parse(body.join("\n")))
				if (metadata.thumbnail) {
					assetBytes += atob(
						metadata.thumbnail.slice(metadata.thumbnail.indexOf(",") + 1),
					).length
					if (assetBytes > 5_000_000)
						throw new Error("Embedded assets exceed 5 MB")
				}
			} catch (error) {
				errors.push({
					line: startLine,
					kind: "json theme metadata",
					message:
						error instanceof Error ? error.message : "Invalid theme metadata",
				})
			}
			continue
		}

		let assetFence = parsePortableAssetFence(
			isPortableAsset ? info : "",
			body.join("\n"),
		)
		if (!kind && assetFence.type === "not-asset") continue
		if (assetFence.type === "error") {
			errors.push({
				line: startLine,
				kind: "base64 asset",
				message: assetFence.error.message,
			})
			continue
		}
		if (assetFence.type === "asset") {
			if (assets.has(assetFence.asset.path)) {
				errors.push({
					line: startLine,
					kind: "base64 asset",
					message: `Duplicate asset path: ${assetFence.asset.path}`,
				})
			} else if (assetBytes + assetFence.asset.byteLength > 5_000_000) {
				errors.push({
					line: startLine,
					kind: "base64 asset",
					message: "Embedded assets exceed 5 MB",
				})
			} else {
				assets.set(assetFence.asset.path, assetFence.asset)
				assetBytes += assetFence.asset.byteLength
			}
			continue
		}

		if (!kind) continue
		if (!closed) {
			errors.push({ line: startLine, kind, message: `Unclosed ${kind} fence` })
			break
		}

		let value = body.join("\n").trim()
		if (kind === "css theme") {
			cssBlocks.push(value)
			continue
		}

		templateFences.push({ kind, line: startLine, value })

		if (kind === "html document") {
			if (documentTemplate !== undefined) {
				errors.push({
					line: startLine,
					kind,
					message: "Only one html document fence is allowed",
				})
			} else {
				documentTemplate = value
			}
		} else if (slideTemplate !== undefined) {
			errors.push({
				line: startLine,
				kind,
				message: "Only one html slide fence is allowed",
			})
		} else {
			slideTemplate = value
		}
	}

	let resolvedCss = resolvePortableAssetReferences(
		cssBlocks.join("\n\n"),
		assets,
	)
	let resolvedDocument = documentTemplate
		? resolvePortableAssetReferences(documentTemplate, assets)
		: undefined
	let resolvedSlide = slideTemplate
		? resolvePortableAssetReferences(slideTemplate, assets)
		: undefined
	for (let template of templateFences) {
		let resolved = resolvePortableAssetReferences(template.value, assets)
		let templateError = (options.validateTemplate ?? getTemplateError)(
			resolved.value,
		)
		if (templateError) {
			errors.push({
				line: template.line,
				kind: template.kind,
				message: templateError,
			})
		}
	}
	for (let path of new Set([
		...resolvedCss.missingPaths,
		...(resolvedDocument?.missingPaths ?? []),
		...(resolvedSlide?.missingPaths ?? []),
	])) {
		errors.push({
			line: 1,
			kind: "base64 asset",
			message: `Unresolved asset reference: ${path}`,
		})
	}

	return {
		...(metadata ? { metadata } : {}),
		css: resolvedCss.value,
		documentTemplate: resolvedDocument?.value,
		slideTemplate: resolvedSlide?.value,
		errors,
	}
}

function hasThemeDefinition(source: ThemeSource): boolean {
	return !!(
		source.css.trim() ||
		source.documentTemplate ||
		source.slideTemplate ||
		source.metadata
	)
}

function isThemeFence(
	info: string,
	tickCount: number,
): info is "css theme" | "html document" | "html slide" {
	return (
		tickCount === 3 &&
		(info === "css theme" || info === "html document" || info === "html slide")
	)
}

function getTemplateError(html: string): string | null {
	let window = new JSDOM("").window
	return validateThemeTemplate(html, {
		parseDocument: value =>
			new window.DOMParser().parseFromString(value, "text/html"),
		sanitize: value => sanitizeHtmlWithWindow(window, value).sanitized,
	})
}

function validateThemeTemplate(
	html: string,
	runtime: {
		parseDocument: (html: string) => ReturnType<DOMParser["parseFromString"]>
		sanitize: (html: string) => string
	},
): string | null {
	let document = runtime.parseDocument(html)
	if (document.querySelector("style")) {
		return "HTML templates cannot contain style blocks; put CSS in a css theme fence"
	}
	let sanitizedDocument = runtime.parseDocument(runtime.sanitize(html))
	let slots = sanitizedDocument.querySelectorAll(
		"[data-content], [data-document]",
	)
	if (slots.length === 0) return "HTML templates need a data-content slot"
	if (slots.length > 1)
		return "HTML templates need exactly one data-content slot"
	return null
}
