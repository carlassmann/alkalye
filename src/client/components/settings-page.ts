import { AccountEmailElement } from "./account-email"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import type * as Context from "effect/Context"
import { documentDiagnostics } from "../../shared/document-diagnostics"
import { editorPreferences } from "../../shared/preferences"
import type {
	AccountPreferences,
	EditorPreferences,
	PreferencePatch,
} from "../../shared/preferences"
import { routeHref, settingsCategories } from "../../shared/routes"
import type { SettingsCategory } from "../../shared/routes"
import {
	startupEvents,
	startupReport,
	type StartupEvent,
} from "../../shared/startup-diagnostics"
import { syntaxFamilies } from "../../shared/syntax"
import type { BrowserAccount } from "../browser-account"
import type { BrowserLibrary } from "../browser-library"
import type { BrowserPreferences } from "../browser-preferences"
import type { ThemeLibrary } from "../theme-library"
import { setMarkup } from "../dom"
import { isIOS, isMobile } from "../installation"
import type { Installation } from "../installation"
import { icon } from "../icons"
import type { IconName } from "../icons"
import { html, joinMarkup, translate } from "../language"
import type { Markup } from "../language"
import { AccountAgentsElement } from "./account-agents"
import { openDialog } from "./dialog"
import { PickerElement, pickerMarkup } from "./menu"
import { screenIcon } from "./screen-icons"
import { SettingsThemesElement } from "./settings-themes"

export interface SettingsPageOptions {
	readonly category: SettingsCategory
	readonly oauth?: string
	readonly back: string
	readonly workspace: string
	readonly preferences: Context.Service.Shape<typeof BrowserPreferences>
	readonly account: Context.Service.Shape<typeof BrowserAccount>
	readonly library: Context.Service.Shape<typeof BrowserLibrary>
	readonly themes: Context.Service.Shape<typeof ThemeLibrary>
	readonly workbench: (theme: string) => void
	readonly prepareRestore: Effect.Effect<unknown, unknown>
	readonly choose: (category: SettingsCategory) => void
	readonly backup: () => void
	readonly importFiles: () => void
	readonly installation: Installation
	readonly report: (error: unknown) => void
	// The shared application dialog; found in the document when omitted.
	readonly dialog?: HTMLDialogElement
}

let categories: Record<SettingsCategory, { label: string; icon: IconName }> = {
	general: { label: "General", icon: "sliders-horizontal" },
	editor: { label: "Editor", icon: "pen-line" },
	connections: { label: "Connections", icon: "plug-zap" },
	app: { label: "App & data", icon: "hard-drive" },
}
// The original's steppers, within what the preference schema accepts.
let numbers = {
	lineWidth: {
		label: "Line width",
		unit: "ch",
		min: 60,
		max: 120,
		step: 5,
		decimals: 0,
	},
	fontSize: {
		label: "Font size",
		unit: "px",
		min: 12,
		max: 30,
		step: 1,
		decimals: 0,
	},
	lineHeight: {
		label: "Line height",
		unit: "",
		min: 1.2,
		max: 2,
		step: 0.1,
		decimals: 1,
	},
	letterSpacing: {
		label: "Letter spacing",
		unit: "em",
		min: -0.1,
		max: 0.1,
		step: 0.01,
		decimals: 2,
	},
}
let defaultFontSize = 18
let display: { key: keyof EditorPreferences; label: Markup }[] = [
	{
		key: "strikethroughDoneTasks",
		label: html`<span class="label-strike">${translate("Strikethrough")}</span>
			${translate("done tasks")}`,
	},
	{
		key: "fadeDoneTasks",
		label: html`<span class="label-fade">${translate("Fade")}</span>
			${translate("done tasks")}`,
	},
	{
		key: "highlightCurrentLine",
		label: html`${translate("Highlight current line")}`,
	},
	{ key: "autoSortTasks", label: html`${translate("Auto-sort tasks")}` },
	{ key: "spellcheck", label: html`${translate("Spellcheck")}` },
]
let authoring: { key: keyof EditorPreferences; label: string }[] = [
	{
		key: "accessibleInput",
		label: "Full document input for assistive technology",
	},
	{ key: "smartPairs", label: "Smart bracket and quote pairs" },
	{ key: "markerWrapping", label: "Wrap selections in Markdown markers" },
	{ key: "tabIndent", label: "Use Tab to indent Markdown blocks" },
	{ key: "smartPaste", label: "Convert rich text and URLs on paste" },
	{
		key: "autocomplete",
		label: "Slash, link, asset, and language suggestions",
	},
]

