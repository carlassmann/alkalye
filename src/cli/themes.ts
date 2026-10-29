import { Args, Command, Options } from "@effect/cli"
import { JSDOM } from "jsdom"
import { readFile } from "node:fs/promises"
import { co } from "jazz-tools"
import { getDocumentTitle } from "@/app/features/documents"
import { persistDocumentContentSynchronously } from "@/app/features/documents/lib/background-document-save"
import { Document, Theme, UserAccount } from "@/schema"
import {
	buildThemeSourceDocument,
	createThemeSourceDocumentContent,
	parseThemeSource,
	hasThemeDefinition,
	serializeThemeSource,
	validateThemeTemplate,
	type ThemeSourceMetadata,
} from "@/app/features/themes/lib/source"
import {
	sanitizeCss,
	sanitizeHtmlWithWindow,
} from "@/app/features/themes/lib/sanitize"
import { serializePortableTheme } from "@/app/features/themes/lib/export"
import {
	NotFoundError,
	PermissionError,
	SyncPeerError,
	ValidationError,
} from "@/cli/errors"
import { descriptions } from "@/cli/help"
import { createAuthenticatedJazz } from "@/cli/jazz"
import { globalOptions, nameOption } from "@/cli/options"
import {
	getOptionString,
	loadAccount,
	runCommand,
	syncMutation,
	type JazzContext,
} from "@/cli/runtime"

export {
	themeCommand,
	compileThemeSource,
	createThemeFromSource,
	updateThemeFromSource,
	listAccountThemes,
	getAccountTheme,
	deleteAccountTheme,
	themeWorkbenchUrl,
}

type ThemeResolve = {
	css: true
	template: true
	slideTemplate: true
}

type LoadedTheme = co.loaded<typeof Theme, ThemeResolve>
type LoadedThemeAccount = co.loaded<
	typeof UserAccount,
	typeof themeLibraryResolve
>
type LoadedThemeList = co.loaded<
	ReturnType<typeof co.list<typeof Theme>>,
	typeof themeLibraryResolve.root.themes
>
type ThemeLibrary = {
	account: LoadedThemeAccount
	themes?: LoadedThemeList
}
type CompiledThemeSource = {
	metadata?: ThemeSourceMetadata
	css: string
	template?: string
	slideTemplate?: string
}
type ThemeSummary = {
	themeId: string
	name: string
	type: "preview" | "slideshow" | "both"
	sourceDocId: string | null
	workbenchUrl: string
	createdAt: string
	updatedAt: string
}

// A theme whose upload never finished stays unavailable for good. It must not
// take the rest of the library down with it.
let themeLibraryResolve = {
	root: {
		documents: true,
		themes: {
			$each: {
				css: true,
				template: true,
				slideTemplate: true,
				$onError: "catch",
			},
		},
	},
} as const

// Theme sources embed fonts as base64 text, which takes far longer to upload
// than the default sync timeout allows.
let themeUploadTimeoutMs = 120_000

let themeIdArg = Args.text({ name: "theme-id" }).pipe(
	Args.withDescription("Theme ID."),
)
let sourceOption = Options.file("source").pipe(
	Options.withDescription(
		"Markdown with css theme and optional html document/slide fences.",
	),
)

let themeList = Command.make("list", globalOptions, args =>
	runCommand("theme.list", args, async config => {
		let jazz = await createAuthenticatedJazz(config)
		try {
			let account = await loadAccount(jazz, config.timeoutMs)
			let themes = await listAccountThemes(account)
			return themes.map(theme => summarizeTheme(theme, config.baseUrl))
		} finally {
			await jazz.done()
		}
	}),
)

let themeGet = Command.make(
	"get",
	{ ...globalOptions, themeId: themeIdArg },
	args =>
		runCommand("theme.get", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			try {
				let account = await loadAccount(jazz, config.timeoutMs)
				let theme = await getAccountTheme(account, args.themeId)
				let sourceContent = await getThemeSource(account, theme)
				let portableTheme = await theme.$jazz.ensureLoaded({
					resolve: {
						css: true,
						template: true,
						slideTemplate: true,
						assets: { $each: { data: true } },
						thumbnail: { original: true },
					},
				})
				let source = await serializePortableTheme(
					portableTheme,
					sourceContent,
					compileThemeSource,
				)
				return {
					...summarizeTheme(theme, config.baseUrl),
					css: theme.css.toString(),
					template: theme.template?.toString() ?? null,
					slideTemplate: theme.slideTemplate?.toString() ?? null,
					source,
				}
			} finally {
				await jazz.done()
			}
		}),
)

