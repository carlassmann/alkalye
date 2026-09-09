import { z } from "jazz-tools"
import { ThemeType, ThemePreset } from "./schema"
import { Group, co } from "jazz-tools"
import { Document, CommentThread } from "@/app/features/documents/lib/schema"
import { createDocumentMetadata } from "@/app/features/documents/lib/metadata"
import { parseFrontmatter } from "@/app/features/editor/lib/frontmatter"
import { sanitizeCss, sanitizeHtml } from "./sanitize"
import {
	parsePortableAssetFence,
	resolvePortableAssetReferences,
	serializePortableAssetFence,
	type PortableAsset,
} from "./portable-assets"
import { UserAccount } from "@/schema"

export {
	withThemeSourceMetadata,
	ThemeSourceMetadataSchema,
	type ThemeSourceMetadata,
	bindThemeSource,
	parseThemeSource,
	validateThemeTemplate,
	serializeThemeSource,
	createThemeSourceDocument,
	createThemeSourceDocumentContent,
	syncThemeFromSource,
	getThemeSourceId,
	serializePortableAssetFence,
	type ThemeSource,
	type ThemeSourceError,
}

let ThemeSourceMetadataSchema = z.object({
	name: z.string().trim().min(1).optional(),
	author: z.string().optional(),
	description: z.string().optional(),
	thumbnail: z
		.string()
		.refine(value => {
			let match = value.match(
				/^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/,
			)
			return (
				!!match &&
				parsePortableAssetFence(`base64 asset thumbnail ${match[1]}`, match[2])
					.type === "asset"
			)
		}, "Thumbnail must be a valid base64 PNG, JPEG, WebP, or GIF up to 2 MB")
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

let latestSourceContent = new Map<string, string>()

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
	if (typeof DOMParser === "undefined")
		return "HTML templates cannot be validated here"
	return validateThemeTemplate(html, {
		parseDocument: value => new DOMParser().parseFromString(value, "text/html"),
		sanitize: value => sanitizeHtml(value).sanitized,
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

function serializeThemeSource(params: {
	css: string
	documentTemplate?: string | null
	slideTemplate?: string | null
}): string {
	let fence = "```"
	let sections = [
		"# Theme source\n\nWrite CSS in a `css theme` fence. Scope rules with `.theme`, `.document`, `.slide`, and `.content`. Add optional `html document` and `html slide` fences with one `data-content` slot. Prose is ignored.",
		`${fence}css theme\n${params.css.trim()}\n${fence}`,
	]
	if (params.documentTemplate?.trim()) {
		sections.push(
			`${fence}html document\n${params.documentTemplate.trim()}\n${fence}`,
		)
	}
	if (params.slideTemplate?.trim()) {
		sections.push(
			`${fence}html slide\n${params.slideTemplate.trim()}\n${fence}`,
		)
	}
	return sections.join("\n\n") + "\n"
}

function getThemeSourceId(content: string): string | null {
	let { frontmatter } = parseFrontmatter(content)
	let value = frontmatter?.["theme-source"]
	return typeof value === "string" && value.trim() ? value.trim() : null
}

function createThemeSourceDocumentContent(params: {
	themeId: string
	name: string
	source: string
}) {
	let source = params.source.replace(
		/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n)?/,
		"",
	)
	let metadata = parseThemeSource(source, {
		validateTemplate: () => null,
	}).metadata
	if (metadata)
		source = withThemeSourceMetadata(source, { ...metadata, name: params.name })
	return `---\ntitle: ${JSON.stringify(`Theme: ${params.name}`)}\ntheme-source: ${params.themeId}\n---\n\n${source}`
}

async function createThemeSourceDocument(
	account: co.loaded<typeof UserAccount>,
	params: { themeId: string; name: string; source: string },
) {
	let loaded = await account.$jazz.ensureLoaded({
		resolve: { root: { documents: true } },
	})
	if (!loaded.root?.documents?.$isLoaded)
		throw new Error("Personal documents are not loaded")

	let content = createThemeSourceDocumentContent(params)
	let group = Group.create({ owner: account })
	let now = new Date()
	let document = Document.create(
		{
			version: 1,
			content: co.plainText().create(content, group),
			comments: co.list(CommentThread).create([], group),
			...createDocumentMetadata(content, now),
			createdAt: now,
			updatedAt: now,
		},
		group,
	)
	loaded.root.documents.$jazz.push(document)
	return document
}

async function syncThemeFromSource(
	account: co.loaded<typeof UserAccount>,
	documentId: string,
	content: string,
): Promise<boolean> {
	latestSourceContent.set(documentId, content)
	try {
		let sourceId = getThemeSourceId(content)
		if (!sourceId) {
			return false
		}
		let parsed = parseThemeSource(content)
		if (parsed.errors.length > 0) {
			return false
		}

		let loaded = await loadThemes(account)
		if (!loaded) {
			return false
		}
		if (latestSourceContent.get(documentId) !== content) return false
		let themes = loaded.root?.themes
		if (!themes?.$isLoaded) {
			return false
		}
		let theme = Array.from(themes).find(
			candidate =>
				candidate?.$isLoaded &&
				candidate.$jazz.id === sourceId &&
				candidate.sourceDocId === documentId,
		)
		if (!theme?.$isLoaded || !theme.css?.$isLoaded) {
			return false
		}

		let css = sanitizeCss(parsed.css).sanitized
		let documentTemplate = parsed.documentTemplate
			? sanitizeHtml(parsed.documentTemplate).sanitized
			: undefined
		let slideTemplate = parsed.slideTemplate
			? sanitizeHtml(parsed.slideTemplate).sanitized
			: undefined
		let currentCss = theme.css.toString()
		let changed = currentCss !== css
		if (changed) {
			if (getDeletedCssLength(currentCss, css) > 2_000) {
				theme.$jazz.set("css", co.plainText().create(css, theme.$jazz.owner))
			} else {
				theme.css.$jazz.applyDiff(css)
			}
		}
		let currentTemplate = theme.template?.$isLoaded
			? theme.template.toString()
			: undefined
		if (currentTemplate !== documentTemplate) {
			changed = true
			theme.$jazz.set(
				"template",
				documentTemplate
					? co.plainText().create(documentTemplate, theme.$jazz.owner)
					: undefined,
			)
		}
		let currentSlideTemplate = theme.slideTemplate?.$isLoaded
			? theme.slideTemplate.toString()
			: undefined
		if (currentSlideTemplate !== slideTemplate) {
			changed = true
			theme.$jazz.set(
				"slideTemplate",
				slideTemplate
					? co.plainText().create(slideTemplate, theme.$jazz.owner)
					: undefined,
			)
		}
		if (parsed.metadata) {
			let metadata = parsed.metadata
			if (metadata.name && theme.name !== metadata.name) {
				theme.$jazz.set("name", metadata.name)
				changed = true
			}
			if (metadata.type && theme.type !== metadata.type) {
				theme.$jazz.set("type", metadata.type)
				changed = true
			}
			let presets = metadata.presets
				? JSON.stringify(metadata.presets)
				: undefined
			if (theme.presets !== presets) {
				theme.$jazz.set("presets", presets)
				changed = true
			}
			if (theme.author !== metadata.author) {
				theme.$jazz.set("author", metadata.author)
				changed = true
			}
			if (theme.description !== metadata.description) {
				theme.$jazz.set("description", metadata.description)
				changed = true
			}
		}
		if (changed) theme.$jazz.set("updatedAt", new Date())
		return true
	} finally {
		clearLatestSourceContent(documentId, content)
	}
}

function getDeletedCssLength(currentCss: string, css: string) {
	let prefixLength = 0
	while (
		prefixLength < currentCss.length &&
		prefixLength < css.length &&
		currentCss[prefixLength] === css[prefixLength]
	) {
		prefixLength++
	}

	let suffixLength = 0
	while (
		suffixLength < currentCss.length - prefixLength &&
		suffixLength < css.length - prefixLength &&
		currentCss.at(-suffixLength - 1) === css.at(-suffixLength - 1)
	) {
		suffixLength++
	}

	return currentCss.length - prefixLength - suffixLength
}

function clearLatestSourceContent(documentId: string, content: string) {
	if (latestSourceContent.get(documentId) === content) {
		latestSourceContent.delete(documentId)
	}
}

async function loadThemes(account: co.loaded<typeof UserAccount>) {
	let loaded = await account.$jazz.ensureLoaded({
		resolve: {
			root: {
				themes: {
					$each: { css: true, template: true, slideTemplate: true },
				},
			},
		},
	})
	return loaded.$isLoaded ? loaded : null
}

function bindThemeSource(content: string, themeId: string): string {
	if (getThemeSourceId(content) === themeId) return content
	let frontmatter = content.match(/^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n)?/)
	if (!frontmatter) return `---\ntheme-source: ${themeId}\n---\n\n${content}`
	let lines = frontmatter[1]
		.split(/\r?\n/)
		.filter(line => !/^\s*theme-source\s*:/.test(line))
	return `---\n${lines.filter(Boolean).join("\n")}\ntheme-source: ${themeId}\n---\n${content.slice(frontmatter[0].length)}`
}

function withThemeSourceMetadata(
	source: string,
	metadata: ThemeSourceMetadata,
): string {
	let lines = source.split("\n")
	let output: string[] = []
	for (let index = 0; index < lines.length; index++) {
		let opening = lines[index].match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
		if (!opening) {
			output.push(lines[index])
			continue
		}
		let remove =
			opening[1] === "```" && opening[2].trim() === "json theme metadata"
		if (!remove) output.push(lines[index])
		for (index++; index < lines.length; index++) {
			if (!remove) output.push(lines[index])
			let closing = lines[index].match(/^\s{0,3}(`{3,}|~{3,})\s*$/)
			if (
				closing &&
				closing[1][0] === opening[1][0] &&
				closing[1].length >= opening[1].length
			)
				break
		}
	}
	return (
		output.join("\n").trimEnd() +
		"\n\n```json theme metadata\n" +
		JSON.stringify(metadata, null, 2) +
		"\n```\n"
	)
}