// The original application's settings page: a category list beside the
// content on wide screens, a category picker above it on narrow ones. Every
// control saves when it changes.
export class SettingsPageElement extends HTMLElement {
	private options: SettingsPageOptions | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	private run: ((work: Effect.Effect<unknown, unknown>) => void) | undefined
	private content: AbortController | undefined
	private syncing = false
	private syncError = ""
	private diagnosticsCleared = 0
	configure(options: SettingsPageOptions) {
		let previous = this.options
		this.options = options
		this.dataset.settingsPage = ""
		if (!this.isConnected) return
		if (!this.lifetime) return this.connectedCallback()
		if (
			previous?.category !== options.category ||
			previous.oauth !== options.oauth
		)
			this.showCategory()
		let back = this.querySelector<HTMLAnchorElement>(".settings-back")
		if (back) back.href = options.back
	}
	connectedCallback() {
		let configured = this.options
		if (!configured || this.lifetime) return
		let host = this
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let run = yield* FiberSet.makeRuntime<never>()
					host.run = work =>
						run(
							work.pipe(
								Effect.catch(error =>
									Effect.sync(() => host.options?.report(error)),
								),
							),
						)
					let events = yield* Effect.acquireRelease(
						Effect.sync(() => new AbortController()),
						events => Effect.sync(() => events.abort()),
					)
					for (let type of ["online", "offline"])
						window.addEventListener(type, () => host.syncStatus(), {
							signal: events.signal,
						})
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => {
							host.content?.abort()
							host.run = undefined
						}),
					)
					host.renderFrame()
					host.showCategory()
					let unsubscribe = configured.installation.subscribe(() => {
						if (host.options?.category === "app") host.showCategory()
					})
					yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
					yield* configured.preferences.state.changes.pipe(
						Stream.runForEach(() => Effect.sync(() => host.syncStatus())),
					)
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
	private renderFrame() {
		let options = this.options
		if (!options) return
		setMarkup(
			this,
			html`<header class="settings-header">
					<div>
						<a
							class="settings-back"
							href="${options.back}"
							aria-label="${translate("Back")}"
							>${icon("arrow-left")}</a
						>
						<h1>${translate("Settings")}</h1>
					</div>
				</header>
				<p
					class="visually-hidden"
					role="status"
					aria-live="polite"
					data-settings-announcement
				></p>
				<div class="settings-body">
					<div class="settings-picker">
						${pickerMarkup(
							"category",
							translate("Settings categories"),
							settingsCategories.map(category => ({
								value: category,
								label: translate(categories[category].label),
							})),
							options.category,
						)}
					</div>
					<nav
						class="settings-nav"
						aria-label="${translate("Settings categories")}"
					></nav>
					<div class="settings-content"></div>
				</div>`,
		)
		this.querySelector(".settings-picker alkalye-picker")?.addEventListener(
			"change",
			event => {
				let picker = event.currentTarget
				if (picker instanceof PickerElement && isCategory(picker.value))
					this.options?.choose(picker.value)
			},
		)
	}
	private showCategory() {
		let options = this.options
		let content = this.querySelector<HTMLElement>(".settings-content")
		let nav = this.querySelector<HTMLElement>(".settings-nav")
		if (!options || !content || !nav) return
		this.content?.abort()
		let events = new AbortController()
		this.content = events
		setMarkup(
			nav,
			joinMarkup(
				settingsCategories.map(
					category =>
						html`<a
							href="${routeHref({ kind: "settings", category, ...(fromOf(options.back) ? { from: options.back } : {}) })}"
							aria-current="${category === options.category ? "page" : "false"}"
							>${icon(categories[category].icon)}<span
								>${translate(categories[category].label)}</span
							></a
						>`,
				),
			),
		)
		let picker = this.querySelector(".settings-picker alkalye-picker")
		if (picker instanceof PickerElement) picker.value = options.category
		content.id = "settings-" + options.category
		let value = options.preferences.state.current().value
		setMarkup(
			content,
			options.category === "general"
				? html`${generalMarkup(value, options.account.subject)}<alkalye-account-email
						></alkalye-account-email>`
				: options.category === "editor"
					? html`${editorMarkup(value)}<alkalye-settings-themes
							></alkalye-settings-themes>`
					: options.category === "connections"
						? html`<alkalye-account-agents
								data-account-agents
							></alkalye-account-agents>`
						: appMarkup(options.installation.installed()),
		)
		content.insertAdjacentHTML("beforeend", String(footerMarkup()))
		let theme = content.querySelector('alkalye-picker[name="appearance"]')
		if (theme instanceof PickerElement)
			theme.setChoices(
				[
					{ value: "light", label: translate("Light"), icon: "sun" },
					{ value: "dark", label: translate("Dark"), icon: "moon" },
					{ value: "system", label: translate("System"), icon: "sun-moon" },
				],
				value.appearance,
			)
		let announcement = this.querySelector("[data-settings-announcement]")
		if (announcement)
			announcement.textContent = translate(categories[options.category].label)
		this.scrollTop = 0
		let themes = content.querySelector("alkalye-settings-themes")
		if (themes instanceof SettingsThemesElement)
			themes.configure({
				themes: options.themes,
				preferences: options.preferences,
				workbench: options.workbench,
				dialog: () => this.dialog(),
				report: options.report,
			})
		let email = content.querySelector("alkalye-account-email")
		if (email instanceof AccountEmailElement)
			email.configure({
				account: options.account,
				prepareRestore: options.prepareRestore,
			})
		let agents = content.querySelector("alkalye-account-agents")
		if (agents instanceof AccountAgentsElement)
			agents.configure({
				account: options.account,
				library: options.library,
				workspace: options.workspace,
				...(options.oauth ? { consent: options.oauth } : {}),
				report: options.report,
			})
		content.addEventListener("change", event => this.changed(event), {
			signal: events.signal,
		})
		content.addEventListener("click", event => this.clicked(event), {
			signal: events.signal,
		})
		if (options.category === "app") {
			this.checkUpdates(false)
			this.showDiagnostics()
		}
		this.syncStatus()
	}
	private changed(event: Event) {
		let target = event.target
		if (!(target instanceof HTMLElement)) return
		let name =
			target instanceof HTMLInputElement
				? target.name
				: (target.getAttribute("name") ?? "")
		if (
			target.closest(
				"[data-account-agents], [data-settings-themes], [data-account-email]",
			)
		)
			return
		if (name === "recovery-key") return
		let value =
			target instanceof HTMLInputElement && target.type === "checkbox"
				? target.checked
				: "value" in target && typeof target.value === "string"
					? target.value
					: undefined
		if (value === undefined || !name) return
		if (name === "appearance" || name === "language")
			return this.save({ [name]: value })
		if (isNumberSetting(name) && typeof value === "string") {
			let number = Number(value)
			if (!Number.isFinite(number)) return this.showNumber(name)
			return this.saveNumber(name, number)
		}
		this.save({ editor: { [name]: value } })
	}
	private clicked(event: Event) {
		let options = this.options
		if (!options || !(event.target instanceof Element)) return
		let control = event.target.closest<HTMLButtonElement>("button")
		if (!control || control.disabled) return
		let step = control.dataset.step
		let setting = control.dataset.setting ?? ""
		if (step && isNumberSetting(setting)) {
			let current = this.numberValue(setting)
			return this.saveNumber(
				setting,
				current + Number(step) * numbers[setting].step,
			)
		}
		let action = control.dataset.preferenceAction ?? control.dataset.settings
		if (action === "edit-name") this.editName()
		else if (action === "show-key") this.toggleKey()
		else if (action === "copy-key")
			this.copy(Redacted.value(options.account.recovery), control)
		else if (action === "restore-account") {
			let key =
				this.querySelector<HTMLInputElement>(
					'[name="recovery-key"]',
				)?.value.trim() ?? ""
			if (!key) return
			control.disabled = true
			this.run?.(
				options.prepareRestore.pipe(
					Effect.andThen(options.account.restore(key)),
					Effect.andThen(Effect.sync(() => location.assign("/app"))),
					Effect.ensuring(
						Effect.sync(() => {
							control.disabled = false
						}),
					),
				),
			)
		} else if (action === "recovery") this.downloadRejected()
		else if (action === "sync-now") this.syncNow()
		else if (action === "reset") {
			// As in the original, resetting the editor keeps the syntax and
			// default themes, which live in their own sections.
			let { syntaxTheme, previewTheme, slideshowTheme } =
				options.preferences.state.current().value.editor
			this.save(
				{
					editor: {
						...editorPreferences(undefined),
						syntaxTheme,
						previewTheme,
						slideshowTheme,
					},
					fontSize: defaultFontSize,
				},
				() => this.showCategory(),
			)
		} else if (action === "sign-in")
			this.run?.(
				options.account.switchAccount.pipe(
					Effect.andThen(options.library.refresh),
				),
			)
		else if (action === "sign-out") this.run?.(options.account.logout)
		else if (action === "backup") options.backup()
		else if (action === "import") options.importFiles()
		else if (action === "install-instructions") this.showInstall()
		else if (action === "check-updates") this.checkUpdates(true)
		else if (action === "reload-update") this.applyUpdate()
		else if (action === "copy-diagnostics") this.copyDiagnostics(control)
		else if (action === "clear-diagnostics") {
			this.diagnosticsCleared = performance.now()
			performance.clearMarks()
			this.showDiagnostics()
		}
	}
	private save(patch: PreferencePatch, done?: () => void) {
		let options = this.options
		if (!options) return
		this.run?.(
			options.preferences
				.save(patch)
				.pipe(Effect.tap(() => Effect.sync(() => done?.()))),
		)
	}
	private numberValue(name: NumberSetting) {
		let value = this.options?.preferences.state.current().value
		if (!value) return 0
		return name === "fontSize" ? value.fontSize : value.editor[name]
	}
	private saveNumber(name: NumberSetting, number: number) {
		let limits = numbers[name]
		let value = Math.max(
			limits.min,
			Math.min(limits.max, Math.round(number * 1000) / 1000),
		)
		this.showNumber(name, value)
		if (name === "fontSize") this.save({ fontSize: value })
		else this.save({ editor: { [name]: value } })
	}
	// The stepper shows the clamped value and, away from the default, what
	// the default is.
	private showNumber(name: NumberSetting, value = this.numberValue(name)) {
		let row = this.querySelector<HTMLElement>(`[data-number="${name}"]`)
		if (!row) return
		let limits = numbers[name]
		let input = row.querySelector<HTMLInputElement>("input")
		if (input) input.value = value.toFixed(limits.decimals)
		for (let button of row.querySelectorAll<HTMLButtonElement>("[data-step]"))
			button.disabled =
				button.dataset.step === "-1" ? value <= limits.min : value >= limits.max
		let fallback = name === "fontSize" ? defaultFontSize : editorDefault(name)
		let hint = row.querySelector<HTMLElement>(".row-description")
		if (hint) {
			hint.hidden = Math.abs(value - fallback) < 0.001
			hint.textContent =
				translate("default:") +
				" " +
				fallback.toFixed(limits.decimals) +
				limits.unit
		}
	}
	private editName() {
		let options = this.options
		let dialog = this.dialog()
		if (!options || !dialog) return
		let name = options.preferences.state.current().value.name
		openDialog(
			dialog,
			options.report,
			() => {},
			translate("Edit name"),
			html`<div data-name-form>
				<input
					name="name"
					value="${name}"
					maxlength="50"
					required
					autocomplete="name"
					placeholder="${translate("Your name")}"
					aria-label="${translate("Your name")}"
				/>
			</div>`,
			form => {
				let next = String(form.get("name") ?? "").trim()
				if (!next)
					return Promise.reject(new Error(translate("Name is required")))
				return Effect.runPromise(options.preferences.save({ name: next }))
			},
		)
		dialog.querySelector<HTMLInputElement>("[data-name-form] input")?.select()
	}
	private toggleKey() {
		let options = this.options
		let output = this.querySelector<HTMLTextAreaElement>("[data-recovery-key]")
		let block = this.querySelector<HTMLElement>("[data-key-block]")
		let actions = this.querySelector<HTMLElement>("[data-key-actions]")
		if (!options || !output || !block || !actions) return
		let showing = output.hidden
		output.hidden = !showing
		block.hidden = !showing
		actions.hidden = showing
		output.textContent = showing ? Redacted.value(options.account.recovery) : ""
		let next = this.querySelector<HTMLElement>(
			showing
				? '[data-key-block] [data-settings="copy-key"]'
				: "[data-key-actions] button",
		)
		next?.focus()
	}
	private copy(text: string, control: HTMLButtonElement) {
		let label = control.querySelector("span")
		this.run?.(
			Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
				Effect.andThen(
					Effect.sync(() => {
						if (label) label.textContent = translate("Copied")
					}),
				),
				Effect.andThen(Effect.sleep("2 seconds")),
				Effect.ensuring(
					Effect.sync(() => {
						if (label) label.textContent = translate("Copy")
					}),
				),
			),
		)
	}
	private syncNow() {
		let options = this.options
		if (!options || this.syncing) return
		this.syncing = true
		this.syncError = ""
		this.syncStatus()
		this.run?.(
			options.library.refresh.pipe(
				Effect.timeout(Duration.seconds(10)),
				Effect.catch(() =>
					Effect.sync(() => {
						this.syncError = translate("Sync timeout")
					}),
				),
				Effect.ensuring(
					Effect.sync(() => {
						this.syncing = false
						this.syncStatus()
					}),
				),
				Effect.andThen(
					Effect.sync(() => (this.syncError ? 5 : 0)).pipe(
						Effect.flatMap(seconds =>
							seconds
								? Effect.sleep(Duration.seconds(seconds)).pipe(
										Effect.andThen(
											Effect.sync(() => {
												this.syncError = ""
												this.syncStatus()
											}),
										),
									)
								: Effect.void,
						),
					),
				),
			),
		)
	}
	private syncStatus() {
		let options = this.options
		if (!options) return
		let state = options.preferences.state.current()
		let name = this.querySelector("[data-name]")
		if (name) name.textContent = state.value.name
		let recovery = this.querySelector<HTMLButtonElement>(
			'[data-preference-action="recovery"]',
		)
		if (recovery) recovery.hidden = state.rejected.length === 0
		let status = this.querySelector<HTMLElement>("[data-sync-status]")
		let label = status?.querySelector("[data-preferences-status]")
		let description = status?.querySelector<HTMLElement>(
			"[data-sync-description]",
		)
		let symbol = status?.querySelector<HTMLElement>("[data-sync-icon]")
		let button = status?.querySelector<HTMLButtonElement>(
			'[data-settings="sync-now"]',
		)
		if (!status || !label || !description || !symbol || !button) return
		let online = navigator.onLine
		let rejected = state.rejected.length
		let [tone, text, detail, glyph] = state.message
			? ["error", state.message, "", icon("circle-alert")]
			: rejected
				? [
						"error",
						rejected +
							" " +
							translate("unsynced changes preserved for recovery"),
						"",
						icon("circle-alert"),
					]
				: !online
					? [
							"muted",
							translate("Offline"),
							translate(
								"You're offline. Changes will sync when you reconnect.",
							),
							screenIcon("wifi-off"),
						]
					: state.pending
						? [
								"muted",
								translate("Saved on this device; waiting to sync"),
								"",
								icon("cloud"),
							]
						: [
								"ok",
								translate("Syncing to cloud"),
								translate("Your notes are synced to the cloud"),
								icon("cloud"),
							]
		status.dataset.tone = String(tone)
		label.textContent = String(text)
		description.textContent = this.syncError || String(detail)
		description.classList.toggle("error", Boolean(this.syncError))
		description.hidden = !description.textContent
		setMarkup(symbol, glyph)
		button.hidden = !online
		button.disabled = this.syncing
		button.classList.toggle("spinning", this.syncing)
		let buttonLabel = button.querySelector("span")
		if (buttonLabel)
			buttonLabel.textContent = translate(
				this.syncing ? "Syncing..." : "Sync now",
			)
	}
	private downloadRejected() {
		let rejected = this.options?.preferences.state.current().rejected ?? []
		this.run?.(
			Effect.acquireUseRelease(
				Effect.sync(() =>
					URL.createObjectURL(
						new Blob([JSON.stringify(rejected, null, 2)], {
							type: "application/json",
						}),
					),
				),
				url =>
					Effect.sync(() => {
						let link = document.createElement("a")
						link.href = url
						link.download = "alkalye-unsynced-preferences.json"
						link.click()
					}).pipe(Effect.andThen(Effect.sleep("1 second"))),
				url => Effect.sync(() => URL.revokeObjectURL(url)),
			),
		)
	}
	private showInstall() {
		let options = this.options
		let dialog = this.dialog()
		if (!options || !dialog) return
		showInstallationInstructions(dialog, options.installation, options.report)
	}
	private checkUpdates(manual: boolean) {
		let panel = this.querySelector<HTMLElement>("[data-app-status]")
		if (!panel) return
		let control = panel.querySelector<HTMLButtonElement>(
			'[data-settings="check-updates"]',
		)
		if (manual && control) {
			control.disabled = true
			control.classList.add("spinning")
			let label = control.querySelector("span")
			if (label) label.textContent = translate("Checking...")
		}
		this.run?.(
			Effect.tryPromise(async () => {
				let registration = await navigator.serviceWorker?.getRegistration()
				if (manual) await registration?.update()
				return Boolean(registration?.waiting)
			}).pipe(
				Effect.catch(() => Effect.succeed(false)),
				Effect.tap(() => (manual ? Effect.sleep("1500 millis") : Effect.void)),
				Effect.tap(ready =>
					Effect.sync(() => {
						let current = this.querySelector<HTMLElement>("[data-app-status]")
						if (current) setMarkup(current, appStatusMarkup(ready))
					}),
				),
			),
		)
	}
	private applyUpdate() {
		this.run?.(
			Effect.tryPromise(async () => {
				let registration = await navigator.serviceWorker?.getRegistration()
				let waiting = registration?.waiting
				if (!waiting) return location.reload()
				navigator.serviceWorker.addEventListener(
					"controllerchange",
					() => location.reload(),
					{ once: true },
				)
				waiting.postMessage("activate")
			}),
		)
	}
	private diagnostics() {
		return startupEvents(
			[
				...performance.getEntriesByType("navigation"),
				...performance.getEntriesByType("paint"),
				...performance.getEntriesByType("mark"),
			].filter(entry => entry.startTime >= this.diagnosticsCleared),
		)
	}
	private showDiagnostics() {
		let block = this.querySelector<HTMLElement>("[data-diagnostics]")
		if (block) setMarkup(block, diagnosticsMarkup(this.diagnostics()))
		let library = this.options?.library
		if (!library || !block) return
		this.run?.(
			library.diagnostics.pipe(
				Effect.tap(metrics =>
					Effect.sync(() => {
						if (!block.isConnected) return
						block.querySelector(".document-diagnostics")?.remove()
						let summary = document.createElement("pre")
						summary.className = "document-diagnostics"
						summary.textContent = documentDiagnostics(metrics)
						block.append(summary)
					}),
				),
			),
		)
	}
	private copyDiagnostics(control: HTMLButtonElement) {
		let label = control.querySelector("span")
		let events = this.diagnostics()
		let library = this.options?.library
		let set = (text: string) => {
			if (label) label.textContent = translate(text)
		}
		control.disabled = true
		set("Preparing report...")
		this.run?.(
			Effect.gen(function* () {
				let storage = yield* Effect.tryPromise(
					() => navigator.storage?.estimate() ?? Promise.resolve(undefined),
				).pipe(Effect.catch(() => Effect.succeed(undefined)))
				let worker = navigator.serviceWorker?.controller
				let startup = startupReport(events, {
					at: new Date().toISOString(),
					userAgent: navigator.userAgent,
					online: navigator.onLine,
					standalone: matchMedia("(display-mode: standalone)").matches,
					serviceWorker: worker ? worker.state : "none",
					...(storage?.usage !== undefined && storage.quota !== undefined
						? { storage: { usage: storage.usage, quota: storage.quota } }
						: {}),
				})
				let metrics = library ? yield* library.diagnostics : []
				let report = startup + "\n\n" + documentDiagnostics(metrics)
				let copied = yield* Effect.tryPromise(() =>
					navigator.clipboard.writeText(report),
				).pipe(
					Effect.as(true),
					Effect.catch(() => Effect.succeed(false)),
				)
				set(copied ? "Copied" : "Copy failed")
				control.disabled = false
				yield* Effect.sleep("2 seconds")
				set("Copy report")
			}),
		)
	}
	private dialog() {
		return (
			this.options?.dialog ??
			document.querySelector<HTMLDialogElement>("dialog[data-dialog]") ??
			undefined
		)
	}
}
customElements.define("alkalye-settings", SettingsPageElement)

