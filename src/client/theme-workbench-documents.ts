import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { AppRoute } from "../shared/routes"
import {
	defaultThemeSource,
	themeName,
	themeSourceProblems,
} from "../shared/theme-source"
import type { BrowserAccount } from "./browser-account"
import type { BrowserLibrary } from "./browser-library"
import type { BrowserPreferences } from "./browser-preferences"
import type {
	PreviewDocument,
	ThemeSource,
	ThemeWorkbenchOptions,
} from "./components/theme-workbench"
import { makeDocumentMediaView } from "./document-media-view"
import type { ThemeLibrary } from "./theme-library"
import type { BrowserStorage } from "./storage"

type Library = Context.Service.Shape<typeof BrowserLibrary>
type OpenedDocument = Effect.Success<ReturnType<Library["open"]>>

interface WorkbenchServices {
	library: Library
	storage: Context.Service.Shape<typeof BrowserStorage>
	account: Context.Service.Shape<typeof BrowserAccount>
	themes: Context.Service.Shape<typeof ThemeLibrary>
	preferences: Context.Service.Shape<typeof BrowserPreferences>
	// The document open beneath the workbench, which may hold the theme.
	current(): string | undefined
	go(route: AppRoute): void
	download(filename: string, content: string): void
	report(error: unknown): void
}

// The workbench edits a theme where it is stored: the account's theme
// library, or the document it is attached to. The route names the theme and,
// for an attached theme, its document; the records themselves decide.
export function themeWorkbenchOptions(
	services: WorkbenchServices,
	route: Extract<AppRoute, { kind: "themeWorkbench" }>,
): ThemeWorkbenchOptions {
	let { library, themes } = services
	return {
		route,
		open: Effect.gen(function* () {
			let scope = yield* Scope.Scope
			let candidates = [
				...new Set(
					[themes.document(), route.document, services.current()].filter(
						(id): id is string => Boolean(id),
					),
				),
			]
			for (let owner of candidates) {
				let attempt = yield* Scope.fork(scope, "sequential")
				let opened = yield* library
					.open(owner)
					.pipe(Effect.provideService(Scope.Scope, attempt), Effect.exit)
				if (
					Exit.isSuccess(opened) &&
					opened.value.session.replica.fields(route.theme).type === "theme"
				)
					return yield* themeSource(owner, opened.value)
				yield* Scope.close(attempt, Exit.void)
			}
			return undefined
		}),
		targets: () =>
			library.state
				.current()
				.library.documents.filter(
					entry => !entry.deleted && entry.document !== themes.document(),
				)
				.map(entry => ({
					id: entry.document,
					title: entry.metadata.title,
					archived: entry.metadata.archived,
				})),
		targetChanges: library.state.changes,
		openTarget: id =>
			Effect.gen(function* () {
				let opened = yield* library.open(id)
				let media = yield* mediaOf(id, opened)
				return media
			}),
		preferences: () => services.preferences.state.current().value.editor,
		openDocument: id =>
			services.go({ kind: "document", document: id, mode: "edit" }),
		createFromDefault: themes
			.create(defaultThemeSource)
			.pipe(
				Effect.tap(id =>
					Effect.sync(() => services.go({ kind: "themeWorkbench", theme: id })),
				),
			),
		report: services.report,
	}

	function themeSource(owner: string, opened: OpenedDocument) {
		return Effect.gen(function* () {
			let key =
				"theme-preview:" +
				services.account.origin +
				":" +
				services.account.subject +
				":" +
				owner +
				":" +
				route.theme
			let stored = yield* services.storage
				.get(key)
				.pipe(Effect.catch(() => Effect.succeed(undefined)))
			let valid =
				typeof stored === "string" && !themeSourceProblems(stored).length
					? stored
					: ""
			let cachePreview = Effect.suspend(() =>
				valid
					? services.storage.set(key, valid).pipe(Effect.ignore)
					: Effect.void,
			)
			let { session } = opened
			let replica = session.replica
			let id = route.theme
			function available() {
				return replica.fields(id).type === "theme"
			}
			function name() {
				return themeName(
					replica.text(id),
					replica.fields(id).name || "Custom theme",
				)
			}
			let source: ThemeSource = {
				lastValid: () => valid,
				rememberValid: content => {
					valid = content
					return cachePreview
				},
				library: owner === themes.document(),
				owner,
				name,
				available,
				text: () => replica.text(id),
				atoms: () => replica.visible(id),
				writable: () => available() && opened.canWrite(),
				edit: (content, base) => session.edit(content, base, id),
				undo: redo => (redo ? session.redo(id) : session.undo(id)),
				pending: () => session.unsaved() > 0,
				flush: session.flush.pipe(Effect.andThen(cachePreview)),
				// Write access follows the document's role and the account too.
				changes: session.changes.pipe(
					Stream.merge(opened.connection.changes),
					Stream.merge(library.state.changes),
					Stream.merge(services.account.state.changes),
				),
				download: () =>
					services.download(
						name().replace(/[\\/:*?"<>|]+/g, "-") + ".theme.md",
						replica.text(id),
					),
			}
			return source
		})
	}

	function mediaOf(id: string, opened: OpenedDocument) {
		return Effect.gen(function* () {
			let revision = yield* SubscriptionRef.make(0)
			let media = yield* makeDocumentMediaView({
				media: opened.media,
				source: () => opened.session.replica.text(id),
				changed: () =>
					Effect.runSync(SubscriptionRef.update(revision, value => value + 1)),
				clear: () => {},
				report: services.report,
			})
			media.visible(true)
			let preview: PreviewDocument = {
				text: () => opened.session.replica.text(id),
				assets: () =>
					new Map([
						...media.current().urls,
						...(opened.localMedia?.current() ?? []),
					]),
				changes: Stream.merge(
					opened.session.changes.pipe(
						Stream.tap(() => Effect.sync(() => media.refresh())),
					),
					SubscriptionRef.changes(revision),
				),
			}
			return preview
		})
	}
}