let themeCreate = Command.make(
	"create",
	{
		...globalOptions,
		source: sourceOption,
		name: Options.optional(nameOption),
	},
	args =>
		runCommand("theme.create", args, async config => {
			let source = await readThemeSource(args.source)
			let jazz = await createAuthenticatedJazz(config)
			try {
				let account = await loadAccount(jazz, config.timeoutMs)
				let uploadTimeoutMs = getThemeUploadTimeout(config.timeoutMs)
				let theme = await createThemeFromSource(account, {
					source,
					name: getOptionString(args.name),
					waitForUpload: () => waitForThemeUpload(jazz, uploadTimeoutMs),
				})
				await syncMutation(jazz, uploadTimeoutMs)
				return summarizeTheme(theme, config.baseUrl)
			} finally {
				await jazz.done()
			}
		}),
)

let themeUpdate = Command.make(
	"update",
	{
		...globalOptions,
		themeId: themeIdArg,
		source: sourceOption,
		name: Options.optional(nameOption),
	},
	args =>
		runCommand("theme.update", args, async config => {
			let source = await readThemeSource(args.source)
			let jazz = await createAuthenticatedJazz(config)
			try {
				let account = await loadAccount(jazz, config.timeoutMs)
				let uploadTimeoutMs = getThemeUploadTimeout(config.timeoutMs)
				let theme = await updateThemeFromSource(account, {
					themeId: args.themeId,
					source,
					name: getOptionString(args.name),
					waitForUpload: () => waitForThemeUpload(jazz, uploadTimeoutMs),
				})
				await syncMutation(jazz, uploadTimeoutMs)
				return summarizeTheme(theme, config.baseUrl)
			} finally {
				await jazz.done()
			}
		}),
)

let themeDelete = Command.make(
	"delete",
	{ ...globalOptions, themeId: themeIdArg },
	args =>
		runCommand("theme.delete", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			try {
				let account = await loadAccount(jazz, config.timeoutMs)
				let deleted = await deleteAccountTheme(account, args.themeId)
				await syncMutation(jazz, config.timeoutMs)
				return { themeId: args.themeId, deleted: true, ...deleted }
			} finally {
				await jazz.done()
			}
		}),
)

let themeCommand = Command.make("theme").pipe(
	Command.withDescription(descriptions.theme),
	Command.withSubcommands([
		themeList,
		themeGet,
		themeCreate,
		themeUpdate,
		themeDelete,
	]),
)

function compileThemeSource(source: string): CompiledThemeSource {
	let parsed = parseThemeSource(source, { validateTemplate: () => null })
	if (parsed.errors.length > 0) throwThemeValidation(parsed.errors)
	if (!hasThemeDefinition(parsed)) {
		throw new ValidationError({
			message: "Theme source needs a CSS, HTML, or theme metadata fence",
		})
	}
	let template = parsed.documentTemplate
		? validateAndSanitizeTemplate(parsed.documentTemplate)
		: undefined
	let slideTemplate = parsed.slideTemplate
		? validateAndSanitizeTemplate(parsed.slideTemplate)
		: undefined
	return {
		css: sanitizeCss(parsed.css).sanitized,
		template,
		slideTemplate,
		...(parsed.metadata ? { metadata: parsed.metadata } : {}),
	}
}

async function createThemeFromSource(
	account: co.loaded<typeof UserAccount>,
	params: {
		source: string
		name?: string
		waitForUpload?: () => Promise<void>
	},
): Promise<LoadedTheme> {
	let compiled = compileThemeSource(params.source)
	let library = await loadThemeLibrary(account)
	let themes = await ensureThemeLibrary(library)
	let name = getThemeName(params.name ?? compiled.metadata?.name, params.source)
	let owner = library.account.root.$jazz.owner
	let now = new Date()
	let theme = Theme.create(
		{
			version: 1,
			name,
			type: compiled.metadata?.type ?? "both",
			author: compiled.metadata?.author,
			description: compiled.metadata?.description,
			thumbnailDataUrl: compiled.metadata?.thumbnail,
			presets: compiled.metadata?.presets
				? JSON.stringify(compiled.metadata.presets)
				: undefined,
			css: co.plainText().create(compiled.css, owner),
			template: compiled.template
				? co.plainText().create(compiled.template, owner)
				: undefined,
			slideTemplate: compiled.slideTemplate
				? co.plainText().create(compiled.slideTemplate, owner)
				: undefined,
			createdAt: now,
			updatedAt: now,
		},
		owner,
	)
	let source = buildThemeSourceDocument(library.account, {
		themeId: theme.$jazz.id,
		name,
		source: params.source,
	})
	theme.$jazz.set("sourceDocId", source.$jazz.id)
	// Linked before its upload finishes, a theme can end up unloadable everywhere.
	await params.waitForUpload?.()
	library.account.root.documents.$jazz.push(source)
	themes.$jazz.push(theme)
	return theme
}

