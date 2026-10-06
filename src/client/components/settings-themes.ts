import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Stream from "effect/Stream"
import { themesFor } from "../../shared/theme-library"
import type { LibraryTheme } from "../../shared/theme-library"
import type { BrowserPreferences } from "../browser-preferences"
import { setMarkup } from "../dom"
import { icon } from "../icons"
import { html, joinMarkup, translate } from "../language"
import type { ThemeLibrary } from "../theme-library"
import { ThemeUploadInvalid } from "../theme-library"
import { confirmDialog } from "./dialog"
import { PickerElement, pickerMarkup } from "./menu"

type Themes = Context.Service.Shape<typeof ThemeLibrary>
interface SettingsThemesOptions {
	themes: Themes
	preferences: Context.Service.Shape<typeof BrowserPreferences>
	workbench(theme: string): void
	dialog(): HTMLDialogElement | undefined
	report(error: unknown): void
}
interface UploadFailure {
	message: string
	errors: readonly string[]
}

// Settings → Editor → Themes: the account's theme library with its default
// preview and slideshow themes, as in the original.
export class SettingsThemesElement extends HTMLElement {
	private options: SettingsThemesOptions | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(options: SettingsThemesOptions) {
		this.options = options
		if (this.isConnected) this.connectedCallback()
	}
	connectedCallback() {
		this.dataset.settingsThemes = ""
		let configured = this.options
		if (!configured || this.lifetime) return
		let options = configured
		let host = this
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let run = yield* FiberSet.makeRuntime<never>()
					let events = yield* Effect.acquireRelease(
						Effect.sync(() => new AbortController()),
						events => Effect.sync(() => events.abort()),
					)
					let uploading = false
					let failure: UploadFailure | undefined
					let shown = ""
					function perform(work: Effect.Effect<unknown, unknown>) {
						run(
							work.pipe(
								Effect.catch(error => Effect.sync(() => options.report(error))),
							),
						)
					}
					function render() {
						let state = options.themes.state.current()
						let editor = options.preferences.state.current().value.editor
						let key = JSON.stringify([
							state.themes.map(theme => [
								theme.id,
								theme.name,
								theme.kind,
								theme.author,
							]),
							editor.previewTheme,
							editor.slideshowTheme,
							uploading,
							failure,
							Boolean(options.themes.document()),
						])
						if (key === shown) return
						shown = key
						setMarkup(
							host,
							themesMarkup(
								state.themes,
								editor.previewTheme,
								editor.slideshowTheme,
								uploading,
								failure,
								Boolean(options.themes.document()),
							),
						)
					}
					host.addEventListener(
						"click",
						event => {
							if (!(event.target instanceof Element)) return
							let control = event.target.closest<HTMLButtonElement>(
								"button[data-theme-action]",
							)
							if (!control || control.disabled) return
							let action = control.dataset.themeAction
							let id = control.dataset.theme ?? ""
							let theme = options.themes.state
								.current()
								.themes.find(theme => theme.id === id)
							if (action === "dismiss") {
								failure = undefined
								render()
							} else if (action === "new")
								perform(
									options.themes
										.create()
										.pipe(
											Effect.tap(id =>
												Effect.sync(() => options.workbench(id)),
											),
										),
								)
							else if (action === "upload")
								host
									.querySelector<HTMLInputElement>("[data-theme-file]")
									?.click()
							else if (action === "edit" && theme) options.workbench(theme.id)
							else if (action === "export" && theme)
								perform(downloadTheme(theme))
							else if (action === "delete" && theme) {
								let target = options.dialog()
								if (!target) return
								perform(
									confirmDialog(
										target,
										translate(
											'Are you sure you want to delete "{name}"? Documents using this theme will fall back to default styles.',
										).replace("{name}", theme.name),
										translate("Delete"),
										translate("Delete theme"),
									).pipe(
										Effect.flatMap(confirmed =>
											confirmed ? options.themes.remove(theme.id) : Effect.void,
										),
									),
								)
							}
						},
						{ signal: events.signal },
					)
					host.addEventListener(
						"change",
						event => {
							let target = event.target
							if (
								target instanceof HTMLInputElement &&
								target.matches("[data-theme-file]")
							) {
								let file = target.files?.[0]
								target.value = ""
								if (!file) return
								uploading = true
								failure = undefined
								render()
								run(
									options.themes.upload(file).pipe(
										Effect.catch(error =>
											Effect.sync(() => {
												failure =
													error instanceof ThemeUploadInvalid
														? { message: error.message, errors: error.errors }
														: {
																message:
																	error instanceof Error
																		? error.message
																		: String(error),
																errors: [],
															}
											}),
										),
										Effect.ensuring(
											Effect.sync(() => {
												uploading = false
												render()
											}),
										),
									),
								)
								return
							}
							if (
								target instanceof PickerElement &&
								(target.name === "previewTheme" ||
									target.name === "slideshowTheme")
							)
								perform(
									options.preferences.save({
										editor: { [target.name]: target.value },
									}),
								)
						},
						{ signal: events.signal },
					)
					render()
					yield* Stream.merge(
						options.themes.state.changes,
						options.preferences.state.changes,
					).pipe(Stream.runForEach(() => Effect.sync(render)))
				}),
			),
		)
	}
	disconnectedCallback() {
		let lifetime = this.lifetime
		this.lifetime = undefined
		if (lifetime) Effect.runFork(Fiber.interrupt(lifetime))
	}
	connectedMoveCallback() {}
}
customElements.define("alkalye-settings-themes", SettingsThemesElement)

