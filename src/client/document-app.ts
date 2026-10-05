import { bootMarkup } from "./components/boot"
import { makeSaveFeedback, saveIndicator } from "../shared/save-status"
import * as Cause from "effect/Cause"
import * as Crypto from "effect/Crypto"
import { webCryptoLayer } from "../platform/web-crypto"
import { documentAccessMarkup } from "./components/access"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FiberHandle from "effect/FiberHandle"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { AccountPreferencesSchema } from "../shared/preferences"
import * as Scope from "effect/Scope"
import * as Ref from "effect/Ref"
import * as Semaphore from "effect/Semaphore"
import * as Schedule from "effect/Schedule"
import * as Stream from "effect/Stream"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import type * as HttpClient from "effect/http/HttpClient"
import { TaskGroup } from "../platform/tasks"
import { formattingCommands } from "../shared/authoring"
import { blobContentType } from "../shared/document-blobs"
import { metadataSource } from "../shared/document-metadata"
import type { MetadataPatch } from "../shared/document-metadata"
import { folderPath } from "../shared/folders"
import { openContextMenu } from "./components/context-menu"
import type { MenuEntry } from "./components/context-menu"
import { PermissionDenied } from "../shared/document-actions"
import {
	compileTheme,
	frontmatter,
	safeUrl,
	withFrontmatter,
} from "../shared/markdown"
import type { DocumentRecord } from "../shared/model"
import { BrowserPreferences } from "./browser-preferences"
import { SettingsPageElement } from "./components/settings-page"
import { openLibraryWorkbench } from "./components/settings-themes"
import { WorkspaceSettingsElement } from "./components/workspace-settings"
import { BrowserAccount } from "./browser-account"
import { DocumentLive } from "./document-live"
import { BrowserLibrary } from "./browser-library"
import {
	isLocalWorkspace,
	LocalDirectories,
	openedFiles,
} from "./local-directories"
import { mountEditor } from "./components/editor"
import { commentsMarkup } from "./components/comments"
import { attachmentsMarkup } from "./components/attachments"
import { makeDocumentMediaView } from "./document-media-view"
import { loadDocumentHistory } from "./document-history"
import { duplicateDocumentVersion } from "./document-duplicate"
import { parseInvitationLink } from "../shared/invitations"
import { publicMember } from "../shared/workspace"
import { routeHref } from "../shared/routes"
import type { AppRoute, SettingsCategory } from "../shared/routes"
import { startRouter } from "./router"
import { watchUpdates } from "./updates"
import { UpdateBannerElement } from "./components/update-banner"
import { pickerMarkup, WorkspaceMenuElement } from "./components/menu"
import type { MenuChoice } from "./components/menu"
import type { InvitationTarget } from "./invitations"
import { restoreDocumentState } from "../shared/document-history"
import { mountDocumentHistory } from "./components/history"
import type { AttachmentSelection } from "./document-assets"
import { prepareAttachment } from "./document-upload"
import {
	confirmDialog,
	field,
	openDialog,
	mediaPreviewDialog,
	promptDialog,
} from "./components/dialog"
import { openFind } from "./components/find"
import { openHelp } from "./components/help"
import { openPalette } from "./components/palette"
import { libraryMarkup, updateLibrary } from "./components/library"
import type { DocumentSummary } from "./components/library"
import { mountPresentation } from "./components/presentation"
import {
	clearPreviewSelection,
	disposePreview,
	previewCommentSelection,
	previewMarkup,
	renderPreview,
} from "./components/preview"
import { clearDocument } from "./components/document-renderer"
import { printDocument } from "./components/print"
import { StatsElement, statusbarMarkup } from "./components/statusbar"
import { toast, ToasterElement } from "./components/toast"
import { toolbarMarkup } from "./components/toolbar"
import { button, element, setMarkup, updateMarkup } from "./dom"
import { html, joinMarkup, setLanguage, translate } from "./language"
import type { Markup } from "./language"
import { icon } from "./icons"
import { fetchResponse } from "../platform/http"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import type { IconName } from "./icons"
import { BrowserStorage } from "./storage"
import { actionShortcutLabel, shortcutAction } from "./shortcuts"
import { ThemeLibrary } from "./theme-library"
import { libraryThemes, resolveTheme } from "../shared/theme-library"

type Mode = "edit" | "preview" | "slideshow" | "teleprompter" | "history"
// Chromium's install prompt, which the standard DOM types do not describe.
interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<unknown>
}
declare global {
	interface WindowEventMap {
		beforeinstallprompt: BeforeInstallPromptEvent
	}
}
type OpenDocument = Effect.Success<
	ReturnType<Context.Service.Shape<typeof BrowserLibrary>["open"]>
>
interface Selection {
	document: string
	scope: Scope.Closeable
	opened: OpenDocument
	tasks: TaskGroup
	media: Effect.Success<ReturnType<typeof makeDocumentMediaView>>
}

let storage = BrowserStorage.layer
let account = BrowserAccount.layer(location.origin).pipe(
	Layer.provideMerge(storage),
	Layer.provide(FetchHttpClient.layer),
)
let live = DocumentLive.layer.pipe(Layer.provideMerge(account))
let folders = LocalDirectories.layer.pipe(Layer.provideMerge(live))
let library = BrowserLibrary.layer.pipe(Layer.provideMerge(folders))
let preferences = BrowserPreferences.layer.pipe(Layer.provideMerge(library))
let themes = ThemeLibrary.layer.pipe(Layer.provideMerge(preferences))
let application = Layer.effectDiscard(mountApplication()).pipe(
	Layer.provide(themes),
	Layer.provide(FetchHttpClient.layer),
	Layer.provide(webCryptoLayer),
)
class ApplicationElement extends HTMLElement {
	private lifetime: Fiber.Fiber<void, never> | undefined
	connectedCallback() {
		if (this.lifetime) return
		this.lifetime = Effect.runFork(
			Layer.launch(application).pipe(
				Effect.catchCause(cause =>
					Effect.sync(() => {
						this.removeAttribute("aria-busy")
						this.setAttribute("role", "alert")
						this.textContent =
							"Could not open your workspace. " + String(Cause.squash(cause))
					}),
				),
			),
		)
	}
	disconnectedCallback() {
		let lifetime = this.lifetime
		if (!lifetime) return
		this.lifetime = undefined
		Effect.runFork(Fiber.interrupt(lifetime))
	}
	connectedMoveCallback() {}
}
customElements.define("alkalye-app", ApplicationElement)
window.addEventListener("pagehide", event => {
	let app = document.querySelector("alkalye-app")
	if (!event.persisted && app instanceof ApplicationElement)
		app.disconnectedCallback()
})