function generalMarkup(value: AccountPreferences, subject: string) {
	return html`${section(
		"Profile",
		"The name collaborators see on shared documents.",
		panel(
			html`<div class="settings-row">
				<div class="row-text">${translate("Display name")}</div>
				<div class="row-controls">
					<span class="row-value" data-name>${value.name}</span
					><button
						type="button"
						class="icon-button"
						data-settings="edit-name"
						aria-label="${translate("Edit name")}"
						title="${translate("Edit name")}"
					>
						${icon("pencil")}
					</button>
				</div>
			</div>`,
		),
	)}${section(
		"Cloud Sync & Backup",
		"",
		panel(
			html`<div class="settings-status" data-sync-status>
					<div class="status-line">
						<span class="status-label"
							><span data-sync-icon></span
							><span data-preferences-status role="status"></span></span
						><button type="button" class="outline" data-settings="sync-now">
							${icon("refresh-cw")}<span>${translate("Sync now")}</span>
						</button>
					</div>
					<p class="status-description" data-sync-description></p>
				</div>
				<div class="settings-actions" data-key-actions>
					<button
						type="button"
						class="outline"
						data-preference-action="show-key"
					>
						${translate("Show recovery key")}</button
					><button
						type="button"
						class="ghost"
						data-settings="sign-out"
						data-action="sign-out"
					>
						${translate("Sign out")}</button
					><button
						hidden
						type="button"
						class="outline"
						data-preference-action="recovery"
					>
						${translate("Download unsynced changes")}
					</button>
				</div>
				<div data-key-block hidden>
					<div class="settings-block">
						<div class="block-label">${translate("Recovery key")}</div>
						<textarea
							readonly
							rows="2"
							data-recovery-key
							hidden
							aria-label="${translate("Recovery key")}"
						></textarea>
					</div>
					<div class="settings-actions">
						<button type="button" class="outline" data-settings="copy-key">
							${icon("copy")}<span>${translate("Copy")}</span></button
						><button
							type="button"
							class="ghost"
							data-preference-action="show-key"
						>
							${translate("Hide")}
						</button>
					</div>
				</div>
				<div class="settings-block">
					<details>
						<summary>Technical account details</summary>
						<label class="block-label" for="account-id"
							>${translate("Account ID")}</label
						>
						<p class="block-description">
							${translate("Share it to be added to a space by its owner.")}
						</p>
						<input id="account-id" readonly value="${subject}" />
					</details>
				</div>
				<div class="settings-block">
					<label class="block-label" for="recovery-key"
						>${translate("Restore another account")}</label
					>
					<p class="block-description">
						${translate("Use your recovery key to open this account on another device or in the CLI.")}
					</p>
					<input
						id="recovery-key"
						type="password"
						name="recovery-key"
						autocomplete="off"
					/>
				</div>
				<div class="settings-actions">
					<button
						type="button"
						class="outline"
						data-preference-action="restore-account"
					>
						${translate("Restore account")}</button
					><button
						type="button"
						class="ghost"
						data-settings="sign-in"
						data-action="sign-in"
					>
						${translate("Reconnect this account")}
					</button>
				</div>`,
		),
	)}${section(
		"Appearance",
		"Theme, code highlighting, and interface language.",
		panel(
			html`${row(
				"Theme",
				pickerMarkup(
					"appearance",
					translate("Theme"),
					[
						{ value: "light", label: translate("Light") },
						{ value: "dark", label: translate("Dark") },
						{ value: "system", label: translate("System") },
					],
					value.appearance,
				),
			)}${row(
				"Syntax theme",
				pickerMarkup(
					"syntaxTheme",
					translate("Syntax theme"),
					syntaxFamilies.map(family => ({
						value: family.id,
						label: family.name,
					})),
					value.editor.syntaxTheme,
				),
			)}${row(
				"Language",
				pickerMarkup(
					"language",
					translate("Language"),
					[
						{ value: "system", label: translate("System") },
						{ value: "en", label: "English" },
						{ value: "de", label: "Deutsch" },
					],
					value.language,
				),
			)}`,
		),
	)}`
}