function downloadTheme(theme: LibraryTheme) {
	return download(
		theme.name.replace(/[\\/:*?"<>|]+/g, "-") + ".theme.md",
		new Blob([theme.source], { type: "text/markdown" }),
	)
}

function download(filename: string, blob: Blob) {
	return Effect.acquireUseRelease(
		Effect.sync(() => URL.createObjectURL(blob)),
		url =>
			Effect.sync(() => {
				let link = document.createElement("a")
				link.href = url
				link.download = filename
				link.click()
			}).pipe(Effect.andThen(Effect.sleep("1 second"))),
		url => Effect.sync(() => URL.revokeObjectURL(url)),
	)
}

function kindLabel(theme: LibraryTheme) {
	return translate(
		theme.kind === "both"
			? "Preview & Slideshow"
			: theme.kind === "preview"
				? "Preview"
				: "Slideshow",
	)
}

function themesMarkup(
	themes: readonly LibraryTheme[],
	previewTheme: string,
	slideshowTheme: string,
	uploading: boolean,
	failure: UploadFailure | undefined,
	editable: boolean,
) {
	let previews = themesFor(themes, "preview")
	let slideshows = themesFor(themes, "slideshow")
	return html`<section class="settings-section">
		<div class="section-heading">
			<div>
				<h2>${translate("Themes")}</h2>
				<p class="section-description">
					${translate("Custom styling for previews and slideshows.")}
				</p>
			</div>
		</div>
		${
			failure
				? html`<div class="theme-upload-error" role="alert">
						${icon("circle-alert")}
						<div>
							<div class="theme-upload-message">
								${translate(failure.message)}
							</div>
							${
								failure.errors.length
									? html`<ul>
											${joinMarkup(
												failure.errors
													.slice(0, 3)
													.map(error => html`<li>${error}</li>`),
											)}${
												failure.errors.length > 3
													? html`<li>
															${translate("and {count} more...").replace(
																"{count}",
																String(failure.errors.length - 3),
															)}
														</li>`
													: ""
											}
										</ul>`
									: ""
							}
						</div>
						<button
							type="button"
							class="icon-button"
							data-theme-action="dismiss"
							aria-label="${translate("Dismiss")}"
						>
							${icon("x")}
						</button>
					</div>`
				: ""
		}
		<div class="settings-panel">
			${
				themes.length
					? html`${joinMarkup(
							themes.map(
								theme =>
									html`<div class="theme-row" data-theme-row="${theme.id}">
										${icon("palette")}
										<div class="theme-text">
											<div class="theme-name">${theme.name}</div>
											<div class="theme-kind">
												${kindLabel(theme)}${
													theme.author
														? ` • ${translate("by")} ${theme.author}`
														: ""
												}
											</div>
										</div>
										<button
											type="button"
											class="icon-button"
											data-theme-action="edit"
											data-theme="${theme.id}"
											aria-label="${translate("Edit")} ${theme.name} ${translate("in workbench")}"
											title="${translate("Edit")} ${theme.name} ${translate("in workbench")}"
											${editable ? "" : "disabled"}
										>
											${icon("pencil")}</button
										><button
											type="button"
											class="icon-button"
											data-theme-action="export"
											data-theme="${theme.id}"
											aria-label="${translate("Export")} ${theme.name}"
											title="${translate("Export")} ${theme.name}"
										>
											${icon("download")}</button
										><button
											type="button"
											class="icon-button"
											data-theme-action="delete"
											data-theme="${theme.id}"
											aria-label="${translate("Delete")} ${theme.name}"
											title="${translate("Delete")} ${theme.name}"
										>
											${icon("trash-2")}
										</button>
									</div>`,
							),
						)}${
							previews.length || slideshows.length
								? html`<div class="group-label">
											${translate("Default themes")}
										</div>
										${previews.length ? defaultRow("previewTheme", "Preview", previews, previewTheme) : ""}${slideshows.length ? defaultRow("slideshowTheme", "Slideshow", slideshows, slideshowTheme) : ""}`
								: ""
						}`
					: html`<div class="settings-empty">
							${icon("palette")}
							<strong>${translate("No themes yet")}</strong>
							<p>
								${translate("Upload a theme file to customize the appearance")}
							</p>
						</div>`
			}
			<div class="settings-actions">
				<input
					type="file"
					accept=".md,.theme.md,.zip"
					hidden
					data-theme-file
					aria-label="${translate("Upload theme")}"
				/><button type="button" class="outline" data-theme-action="new">
					${icon("plus")}<span>${translate("New custom theme")}</span></button
				><button
					type="button"
					class="outline${uploading ? " spinning" : ""}"
					data-theme-action="upload"
					${uploading ? "disabled" : ""}
				>
					${icon(uploading ? "refresh-cw" : "upload")}<span
						>${translate(uploading ? "Uploading..." : "Upload theme")}</span
					>
				</button>
			</div>
		</div>
	</section>`
}

function defaultRow(
	name: "previewTheme" | "slideshowTheme",
	label: string,
	themes: readonly LibraryTheme[],
	value: string,
) {
	return html`<div class="settings-row">
		<div class="row-text">${translate(label)}</div>
		<div class="row-controls">
			${pickerMarkup(
				name,
				translate(label),
				[
					{ value: "", label: translate("None") },
					...themes.map(theme => ({ value: theme.id, label: theme.name })),
				],
				themes.some(theme => theme.id === value) ? value : "",
			)}
		</div>
	</div>`
}