function mountApplication() {
	return Effect.gen(function* () {
		let random = yield* Crypto.Crypto
		let library = yield* BrowserLibrary
		let preferences = yield* BrowserPreferences
		let themeLibrary = yield* ThemeLibrary
		let account = yield* BrowserAccount
		let storage = yield* BrowserStorage
		let parent = yield* Scope.Scope
		let tasks = yield* TaskGroup.make
		let selecting = yield* Semaphore.make(1)
		let acquiring = yield* FiberHandle.make<OpenDocument, unknown>()
		let mediaPreview = yield* FiberHandle.make<void, unknown>()
		let requests = yield* Ref.make(0)
		let selection: Selection | undefined
		let undoWaiting = new WeakSet<Selection>()
		let mounted: Selection | undefined
		let switching = false
		let opening = true
		let mode: Mode = "edit"
		// The last document or library address, where Settings returns to.
		let place = "/app"
		function here() {
			let route = router.current()
			if (route.kind === "library" || route.kind === "document")
				place = routeHref(route)
			return place
		}
		let page: HTMLElement | undefined
		let installPrompt: BeforeInstallPromptEvent | undefined
		let panel: "tools" | "comments" = "tools"
		let dialogOwner: Selection | undefined
		let dialogElement = element("#dialog")
		if (!(dialogElement instanceof HTMLDialogElement))
			return yield* Effect.die("Missing document dialog")
		let dialog = dialogElement
		let filter = ""
		let showArchive = false
		let showTrash = false
		let pointer = { x: -1, y: -1, time: 0 }
		let folders = true
		let collapsed = new Set<string>()
		let slideIndex = 0
		let workspace = ""
		let fileTarget:
			{ selected: Selection; captured?: AttachmentSelection } | undefined
		let editor: ReturnType<typeof mountEditor> | undefined
		let presentation: ReturnType<typeof mountPresentation> | undefined
		let selectedComment: string | undefined
		let app = element("#app")
		let archives = Effect.tryPromise(() => import("./document-archives"))
		setLanguage(preferences.state.current().value.language)
		setMarkup(
			app,
			html`${libraryMarkup(preferences.state.current().value.name, "")}
				<div data-app class="workspace">
					${toolbarMarkup()}
					<div data-find id="find-bar" hidden></div>
					<main id="main">${bootMarkup()}</main>
					${statusbarMarkup()}
				</div>
				<aside data-inspector class="inspector" aria-label="Document tools">
					<div class="inspector-title">
						<strong>Document</strong
						>${button("appearance", "Appearance", icon("sun-moon"))}${button("settings", "Settings", icon("settings"))}
					</div>
					<header>
						<button data-action="tools">Tools</button
						><button data-action="comments">Comments</button>
					</header>
					<div id="inspector-body"></div>
					<footer>
						${button("help", "Help", html`${icon("circle-help")}<span>Help</span>`)}
					</footer>
				</aside>
				<input id="asset-files" type="file" multiple hidden /><input
					id="import-files"
					type="file"
					accept=".md,.markdown,.txt,.zip,.json,.tldr,text/markdown,text/plain,application/zip"
					multiple
					hidden
				/>`,
		)
		let saveFeedback = yield* makeSaveFeedback(indicator => {
			let hint = element("#save-status")
			hint.textContent = translate(indicator.text)
			hint.dataset.state = indicator.state
			hint.toggleAttribute("data-quiet", indicator.state === "quiet")
			hint.setAttribute(
				"role",
				indicator.state === "error" ? "alert" : "presentation",
			)
		})
		app.dataset.documentApp = ""
		let enabled = new Set([
			"retry-save",
			"new",
			"new-workspace",
			"manage-workspace",
			"share",
			"new-whiteboard",
			"history",
			"theme",
			"library",
			"preview",
			"focus",
			"toggle-tools",
			"tools",
			"comments",
			"asset",
			"archive-toggle",
			"folders",
			"help",
			"settings",
			"properties",
			"duplicate",
			"import",
			"export-all",
			"library-menu",
			"profile-menu",
			"appearance-light",
			"appearance-dark",
			"appearance-system",
			"language-en",
			"language-de",
			"language-system",
			"open-file",
			"open-folder",
			"sign-in",
			"sign-out",
			"library-options",
			"syntax-theme",
			"appearance",
			"trash-toggle",
			...formattingCommands,
		])
		for (let control of app.querySelectorAll<HTMLButtonElement>(
			"[data-action]",
		))
			if (!enabled.has(control.dataset.action ?? "")) control.hidden = true
		let workspaceMenu = app.querySelector("alkalye-workspace-menu")
		if (!(workspaceMenu instanceof WorkspaceMenuElement))
			return yield* Effect.die("Missing workspace menu")
		let workspaces = workspaceMenu
		element(".library-menu").insertAdjacentHTML(
			"beforeend",
			String(
				html`${button("open-file", "Open a Markdown file on this device", html`${icon("file-text")}<span>Open file</span>`)}${button("open-folder", "Open a folder on this device", html`${icon("folder-open")}<span>Open folder</span>`)}${button("settings", "Settings", html`${icon("settings")}<span>Settings</span>`)}${button("help", "Help", html`${icon("circle-help")}<span>Help</span>`)}`,
			),
		)
		// Sidebars start closed, as in the original; the choice persists per device.
		let layout = readLayout()
		app.classList.toggle("library-open", layout.library)
		app.classList.toggle("tools-open", layout.tools)
		let events = new AbortController()
		dialog.addEventListener(
			"close",
			() => {
				selection?.media.visible(mode !== "edit" && mode !== "history")
				launch(announce())
			},
			{ signal: events.signal },
		)
		let importInput = element("#import-files")
		if (!(importInput instanceof HTMLInputElement))
			return yield* Effect.die("Missing import picker")
		importInput.addEventListener(
			"change",
			() => {
				let files = [...(importInput.files ?? [])]
				let destination = workspace || undefined
				importInput.value = ""
				launch(
					Effect.gen(function* () {
						let { importFiles } = yield* archives
						let created = yield* importFiles(library, files, {
							workspace: destination,
							importTheme,
						})
						if (created[0]) yield* open(created[0])
						if (created.length)
							toast(
								created.length === 1
									? "Imported 1 document"
									: "Imported " + created.length + " documents",
							)
					}).pipe(Effect.provideService(Crypto.Crypto, random)),
				)
			},
			{ signal: events.signal },
		)
		let assetInput = element("#asset-files")
		if (!(assetInput instanceof HTMLInputElement))
			return yield* Effect.die("Missing attachment picker")
		assetInput.addEventListener(
			"change",
			() => {
				let target = fileTarget
				fileTarget = undefined
				let files = [...(assetInput.files ?? [])]
				assetInput.value = ""
				if (target && selection === target.selected && writable())
					attachFiles(target.selected, files, target.captured)
			},
			{ signal: events.signal },
		)
		assetInput.addEventListener(
			"cancel",
			() => {
				fileTarget = undefined
			},
			{ signal: events.signal },
		)
		element("#main").addEventListener(
			"dragover",
			event => {
				if (event.dataTransfer?.types.includes("Files")) event.preventDefault()
			},
			{ signal: events.signal },
		)
		element("#main").addEventListener(
			"drop",
			event => {
				if (!event.dataTransfer?.files.length) return
				event.preventDefault()
				if (selection && writable())
					attachFiles(
						selection,
						[...event.dataTransfer.files],
						editor?.attachmentSelection(),
					)
			},
			{ signal: events.signal },
		)
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				events.abort()
				let preview = app.querySelector<HTMLElement>("#preview")
				if (preview) disposePreview(preview)
				presentation?.dispose()
			}),
		)
		app.addEventListener(
			"click",
			event => {
				if (!(event.target instanceof Element)) return
				let doc = event.target.closest<HTMLElement>("[data-doc]")?.dataset.doc
				if (
					matchMedia("(max-width: 1100px)").matches &&
					(doc ||
						!event.target.closest(
							"[data-library], [data-inspector], [data-toolbar], .preview-header",
						))
				) {
					setLayout("library", false)
					setLayout("tools", false)
				}
				if (doc) {
					launch(open(doc))
					return
				}
				let choice = event.target.closest<HTMLElement>("[data-library-filter]")
				if (choice) {
					for (let item of app.querySelectorAll<HTMLElement>(
						"[data-library-filter]",
					))
						if (item.dataset.libraryFilter === choice.dataset.libraryFilter)
							item.setAttribute("aria-checked", String(item === choice))
					refreshLibrary()
					return
				}
				let action =
					event.target.closest<HTMLElement>("[data-action]")?.dataset.action
				if (action) launch(act(action))
			},
			{ signal: events.signal },
		)
		app.addEventListener(
			"contextmenu",
			event => {
				if (!(event.target instanceof Element)) return
				let id = event.target.closest<HTMLElement>("[data-doc]")?.dataset.doc
				if (!id) return
				let doc = library.state
					.current()
					.library.documents.find(doc => doc.document === id)
				if (!doc) return
				let invitations: MenuEntry[] = isLocalWorkspace(doc.workspace)
					? []
					: [
							{
								label: "Invite collaborators",
								icon: "users",
								disabled: doc.owner !== account.subject,
								run: () =>
									launch(
										open(id).pipe(
											Effect.andThen(() =>
												selection?.document === id ? act("share") : Effect.void,
											),
										),
									),
							},
						]
				openContextMenu(event, [
					{
						label: "Open document",
						icon: "file-text",
						run: () => launch(open(id)),
					},
					...invitations,
					{
						label: "Document properties",
						icon: "pencil",
						disabled: doc.role === "reader",
						run: () => launch(open(id).pipe(Effect.andThen(act("properties")))),
					},
					{
						label: "Duplicate document",
						icon: "copy",
						run: () => launch(open(id).pipe(Effect.andThen(act("duplicate")))),
					},
					{
						label: doc.metadata.pinned ? "Unpin document" : "Pin document",
						icon: doc.metadata.pinned ? "pin-off" : "pin",
						disabled: doc.role === "reader",
						run: () => launch(open(id).pipe(Effect.andThen(act("pin")))),
					},
					{
						label: doc.metadata.archived
							? "Restore document"
							: "Archive document",
						icon: "archive",
						disabled: doc.role === "reader",
						run: () => launch(open(id).pipe(Effect.andThen(act("archive")))),
					},
					{
						label: "Export document",
						icon: "download",
						run: () => launch(open(id).pipe(Effect.andThen(act("download")))),
					},
					{
						label: "Time machine",
						icon: "history",
						run: () => launch(open(id).pipe(Effect.andThen(act("history")))),
					},
				])
			},
			{ signal: events.signal },
		)
		element("#search").addEventListener(
			"input",
			event => {
				if (event.target instanceof HTMLInputElement) {
					filter = event.target.value
					refreshLibrary()
				}
			},
			{ signal: events.signal },
		)
		workspaces.addEventListener(
			"change",
			() => {
				workspace = workspaces.value
				refreshLibrary()
				router.record(
					selection
						? documentRoute(selection.document)
						: { kind: "library", ...(workspace ? { workspace } : {}) },
					{ replace: true },
				)
			},
			{ signal: events.signal },
		)
		window.addEventListener(
			"beforeinstallprompt",
			event => {
				event.preventDefault()
				installPrompt = event
			},
			{ signal: events.signal },
		)

		let stats = app.querySelector("alkalye-stats")
		if (stats instanceof StatsElement)
			stats.addEventListener(
				"change",
				() => {
					launch(preferences.save({ editor: { statsUnit: stats.value } }))
					if (stats.value === "hidden") editor?.source?.focus()
				},
				{ signal: events.signal },
			)
		let router = startRouter(events.signal, route => show(route))
		window.addEventListener(
			"keydown",
			event => {
				if (event.defaultPrevented || dialog.open || page) return
				let action = shortcutAction(event)
				if (
					(action === "undo" || action === "redo") &&
					event.target instanceof HTMLInputElement
				)
					return
				if (
					action &&
					formattingCommands.includes(action) &&
					event.target instanceof Element &&
					event.target.closest("alkalye-find")
				)
					return
				if (action) {
					event.preventDefault()
					launch(act(action))
					return
				}
				if (event.key === "Escape" && mode !== "edit") {
					event.preventDefault()
					if (mode === "preview") {
						if (app.classList.contains("focus-mode")) {
							app.classList.remove("focus-mode")
							return
						}
						selectedComment = undefined
						clearPreviewSelection(element("#preview"))
						refreshDocument()
					} else if (document.fullscreenElement) {
						launch(Effect.tryPromise(() => document.exitFullscreen()))
					} else if (mode === "history" || writable()) changeMode("edit")
				} else if (
					(mode === "slideshow" || mode === "teleprompter") &&
					["ArrowRight", "ArrowLeft", "PageDown", "PageUp"].includes(event.key)
				) {
					event.preventDefault()
					presentation?.change(
						event.key === "ArrowLeft" || event.key === "PageUp" ? -1 : 1,
					)
				}
			},
			{ signal: events.signal },
		)
		yield* library.state.changes.pipe(
			Stream.runForEach(() =>
				Effect.sync(() => {
					refreshLibrary()
					refreshSafely()
				}),
			),
			Effect.forkScoped({ startImmediately: true }),
		)
		let appearance = matchMedia("(prefers-color-scheme: dark)")
		function applyPreferences() {
			let value = preferences.state.current().value
			let root = document.documentElement
			root.dataset.appearance =
				value.appearance === "system"
					? appearance.matches
						? "dark"
						: "light"
					: value.appearance
			root.style.setProperty("--editor-width", `${value.editor.lineWidth}ch`)
			root.style.setProperty(
				"--editor-letter-spacing",
				`${value.editor.letterSpacing}em`,
			)
			root.style.setProperty(
				"--editor-line-height",
				String(value.editor.lineHeight),
			)
			root.style.setProperty("--editor-size", `${value.fontSize}px`)
			for (let choice of app.querySelectorAll<HTMLElement>(
				"#profile-appearance [data-action], #profile-language [data-action]",
			)) {
				choice.setAttribute(
					"aria-checked",
					String(
						choice.dataset.action === "appearance-" + value.appearance ||
							choice.dataset.action === "language-" + value.language,
					),
				)
			}
			setLanguage(value.language)
			for (let label of app.querySelectorAll<HTMLElement>(
				"[data-profile-label]",
			))
				label.textContent = translate(label.dataset.profileLabel ?? "")
			for (let menu of app.querySelectorAll<HTMLElement>(
				"[data-profile-menu-label]",
			))
				menu.setAttribute(
					"aria-label",
					translate(menu.dataset.profileMenuLabel ?? ""),
				)
			editor?.preferences(value.editor)
			let label = app.querySelector(".profile-name")?.firstChild
			if (label instanceof Text) label.textContent = value.name
			refreshSafely()
		}
		yield* preferences.state.changes.pipe(
			Stream.map(state => state.value),
			Stream.changesWith(Schema.toEquivalence(AccountPreferencesSchema)),
			Stream.runForEach(() => Effect.sync(applyPreferences)),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* Stream.fromEventListener(appearance, "change").pipe(
			Stream.runForEach(() => Effect.sync(applyPreferences)),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* account.state.changes.pipe(
			Stream.runForEach(() => Effect.sync(refreshSafely)),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* themeLibrary.state.changes.pipe(
			Stream.runForEach(() => Effect.sync(refreshSafely)),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* library.live.presence.changes.pipe(
			Stream.runForEach(() =>
				Effect.sync(() => {
					let people = library.live.presence.current(selection?.document ?? "")
					editor?.presence(people)
					presentation?.presence()
					element("#presence").textContent = people.length
						? "Editing with " +
							people
								.map(person => (person.own ? "your other device" : person.name))
								.join(" · ")
						: ""
				}),
			),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* Stream.fromSchedule(Schedule.spaced("3 seconds")).pipe(
			Stream.runForEach(() =>
				library.live.connected() ? announce() : Effect.void,
			),
			Effect.forkScoped({ startImmediately: true }),
		)
		refreshLibrary()
		let remembered = yield* storage.get("native-selected:" + account.subject)
		let start = router.current()
		let inviting = start.kind === "invitation"
		if (start.kind === "document") {
			mode = start.mode
			workspace = start.workspace ?? ""
		}
		if (start.kind === "library" || start.kind === "workspaceSettings")
			workspace = start.workspace ?? ""
		if (start.kind === "unknown")
			router.record({ kind: "library" }, { replace: true })
		refreshLibrary()
		let initial =
			start.kind === "document"
				? start.document
				: inviting ||
					  start.kind === "share" ||
					  // A workspace's address shows that workspace, not the
					  // document last open somewhere else.
					  (start.kind === "library" && start.workspace)
					? ""
					: typeof remembered === "string"
						? remembered
						: ""
		if (inviting) launch(showInvitation())
		if (start.kind === "share") launch(receiveShare(start))
		if (start.kind === "settings" || start.kind === "workspaceSettings")
			launch(showPage(start))
		// Opening Markdown files with the installed app lands here.
		window.launchQueue?.setConsumer(parameters => {
			for (let handle of parameters.files)
				if (handle instanceof FileSystemFileHandle)
					launch(
						library.folders.openFile(handle).pipe(
							Effect.tap(() =>
								Effect.sync(() => {
									workspace = openedFiles
									refreshLibrary()
								}),
							),
							Effect.flatMap(document => open(document)),
						),
					)
		})
		if (initial)
			launch(
				open(
					initial,
					start.kind === "settings" || start.kind === "workspaceSettings"
						? "none"
						: "replace",
				).pipe(Effect.ensuring(Effect.sync(finishOpening))),
			)
		else if (!inviting && start.kind !== "share")
			launch(welcome().pipe(Effect.ensuring(Effect.sync(finishOpening))))
		else finishOpening()
		if ("serviceWorker" in navigator)
			launch(
				watchUpdates(events.signal, apply => {
					let banner = new UpdateBannerElement()
					// Reloading flushes the open document's last edits first.
					banner.offer(() =>
						launch(
							(selection?.opened.session.flush ?? Effect.void).pipe(
								Effect.andThen(Effect.sync(apply)),
								Effect.onError(() => Effect.sync(() => banner.enableReload())),
							),
						),
					)
					let notifications = element("#toast")
					if (notifications instanceof ToasterElement) {
						let dismiss = notifications.showContent(banner, true)
						events.signal.addEventListener("abort", () => dismiss?.(), {
							once: true,
						})
					}
				}),
			)
		function finishOpening() {
			if (!opening) return
			opening = false
			if (!selection) mountDocument()
			launch(
				Effect.tryPromise(async () => {
					await Promise.allSettled([
						document.fonts.load("14px Geist"),
						document.fonts.load('18px "Geist Mono"'),
					])
					await document.fonts.ready
				}).pipe(
					Effect.ensuring(Effect.sync(() => app.removeAttribute("aria-busy"))),
				),
			)
		}
		function launch<A, E>(
			work: Effect.Effect<A, E, Scope.Scope | HttpClient.HttpClient>,
		) {
			tasks.fork(
				work.pipe(
					Effect.catchCause(cause =>
						Cause.hasFails(cause) || Cause.hasDies(cause)
							? Effect.sync(() => report(Cause.squash(cause)))
							: Effect.void,
					),
				),
			)
		}
		// A new account starts with the welcome document, as in the original.
		function welcome() {
			return Effect.gen(function* () {
				let key = "welcomed:" + account.subject
				if (yield* storage.get(key)) return
				yield* library.refresh
				let state = library.state.current()
				if (state.refresh === "failed") return
				if (
					state.library.documents.some(
						entry => !entry.deleted && !isLocalWorkspace(entry.workspace),
					)
				)
					return yield* storage.set(key, true)
				let response = yield* fetchResponse("/docs/welcome.md").pipe(
					Effect.flatMap(HttpClientResponse.filterStatusOk),
				)
				let document = yield* library.create(yield* response.text)
				yield* storage.set(key, true)
				// Only open it if the person has not already chosen something.
				if (
					Ref.getUnsafe(requests) === 0 &&
					router.current().kind === "library"
				)
					yield* open(document, "replace")
			})
		}
		function showInvitation() {
			return Effect.gen(function* () {
				let { mountInvitationScreen } = yield* Effect.tryPromise(
					() => import("./components/invitation-screen"),
				)
				let link = parseInvitationLink(location.hash)
				let request = yield* random.randomUUIDv4
				mountInvitationScreen(element("#main"), {
					name: () => preferences.state.current().value.name,
					describe: link
						? account.request(
								account.api.invitations.describe({
									params: { invitation: link.invitation },
									payload: { secret: link.secret },
								}),
							)
						: Effect.fail(new Error("This invitation link is incomplete")),
					accept: link
						? account.request(
								account.api.invitations.accept({
									params: { invitation: link.invitation },
									payload: { secret: link.secret, request },
								}),
							)
						: Effect.fail(new Error("This invitation link is incomplete")),
					switchAccount: account.switchAccount,
					accepted: acceptance =>
						library.refresh.pipe(
							Effect.andThen(
								Effect.sync(() => {
									workspace = acceptance.document ? "" : acceptance.workspace
									refreshLibrary()
									if (acceptance.document)
										launch(open(acceptance.document, "replace"))
									else {
										router.record(
											{ kind: "library", workspace: acceptance.workspace },
											{ replace: true },
										)
										mountDocument()
									}
								}),
							),
						),
				})
			})
		}
		// A document's address names the chosen workspace only when the
		// document belongs to it, as /app/spaces/<space>/doc/<document>.
		function documentRoute(
			document: string,
		): Extract<AppRoute, { kind: "document" }> {
			let inside =
				workspace &&
				!isLocalWorkspace(workspace) &&
				library.state
					.current()
					.library.documents.some(
						entry =>
							entry.document === document && entry.workspace === workspace,
					)
			return {
				kind: "document",
				document,
				mode,
				...(inside ? { workspace } : {}),
			}
		}
		function presenting() {
			let doc = currentDocument()
			return Boolean(doc && frontmatter(doc.content).values.mode === "present")
		}
		// Mode changes are history entries, so Back leaves a slideshow.
		function changeMode(next: Mode, replace = false) {
			if ((next === "slideshow" || next === "teleprompter") && !presenting())
				return
			mode = next
			mountDocument()
			if (selection)
				router.record(documentRoute(selection.document), { replace })
		}
		// Back, forward and in-app links arrive here with the route to show.
		function show(route: AppRoute) {
			if (route.kind === "settings" || route.kind === "workspaceSettings")
				return launch(showPage(route))
			closePage()
			if (route.kind === "invitation") return launch(showInvitation())
			if (route.kind === "share") return launch(receiveShare(route))
			if (route.kind === "unknown") return
			let target = route.workspace
			if (target !== undefined && target !== workspace) {
				workspace = target
				refreshLibrary()
			}
			if (route.kind === "library") {
				if (selection) launch(closeSelection(selection))
				return
			}
			if (selection?.document === route.document) {
				if (mode !== route.mode) {
					mode = route.mode
					mountDocument()
				}
				return
			}
			mode = route.mode
			launch(open(route.document, "none"))
		}
		// Text shared from another app becomes a new document.
		function receiveShare(route: Extract<AppRoute, { kind: "share" }>) {
			return library
				.create(
					metadataSource(route.text, {
						title: route.title || translate("Shared note"),
					}),
					workspace && !isLocalWorkspace(workspace) ? workspace : undefined,
				)
				.pipe(Effect.flatMap(id => open(id, "replace")))
		}
		function closePage() {
			if (!page) return
			page.remove()
			page = undefined
			element("#main").removeAttribute("inert")
		}
		// Settings pages cover the app; the document underneath stays open so
		// returning is instant.
		function showPage(
			route: Extract<AppRoute, { kind: "settings" | "workspaceSettings" }>,
		) {
			return Effect.gen(function* () {
				if (dialog.open) dialog.close()
				if (route.kind === "settings") {
					let current =
						page instanceof SettingsPageElement
							? page
							: new SettingsPageElement()
					current.configure({
						category: route.category,
						...(route.oauth ? { oauth: route.oauth } : {}),
						back: route.from ?? place,
						workspace,
						preferences,
						account,
						library,
						themes: themeLibrary,
						prepareRestore: selection?.opened.session.flush ?? Effect.void,
						choose: (category: SettingsCategory) =>
							router.go(
								{
									kind: "settings",
									category,
									...(route.from ? { from: route.from } : {}),
								},
								{ replace: true },
							),
						backup: () => launch(act("export-all")),
						importFiles: () => importInput.click(),
						install: installPrompt
							? () => {
									let prompt = installPrompt
									installPrompt = undefined
									return prompt?.prompt() ?? Promise.resolve()
								}
							: undefined,
						report,
					})
					mountPage(current)
					return
				}
				let id = route.workspace
				let local = isLocalWorkspace(id)
					? library.folders.current().find(directory => directory.id === id)
					: undefined
				let current = new WorkspaceSettingsElement()
				current.configure({
					workspace: id,
					back: place,
					subject: account.subject,
					personal: id === "personal-" + account.subject,
					...(local
						? {
								local: {
									name: local.name,
									files: local.files.length,
									...(local.message ? { message: local.message } : {}),
									refresh: library.folders.reconnect(id),
									forget: library.folders.forget(id).pipe(
										Effect.andThen(
											Effect.sync(() => {
												workspace = ""
												refreshLibrary()
												router.go({ kind: "library" }, { replace: true })
											}),
										),
									),
								},
							}
						: {}),
					changes: library.live.changes.pipe(
						Stream.filter(
							message =>
								message.type === "advanced" || message.type === "connected",
						),
						Stream.buffer({ capacity: 1, strategy: "sliding" }),
					),
					load: account.request(
						account.api.workspaces.snapshot({ params: { workspace: id } }),
					),
					avatar: image =>
						random.randomUUIDv4.pipe(
							Effect.flatMap(request =>
								account.request(
									account.api.workspaces.avatar({
										params: { workspace: id },
										payload: { request, image },
									}),
								),
							),
							Effect.andThen(library.refresh),
						),
					rename: name =>
						random.randomUUIDv4.pipe(
							Effect.flatMap(request =>
								account.request(
									account.api.workspaces.rename({
										params: { workspace: id },
										payload: { request, name },
									}),
								),
							),
							Effect.andThen(library.refresh),
							Effect.andThen(
								Effect.sync(() => toast(translate("Workspace renamed"))),
							),
						),
					member: (member, role) =>
						random.randomUUIDv4.pipe(
							Effect.flatMap(request =>
								account.request(
									account.api.workspaces.membership({
										params: { workspace: id, member },
										payload: { request, role },
									}),
								),
							),
							Effect.andThen(library.refresh),
						),
					leave: random.randomUUIDv4.pipe(
						Effect.flatMap(request =>
							account.request(
								account.api.invitations.leaveTarget({
									payload: { target: { workspace: id }, request },
								}),
							),
						),
						Effect.flatMap(left =>
							left
								? library.refresh.pipe(
										Effect.andThen(
											Effect.sync(() => {
												workspace = ""
												refreshLibrary()
												router.go({ kind: "library" }, { replace: true })
											}),
										),
									)
								: Effect.sync(() =>
										report(
											"Your access was granted directly; ask the owner to remove it",
										),
									),
						),
					),
					remove: name => {
						let request = Effect.runSync(random.randomUUIDv4)
						return account
							.request(
								account.api.workspaces.remove({
									params: { workspace: id },
									payload: { name, request },
								}),
							)
							.pipe(
								Effect.andThen(library.refresh),
								Effect.andThen(
									Effect.sync(() => {
										workspace = ""
										refreshLibrary()
										router.go({ kind: "library" }, { replace: true })
										toast(translate("Workspace deleted"))
									}),
								),
							)
					},
					invitations: invitationPanel({ workspace: id }),
					report,
				})
				mountPage(current)
			})
		}
		function mountPage(next: HTMLElement) {
			if (page !== next) {
				page?.remove()
				page = next
				document.body.append(next)
			}
			element("#main").setAttribute("inert", "")
			next.querySelector<HTMLElement>("h1")?.focus()
		}
		function invitationPanel(target: InvitationTarget) {
			return Effect.gen(function* () {
				let [{ invitationsElement }, { invitationController }] =
					yield* Effect.all([
						Effect.tryPromise(() => import("./components/invitations")),
						Effect.tryPromise(() => import("./invitations")),
					])
				return invitationsElement(
					invitationController(account, target, random, report),
				)
			})
		}
		// Opening records the document's address unless the caller is showing
		// another page above it, such as Settings.
		function open(
			document: string,
			history: "push" | "replace" | "none" = "push",
		) {
			return Effect.gen(function* () {
				let request = yield* Ref.updateAndGet(requests, request => request + 1)
				return yield* Effect.gen(function* () {
					if (selection?.document === document) {
						yield* FiberHandle.clear(acquiring)
						if (history !== "none") {
							closePage()
							router.record(documentRoute(document), { replace: true })
						}
						return
					}
					let scope = yield* Scope.fork(parent, "sequential")
					let opened = yield* FiberHandle.run(
						acquiring,
						library
							.open(document)
							.pipe(Effect.provideService(Scope.Scope, scope)),
					).pipe(
						Effect.flatMap(Fiber.join),
						Effect.onError(() => Scope.close(scope, Exit.void)),
					)
					yield* selecting.withPermit(
						Effect.gen(function* () {
							if (request !== Ref.getUnsafe(requests))
								return yield* Scope.close(scope, Exit.void)
							let previous = selection
							let committed = false
							switching = true
							refreshSafely()
							yield* Effect.gen(function* () {
								if (selection) {
									yield* selection.opened.session.flush
									if (
										selection.opened.session.unsaved() ||
										selection.opened.session.failures.current().save
									)
										return yield* Effect.fail(
											new Error("Save this document before opening another"),
										)
								}
								yield* Effect.uninterruptible(
									Effect.gen(function* () {
										let selectedTasks = yield* TaskGroup.make.pipe(
											Effect.provideService(Scope.Scope, scope),
										)
										let adopted: Selection | undefined
										let media = yield* makeDocumentMediaView({
											media: opened.media,
											source: () => opened.session.replica.text(document),
											changed: () => {
												if (
													adopted &&
													selection === adopted &&
													mounted === adopted
												)
													refreshDocument()
											},
											clear: () => {
												if (
													adopted &&
													selection === adopted &&
													mode !== "edit"
												) {
													for (let host of element(
														"#main",
													).querySelectorAll<HTMLElement>(
														"[data-document-renderer]",
													))
														clearDocument(host)
												}
											},
											report,
										}).pipe(Effect.provideService(Scope.Scope, scope))
										selection = {
											document,
											scope,
											opened,
											tasks: selectedTasks,
											media,
										}
										adopted = selection
										slideIndex = 0
										mountDocument()
										yield* Scope.addFinalizer(
											scope,
											Effect.sync(() => {
												if (dialogOwner === adopted) {
													dialog.close()
													dialogOwner = undefined
												}
											}),
										)
										yield* opened.session.changes.pipe(
											Stream.runForEach(() => Effect.sync(refreshSafely)),
											Effect.forkScoped({ startImmediately: true }),
											Effect.provideService(Scope.Scope, scope),
										)
										yield* opened.session.failures.changes.pipe(
											Stream.runForEach(() => Effect.sync(refreshSafely)),
											Effect.forkScoped({ startImmediately: true }),
											Effect.provideService(Scope.Scope, scope),
										)
										yield* opened.connection.changes.pipe(
											Stream.runForEach(() => Effect.sync(refreshSafely)),
											Effect.forkScoped({ startImmediately: true }),
											Effect.provideService(Scope.Scope, scope),
										)
										if (opened.localMedia)
											yield* opened.localMedia.changes.pipe(
												Stream.runForEach(() => Effect.sync(refreshSafely)),
												Effect.forkScoped({ startImmediately: true }),
												Effect.provideService(Scope.Scope, scope),
											)
										yield* Effect.try(() => {
											if (history === "none") return
											closePage()
											router.record(documentRoute(document), {
												replace: history === "replace",
											})
										}).pipe(
											Effect.catch(error =>
												Effect.try(() => {
													report(error)
													router.record(documentRoute(document), {
														replace: true,
													})
												}).pipe(
													Effect.catch(error =>
														Effect.sync(() => report(error)),
													),
												),
											),
										)
										if (previous)
											yield* Scope.close(previous.scope, Exit.void).pipe(
												Effect.catchCause(cause =>
													Effect.sync(() => report(Cause.squash(cause))),
												),
											)
										committed = true
									}),
								)
								yield* storage
									.set("native-selected:" + account.subject, document)
									.pipe(Effect.catch(error => Effect.sync(() => report(error))))
							}).pipe(
								Effect.onError(() =>
									Effect.gen(function* () {
										if (committed) return
										if (selection?.scope === scope) {
											selection = previous
											yield* Effect.sync(mountDocument).pipe(
												Effect.catchCause(cause =>
													Effect.sync(() => report(Cause.squash(cause))),
												),
											)
										}
										yield* Scope.close(scope, Exit.void)
									}),
								),
								Effect.ensuring(
									Effect.sync(() => {
										switching = false
										refreshSafely()
									}),
								),
							)
							refreshLibrary()
						}),
					)
				}).pipe(
					Effect.onError(() =>
						Effect.suspend(() => {
							if (request !== Ref.getUnsafe(requests)) return Effect.void
							let current = selection
							return current
								? Effect.try(() =>
										router.record(documentRoute(current.document), {
											replace: true,
										}),
									).pipe(
										Effect.catch(error => Effect.sync(() => report(error))),
									)
								: Effect.void
						}),
					),
				)
			})
		}
		function currentDocument(): DocumentRecord | undefined {
			let current = selection
			let workspace =
				library.state
					.current()
					.library.documents.find(doc => doc.document === current?.document)
					?.workspace ?? ""
			// A document in the trash still opens, read-only, so it can be restored.
			return current?.opened.session.replica
				.documents(workspace, true)
				.find(doc => doc.id === current.document)
		}
		function summaries(): DocumentSummary[] {
			let current = currentDocument()
			return library.state
				.current()
				.library.documents.filter(
					doc =>
						doc.deleted === showTrash &&
						doc.document !== preferences.state.current().value.themeLibrary,
				)
				.map(doc => {
					if (doc.document === current?.id)
						return {
							...current,
							// A folder document is listed by its file name and location.
							...(isLocalWorkspace(doc.workspace)
								? {
										room: doc.workspace,
										title: doc.metadata.title,
										folder: doc.metadata.path,
									}
								: {}),
							excerpt: frontmatter(current.content)
								.body.replace(/[#*`>\n]/g, " ")
								.trim()
								.slice(0, 72),
						}
					return {
						id: doc.document,
						room: doc.workspace,
						title: doc.metadata.title,
						folder: doc.metadata.path,
						archived: doc.metadata.archived,
						pinned: doc.metadata.pinned,
						tags: [...doc.metadata.tags],
						kind: doc.kind,
						created: doc.created,
						updated: doc.updated,
						excerpt: doc.excerpt,
					}
				})
		}
		function writable() {
			return !switching && Boolean(selection?.opened.canWrite())
		}

		function refreshLibrary() {
			let state = library.state.current()
			let catalogue = state.library
			workspaces.value = workspace
			workspaces.update(
				[
					{ value: "", label: translate("All documents"), icon: "list" },
					...catalogue.workspaces.map((space): MenuChoice => ({
						value: space.workspace,
						label:
							space.workspace === "personal-" + account.subject
								? translate("Personal")
								: space.name,
						icon:
							space.workspace === openedFiles
								? "file-text"
								: isLocalWorkspace(space.workspace)
									? "folder"
									: space.workspace === "personal-" + account.subject
										? "user"
										: "users",
						...(isLocalWorkspace(space.workspace) ||
						space.workspace === openedFiles ||
						space.workspace === "personal-" + account.subject
							? {}
							: {
									avatar: {
										name: space.name,
										...(space.avatar ? { image: space.avatar } : {}),
									},
								}),
					})),
				],
				[
					{
						action: "new-workspace",
						label: translate("New workspace"),
						icon: "plus",
					},
					{
						action: "open-folder",
						label: translate("Open folder"),
						icon: "folder-open",
					},
					{
						action: "open-file",
						label: translate("Open file"),
						icon: "file-text",
					},
				],
			)
			let order =
				app.querySelector<HTMLElement>(
					'[data-library-filter="order"][aria-checked="true"]',
				)?.dataset.value ?? "updated"
			let type =
				app.querySelector<HTMLElement>(
					'[data-library-filter="type"][aria-checked="true"]',
				)?.dataset.value ?? "all"
			updateLibrary(
				summaries().filter(doc =>
					workspace ? doc.room === workspace : !isLocalWorkspace(doc.room),
				),
				selection?.document ?? "",
				filter,
				showArchive && !showTrash,
				{
					order,
					folders: folders && !showTrash,
					collapsed,
					type,
					...(showTrash ? { label: "Trash" } : {}),
				},
			)
			let folder = library.folders
				.current()
				.find(directory => directory.id === workspace)
			let banner = element("#folder-status")
			banner.hidden = !folder || folder.status === "ready"
			updateMarkup(
				banner,
				folder && folder.status !== "ready"
					? html`<p>
								${
									folder.status === "scanning"
										? "Reading " + folder.name + "…"
										: (folder.message ?? "This folder needs attention")
								}
							</p>
							${
								folder.status === "scanning"
									? ""
									: button(
											"reconnect-folder",
											"Allow access to this folder",
											"Allow access",
										)
							}`
					: "",
			)
			element("#sync-status").textContent = state.cacheFailure
				? "Could not cache the library on this device"
				: state.refresh === "failed"
					? "Offline or disconnected"
					: "Synced to your account"
			let profile = app.querySelector<HTMLElement>(".profile")
			if (profile) {
				profile.toggleAttribute("data-offline", state.refresh === "failed")
				let avatar = profile.querySelector(".avatar")
				if (avatar)
					updateMarkup(
						avatar,
						icon(state.refresh === "failed" ? "cloud-off" : "cloud"),
					)
			}
		}
		function mountDocument() {
			let preview = app.querySelector<HTMLElement>("#preview")
			if (preview) disposePreview(preview)
			let stats = app.querySelector("alkalye-stats")
			if (stats instanceof StatsElement) stats.clear()
			launch(
				saveFeedback.update(currentDocument()?.id ?? "", {
					text: "Saved",
					state: "quiet",
				}),
			)
			let find = element("#find-bar")
			find.hidden = true
			find.replaceChildren()
			mounted = undefined
			presentation?.dispose()
			presentation = undefined
			editor = undefined
			app.classList.remove(
				"mode-edit",
				"mode-preview",
				"mode-slideshow",
				"mode-teleprompter",
				"mode-history",
			)
			let doc = currentDocument()
			app.toggleAttribute("data-document-ready", Boolean(doc))
			if ((mode === "slideshow" || mode === "teleprompter") && !presenting()) {
				mode = "edit"
				let route = router.current()
				if (
					route.kind === "document" &&
					(!selection || route.document === selection.document)
				)
					router.record({ ...route, mode }, { replace: true })
			}
			app.classList.add("mode-" + mode)
			if (
				(mode === "slideshow" ||
					mode === "teleprompter" ||
					mode === "history") &&
				matchMedia("(max-width: 1100px)").matches
			) {
				setLayout("library", false, false)
				setLayout("tools", false, false)
			}
			let selected = selection
			if (!doc || !selected) {
				if (opening) return
				setMarkup(
					element("#main"),
					html`<div class="empty">
						<h1>Your words. Your space.</h1>
						<p>Open a document or start writing.</p>
						${button("new", "New document", "+ New document")}
					</div>`,
				)
				return
			}
			let selectedReplica = selected.opened.session.replica
			function mediaIcon(url: string) {
				let id = url.startsWith("asset:") ? url.slice(6) : undefined
				let fields = id ? selectedReplica.fields(id) : undefined
				if (fields?.type === "whiteboard") return "pencil"
				let type = blobContentType(fields?.data ?? "") ?? ""
				if (
					type.startsWith("video/") ||
					/\.(mp4|webm|mov)(?:[?#]|$)/i.test(url)
				)
					return "film"
				if (
					type.startsWith("audio/") ||
					/\.(mp3|wav|ogg|m4a)(?:[?#]|$)/i.test(url)
				)
					return "music"
				return "image"
			}
			if (mode === "edit") {
				editor = mountEditor(element("#main"), {
					content: doc.content,
					atoms: selected.opened.session.replica.visible(doc.id),
					editable: writable(),
					preferences: preferences.state.current().value.editor,
					documents: summaries,
					openDocument: (id, newTab) => {
						if (selection !== selected) return
						if (newTab)
							window.open(
								routeHref(documentRoute(id)),
								"_blank",
								"noopener,noreferrer",
							)
						else launch(open(id))
					},
					canComment: () =>
						!selected.opened.session.replica.metadata(doc.id).commentsDisabled,
					previewImage: (url, alt) => {
						if (selection !== selected) return
						let id = url.startsWith("asset:") ? url.slice(6) : undefined
						if (
							id &&
							selected.opened.session.replica.fields(id).type === "whiteboard"
						) {
							launch(openDrawing(selected, id))
							return
						}
						launch(
							FiberHandle.run(
								mediaPreview,
								Effect.scoped(
									Effect.gen(function* () {
										let source =
											selected.opened.localMedia?.current().get(id ?? url) ??
											(id ? undefined : safeUrl(url))
										if (id && !source) {
											let reference = selected.opened.media
												.references(`![media](${url})`)
												.find(([asset]) => asset === id)?.[1]
											if (reference)
												source = yield* selected.opened.media.acquire(reference)
										}
										if (selection !== selected) return
										if (!source || source === "#")
											return report("Image is not available yet")
										dialogOwner = selected
										let name = mediaIcon(url)
										yield* mediaPreviewDialog(
											dialog,
											report,
											source,
											alt,
											name === "film"
												? "video"
												: name === "music"
													? "audio"
													: "image",
										)
									}),
								).pipe(
									Effect.catchCause(cause =>
										selection === selected &&
										(Cause.hasFails(cause) || Cause.hasDies(cause))
											? Effect.sync(() => report(Cause.squash(cause)))
											: Effect.void,
									),
								),
							),
						)
					},
					mediaIcon,
					createLinkedDocument: title =>
						tasks.run(library.create(metadataSource("", { title }))),
					isDrawing: id =>
						selected.opened.session.replica.fields(id).type === "whiteboard",
					openDrawing: id => launch(openDrawing(selected, id)),
					requestAsset: () => requestAsset(selected),
					attach: files =>
						attachFiles(selected, files, editor?.attachmentSelection()),
					command: action => {
						if (selection === selected && writable()) launch(act(action))
					},
					find: query => openFind(query),
					comments: () =>
						selected.opened.discussion
							.current()
							.filter(comment => comment.fields.resolved !== "true")
							.flatMap(comment => (comment.range ? [comment.range] : [])),
					select: () => launch(announce()),
					undo: redo => {
						if (
							!writable() ||
							selection !== selected ||
							undoWaiting.has(selected)
						)
							return
						undoWaiting.add(selected)
						selected.tasks.fork(
							(redo
								? selected.opened.session.redo()
								: selected.opened.session.undo()
							).pipe(
								Effect.catchCause(cause =>
									selection === selected &&
									(Cause.hasFails(cause) || Cause.hasDies(cause))
										? Effect.sync(() => report(Cause.squash(cause)))
										: Effect.void,
								),
								Effect.ensuring(
									Effect.sync(() => undoWaiting.delete(selected)),
								),
							),
						)
					},
					report,
					change: (content, base) => {
						if (!writable() || selection !== selected) {
							refreshDocument()
							return
						}
						let edit = selected.opened.session.edit(content, base)
						launch(edit.saved)
						refreshDocument()
						refreshLibrary()
						return edit
					},
				})
			} else if (mode === "preview") {
				if (panel !== "comments") setLayout("tools", false, false)
				setMarkup(
					element("#main"),
					previewMarkup(
						doc.title,
						routeHref({ ...documentRoute(doc.id), mode: "edit" }),
						selected.opened.session.replica.metadata(doc.id)
							.commentsDisabled !== true,
						preferences.state.current().value.appearance,
					),
				)
				renderPreview(
					element("#preview"),
					doc.content,
					rendering(doc),
					id => launch(open(id)),
					id => launch(openDrawing(selected, id)),
					previewComments(selected),
				)
			} else if (mode === "history") {
				let copies = new Map<
					number,
					ReturnType<typeof duplicateDocumentVersion>
				>()
				mountDocumentHistory(element("#main"), {
					document: selected.document,
					author: subject =>
						subject === account.subject ? "You" : "Another writer",
					mountSource: (host, historical) =>
						mountEditor(host, {
							content: historical.text(selected.document),
							atoms: historical.visible(selected.document),
							editable: false,
							preferences: preferences.state.current().value.editor,
							documents: summaries,
							isDrawing: id => historical.fields(id).type === "whiteboard",
							openDrawing: () => {},
							openDocument: id => launch(open(id)),
							createLinkedDocument: () =>
								Promise.reject(new Error("History is read-only")),
							comments: () => [],
							change: () => undefined,
							undo: () => {},
							select: () => {},
							requestAsset: () => {},
							attach: () => {},
							command: () => {},
							find: () => {},
							report,
						}),
					run: command => tasks.run(command),
					load: loadDocumentHistory(
						selected.opened.session,
						account.subject,
						selected.document,
					).pipe(Effect.provideService(BrowserStorage, storage)),
					writable: () => selection === selected && writable(),
					restore: (historical, position) =>
						askDocument(
							selected,
							confirmDialog(
								dialog,
								"Restore this version? Your current document will remain in history.",
								"Restore",
								"Restore this version",
							),
						).pipe(
							Effect.flatMap(confirmed =>
								confirmed && writable()
									? selected.opened.session
											.change("Restore moment " + position, staged =>
												restoreDocumentState(
													staged,
													historical,
													selected.document,
												),
											)
											.pipe(
												Effect.tap(() =>
													Effect.sync(() => {
														if (selection === selected) {
															changeMode("edit", true)
														}
													}),
												),
											)
									: Effect.void,
							),
						),
					createCopy: (historical, position) => {
						let command = copies.get(position)
						if (!command) {
							command = duplicateDocumentVersion(
								library,
								selected.opened.blobs,
								historical,
								selected.document,
								historical.metadata(selected.document).title +
									" (moment " +
									position +
									")",
								workspace || undefined,
							)
							copies.set(position, command)
						}
						return command.pipe(
							Effect.provideService(Crypto.Crypto, random),
							Effect.flatMap(id => {
								if (selection !== selected) return Effect.void
								mode = "edit"
								return open(id)
							}),
							Effect.provide(FetchHttpClient.layer),
						)
					},
					report,
				})
			} else {
				presentation = mountPresentation(element("#main"), {
					mode,
					index: slideIndex,
					documentId: doc.id,
					document: currentDocument,
					writable: () => selection === selected && writable(),
					position: () => {
						let value = selected.opened.session.replica.fields(
							doc.id,
						).presentationItem
						if (!value) return undefined
						let index = Number(value)
						return Number.isSafeInteger(index) && index >= 0 ? index : undefined
					},
					present: index => {
						if (selection !== selected || !writable()) return
						launch(
							selected.opened.session.change("Move presentation", staged => [
								staged.set(doc.id, "presentationItem", String(index)),
							]),
						)
					},
					presence: () => library.live.presence.current(doc.id),
					actor: () => library.live.actor(),
					render: (host, source, slideshow, number, appearance) =>
						renderPreview(
							host,
							source,
							{
								...rendering(currentDocument() ?? doc),
								mode: slideshow ? "slideshow" : undefined,
								slideNumber: number,
								...(appearance ? { appearance } : {}),
							},
							id => launch(open(id)),
							id => launch(openDrawing(selected, id)),
						),
					announce: (x, y) => {
						pointer = { x: x ?? -1, y: y ?? -1, time: Date.now() }
						return tasks.run(announce(x, y))
					},
					changed: index => {
						slideIndex = index
					},
				})
				let route = router.current()
				if (route.kind === "document" && route.follow) presentation.follow()
			}
			launch(announce())
			selected.media.visible(mode !== "edit")
			mounted = selected
			refreshDocument()
			finishOpening()
		}
		function openDrawing(selected: Selection, id: string, create = false) {
			return Effect.gen(function* () {
				let fields = selected.opened.session.replica.fields(id)
				if (
					!create &&
					(fields.type !== "whiteboard" ||
						fields.document !== selected.document)
				)
					return
				let { openWhiteboard } = yield* Effect.tryPromise(
					() => import("./components/whiteboard"),
				)
				if (selection !== selected) return
				dialogOwner = selected
				let session = selected.opened.session
				openWhiteboard({
					boardId: id,
					documentId: selected.document,
					actor: library.live.actor(),
					name: preferences.state.current().value.name,
					dialog,
					report,
					showDialog: (title, body) =>
						openDialog(dialog, report, refreshSafely, title, body),
					session: {
						replica: session.replica,
						uuid: random.randomUUIDv4,
						writable,
						changes: Stream.merge(session.changes, library.state.changes),
						presenceChanges: library.live.presence.changes,
						people: () => library.live.presence.current(selected.document),
						announce: value => library.live.announce(value).pipe(Effect.ignore),
						undo: () =>
							selection === selected && writable()
								? session.undo()
								: Effect.void,
						redo: () =>
							selection === selected && writable()
								? session.redo()
								: Effect.void,
						write: (board, values, embed) => {
							if (selection !== selected || !writable())
								return Effect.fail(
									new PermissionDenied({
										message: "This document is read-only",
									}),
								)
							return session.change(
								embed ? "Embed drawing" : "Draw",
								staged => {
									let changes =
										staged.fields(board).type === "whiteboard"
											? []
											: [
													staged.set(board, "type", "whiteboard"),
													staged.set(board, "document", selected.document),
												]
									changes.push(
										...values.map(([field, value]) =>
											staged.set(board, field, value),
										),
									)
									if (
										embed &&
										!staged.text(selected.document).includes(`asset:${board}`)
									) {
										let edit = staged.edit(
											selected.document,
											staged.text(selected.document) +
												`\n![Whiteboard](asset:${board})\n`,
										)
										if (edit) changes.push(edit)
									}
									return changes
								},
							)
						},
					},
				})
			})
		}
		function openThemeWorkbench(selected: Selection, id: string) {
			return Effect.gen(function* () {
				let { openThemeWorkbench } = yield* Effect.tryPromise(
					() => import("./components/theme-workbench"),
				)
				if (selection !== selected) return
				dialogOwner = selected
				selected.media.visible(true)
				openThemeWorkbench(id, {
					session: {
						replica: selected.opened.session.replica,
						change: selected.opened.session.change,
						changes: Stream.merge(
							selected.opened.session.changes,
							selected.opened.connection.changes,
						),
					},
					writable: () => selection === selected && writable(),
					run: task => selected.tasks.run(task),
					report,
					content: selected.opened.session.replica.text(selected.document),
					dialog,
					showDialog: (title, body) =>
						openDialog(dialog, report, refreshSafely, title, body),
					assets: () => selected.media.current().urls,
					download: (filename, content, type) => {
						launch(
							Effect.acquireUseRelease(
								Effect.sync(() =>
									URL.createObjectURL(
										typeof content === "string"
											? new Blob([content], { type })
											: content,
									),
								),
								url =>
									Effect.sync(() => {
										let link = document.createElement("a")
										link.href = url
										link.download = filename
										link.click()
									}).pipe(Effect.andThen(Effect.sleep("1 second"))),
								url => Effect.sync(() => URL.revokeObjectURL(url)),
							),
						)
					},
				})
			})
		}
		function announce(x = -1, y = -1) {
			let selected = selection
			if (!selected) return Effect.void
			// Heartbeats keep the presenter's laser where it last pointed, so a
			// follower's laser does not blink off between pointer movements.
			if (x < 0 && presentation && Date.now() - pointer.time < 3000) {
				x = pointer.x
				y = pointer.y
			}
			if (dialog.open && dialog.querySelector("[data-whiteboard]"))
				return Effect.void
			let input = editor?.source
			let notes = document.querySelector<HTMLElement>("#speaker-notes")
			return library.live
				.announce({
					actor: library.live.actor(),
					name: preferences.state.current().value.name,
					document: selected.document,
					cursor: input?.selectionStart ?? 0,
					selectionEnd: input?.selectionEnd ?? 0,
					slide: presentation?.index ?? slideIndex,
					item: presentation?.item,
					x,
					y,
					time: Date.now(),
					presenting: Boolean(presentation && !presentation.following),
					movedAt: presentation?.movedAt,
					display: presentation?.display,
					target: presentation?.target,
					scroll: notes
						? notes.scrollTop /
							Math.max(1, notes.scrollHeight - notes.clientHeight)
						: 0,
				})
				.pipe(Effect.ignore)
		}
		function askDocument<A>(
			selected: Selection,
			question: Effect.Effect<A | undefined>,
		) {
			return Effect.gen(function* () {
				dialogOwner = selected
				let answer = yield* question
				return selection === selected ? answer : undefined
			})
		}
		function previewComments(selected: Selection) {
			return {
				comments: selected.opened.discussion.current(),
				selected: selectedComment,
				commentable:
					writable() &&
					selected.opened.session.replica.metadata(selected.document)
						.commentsDisabled !== true,
				select: (id: string) => {
					selectedComment = selectedComment === id ? undefined : id
					panel = "comments"
					setLayout("tools", true)
					refreshDocument()
					if (selectedComment)
						app
							.querySelector<HTMLElement>(
								'[data-comment="' + CSS.escape(selectedComment) + '"]',
							)
							?.scrollIntoView({ block: "nearest" })
				},
			}
		}
		function rendering(doc: DocumentRecord) {
			let header = frontmatter(doc.content).values
			let requested = header["theme-id"] || header.theme || ""
			let replica = selection?.opened.session.replica
			let editor = preferences.state.current().value.editor
			let appearance =
				requested === "light" || requested === "dark"
					? requested
					: document.documentElement.dataset.appearance
			let theme = resolveTheme({
				header,
				document: libraryThemes(
					replica?.records("theme") ?? [],
					id => replica?.text(id) ?? "",
				),
				library: themeLibrary.state.current().themes,
				fallback:
					mode === "slideshow" || mode === "teleprompter"
						? editor.slideshowTheme
						: editor.previewTheme,
				...(appearance ? { appearance } : {}),
			})
			return {
				theme: theme.source,
				...(theme.warning ? { warning: theme.warning } : {}),
				appearance,
				size: header.size,
				preset: header.preset,
				syntaxTheme:
					header["syntax-theme"] ||
					preferences.state.current().value.editor.syntaxTheme,
				mode: mode === "slideshow" ? "slideshow" : undefined,
				assets: new Map([
					...(selection?.media.current().urls ?? []),
					...(selection?.opened.localMedia?.current() ?? []),
				]),
				mutedAssets: selection?.opened.assets
					.current()
					.filter(asset => asset.fields.muted === "true")
					.map(asset => asset.id),
			}
		}
		function refreshDocument() {
			let signedIn = account.state.current().status === "signedIn"
			let signIn = app.querySelector<HTMLElement>(
				'#profile-menu [data-action="sign-in"]',
			)
			let signOut = app.querySelector<HTMLElement>(
				'#profile-menu [data-action="sign-out"]',
			)
			if (signIn) signIn.hidden = signedIn
			if (signOut) signOut.hidden = !signedIn
			selection?.media.refresh()
			let doc = currentDocument()
			if (!doc) {
				element("#document-title").textContent = ""
				element("#inspector-body").replaceChildren()
				return
			}
			let route = router.current()
			if (
				route.kind === "document" &&
				route.document === doc.id &&
				(mode === "slideshow" || mode === "teleprompter") &&
				!presenting()
			) {
				changeMode("edit", true)
				return
			}
			let file = selection?.opened.file
			let located = selection && library.folders.locate(selection.document)
			let entry = library.state
				.current()
				.library.documents.find(entry => entry.document === selection?.document)
			let role = entry?.role
			element("#document-title").textContent = doc?.title ?? ""
			if (doc && selection && mounted === selection) {
				editor?.update(
					doc.content,
					selection.opened.session.replica.visible(doc.id),
					writable(),
				)
				if (mode === "preview") {
					app
						.querySelector('[data-action="preview-comments"]')
						?.setAttribute(
							"aria-expanded",
							String(
								panel === "comments" && app.classList.contains("tools-open"),
							),
						)
					element("#preview-title").textContent = doc.title
					let selected = selection
					renderPreview(
						element("#preview"),
						doc.content,
						rendering(doc),
						id => launch(open(id)),
						id => launch(openDrawing(selected, id)),
						previewComments(selected),
					)
				}
				editor?.presence(library.live.presence.current(doc.id))
				presentation?.update()
				let session = selection.opened.session
				let failures = session.failures.current()
				let state = selection.opened.file?.current()
				element("#save-status").title =
					state?.message ?? failures.synchronization?.message ?? ""
				let indicator = saveIndicator({
					unsaved: Boolean(session.unsaved()),
					pending: session.pending().length > 0,
					saveFailed: Boolean(failures.save),
					syncFailed: Boolean(failures.synchronization),
					file: state,
				})
				launch(saveFeedback.update(doc.id, indicator))
				element("#retry-save").hidden = !failures.save
				let stats = app.querySelector("alkalye-stats")
				if (stats instanceof StatsElement)
					stats.update(
						doc.content,
						preferences.state.current().value.editor.statsUnit,
					)
			}
			app.toggleAttribute("data-comments-panel", panel === "comments")
			for (let tab of app.querySelectorAll<HTMLButtonElement>(
				"[data-inspector] > header [data-action]",
			))
				tab.classList.toggle("selected", tab.dataset.action === panel)
			if (panel === "comments") {
				updateMarkup(
					element("#inspector-body"),
					commentsMarkup(
						selection?.opened.discussion.current() ?? [],
						doc
							? selection?.opened.session.replica.metadata(doc.id)
									.commentsDisabled
							: false,
						writable() && Boolean(selection?.opened.discussion.canWrite()),
						selectedComment,
					),
				)
				return
			}
			updateTools(
				html`<div class="tool-section">
						${tool("find", "Find", "search")}${tool("palette", "Command palette", "command")}${doc ? tool("outline", "Document outline", "list-tree") : ""}
					</div>
					<div class="tool-section">
						${mode === "edit" ? tool("preview", "Preview", "eye") : tool("edit", "Write", "pencil")}${presenting() ? html`${tool("slideshow", "Slideshow", "presentation")}${tool("teleprompter", "Teleprompter", "scroll-text")}` : ""}${doc && !file && writable() ? tool("toggle-comments", selection?.opened.session.replica.metadata(doc.id).commentsDisabled ? "Enable comments" : "Disable comments", "message-square-off") : ""}
					</div>
					${
						doc
							? html`<div class="tool-section">
									${group(
										"file",
										"File",
										"file-text",
										html`${tool("properties", "Properties", "pencil")}${tool("present", presenting() ? "Turn into document" : "Turn into presentation", "presentation")}${tool("pin", doc.pinned ? "Unpin" : "Pin", doc.pinned ? "pin-off" : "pin")}${tool("archive", doc.archived ? "Restore" : "Archive", doc.archived ? "archive-restore" : "archive")}${file ? "" : tool("history", "Time machine", "history")}${tool("theme", "Theme", "palette")}${tool("download", "Export", "download")}${window.showSaveFilePicker ? tool("save-as", "Save as…", "save") : ""}${typeof navigator.canShare === "function" ? tool("share-copy", "Share a copy", "share") : ""}${tool("print", "Print or PDF", "printer")}${tool("duplicate", "Duplicate", "copy")}${file ? "" : role === "owner" ? html`${tool("move", "Move to workspace", "folder-input")}${entry?.deleted ? tool("restore-document", "Restore from trash", "archive-restore") : tool("delete", "Delete", "trash-2")}` : tool("leave", "Leave document", "log-out")}`,
									)}${group(
										"edit",
										"Edit",
										"undo-2",
										html`${tool("undo", "Undo", "undo-2")}${tool("redo", "Redo", "redo-2")}
											<hr />
											${tool("cut", "Cut", "scissors")}${tool("copy-text", "Copy", "copy")}${tool("paste", "Paste", "clipboard")}
											<hr />
											${tool("find-replace", "Find and replace", "search")}${tool("complete", "Toggle task completion", "list-todo")}${tool("sort-tasks", "Sort tasks", "list")}`,
									)}${group(
										"format",
										"Format",
										"type",
										html`${group("headings", "Headings", "heading", joinMarkup([1, 2, 3, 4, 5, 6].map(level => tool("h" + level, "Heading " + level, "heading"))), true)}${group("lists", "Lists", "list", html`${tool("bullet", "Bullet list", "list")}${tool("ordered", "Numbered list", "list")}${tool("task", "Task list", "list-todo")}${tool("complete", "Toggle task completion", "list-todo")}`, true)}${tool("quote", "Quote", "message-square")}${tool("body", "Body text", "type")}${group(
												"structure",
												"Structure",
												"type",
												html`${tool("indent", "Indent", "chevron-right")}${tool("outdent", "Outdent", "chevron-left")}
													<hr />
													${tool("move-up", "Move line up", "chevron-up")}${tool("move-down", "Move line down", "chevron-down")}`,
												true,
											)}
											<hr />
											${tool("bold", "Bold", "bold")}${tool("italic", "Italic", "italic")}${tool("strike", "Strikethrough", "type")}
											<hr />
											${tool("code", "Inline code", "code")}${tool("code-block", "Code block", "code")}${tool("link", "Link", "link")}${tool("image", "Image", "image")}${tool("wikilink", "Link to document", "file-symlink")}
											<hr />
											${tool("clear", "Clear formatting", "x")}`,
									)}
								</div>`
							: ""
					}
					${
						doc && !file
							? html`<div class="tool-section">
									<h3>Collaboration</h3>
									${tool("share", "Invite collaborators", "users")}
								</div>`
							: ""
					}
					${
						doc && file && located
							? html`<div class="tool-section" data-local-file>
									<h3>File</h3>
									<p
										class="file-path"
										title="${located.directory.name}/${located.file.path}"
									>
										${located.directory.name}/${located.file.path}
									</p>
									${
										file.current().status === "conflict"
											? html`<p class="file-conflict">
														${file.current().message ?? ""}
													</p>
													${tool("file-keep-editor", "Keep my version", "pencil")}${tool("file-use-disk", "Use disk version", "hard-drive")}`
											: ""
									}
									${file.current().status === "reconnect" ? tool("reconnect-folder", "Allow access", "folder-open") : ""}
									${file.current().recovery ? tool("file-restore", "Restore other version", "undo-2") : ""}
									${located.directory.id === openedFiles ? tool("file-close", "Close file", "x") : html`${tool("file-move", "Rename or move", "pencil")}${tool("file-delete", "Delete file", "trash-2")}`}
								</div>`
							: ""
					}
					${doc && !file ? backlinksMarkup(doc) : ""}
					${doc && selection ? attachmentsMarkup(selection.opened.assets.current(), writable() && located?.directory.id !== openedFiles, selection.media.current().failures) : ""}
					${
						doc
							? html`<div class="tool-section">
									<h3>
										<span>Drawings</span
										>${file ? "" : button("new-whiteboard", "New drawing", icon("plus"))}
									</h3>
									${joinMarkup((selection?.opened.session.replica.records("whiteboard") ?? []).filter(board => board.fields.document === doc?.id).map(board => tool("drawing:" + board.id, board.fields.name || "Drawing", "pen-tool")))}
								</div>`
							: ""
					}
					<div class="tool-section">
						${tool("sign-in", "Sign in", "log-in")}${tool("sign-out", "Sign out", "log-out")}
					</div>`,
			)
		}

		function updateTools(markup: Markup) {
			let host = element("#inspector-body")
			let opened = [
				...host.querySelectorAll<HTMLElement>(
					".tool-group > [popover]:popover-open",
				),
			]
			let active = document.activeElement
			let action =
				active instanceof HTMLElement ? active.dataset.action : undefined
			let controls = active?.getAttribute("aria-controls")
			let panel = active?.closest("[popover]")?.id
			let selected = selection
			updateMarkup(host, markup)
			if (!opened.some(panel => !panel.isConnected)) return
			queueMicrotask(() => {
				if (selection !== selected || !host.isConnected) return
				for (let previous of opened) {
					let trigger = host.querySelector<HTMLButtonElement>(
						'[aria-controls="' + CSS.escape(previous.id) + '"]',
					)
					if (trigger && !trigger.disabled) trigger.click()
				}
				let restored = panel
					? host.querySelector<HTMLElement>("#" + CSS.escape(panel))
					: undefined
				let target = action
					? restored?.querySelector<HTMLElement>(
							'[data-action="' + CSS.escape(action) + '"]',
						)
					: controls
						? restored?.querySelector<HTMLElement>(
								'[aria-controls="' + CSS.escape(controls) + '"]',
							)
						: undefined
				if (target && !target.hasAttribute("disabled"))
					target.focus({ preventScroll: true })
			})
		}
		function group(
			id: string,
			label: string,
			name: IconName,
			content: Markup,
			submenu = false,
		) {
			return html`<alkalye-menu
				class="tool-group"
				data-group="${id}"
				side="${submenu ? "right" : "left"}"
				${submenu ? html`data-submenu` : ""}
			>
				<button
					type="button"
					class="menu-trigger"
					aria-controls="tools-${id}"
					${id !== "file" && (mode !== "edit" || (id !== "edit" && !writable())) ? "disabled" : ""}
					aria-haspopup="menu"
				>
					${icon(name)}<span>${label}</span>${icon("chevron-right")}
				</button>
				<div
					id="tools-${id}"
					class="menu-popover"
					popover
					role="menu"
					aria-label="${label}"
				>
					${content}
				</div>
			</alkalye-menu>`
		}
		function backlinksMarkup(doc: DocumentRecord) {
			let linking = library.state
				.current()
				.library.documents.filter(
					entry =>
						!entry.deleted &&
						entry.document !== doc.id &&
						entry.links?.some(
							target => target === doc.id || target === doc.title,
						),
				)
			return html`<div class="tool-section" data-backlinks>
				<h3>Backlinks</h3>
				${
					linking.length
						? joinMarkup(
								linking.map(
									entry =>
										html`<button type="button" data-doc="${entry.document}">
											${icon("link")}<span>${entry.metadata.title}</span>
										</button>`,
								),
							)
						: html`<p class="muted padded">No documents link here yet.</p>`
				}
			</div>`
		}
		function tool(action: string, label: string, name: IconName) {
			let shortcut = actionShortcutLabel(
				action,
				/Mac/i.test(navigator.platform) ? "mac" : "other",
			)
			let changesSource =
				formattingCommands.includes(action) ||
				[
					"undo",
					"redo",
					"cut",
					"paste",
					"body",
					"sort-tasks",
					"indent",
					"outdent",
					"move-up",
					"move-down",
					"code-block",
					"image",
					"wikilink",
				].includes(action)
			return button(
				action,
				label,
				html`${icon(name)}<span>${label}</span>${shortcut ? html`<kbd>${shortcut}</kbd>` : ""}`,
				changesSource && (mode !== "edit" || !writable()) ? "disabled" : "",
			)
		}
		function refreshSafely() {
			try {
				refreshDocument()
			} catch (error) {
				report(error)
			}
		}
		function requestAsset(selected: Selection) {
			if (selection !== selected || !writable()) return
			let captured = editor?.attachmentSelection()
			if (mode === "edit" && !captured)
				return report("Finish editing before attaching a file")
			fileTarget = { selected, captured }
			assetInput.click()
		}
		function attachFiles(
			selected: Selection,
			files: File[],
			captured?: AttachmentSelection,
		) {
			if (selection !== selected || !writable()) return
			if (mode === "edit" && !captured)
				return report("Finish editing before attaching a file")
			selected.tasks.fork(
				Effect.gen(function* () {
					if (!files.length) return
					if (selected.opened.file) {
						let links = yield* Effect.forEach(files, file =>
							library.folders
								.writeAsset(selected.document, file)
								.pipe(Effect.map(source => ({ source, name: file.name }))),
						)
						yield* selected.opened.assets.link(links, captured)
						return
					}
					let prepared = yield* Effect.forEach(files, prepareAttachment)
					yield* selected.opened.assets.attachFiles(prepared, captured)
				}).pipe(
					Effect.catchCause(cause =>
						selection === selected &&
						(Cause.hasFails(cause) || Cause.hasDies(cause))
							? Effect.sync(() => report(Cause.squash(cause)))
							: Effect.void,
					),
				),
			)
		}
		function act(action: string) {
			return Effect.gen(function* () {
				if (action === "toggle-preview") action = "preview"
				if (action === "save-as" && !window.showSaveFilePicker)
					action = "download"
				if (action === "settings") {
					router.go({ kind: "settings", category: "general", from: here() })
					return
				}
				if (action === "palette") {
					dialogOwner = undefined
					openPalette(
						dialog,
						(title, body) =>
							openDialog(dialog, report, refreshSafely, title, body),
						action => tasks.run(act(action).pipe(Effect.asVoid)),
						report,
						new Set([
							...enabled,
							...(presenting() ? ["slideshow", "teleprompter"] : []),
							"find",
							"comment",
							"undo",
							"redo",
						]),
					)
					return
				}
				if (action === "help") {
					dialogOwner = undefined
					return yield* openHelp(
						dialog,
						(title, body) =>
							openDialog(dialog, report, refreshSafely, title, body),
						(title, content) =>
							library
								.create(
									metadataSource(content, { title }),
									workspace || undefined,
								)
								.pipe(Effect.flatMap(id => open(id))),
						report,
					)
				}
				if (action === "find" || action === "find-replace") {
					if (mode !== "edit") {
						mode = "edit"
						mountDocument()
					}
					openFind("", action === "find-replace")
					return
				}
				if (action === "find-next" || action === "find-previous") {
					let button = document.querySelector<HTMLButtonElement>("#" + action)
					if (button) button.click()
					else openFind()
					return
				}
				if (action === "agents") {
					router.go({ kind: "settings", category: "connections", from: here() })
					return
				}
				if (formattingCommands.includes(action)) {
					editor?.format(action)
					return
				}
				if (
					[
						"cut",
						"copy-text",
						"paste",
						"sort-tasks",
						"body",
						"indent",
						"outdent",
						"move-up",
						"move-down",
					].includes(action)
				) {
					editor?.command(action)
					return
				}
				if (action === "image") {
					editor?.format("image")
					return
				}
				if (action === "wikilink") {
					editor?.insert("[[")
					return
				}
				if (action === "code-block") {
					editor?.insertCodeBlock()
					return
				}
				if (action === "import") {
					importInput.click()
					return
				}
				if (action === "open-file") {
					let opened = yield* library.folders.openFile()
					workspace = openedFiles
					refreshLibrary()
					yield* open(opened)
					return
				}
				if (action === "open-folder") {
					let opened = yield* library.folders.open()
					workspace = opened
					refreshLibrary()
					let first = library.folders
						.current()
						.find(directory => directory.id === opened)?.files[0]
					if (first) yield* open(first.document)
					return
				}
				if (action === "reconnect-folder") {
					let id =
						(selection &&
							library.folders.locate(selection.document)?.directory.id) ||
						workspace
					if (!isLocalWorkspace(id)) return
					yield* library.folders.reconnect(id)
					if (selection?.opened.file) yield* selection.opened.file.reconcile
					return
				}
				if (action === "export-all") {
					let catalogue = library.state.current().library
					let documents = catalogue.documents.filter(
						entry =>
							!entry.deleted && (!workspace || entry.workspace === workspace),
					)
					if (!documents.length)
						return report("There are no documents to back up")
					let names = new Map(
						catalogue.workspaces.map(space => [space.workspace, space.name]),
					)
					let spaces = new Set(documents.map(entry => entry.workspace))
					let { downloadFile, exportLibrary } = yield* archives
					yield* downloadFile(
						yield* exportLibrary(
							library,
							documents.map(entry => ({
								document: entry.document,
								...(spaces.size > 1
									? { folder: names.get(entry.workspace) ?? "Workspace" }
									: {}),
							})),
							"Alkalye " + (names.get(workspace) ?? "backup"),
						),
					)
					return
				}
				if (action === "new") {
					yield* open(yield* library.create("", workspace || undefined))
					return
				}
				if (action === "new-workspace") {
					let id = yield* random.randomUUIDv4
					let request = yield* random.randomUUIDv4
					dialogOwner = undefined
					openDialog(
						dialog,
						report,
						() => {
							workspace = id
							refreshLibrary()
							router.record(
								selection
									? documentRoute(selection.document)
									: { kind: "library", workspace: id },
								{ replace: true },
							)
							toast(translate("Workspace created"))
						},
						"Create workspace",
						html`<p class="muted">
								${translate("A workspace keeps documents you share with the same people.")}
							</p>
							<label
								>${translate("Name")}<input
									name="name"
									required
									maxlength="100"
									placeholder="${translate("My workspace")}"
									autocomplete="off"
									enterkeyhint="done"
							/></label>`,
						form =>
							tasks.run(
								account
									.request(
										account.api.workspaces.create({
											payload: {
												workspace: id,
												request,
												name: String(form.get("name") ?? "").trim(),
											},
										}),
									)
									.pipe(Effect.andThen(library.refresh)),
							),
						"Create",
					)
					return
				}
				if (action === "manage-workspace") {
					here()
					router.go({
						kind: "workspaceSettings",
						workspace: workspace || "personal-" + account.subject,
					})
					return
				}
				if (action === "sign-in") {
					yield* account.switchAccount
					yield* library.refresh
					return
				}
				if (action === "sign-out") {
					yield* account.logout
					return
				}
				if (action === "library") {
					setLayout("library", !app.classList.contains("library-open"))
					return
				}
				if (
					action === "library-menu" ||
					action === "library-options" ||
					action === "profile-menu"
				) {
					let panel = element("." + action)
					if (panel.hasAttribute("popover")) return
					panel.hidden = !panel.hidden
					app
						.querySelector(`[data-action="${action}"]`)
						?.setAttribute("aria-expanded", String(!panel.hidden))
					return
				}
				if (
					action === "language-en" ||
					action === "language-de" ||
					action === "language-system"
				) {
					yield* preferences.save({
						language:
							action === "language-en"
								? "en"
								: action === "language-de"
									? "de"
									: "system",
					})
					return
				}
				if (
					action === "appearance-light" ||
					action === "appearance-dark" ||
					action === "appearance-system"
				) {
					yield* preferences.save({
						appearance:
							action === "appearance-light"
								? "light"
								: action === "appearance-dark"
									? "dark"
									: "system",
					})
					return
				}
				if (action === "retry-save") {
					yield* selection?.opened.session.flush ?? Effect.void
					return
				}
				if (action === "preview-comments") {
					let open =
						panel === "comments" && app.classList.contains("tools-open")
					panel = "comments"
					setLayout("tools", !open)
					refreshDocument()
					return
				}
				if (action === "appearance") {
					yield* preferences.save({
						appearance:
							document.documentElement.dataset.appearance === "dark"
								? "light"
								: "dark",
					})
					return
				}
				if (action === "syntax-theme") {
					let { syntaxFamilies } = yield* Effect.tryPromise(
						() => import("../shared/syntax"),
					)
					let current = preferences.state.current().value.editor.syntaxTheme
					dialogOwner = undefined
					openDialog(
						dialog,
						report,
						refreshSafely,
						"Syntax colors",
						html`<label
							>Syntax
							colors${pickerMarkup(
								"syntaxTheme",
								"Syntax colors",
								syntaxFamilies.map(family => ({
									value: family.id,
									label: family.name,
								})),
								current,
							)}</label
						>`,
						form =>
							tasks.run(
								preferences.save({
									editor: {
										syntaxTheme: String(form.get("syntaxTheme") ?? current),
									},
								}),
							),
					)
					return
				}
				if (action === "focus") {
					app.classList.toggle("focus-mode")
					return
				}
				if (action === "tools" || action === "comments") {
					panel = action
					setLayout("tools", true)
					refreshDocument()
					return
				}
				if (action === "toggle-tools") {
					setLayout("tools", !app.classList.contains("tools-open"))
					return
				}
				if (action === "archive-toggle") {
					showArchive = !showArchive
					showTrash = false
					refreshLibrary()
					return
				}
				if (action === "trash-toggle") {
					showTrash = !showTrash
					showArchive = false
					refreshLibrary()
					return
				}
				if (action === "folders") {
					folders = !folders
					refreshLibrary()
					return
				}
				if (action.startsWith("folder-toggle:")) {
					let folder = action.slice("folder-toggle:".length)
					if (collapsed.has(folder)) collapsed.delete(folder)
					else collapsed.add(folder)
					refreshLibrary()
					return
				}
				if (action === "new-whiteboard" && selection) {
					if (!writable()) return
					yield* openDrawing(selection, yield* random.randomUUIDv4, true)
					return
				}
				if (action.startsWith("drawing:") && selection) {
					yield* openDrawing(selection, action.slice(8))
					return
				}
				if (action === "theme" && selection) {
					let selected = selection
					let { openDocumentThemePicker } = yield* Effect.tryPromise(
						() => import("./components/theme-picker"),
					)
					if (selection !== selected) return
					dialogOwner = selected
					openDocumentThemePicker({
						document: selected.document,
						library: themeLibrary.state.current().themes,
						session: selected.opened.session,
						dialog,
						writable: () => selection === selected && writable(),
						uuid: random.randomUUIDv4,
						run: task => selected.tasks.run(task),
						report,
						changed: refreshSafely,
						workbench: id =>
							themeLibrary.state.current().themes.some(theme => theme.id === id)
								? launch(
										openLibraryWorkbench(themeLibrary, id, { dialog, report }),
									)
								: launch(openThemeWorkbench(selected, id)),
					})
					return
				}
				if (action === "follow") {
					presentation?.follow()
					return
				}
				if (action === "presenter" && selection && presenting()) {
					window.open(
						routeHref({
							kind: "document",
							document: selection.document,
							mode: "slideshow",
							follow: true,
						}),
						"alkalye-slides",
					)
					return
				}
				if (
					action === "edit" ||
					action === "preview" ||
					action === "slideshow" ||
					action === "teleprompter" ||
					action === "history"
				) {
					changeMode(
						action === "preview" && mode === "preview" ? "edit" : action,
					)
					return
				}
				if (action === "next" || action === "previous") {
					presentation?.change(action === "next" ? 1 : -1)
					return
				}
				if (action === "fullscreen") {
					if (document.fullscreenElement)
						yield* Effect.tryPromise(() => document.exitFullscreen())
					else
						yield* Effect.tryPromise(() => element("#main").requestFullscreen())
					return
				}
				let doc = currentDocument()
				let selected = selection
				if (!doc || !selected) return
				let file = selected.opened.file
				if (
					file &&
					(action === "file-keep-editor" || action === "file-use-disk")
				)
					return yield* file.resolve(
						action === "file-use-disk" ? "disk" : "editor",
					)
				if (file && action === "file-restore")
					return yield* file.restoreRecovery
				if (file && action === "file-close") {
					yield* closeSelection(selected)
					yield* library.folders.close(selected.document)
					return
				}
				if (file && (action === "file-move" || action === "file-delete")) {
					let located = library.folders.locate(selected.document)
					if (!located) return
					if (action === "file-move") {
						let path = yield* askDocument(
							selected,
							promptDialog(
								dialog,
								"File name or path inside " + located.directory.name,
								located.file.path,
							),
						)
						if (path === undefined || path.trim() === located.file.path) return
						yield* selected.opened.session.flush
						yield* file.reconcile
						yield* library.folders.move(selected.document, path.trim())
						return
					}
					if (
						!(yield* askDocument(
							selected,
							confirmDialog(
								dialog,
								"Delete " +
									located.file.path +
									" from " +
									located.directory.name +
									"?",
							),
						))
					)
						return
					yield* closeSelection(selected)
					yield* library.folders.remove(selected.document)
					return
				}
				if (action === "share") {
					if (selected.opened.file)
						return report(
							"Move this local file to a synced workspace to invite collaborators",
						)
					let entry = library.state
						.current()
						.library.documents.find(
							entry => entry.document === selected.document,
						)
					if (entry?.owner !== account.subject)
						return report("Only the document owner can manage permissions")
					let invitations = yield* invitationPanel({
						document: selected.document,
					})
					if (selection !== selected) return
					dialogOwner = selected
					openDialog(
						dialog,
						report,
						refreshSafely,
						"Share document",
						documentAccessMarkup(
							entry.owner,
							selected.opened.session.replica.fields(selected.document),
							account.subject,
							account.origin +
								routeHref({
									kind: "document",
									document: selected.document,
									mode: "edit",
								}),
						),
						form => {
							let member = String(form.get("member") ?? "")
							let role = form.get("role")
							return selected.tasks.run(
								selected.opened.session
									.change("Change document permission", staged => [
										staged.set(
											selected.document,
											"access:" + member,
											role === "writer" || role === "reader" ? role : "",
										),
									])
									.pipe(Effect.andThen(selected.opened.session.sync)),
							)
						},
					)
					dialog.querySelector(".dialog-body")?.prepend(invitations)
					let toggle = dialog.querySelector<HTMLButtonElement>(
						"[data-public-toggle]",
					)
					if (toggle)
						toggle.onclick = () => {
							toggle.disabled = true
							selected.tasks
								.run(
									selected.opened.session
										.change(
											toggle.dataset.publicToggle
												? "Make document public"
												: "Make document private",
											staged => [
												staged.set(
													selected.document,
													"access:" + publicMember,
													toggle.dataset.publicToggle ?? "",
												),
											],
										)
										.pipe(Effect.andThen(selected.opened.session.sync)),
								)
								.then(() => {
									dialog.close()
									launch(act("share"))
								})
								.catch(report)
								.finally(() => {
									toggle.disabled = false
								})
						}
					return
				}

				if (action === "properties") {
					if (!writable())
						return yield* new PermissionDenied({
							message: "This document is read-only",
						})
					let initial = selected.opened.session.replica.metadata(doc.id)
					dialogOwner = selected
					openDialog(
						dialog,
						report,
						refreshSafely,
						"Document properties",
						html`${field("Title", "title", initial.title)}${field("Folder", "path", initial.path)}${field("Tags (comma separated)", "tags", initial.tags.join(", "))}`,
						form =>
							selected.tasks.run(
								Effect.gen(function* () {
									if (selection !== selected || !writable())
										return yield* new PermissionDenied({
											message: "This document is no longer writable",
										})
									let title = String(form.get("title") ?? "").trim()
									let path = yield* Effect.try(() =>
										folderPath(String(form.get("path") ?? "")),
									)
									let tags = String(form.get("tags") ?? "")
										.split(",")
										.map(value => value.trim())
										.filter(Boolean)
									let patch: MetadataPatch = {}
									if (title !== initial.title) patch.title = title
									if (path !== initial.path) patch.path = path
									if (JSON.stringify(tags) !== JSON.stringify(initial.tags))
										patch.tags = tags
									if (!Object.keys(patch).length) return
									yield* selected.opened.session.change(
										"Document properties",
										staged => [
											staged.edit(
												doc.id,
												metadataSource(staged.text(doc.id), patch),
											),
										],
									)
								}),
							),
					)
					return
				}
				if (action === "outline") {
					let headings = [...doc.content.matchAll(/^(#{1,6})\s+(.+)$/gm)]
					dialogOwner = selected
					openDialog(
						dialog,
						report,
						refreshSafely,
						"Document outline",
						headings.length
							? html`<nav class="outline">
									${joinMarkup(headings.map(heading => html`<button type="button" data-outline="${heading.index ?? 0}" style="--outline-depth:${(heading[1]?.length ?? 1) - 1}">${heading[2] ?? ""}</button>`))}
								</nav>`
							: html`<p class="muted">
									Add headings with # to outline this document.
								</p>`,
					)
					for (let control of dialog.querySelectorAll<HTMLButtonElement>(
						"[data-outline]",
					))
						control.onclick = () => {
							let start = Number(control.dataset.outline)
							dialog.close()
							if (mode !== "edit") {
								mode = "edit"
								mountDocument()
							}
							let end = doc.content.indexOf("\n", start)
							editor?.selectRange(start, end < 0 ? doc.content.length : end)
						}
					return
				}
				if (action === "present") {
					if (!writable()) return
					let presentation = presenting()
					yield* selected.opened.session.change(
						presentation ? "Turn into document" : "Turn into presentation",
						staged => [
							staged.edit(
								selected.document,
								withFrontmatter(staged.text(selected.document), {
									mode: presentation ? undefined : "present",
								}),
							),
						],
					)
					return
				}
				if (action === "save-as" || action === "share-copy") {
					let { exportDocument, exportMarkdown, libraryTitles } =
						yield* archives
					if (action === "save-as") {
						let file = exportMarkdown(
							selected.opened,
							selected.document,
							libraryTitles(library),
						)
						let picker = window.showSaveFilePicker
						if (!picker) return
						let handle = yield* Effect.tryPromise({
							try: () =>
								picker.call(window, {
									suggestedName: file.name,
									types: [
										{
											description: "Markdown",
											accept: { "text/markdown": [".md"] },
										},
									],
								}),
							catch: error => error,
						}).pipe(
							Effect.catchIf(
								error =>
									error instanceof DOMException && error.name === "AbortError",
								() => Effect.interrupt,
							),
						)
						yield* Effect.tryPromise(async () => {
							let writable = await handle.createWritable()
							await writable.write(file.blob)
							await writable.close()
						})
						toast("Saved " + handle.name)
						return
					}
					let file = yield* exportDocument(
						selected.opened,
						selected.document,
						libraryTitles(library),
					)
					let shared = new File([file.blob], file.name, {
						type: file.blob.type,
					})
					if (!navigator.canShare?.({ files: [shared] }))
						return report("This browser cannot share files")
					yield* Effect.tryPromise(() =>
						navigator.share({ files: [shared], title: doc.title }),
					).pipe(Effect.catch(() => Effect.void))
					return
				}
				if (action === "delete" || action === "restore-document") {
					let entry = library.state
						.current()
						.library.documents.find(
							entry => entry.document === selected.document,
						)
					if (entry?.role !== "owner")
						return report("Only the document owner can delete it")
					if (
						action === "delete" &&
						!(yield* askDocument(
							selected,
							confirmDialog(
								dialog,
								"Move " + doc.title + " to the trash?",
								"Delete",
							),
						))
					)
						return
					yield* selected.opened.session.change(
						action === "delete" ? "Delete document" : "Restore document",
						staged => [
							staged.set(
								selected.document,
								"type",
								action === "delete" ? "deleted" : "document",
							),
						],
					)
					yield* selected.opened.session.sync.pipe(Effect.ignore)
					yield* library.refresh
					if (action === "delete") {
						yield* closeSelection(selected)
						toast("Moved to the trash")
					} else {
						showTrash = false
						refreshLibrary()
						refreshSafely()
					}
					return
				}
				if (action === "move") {
					let entry = library.state
						.current()
						.library.documents.find(
							entry => entry.document === selected.document,
						)
					let destinations = library.state
						.current()
						.library.workspaces.filter(
							space =>
								space.role !== "reader" &&
								space.workspace !== entry?.workspace &&
								!isLocalWorkspace(space.workspace),
						)
					if (entry?.role !== "owner")
						return report("Only the document owner can move it")
					if (!destinations.length)
						return report("Create another workspace to move this document")
					let request = yield* random.randomUUIDv4
					dialogOwner = selected
					openDialog(
						dialog,
						report,
						refreshLibrary,
						"Move to workspace",
						html`<label
							>Workspace${pickerMarkup(
								"workspace",
								"Workspace",
								destinations.map(space => ({
									value: space.workspace,
									label: space.name,
								})),
								destinations[0]?.workspace ?? "",
							)}</label
						>`,
						form =>
							selected.tasks.run(
								account
									.request(
										account.api.documents.move({
											params: { document: selected.document },
											payload: {
												workspace: String(form.get("workspace") ?? ""),
												request,
											},
										}),
									)
									.pipe(Effect.andThen(library.refresh)),
							),
					)
					return
				}
				if (action === "leave") {
					if (
						!(yield* askDocument(
							selected,
							confirmDialog(dialog, "Leave " + doc.title + "?", "Leave"),
						))
					)
						return
					let request = yield* random.randomUUIDv4
					let left = yield* account.request(
						account.api.invitations.leaveTarget({
							payload: { target: { document: selected.document }, request },
						}),
					)
					if (!left)
						return report(
							"Your access was granted directly; ask the owner to remove it",
						)
					yield* closeSelection(selected)
					yield* library.refresh
					return
				}
				if (action === "duplicate") {
					let destination = library.state
						.current()
						.library.workspaces.find(space => space.workspace === workspace)
					let target =
						destination && destination.role !== "reader"
							? workspace
							: "personal-" + account.subject
					let copied = yield* duplicateDocumentVersion(
						library,
						selected.opened.blobs,
						selected.opened.session.replica,
						doc.id,
						doc.title + " (copy)",
						target,
					).pipe(Effect.provideService(Crypto.Crypto, random))
					yield* open(copied)
					return
				}

				return yield* Fiber.join(
					selected.tasks.fork(
						Effect.gen(function* () {
							if (action === "save") return yield* selected.opened.session.flush
							if (action === "undo" || action === "redo") {
								if (!writable() || undoWaiting.has(selected)) return
								undoWaiting.add(selected)
								return yield* (
									action === "redo"
										? selected.opened.session.redo()
										: selected.opened.session.undo()
								).pipe(
									Effect.ensuring(
										Effect.sync(() => undoWaiting.delete(selected)),
									),
								)
							}
							if (action === "media-retry") {
								selected.media.retry()
								return
							}
							if (action.startsWith("asset-download:")) {
								let asset = selected.opened.assets
									.current()
									.find(
										asset =>
											asset.id === action.slice("asset-download:".length),
									)
								if (!asset?.fields.data) return
								let blob = yield* selected.opened.blobs.read(asset.fields.data)
								yield* Effect.acquireUseRelease(
									Effect.sync(() =>
										URL.createObjectURL(
											new Blob([blob], { type: "application/octet-stream" }),
										),
									),
									url =>
										Effect.sync(() => {
											let link = document.createElement("a")
											link.href = url
											link.download = asset.fields.name ?? "Asset"
											link.click()
										}).pipe(Effect.andThen(Effect.sleep("1 second"))),
									url => Effect.sync(() => URL.revokeObjectURL(url)),
								)
								return
							}
							if (action.startsWith("jump-comment:")) {
								let comment = selected.opened.discussion
									.current()
									.find(
										comment =>
											comment.id === action.slice("jump-comment:".length),
									)
								if (!comment?.range)
									return report("The commented text has been deleted")
								if (mode !== "edit") {
									mode = "edit"
									mountDocument()
								}
								editor?.selectRange(comment.range.start, comment.range.end)
								return
							}
							if (action === "print") {
								yield* Effect.tryPromise(() =>
									printDocument(doc.content, {
										slideshow: mode === "slideshow",
										render: (host, source) =>
											renderPreview(host, source, rendering(doc), id =>
												launch(open(id)),
											),
									}),
								)
								return
							}
							if (action === "download") {
								let { downloadFile, exportDocument, libraryTitles } =
									yield* archives
								yield* downloadFile(
									yield* exportDocument(
										selected.opened,
										selected.document,
										libraryTitles(library),
									),
								)
								return
							}
							if (!writable()) return
							if (action === "asset") {
								requestAsset(selected)
								return
							}
							if (action.startsWith("asset-insert:")) {
								let captured = editor?.attachmentSelection()
								if (mode === "edit" && !captured)
									return report("Finish editing before inserting an attachment")
								yield* selected.opened.assets.insert(
									action.slice("asset-insert:".length),
									captured,
								)
								return
							}
							if (action.startsWith("asset-mute:")) {
								let id = action.slice("asset-mute:".length)
								yield* selected.opened.assets.mute(
									id,
									selected.opened.session.replica.fields(id).muted !== "true",
								)
								return
							}
							if (action.startsWith("asset-rename:")) {
								let id = action.slice("asset-rename:".length)
								let name = yield* askDocument(
									selected,
									promptDialog(
										dialog,
										"Attachment name",
										selected.opened.session.replica.fields(id).name ?? "",
									),
								)
								if (name !== undefined)
									yield* selected.opened.assets.rename(id, name)
								return
							}
							if (action.startsWith("asset-delete:")) {
								let id = action.slice("asset-delete:".length)
								if (
									yield* askDocument(
										selected,
										confirmDialog(
											dialog,
											"Remove this attachment and its source references?",
											"Remove",
										),
									)
								)
									yield* selected.opened.assets.delete(id)
								return
							}
							if (action === "comment" || action.startsWith("reply:")) {
								let captured =
									mode === "preview"
										? previewCommentSelection(
												element("#preview"),
												selected.opened.session.replica.visible(
													selected.document,
												),
												doc.content,
											)
										: editor?.selectionAnchor()
								if (action === "comment" && !captured)
									return report("Finish editing before adding a comment")
								let composer =
									action === "comment" && captured
										? yield* selected.opened.discussion.prepareComment(captured)
										: yield* selected.opened.discussion.prepareReply(
												action.slice("reply:".length),
											)
								dialogOwner = selected
								let cancelling = new AbortController()
								dialog.addEventListener("close", () => cancelling.abort(), {
									once: true,
								})
								openDialog(
									dialog,
									report,
									() => {
										panel = "comments"
										refreshDocument()
									},
									action === "comment" ? "Add comment" : "Reply",
									html`${action === "comment" && captured?.quote ? html`<blockquote>${captured.quote}</blockquote>` : ""}<label
											>Comment<textarea
												name="body"
												rows="4"
												required
											></textarea>
										</label>`,
									form =>
										selected.tasks.run(
											Effect.gen(function* () {
												if (selection !== selected || !writable())
													return yield* Effect.fail(
														new PermissionDenied({
															message: "This document is read-only",
														}),
													)
												yield* composer.submit(String(form.get("body") ?? ""))
											}).pipe(
												Effect.catchCause(cause =>
													Cause.hasFails(cause) || Cause.hasDies(cause)
														? Effect.failCause(cause)
														: Effect.void,
												),
											),
											cancelling.signal,
										),
								)
								return
							}
							if (
								action.startsWith("resolve:") ||
								action.startsWith("reopen:")
							) {
								yield* selected.opened.discussion.resolve(
									action.slice(action.indexOf(":") + 1),
									action.startsWith("resolve:"),
								)
								return
							}
							if (action.startsWith("delete-comment:")) {
								yield* selected.opened.discussion.delete(
									action.slice("delete-comment:".length),
								)
								return
							}
							if (action === "toggle-comments") {
								yield* selected.opened.discussion.setEnabled(
									selected.opened.session.replica.metadata(doc.id)
										.commentsDisabled,
								)
								return
							}
							if (
								action === "rename" ||
								action === "pin" ||
								action === "archive"
							) {
								let title =
									action === "rename"
										? yield* askDocument(
												selected,
												promptDialog(dialog, "Document title", doc.title),
											)
										: undefined
								if (title === undefined && action === "rename") return
								yield* selected.opened.session.change(
									action === "rename"
										? "Rename document"
										: action === "pin"
											? "Pin document"
											: "Archive document",
									staged => [
										staged.edit(
											doc.id,
											metadataSource(
												staged.text(doc.id),
												action === "rename"
													? { title: title ?? doc.title }
													: action === "pin"
														? { pinned: !doc.pinned }
														: { archived: !doc.archived },
											),
										),
									],
								)
								refreshLibrary()
							}
						}).pipe(
							Effect.catchCause(cause =>
								selection === selected ? Effect.failCause(cause) : Effect.void,
							),
						),
					),
				)
			})
		}
		function importTheme(source: string, name: string) {
			return Effect.gen(function* () {
				let selected = selection
				if (!selected || !writable())
					return yield* new PermissionDenied({
						message: "Open a writable document to import a theme",
					})
				let compiled = yield* Effect.try(() => compileTheme(source))
				let id = yield* random.randomUUIDv4
				let document = selected.document
				yield* selected.opened.session.change("Import theme", staged => [
					staged.set(id, "type", "theme"),
					staged.set(id, "document", document),
					staged.set(id, "name", compiled.metadata.name || name || "Theme"),
					staged.edit(id, source),
					staged.edit(
						document,
						withFrontmatter(staged.text(document), { "theme-id": id }),
					),
				])
				toast("Theme imported")
			})
		}
		// Closing flushes the document's last edits before its file disappears.
		function closeSelection(selected: Selection) {
			return selecting.withPermit(
				Effect.gen(function* () {
					if (selection !== selected) return
					selection = undefined
					mountDocument()
					if (!page)
						router.record(
							{ kind: "library", ...(workspace ? { workspace } : {}) },
							{ replace: true },
						)
					yield* Scope.close(selected.scope, Exit.void)
					refreshLibrary()
				}),
			)
		}
		function setLayout(
			part: "library" | "tools",
			open: boolean,
			animate = true,
		) {
			if (animate) app.dataset.layoutMotion = ""
			app.classList.toggle(part + "-open", open)
			let narrow = matchMedia("(max-width: 1100px)").matches
			if (open && narrow)
				app.classList.toggle(
					part === "library" ? "tools-open" : "library-open",
					false,
				)
			try {
				localStorage.setItem(
					"alkalye-layout",
					JSON.stringify({
						library: app.classList.contains("library-open"),
						tools: app.classList.contains("tools-open"),
					}),
				)
			} catch {}
		}
		function report(error: unknown) {
			toast(error instanceof Error ? error.message : String(error))
		}
	})
}
function readLayout() {
	try {
		let stored: unknown = JSON.parse(
			localStorage.getItem("alkalye-layout") ?? "{}",
		)
		if (typeof stored === "object" && stored !== null)
			return {
				library: "library" in stored && stored.library === true,
				tools: "tools" in stored && stored.tools === true,
			}
	} catch {}
	return { library: false, tools: false }
}