function editorMarkup(value: AccountPreferences) {
	return section(
		"Editor",
		"How writing feels — spacing, task display, and typing behavior.",
		panel(
			html`<div class="group-label">${translate("Typography")}</div>
				${joinMarkup(
					numberSettings.map(name =>
						numberRow(
							name,
							name === "fontSize" ? value.fontSize : value.editor[name],
						),
					),
				)}
				<div class="group-label">${translate("Display")}</div>
				${joinMarkup(
					display.map(item =>
						toggle(item.key, item.label, value.editor[item.key] === true),
					),
				)}
				${row(
					"Spellcheck language",
					pickerMarkup(
						"spellcheckLanguage",
						translate("Spellcheck language"),
						[
							{ value: "", label: translate("System default") },
							{ value: "en", label: translate("English") },
							{ value: "de", label: translate("German") },
						],
						value.editor.spellcheckLanguage,
					),
				)}
				${row(
					"Stats badge",
					pickerMarkup(
						"statsUnit",
						translate("Stats badge"),
						[
							{ value: "words", label: translate("Words") },
							{ value: "sentences", label: translate("Sentences") },
							{ value: "tasks", label: translate("Tasks") },
							{ value: "hidden", label: translate("Hide") },
						],
						value.editor.statsUnit,
					),
				)}
				<div class="group-label">${translate("Authoring behavior")}</div>
				${joinMarkup(
					authoring.map(item =>
						toggle(
							item.key,
							html`${translate(item.label)}`,
							value.editor[item.key] === true,
						),
					),
				)}`,
		),
		html`<button
			type="button"
			class="ghost muted"
			data-preference-action="reset"
		>
			${translate("Reset to defaults")}
		</button>`,
	)
}

