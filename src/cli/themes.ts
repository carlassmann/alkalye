import { Args, Command, Options } from "@effect/cli"
import { JSDOM } from "jsdom"
import { readFile } from "node:fs/promises"
import { co } from "jazz-tools"
import { getDocumentTitle } from "@/app/features/documents"
import { persistDocumentContentSynchronously } from "@/app/features/documents/lib/background-document-save"
import { Document, Theme, UserAccount } from "@/schema"
import {
	createThemeSourceDocument,
	createThemeSourceDocumentContent,
	parseThemeSource,
	serializeThemeSource,
	validateThemeTemplate,
} from "@/app/features/themes/lib/source"
import {
	sanitizeCss,
	sanitizeHtmlWithWindow,
} from "@/app/features/themes/lib/sanitize"
import { NotFoundError, PermissionError, ValidationError } from "@/cli/errors"
import { descriptions } from "@/cli/help"
import { createAuthenticatedJazz } from "@/cli/jazz"
import { globalOptions, nameOption } from "@/cli/options"
import {
	getOptionString,
	loadAccount,
	runCommand,
	syncMutation,
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
type LoadedThemeList = co.loaded<
	ReturnType<typeof co.list<typeof Theme>>,
	{ $each: ThemeResolve }
>
type LoadedThemeAccount = co.loaded<
	typeof UserAccount,
	{ root: { documents: true; themes: { $each: ThemeResolve } } }
>
type ThemeLibrary = {
	account: LoadedThemeAccount
	themes?: LoadedThemeList
}
type CompiledThemeSource = {
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
				let source = await getThemeSource(account, theme)
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
				let theme = await createThemeFromSource(account, {
					source,
					name: getOptionString(args.name),
				})
				await syncMutation(jazz, config.timeoutMs)
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
				let theme = await updateThemeFromSource(account, {
					themeId: args.themeId,
					source,
					name: getOptionString(args.name),
				})
				await syncMutation(jazz, config.timeoutMs)
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
	if (!parsed.css.trim()) {
		throw new ValidationError({
			message: "Theme source needs at least one css theme fence",
		})
	}
	let template = parsed.documentTemplate
		? validateAndSanitizeTemplate(parsed.documentTemplate)
		: undefined
	let slideTemplate = parsed.slideTemplate
		? validateAndSanitizeTemplate(parsed.slideTemplate)
		: undefined
	return { css: sanitizeCss(parsed.css).sanitized, template, slideTemplate }
}

async function createThemeFromSource(
	account: co.loaded<typeof UserAccount>,
	params: { source: string; name?: string },
): Promise<LoadedTheme> {
	let compiled = compileThemeSource(params.source)
	let library = await loadThemeLibrary(account)
	let themes = await ensureThemeLibrary(library)
	let name = getThemeName(params.name, params.source)
	let owner = library.account.root.$jazz.owner
	let now = new Date()
	let theme = Theme.create(
		{
			version: 1,
			name,
			type: "both",
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
	let source = await createThemeSourceDocument(library.account, {
		themeId: theme.$jazz.id,
		name,
		source: params.source,
	})
	theme.$jazz.set("sourceDocId", source.$jazz.id)
	themes.$jazz.push(theme)
	return theme
}

async function updateThemeFromSource(
	account: co.loaded<typeof UserAccount>,
	params: { themeId: string; source: string; name?: string },
): Promise<LoadedTheme> {
	let compiled = compileThemeSource(params.source)
	let library = await loadThemeLibrary(account)
	let theme = findAccountTheme(library.themes, params.themeId)
	let name = params.name?.trim() || theme.name
	let existingSource = theme.sourceDocId
		? await getOwnedSourceDocument(library.account, theme.sourceDocId)
		: undefined
	let nextSource = createThemeSourceDocumentContent({
		themeId: theme.$jazz.id,
		name,
		source: params.source,
	})

	theme.$jazz.set("css", co.plainText().create(compiled.css, theme.$jazz.owner))
	theme.$jazz.set(
		"template",
		compiled.template
			? co.plainText().create(compiled.template, theme.$jazz.owner)
			: undefined,
	)
	theme.$jazz.set(
		"slideTemplate",
		compiled.slideTemplate
			? co.plainText().create(compiled.slideTemplate, theme.$jazz.owner)
			: undefined,
	)
	if (theme.name !== name) theme.$jazz.set("name", name)
	if (existingSource) {
		persistDocumentContentSynchronously(existingSource, nextSource)
	} else {
		let source = await createThemeSourceDocument(library.account, {
			themeId: theme.$jazz.id,
			name,
			source: params.source,
		})
		theme.$jazz.set("sourceDocId", source.$jazz.id)
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
	let index = Array.from(library.themes).findIndex(
		theme => theme?.$jazz.id === themeId,
	)
	if (index < 0)
		throw new NotFoundError({ message: `Theme not found: ${themeId}` })
	let theme = findAccountTheme(library.themes, themeId)
	library.themes.$jazz.splice(index, 1)
	return { sourceDocId: theme.sourceDocId ?? null }
}

function themeWorkbenchUrl(baseUrl: string, themeId: string) {
	let base = baseUrl.replace(/\/$/, "")
	return `${base.endsWith("/app") ? base : `${base}/app`}/themes/${themeId}/workbench`
}

async function loadThemeLibrary(
	account: co.loaded<typeof UserAccount>,
): Promise<ThemeLibrary> {
	let loaded = await account.$jazz.ensureLoaded({
		resolve: {
			root: {
				documents: true,
				themes: { $each: { css: true, template: true, slideTemplate: true } },
			},
		},
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