async function updateThemeFromSource(
	account: co.loaded<typeof UserAccount>,
	params: {
		themeId: string
		source: string
		name?: string
		waitForUpload?: () => Promise<void>
	},
): Promise<LoadedTheme> {
	let compiled = compileThemeSource(params.source)
	let library = await loadThemeLibrary(account)
	let theme = findAccountTheme(library.themes, params.themeId)
	let name = params.name?.trim() || compiled.metadata?.name || theme.name
	let existingSource = theme.sourceDocId
		? await getOwnedSourceDocument(library.account, theme.sourceDocId)
		: undefined
	let nextSource = createThemeSourceDocumentContent({
		themeId: theme.$jazz.id,
		name,
		source: params.source,
	})

	let owner = theme.$jazz.owner
	let css = co.plainText().create(compiled.css, owner)
	let template = compiled.template
		? co.plainText().create(compiled.template, owner)
		: undefined
	let slideTemplate = compiled.slideTemplate
		? co.plainText().create(compiled.slideTemplate, owner)
		: undefined
	let createdSource = existingSource
		? undefined
		: buildThemeSourceDocument(library.account, {
				themeId: theme.$jazz.id,
				name,
				source: params.source,
			})
	// Pointed at before its upload finishes, new CSS leaves the theme unloadable.
	await params.waitForUpload?.()

	theme.$jazz.set("css", css)
	theme.$jazz.set("template", template)
	theme.$jazz.set("slideTemplate", slideTemplate)
	if (theme.name !== name) theme.$jazz.set("name", name)
	if (compiled.metadata) {
		if (compiled.metadata.type) theme.$jazz.set("type", compiled.metadata.type)
		theme.$jazz.set("author", compiled.metadata.author)
		theme.$jazz.set("description", compiled.metadata.description)
		theme.$jazz.set("thumbnailDataUrl", compiled.metadata.thumbnail)
		theme.$jazz.set(
			"presets",
			compiled.metadata.presets
				? JSON.stringify(compiled.metadata.presets)
				: undefined,
		)
	}
	if (existingSource) {
		persistDocumentContentSynchronously(existingSource, nextSource)
	}
	if (createdSource) {
		library.account.root.documents.$jazz.push(createdSource)
		theme.$jazz.set("sourceDocId", createdSource.$jazz.id)
	}
	theme.$jazz.set("updatedAt", new Date())
	return theme
}

async function listAccountThemes(
	account: co.loaded<typeof UserAccount>,
): Promise<LoadedTheme[]> {
	let library = await loadThemeLibrary(account)
	if (!library.themes) return []
	return Array.from(library.themes).filter(
		(candidate): candidate is LoadedTheme => Boolean(candidate?.$isLoaded),
	)
}

async function getAccountTheme(
	account: co.loaded<typeof UserAccount>,
	themeId: string,
): Promise<LoadedTheme> {
	let library = await loadThemeLibrary(account)
	return findAccountTheme(library.themes, themeId)
}

async function deleteAccountTheme(
	account: co.loaded<typeof UserAccount>,
	themeId: string,
): Promise<{ sourceDocId: string | null }> {
	let library = await loadThemeLibrary(account)
	if (!library.themes)
		throw new NotFoundError({ message: `Theme not found: ${themeId}` })
	let index = library.themes.$jazz.raw.asArray().indexOf(themeId)
	if (index < 0)
		throw new NotFoundError({ message: `Theme not found: ${themeId}` })
	let theme = library.themes[index]
	library.themes.$jazz.splice(index, 1)
	return { sourceDocId: theme?.$isLoaded ? (theme.sourceDocId ?? null) : null }
}

function themeWorkbenchUrl(baseUrl: string, themeId: string) {
	let base = baseUrl.replace(/\/$/, "")
	return `${base.endsWith("/app") ? base : `${base}/app`}/themes/${themeId}/workbench`
}