function numberRow(name: NumberSetting, value: number) {
	let limits = numbers[name]
	let label = translate(limits.label)
	let fallback = name === "fontSize" ? defaultFontSize : editorDefault(name)
	let changed = Math.abs(value - fallback) >= 0.001
	return html`<div class="settings-row" data-number="${name}">
		<div class="row-text">
			<label for="setting-${name}">${label}</label>
			<p class="row-description" ${changed ? "" : "hidden"}>
				${translate("default:")}
				${fallback.toFixed(limits.decimals)}${limits.unit}
			</p>
		</div>
		<div class="row-controls">
			<span class="number-unit">${limits.unit}</span>
			<div class="stepper">
				<button
					type="button"
					data-step="-1"
					data-setting="${name}"
					aria-label="${translate("Decrease")} ${label}"
					${value <= limits.min ? "disabled" : ""}
				>
					${screenIcon("minus")}</button
				><input
					id="setting-${name}"
					type="number"
					name="${name}"
					value="${value.toFixed(limits.decimals)}"
					min="${limits.min}"
					max="${limits.max}"
					step="${limits.step}"
					inputmode="decimal"
					aria-label="${label}"
				/><button
					type="button"
					data-step="1"
					data-setting="${name}"
					aria-label="${translate("Increase")} ${label}"
					${value >= limits.max ? "disabled" : ""}
				>
					${icon("plus")}
				</button>
			</div>
		</div>
	</div>`
}

