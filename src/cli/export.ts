import { Args, Command, Options } from "@effect/cli"
import { JSDOM } from "jsdom"
import { readFile, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { getLoadedAssets, toPrintableAsset } from "@/app/features/assets"
import {
	findThemeById,
	findThemeByName,
	findPresetByAppearance,
	getThemeId,
	getThemeName,
	getThemePresets,
	loadThemesForPdf,
} from "@/app/features/themes/lib/document-theme"
import { scopeThemeCss } from "@/app/features/themes/lib/renderer"
import {
	buildPresetVariables,
	buildPrintableDocument,
	PRINT_THEME_SCOPE,
	resolvePrintTheme,
	toPrintTheme,
	type PrintTheme,
} from "@/app/features/import-export/lib/printable-html"
import { CliUsageError, FilesystemError, NotFoundError } from "@/cli/errors"
import { createAuthenticatedJazz } from "@/cli/jazz"
import {
	docIdArg,
	globalOptions,
	localOption,
	offlineOption,
	staleOkOption,
} from "@/cli/options"
import { printHtmlToPdf } from "@/cli/pdf"
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

			let html = filePath
				? await renderLocalFile(filePath, themeOption, config)
				: await renderDoc(docId ?? "", themeOption, config, {
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

async function compileLocalPrintTheme(path: string): Promise<PrintTheme> {
	let source = await readFile(path, "utf8").catch(() => {
		throw new FilesystemError({ message: `Cannot read theme ${path}` })
	})
	let compiled = compileThemeSource(source)
	let presets = compiled.metadata?.presets ?? []
	let preset =
		presets.find(candidate => candidate.appearance === "light") ??
		presets[0] ??
		null
	return {
		name: compiled.metadata?.name ?? basename(path, ".theme.md"),
		css: scopeThemeCss(compiled.css, PRINT_THEME_SCOPE),
		template: compiled.template ?? null,
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
	config: CliConfig,
) {
	let content = await readFile(filePath, "utf8").catch(() => {
		throw new FilesystemError({ message: `Cannot read ${filePath}` })
	})
	let themeRef = themeOption ?? getThemeId(content) ?? getThemeName(content)
	let theme = !themeRef
		? null
		: isLocalThemePath(themeRef)
			? await compileLocalPrintTheme(themeRef)
			: await withAccountThemes(config, themes =>
					resolveNamedTheme(themes, themeRef),
				)
	return buildPrintableDocument({
		content,
		theme,
		assets: [],
		defaultSyntaxTheme: null,
		parseHtml: parseHtmlWithJsdom,
	})
}

async function renderDoc(
	docId: string,
	themeOption: string | undefined,
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
		let account = await loadAccount(jazz, config.timeoutMs)
		let library = await loadThemesForPdf(account)
		let theme = !themeOption
			? await resolveDocTheme(content, library)
			: isLocalThemePath(themeOption)
				? await compileLocalPrintTheme(themeOption)
				: await resolveNamedTheme(library.themes, themeOption)
		return await buildPrintableDocument({
			content,
			theme,
			assets: await loadPrintableAssets(doc),
			defaultSyntaxTheme: library.defaultSyntaxTheme,
			parseHtml: parseHtmlWithJsdom,
		})
	} finally {
		await jazz.done()
	}
}

async function withAccountThemes<T>(
	config: CliConfig,
	pickTheme: (
		themes: Awaited<ReturnType<typeof loadThemesForPdf>>["themes"],
	) => Promise<T>,
) {
	let jazz = await createAuthenticatedJazz(config)
	try {
		let account = await loadAccount(jazz, config.timeoutMs)
		let library = await loadThemesForPdf(account)
		return await pickTheme(library.themes)
	} finally {
		await jazz.done()
	}
}

async function resolveDocTheme(
	content: string,
	library: Awaited<ReturnType<typeof loadThemesForPdf>>,
): Promise<PrintTheme | null> {
	let { theme, preset } = resolvePrintTheme({
		content,
		themes: library.themes,
		defaultPreviewTheme: library.defaultPreviewTheme,
	})
	return theme ? toPrintTheme(theme, preset) : null
}

async function resolveNamedTheme(
	themes: Awaited<ReturnType<typeof loadThemesForPdf>>["themes"],
	themeRef: string,
): Promise<PrintTheme> {
	let theme =
		findThemeById(themes, themeRef) ?? findThemeByName(themes, themeRef)
	if (!theme)
		throw new NotFoundError({ message: `Theme not found: ${themeRef}` })
	let preset =
		findPresetByAppearance(theme, "light") ?? getThemePresets(theme)[0] ?? null
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
