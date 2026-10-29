import { Args, Command, Options } from "@effect/cli"
import { JSDOM } from "jsdom"
import { readFile, writeFile } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { getLoadedAssets, toPrintableAsset } from "@/app/features/assets"
import {
	findThemeById,
	findThemeByName,
	findPresetByAppearance,
	getThemeId,
	getThemePresets,
	loadThemesForPdf,
} from "@/app/features/themes/lib/document-theme"
import { scopeThemeCss } from "@/app/features/themes/lib/renderer"
import {
	buildPresetVariables,
	buildPrintableDocument,
	getNamedTheme,
	PRINT_THEME_SCOPE,
	resolvePrintTheme,
	toPrintTheme,
	type PrintTheme,
} from "@/app/features/import-export/lib/printable-html"
import {
	buildPrintableSlides,
	slideAspectRatios,
	type SlideAspectRatio,
	type SlidePrintLayout,
} from "@/app/features/import-export/lib/printable-slides"
import {
	getPresentationMode,
	parsePresentationTheme,
} from "@/app/features/presentation/lib/presentation"
import type { PrintableAsset } from "@/app/features/assets"
import { CliUsageError, FilesystemError, NotFoundError } from "@/cli/errors"
import { createAuthenticatedJazz } from "@/cli/jazz"
import {
	docIdArg,
	globalOptions,
	localOption,
	offlineOption,
	staleOkOption,
} from "@/cli/options"
import { embedLocalImages } from "@/cli/local-images"
import { printHtmlToPdf } from "@/cli/pdf"
import { loadAppPrintFonts } from "@/cli/print-fonts"
import {
	getOptionString,
	loadAccount,
	loadDocumentMetadata,
	runCommand,
} from "@/cli/runtime"
import type { CliConfig } from "@/cli/config"
import { compileThemeSource } from "@/cli/themes"

export { docExportCommand, compileLocalPrintTheme, isLocalThemePath }

let minimumPrintTimeoutMs = 60_000
let exportLayouts = ["document", "slides", "notes"] as const

type ExportLayout = (typeof exportLayouts)[number]
type ExportFormat = { layout: ExportLayout; aspectRatio: SlideAspectRatio }
type ThemeLibrary = Awaited<ReturnType<typeof loadThemesForPdf>>

let docExportCommand = Command.make(
	"export",
	{
		...globalOptions,
		docId: Args.optional(docIdArg),
		pdf: Options.optional(Options.text("pdf")).pipe(
			Options.withDescription("Write a PDF to this path."),
		),
		html: Options.optional(Options.text("html")).pipe(
			Options.withDescription("Write the printable HTML to this path."),
		),
		file: Options.optional(Options.file("file")).pipe(
			Options.withDescription("Export a local Markdown file instead of a doc."),
		),
		theme: Options.optional(Options.text("theme")).pipe(
			Options.withDescription(
				"Theme name, ID, or path to a local .theme.md file.",
			),
		),
		layout: Options.optional(Options.choice("layout", exportLayouts)).pipe(
			Options.withDescription(
				"document, slides, or notes (slides with speaker notes). Presentations default to slides.",
			),
		),
		aspect: Options.choice("aspect", slideAspectRatios).pipe(
			Options.withDefault("16:9"),
			Options.withDescription("Slide aspect ratio for slides and notes."),
		),
		offline: offlineOption,
		local: localOption,
		staleOk: staleOkOption,
	},
	args =>
		runCommand("doc.export", args, async config => {
			let docId = getOptionString(args.docId)
			let filePath = getOptionString(args.file)
			let pdfPath = getOptionString(args.pdf)
			let htmlPath = getOptionString(args.html)
			let themeOption = getOptionString(args.theme)
			let layout = getOptionString(args.layout)
			if (!docId === !filePath) {
				throw new CliUsageError({
					message: "Pass either a doc ID or --file <markdown>",
				})
			}
			if (!pdfPath && !htmlPath) {
				throw new CliUsageError({
					message: "Pass --pdf <path> and/or --html <path>",
				})
			}

			let format = { layout, aspectRatio: args.aspect }
			let html = filePath
				? await renderLocalFile(filePath, themeOption, format, config)
				: await renderDoc(docId ?? "", themeOption, format, config, {
						allowStale: args.offline || args.local || args.staleOk,
					})

			if (htmlPath) await writeFile(resolve(htmlPath), html, "utf8")
			if (pdfPath) {
				await printHtmlToPdf({
					html,
					outputPath: pdfPath,
					timeoutMs: Math.max(config.timeoutMs, minimumPrintTimeoutMs),
				})
			}
			return {
				source: filePath ? resolve(filePath) : docId,
				pdf: pdfPath ? resolve(pdfPath) : null,
				html: htmlPath ? resolve(htmlPath) : null,
			}
		}),
)

async function compileLocalPrintTheme(
	path: string,
	appearance: "light" | "dark" = "light",
): Promise<PrintTheme> {
	let source = await readFile(path, "utf8").catch(() => {
		throw new FilesystemError({ message: `Cannot read theme ${path}` })
	})
	let compiled = compileThemeSource(source)
	let presets = compiled.metadata?.presets ?? []
	let preset =
		presets.find(candidate => candidate.appearance === appearance) ??
		presets[0] ??
		null
	return {
		name: compiled.metadata?.name ?? basename(path, ".theme.md"),
		css: scopeThemeCss(compiled.css, PRINT_THEME_SCOPE),
		template: compiled.template ?? null,
		slideTemplate: compiled.slideTemplate ?? null,
		fontFaceRules: "",
		presetVariables: preset ? buildPresetVariables(preset) : "",
	}
}