function appMarkup(installed: boolean) {
	return html`${
		installed
			? ""
			: section(
					"Installation",
					"",
					panel(
						html`<div class="settings-status" data-tone="muted">
								<div class="status-line">
									<span class="status-label"
										>${translate("Not installed")}</span
									>
								</div>
								<p class="status-description">
									${translate("Install as an app on your device for offline access and better integration")}
								</p>
							</div>
							<div class="settings-actions">
								<button
									type="button"
									class="outline"
									data-settings="install-instructions"
								>
									${translate("Show instructions")}
								</button>
							</div>`,
					),
				)
	}${section(
		"App",
		"",
		html`<div class="settings-panel" data-app-status>
			${appStatusMarkup(false)}
		</div>`,
	)}${section(
		"Startup diagnostics",
		"Timing trace for recent app launches. Copy it after a slow startup.",
		panel(
			html`<div class="settings-block">
					<div class="diagnostics" data-diagnostics></div>
				</div>
				<div class="settings-actions">
					<button
						type="button"
						class="outline diagnostics-copy"
						data-settings="copy-diagnostics"
					>
						${icon("copy")}<span>${translate("Copy report")}</span></button
					><button
						type="button"
						class="ghost"
						data-settings="clear-diagnostics"
					>
						${icon("trash-2")}<span>${translate("Clear")}</span>
					</button>
				</div>`,
		),
	)}${section(
		"Data",
		"Back up every document with its attachments, drawings, themes and comments, or import Markdown and backups.",
		panel(
			html`<div class="settings-actions">
				<button type="button" class="outline" data-settings="backup">
					${icon("download")}<span
						>${translate("Back up all documents")}</span
					></button
				><button type="button" class="outline" data-settings="import">
					${icon("upload")}<span>${translate("Import documents")}</span>
				</button>
			</div>`,
		),
	)}`
}