async function loadThemeLibrary(
	account: co.loaded<typeof UserAccount>,
): Promise<ThemeLibrary> {
	let loaded = await account.$jazz.ensureLoaded({
		resolve: themeLibraryResolve,
	})
	if (!loaded.root) {
		throw new ValidationError({ message: "Personal themes are not loaded" })
	}
	return {
		account: loaded,
		themes: loaded.root.themes?.$isLoaded ? loaded.root.themes : undefined,
	}
}

async function ensureThemeLibrary(
	library: ThemeLibrary,
): Promise<LoadedThemeList> {
	if (library.themes) return library.themes
	let themes = co.list(Theme).create([], library.account.root.$jazz.owner)
	library.account.root.$jazz.set("themes", themes)
	let reloaded = await loadThemeLibrary(library.account)
	if (!reloaded.themes) {
		throw new ValidationError({ message: "Personal themes are not loaded" })
	}
	return reloaded.themes
}

function findAccountTheme(
	themes: LoadedThemeList | undefined,
	themeId: string,
): LoadedTheme {
	if (themes) {
		for (let theme of themes) {
			if (theme?.$isLoaded && theme.$jazz.id === themeId) return theme
		}
	}
	throw new NotFoundError({ message: `Theme not found: ${themeId}` })
}

async function getThemeSource(account: LoadedThemeAccount, theme: LoadedTheme) {
	if (!theme.sourceDocId) {
		return serializeThemeSource({
			css: theme.css.toString(),
			documentTemplate: theme.template?.toString(),
			slideTemplate: theme.slideTemplate?.toString(),
		})
	}
	let source = await getOwnedSourceDocument(account, theme.sourceDocId)
	return source.content.toString()
}

async function getOwnedSourceDocument(
	account: LoadedThemeAccount,
	sourceId: string,
) {
	let isOwned = account.root.documents.some(doc => doc?.$jazz.id === sourceId)
	if (!isOwned) {
		throw new PermissionError({
			message: `Theme source is not owned by this account: ${sourceId}`,
		})
	}
	let source = await Document.load(sourceId, {
		loadAs: account,
		resolve: { content: true },
	})
	if (!source.$isLoaded || !source.content?.$isLoaded) {
		throw new NotFoundError({ message: `Theme source not found: ${sourceId}` })
	}
	let role = source.$jazz.owner.myRole?.()
	if (role !== "admin" && role !== "writer") {
		throw new PermissionError({
			message: `Theme source is not writable: ${sourceId}`,
		})
	}
	return source
}

function validateAndSanitizeTemplate(template: string) {
	let dom = new JSDOM("")
	try {
		let window = dom.window
		let sanitized = sanitizeHtmlWithWindow(window, template).sanitized
		let error = validateThemeTemplate(template, {
			parseDocument: value =>
				new window.DOMParser().parseFromString(value, "text/html"),
			sanitize: () => sanitized,
		})
		if (error) {
			throw new ValidationError({ message: error })
		}
		return sanitized
	} finally {
		dom.window.close()
	}
}

function throwThemeValidation(
	errors: { line: number; message: string }[],
): never {
	throw new ValidationError({
		message: errors
			.map(error => `Line ${error.line}: ${error.message}`)
			.join("\n"),
	})
}

function getThemeName(name: string | undefined, source: string) {
	let nextName = name?.trim() || getDocumentTitle(source).trim()
	if (!nextName)
		throw new ValidationError({ message: "Theme name is required" })
	return nextName
}

async function readThemeSource(path: string) {
	return readFile(path, "utf8")
}

function summarizeTheme(theme: LoadedTheme, baseUrl: string): ThemeSummary {
	return {
		themeId: theme.$jazz.id,
		name: theme.name,
		type: theme.type,
		sourceDocId: theme.sourceDocId ?? null,
		workbenchUrl: themeWorkbenchUrl(baseUrl, theme.$jazz.id),
		createdAt: theme.createdAt.toISOString(),
		updatedAt: theme.updatedAt.toISOString(),
	}
}

async function waitForThemeUpload(jazz: JazzContext, timeoutMs: number) {
	try {
		await syncMutation(jazz, timeoutMs)
	} catch {
		throw new SyncPeerError({
			message: `Theme upload did not finish within ${timeoutMs} ms, so it was not added to your library. Retry with a longer --timeout.`,
		})
	}
}

function getThemeUploadTimeout(timeoutMs: number) {
	return Math.max(timeoutMs, themeUploadTimeoutMs)
}
