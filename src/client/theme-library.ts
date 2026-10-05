import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { compileTheme } from "../shared/markdown"
import { themeFromArchive } from "../shared/theme-archive"
import { libraryThemes, themeLibraryBirth } from "../shared/theme-library"
import type { LibraryTheme } from "../shared/theme-library"
import { unzip } from "../shared/zip"
import { BrowserLibrary } from "./browser-library"
import { BrowserAccount } from "./browser-account"
import { withThemeName } from "../shared/theme-source"
import { BrowserPreferences } from "./browser-preferences"

type Library = Context.Service.Shape<typeof BrowserLibrary>
export type ThemeLibraryDocument = Effect.Success<ReturnType<Library["open"]>>

export interface ThemeLibraryState {
	// The personal document holding the themes, once the account has one.
	readonly document: string
	readonly themes: ReadonlyArray<LibraryTheme>
	readonly status: "ready" | "loading" | "failed"
	readonly message?: string
}

export class ThemeUploadInvalid extends Schema.TaggedError<ThemeUploadInvalid>()(
	"ThemeUploadInvalid",
	{ message: Schema.String, errors: Schema.Array(Schema.String) },
) {}

// The account's theme library lives in one personal document, so its themes
// sync, stay encrypted and work offline like any other writing. The
// document is created with the first theme and named by a preference.
export class ThemeLibrary extends Context.Service<
	ThemeLibrary,
	Effect.Success<ReturnType<typeof makeThemeLibrary>>
>()("alkalye/ThemeLibrary") {
	static layer = Layer.effect(ThemeLibrary, makeThemeLibrary())
}

export let starterTheme =
	'# Custom theme\n\n```css theme\n.document .content { font-family: Georgia, serif; }\n```\n\n```html document\n<article class="content" data-content></article>\n```'

function makeThemeLibrary() {
	return Effect.gen(function* () {
		let library = yield* BrowserLibrary
		let account = yield* BrowserAccount
		let preferences = yield* BrowserPreferences
		let random = yield* Crypto.Crypto
		let creating = yield* Semaphore.make(1)
		let state = yield* SubscriptionRef.make<ThemeLibraryState>(
			Object.freeze({ document: "", themes: [], status: "ready" }),
		)
		yield* preferences.state.changes.pipe(
			Stream.map(current => current.value.themeLibrary),
			Stream.changes,
			Stream.merge(
				library.live.changes.pipe(
					Stream.filter(change => change.type === "connected"),
					Stream.map(() => preferences.state.current().value.themeLibrary),
				),
			),
			Stream.switchMap(watch),
			Stream.runDrain,
			Effect.forkScoped({ startImmediately: true }),
		)
		return Object.freeze({
			state: Object.freeze({
				current: () => SubscriptionRef.getUnsafe(state),
				changes: SubscriptionRef.changes(state),
			}),
			// The open library document, for the theme workbench.
			document: () => preferences.state.current().value.themeLibrary,
			open: () => library.open(preferences.state.current().value.themeLibrary),
			references: preferences.state.changes.pipe(
				Stream.map(current => current.value.themeLibrary),
				Stream.changes,
			),
			create,
			upload,
			remove,
		})

		function watch(id: string) {
			if (!id)
				return Stream.fromEffect(
					publish({ document: "", themes: [], status: "ready" }),
				)
			return Stream.unwrap(
				Effect.gen(function* () {
					yield* publish({
						document: id,
						themes:
							SubscriptionRef.getUnsafe(state).document === id
								? SubscriptionRef.getUnsafe(state).themes
								: [],
						status: "loading",
					})
					let document = yield* library.open(id)
					return Stream.make(undefined).pipe(
						Stream.merge(document.session.changes),
						Stream.mapEffect(() =>
							publish({
								document: id,
								themes: themesOf(document),
								status: "ready",
							}),
						),
					)
				}),
			).pipe(
				Stream.catchCause(cause =>
					Stream.fromEffect(
						publish({
							document: id,
							themes: [],
							status: "failed",
							message: String(cause),
						}),
					),
				),
			)
		}
		function publish(value: ThemeLibraryState) {
			return SubscriptionRef.set(
				state,
				Object.freeze({ ...value, themes: Object.freeze([...value.themes]) }),
			)
		}
		function themesOf(document: ThemeLibraryDocument) {
			let replica = document.session.replica
			return libraryThemes(replica.records("theme"), id => replica.text(id))
		}
		// One library per account: concurrent first themes share a document.
		function libraryDocument() {
			return creating.withPermit(
				Effect.gen(function* () {
					let existing = preferences.state.current().value.themeLibrary
					if (existing) return existing
					let birth = themeLibraryBirth(account.subject)
					let id = yield* library.create(
						birth.source,
						birth.workspace,
						birth.document,
						birth.actor,
					)
					yield* preferences.save({ themeLibrary: id })
					return id
				}),
			)
		}
		function create(source = starterTheme, name = "") {
			return Effect.scoped(
				Effect.gen(function* () {
					let compiled = yield* Effect.try({
						try: () => compileTheme(source),
						catch: error =>
							new ThemeUploadInvalid({
								message: "This theme could not be read",
								errors: [
									error instanceof Error ? error.message : String(error),
								],
							}),
					})
					let documentId = yield* libraryDocument()
					let document = yield* library.open(documentId)
					let id = yield* random.randomUUIDv4
					let count = document.session.replica.records("theme").length
					let title =
						compiled.metadata.name.trim() ||
						name.trim() ||
						`Custom theme ${count + 1}`
					yield* document.session.change("Add theme", staged => [
						staged.set(id, "type", "theme"),
						staged.set(id, "document", documentId),
						staged.set(id, "name", title),
						staged.edit(
							id,
							compiled.metadata.name.trim()
								? source
								: withThemeName(source, title),
						),
					])
					yield* document.session.save
					return id
				}),
			)
		}
		// Markdown themes import as written; ZIP themes become Markdown with
		// their fonts and images embedded.
		function upload(file: File) {
			return Effect.gen(function* () {
				let markdown = /\.(md|markdown)$/i.test(file.name)
				let source = markdown
					? yield* Effect.tryPromise(() => file.text())
					: themeFromArchive(
							yield* Effect.tryPromise({
								try: async () =>
									unzip(new Uint8Array(await file.arrayBuffer())),
								catch: error =>
									new ThemeUploadInvalid({
										message: "This ZIP file could not be opened",
										errors: [
											error instanceof Error ? error.message : String(error),
										],
									}),
							}),
						)
				if (!source)
					return yield* new ThemeUploadInvalid({
						message: "This ZIP file does not contain a theme",
						errors: [],
					})
				return yield* create(
					source,
					file.name.replace(/(\.theme)?\.(md|markdown|zip)$/i, ""),
				)
			})
		}
		function remove(id: string) {
			return Effect.scoped(
				Effect.gen(function* () {
					let documentId = preferences.state.current().value.themeLibrary
					if (!documentId) return
					let document = yield* library.open(documentId)
					yield* document.session.change("Delete theme", staged => [
						staged.set(id, "type", "deleted"),
					])
					yield* document.session.save
					let editor = preferences.state.current().value.editor
					let defaults = {
						...(editor.previewTheme === id ? { previewTheme: "" } : {}),
						...(editor.slideshowTheme === id ? { slideshowTheme: "" } : {}),
					}
					if (Object.keys(defaults).length)
						yield* preferences.save({ editor: defaults })
				}),
			)
		}
	})
}