function appStatusMarkup(ready: boolean) {
	let changelog = html`<a
		class="button outline"
		href="/changelog"
		target="_blank"
		rel="noopener noreferrer"
		>${translate("What's new")}</a
	>`
	return ready
		? html`<div class="settings-status" data-tone="ok">
					<div class="status-line">
						<span class="status-label">${translate("Update available")}</span>
					</div>
					<p class="status-description">
						${translate("A new version is ready to use")}
					</p>
				</div>
				<div class="settings-actions">
					<button type="button" class="primary" data-settings="reload-update">
						${icon("refresh-cw")}<span
							>${translate("Reload to update")}</span
						></button
					>${changelog}
				</div>`
		: html`<div class="settings-status" data-tone="muted">
					<div class="status-line">
						<span class="status-label">${translate("Latest version")}</span>
					</div>
					<p class="status-description">
						${translate("You're using the latest version")}
					</p>
				</div>
				<div class="settings-actions">
					${changelog}<button
						type="button"
						class="outline"
						data-settings="check-updates"
					>
						${icon("refresh-cw")}<span>${translate("Check for updates")}</span>
					</button>
				</div>`
}

function diagnosticsMarkup(events: readonly StartupEvent[]) {
	let latest = events.at(-1)
	return latest
		? html`<div class="diagnostics-line">
					<span>${latest.event}</span
					><span class="muted">${latest.elapsedMs} ms</span>
				</div>
				<div class="muted">${new Date().toLocaleString()}</div>
				<div class="muted">${events.length} ${translate("events")}</div>`
		: html`<span class="muted">${translate("No events captured yet")}</span>`
}