function isLocalThemePath(themeRef: string) {
	return themeRef.endsWith(".theme.md") || themeRef.includes("/")
}

async function renderLocalFile(
	filePath: string,
	themeOption: string | undefined,
	requested: { layout: string | undefined; aspectRatio: SlideAspectRatio },
	config: CliConfig,
) {
	let content = await readFile(filePath, "utf8").catch(() => {
		throw new FilesystemError({ message: `Cannot read ${filePath}` })
	})
	let format = resolveExportFormat(content, requested)
	let appearance = getPrintAppearance(content, format)
	let themeRef = themeOption ?? getThemeId(content) ?? getNamedTheme(content)
	let theme = !themeRef
		? null
		: isLocalThemePath(themeRef)
			? await compileLocalPrintTheme(themeRef, appearance)
			: await withThemeLibrary(config, library =>
					resolveNamedTheme(library.themes, themeRef, appearance),
				)
	let html = await renderExport({
		content,
		format,
		theme,
		assets: [],
		defaultSyntaxTheme: null,
	})
	return embedLocalImages(html, dirname(resolve(filePath)))
}

async function renderDoc(
	docId: string,
	themeOption: string | undefined,
	requested: { layout: string | undefined; aspectRatio: SlideAspectRatio },
	config: CliConfig,
	options: { allowStale: boolean },
) {
	let jazz = await createAuthenticatedJazz(config)
	try {
		let doc = await loadDocumentMetadata(jazz, docId, {
			allowStale: options.allowStale,
			timeoutMs: config.timeoutMs,
		})
		let content = doc.content.toString()
		let format = resolveExportFormat(content, requested)
		let appearance = getPrintAppearance(content, format)
		let account = await loadAccount(jazz, config.timeoutMs)
		let library = await loadThemesForPdf(account)
		let theme = !themeOption
			? await resolveDocTheme(content, library, format)
			: isLocalThemePath(themeOption)
				? await compileLocalPrintTheme(themeOption, appearance)
				: await resolveNamedTheme(library.themes, themeOption, appearance)
		return await renderExport({
			content,
			format,
			theme,
			assets: await loadPrintableAssets(doc),
			defaultSyntaxTheme: library.defaultSyntaxTheme,
		})
	} finally {
		await jazz.done()
	}
}

function resolveExportFormat(
	content: string,
	requested: { layout: string | undefined; aspectRatio: SlideAspectRatio },
): ExportFormat {
	let layout = exportLayouts.find(candidate => candidate === requested.layout)
	return {
		layout: layout ?? (getPresentationMode(content) ? "slides" : "document"),
		aspectRatio: requested.aspectRatio,
	}
}

function getPrintAppearance(content: string, format: ExportFormat) {
	return format.layout === "document"
		? "light"
		: (parsePresentationTheme(content) ?? "light")
}

async function renderExport(params: {
	content: string
	format: ExportFormat
	theme: PrintTheme | null
	assets: PrintableAsset[]
	defaultSyntaxTheme: string | null
}) {
	let { format, ...rest } = params
	let slideLayout = toSlideLayout(format.layout)
	if (!slideLayout) {
		return buildPrintableDocument({ ...rest, parseHtml: parseHtmlWithJsdom })
	}
	return buildPrintableSlides({
		...rest,
		appFonts: await loadAppPrintFonts(),
		layout: slideLayout,
		aspectRatio: format.aspectRatio,
		parseHtml: parseHtmlWithJsdom,
	})
}

function toSlideLayout(layout: ExportLayout): SlidePrintLayout | null {
	return layout === "document" ? null : layout
}

async function withThemeLibrary<T>(
	config: CliConfig,
	pickTheme: (library: ThemeLibrary) => Promise<T>,
) {
	let jazz = await createAuthenticatedJazz(config)
	try {
		let account = await loadAccount(jazz, config.timeoutMs)
		return await pickTheme(await loadThemesForPdf(account))
	} finally {
		await jazz.done()
	}
}

async function resolveDocTheme(
	content: string,
	library: ThemeLibrary,
	format: ExportFormat,
): Promise<PrintTheme | null> {
	let isSlides = format.layout !== "document"
	let { theme, preset } = resolvePrintTheme({
		content,
		themes: library.themes,
		defaultThemeName: isSlides
			? library.defaultSlideshowTheme
			: library.defaultPreviewTheme,
		appearance: getPrintAppearance(content, format),
	})
	return theme ? toPrintTheme(theme, preset) : null
}

async function resolveNamedTheme(
	themes: ThemeLibrary["themes"],
	themeRef: string,
	appearance: "light" | "dark",
): Promise<PrintTheme> {
	let theme =
		findThemeById(themes, themeRef) ?? findThemeByName(themes, themeRef)
	if (!theme)
		throw new NotFoundError({ message: `Theme not found: ${themeRef}` })
	let preset =
		findPresetByAppearance(theme, appearance) ??
		getThemePresets(theme)[0] ??
		null
	return toPrintTheme(theme, preset)
}

async function loadPrintableAssets(
	doc: Awaited<ReturnType<typeof loadDocumentMetadata>>,
) {
	let loaded = await doc.$jazz.ensureLoaded({
		resolve: { assets: { $each: { $onError: "catch" } } },
	})
	// Video posters need a browser canvas; the CLI prints videos as plain links.
	return getLoadedAssets(loaded.assets)
		.filter(asset => asset.type !== "video")
		.map(toPrintableAsset)
}

function parseHtmlWithJsdom(html: string): Document {
	return new JSDOM(html).window.document
}