function installMarkup(installable: boolean) {
	let mobile = isMobile()
	let ios = isIOS()
	let android = /Android/i.test(navigator.userAgent)
	let steps = (title: string, items: string[]) =>
		html`<p class="muted">${translate(title)}</p>
			<ol class="install-steps">
				${joinMarkup(items.map(item => html`<li>${translate(item)}</li>`))}
			</ol>`
	return html`<p>
			${translate(
				mobile
					? "Add Alkalye to your homescreen for instant access and the best experience."
					: "Install Alkalye as an app for quick access and a better experience.",
			)}
		</p>
		<div class="install-instructions">
			${
				installable
					? html`<p class="muted">
								${translate("Your browser supports direct installation:")}
							</p>
							<button type="button" class="primary" data-install-app>
								${translate("Install App")}
							</button>`
					: ios
						? html`${steps(
									"To install on iOS, use Safari and follow these steps:",
									[
										"Tap the Share button at the bottom of Safari",
										'Scroll down and tap "Add to Home Screen"',
										'Tap "Add" in the top right corner',
									],
								)}
								<p class="muted">
									${translate("If Add to Home Screen is missing, open this page in Safari.")}
								</p>`
						: android || mobile
							? steps("To install, follow these steps:", [
									"Tap the menu button in your browser",
									'Select "Add to Home screen" or "Install app"',
									"Confirm the installation",
								])
							: html`<p class="muted">
										${translate("Install instructions vary by browser:")}
									</p>
									<dl class="install-browsers">
										<dt>Chrome / Edge</dt>
										<dd>
											${translate('Look for the install icon in the address bar, or use the menu and select "Install app"')}
										</dd>
										<dt>Safari (macOS)</dt>
										<dd>${translate("Click File > Add to Dock")}</dd>
										<dt>Firefox</dt>
										<dd>
											${translate("On supported Windows versions, use Firefox’s web app button. Otherwise use Chrome or Edge.")}
										</dd>
									</dl>`
			}
		</div>`
}

function footerMarkup() {
	return html`<footer class="settings-footer">
		<a href="/privacy">${translate("Privacy")}</a
		><a href="/imprint">${translate("Imprint")}</a
		><a href="/terms">${translate("Terms")}</a
		><a href="/support">${translate("Support")}</a>
	</footer>`
}

function section(
	title: string,
	description: string,
	content: Markup,
	action?: Markup,
) {
	return html`<section class="settings-section">
		<div class="section-heading">
			<div>
				<h2>${translate(title)}</h2>
				${
					description
						? html`<p class="section-description">${translate(description)}</p>`
						: ""
				}
			</div>
			${action ?? ""}
		</div>
		${content}
	</section>`
}
function panel(content: Markup) {
	return html`<div class="settings-panel">${content}</div>`
}
function row(label: string, control: Markup) {
	return html`<div class="settings-row">
		<div class="row-text">${translate(label)}</div>
		<div class="row-controls">${control}</div>
	</div>`
}
function toggle(name: string, label: Markup, checked: boolean) {
	return html`<label class="settings-row toggle"
		><span class="row-text">${label}</span
		><span class="row-controls"
			><input
				type="checkbox"
				role="switch"
				name="${name}"
				${checked ? "checked" : ""} /></span
	></label>`
}
type NumberSetting = keyof typeof numbers
let numberSettings: NumberSetting[] = [
	"lineWidth",
	"fontSize",
	"lineHeight",
	"letterSpacing",
]
function isNumberSetting(name: string): name is NumberSetting {
	return numberSettings.some(setting => setting === name)
}
function editorDefault(name: Exclude<NumberSetting, "fontSize">) {
	return editorPreferences(undefined)[name]
}
function isCategory(value: string): value is SettingsCategory {
	return settingsCategories.some(category => category === value)
}
function fromOf(back: string) {
	return back.startsWith("/app") && back !== "/app"
}

export function showInstallationInstructions(
	dialog: HTMLDialogElement,
	installation: Installation,
	report: (error: unknown) => void,
) {
	let unsubscribe = () => {}
	let marker: Element | null = null
	let active = true
	let observer = new MutationObserver(() => {
		if (!ownsDialog()) release()
	})
	function ownsDialog() {
		return (
			active &&
			dialog.open &&
			marker !== null &&
			marker === dialog.querySelector("[data-installation-instructions]")
		)
	}
	function release() {
		active = false
		unsubscribe()
		observer.disconnect()
		dialog.removeEventListener("close", release)
	}
	function render() {
		if (marker && !ownsDialog()) {
			release()
			return
		}
		if (installation.installed()) {
			if (ownsDialog()) dialog.close()
			release()
			return
		}
		openDialog(
			dialog,
			report,
			release,
			translate("Install Alkalye"),
			html`<div data-installation-instructions>
				${installMarkup(installation.available())}
			</div>`,
		)
		marker = dialog.querySelector("[data-installation-instructions]")
		let button = dialog.querySelector<HTMLButtonElement>("[data-install-app]")
		if (button)
			button.onclick = () => {
				installation.prompt().then(outcome => {
					if (outcome === "accepted" && ownsDialog()) dialog.close()
				}, report)
			}
	}
	render()
	if (dialog.open && active) {
		unsubscribe = installation.subscribe(render)
		observer.observe(dialog, { childList: true, subtree: true })
		dialog.addEventListener("close", release)
	}
}
