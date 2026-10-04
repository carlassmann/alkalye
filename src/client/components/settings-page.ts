import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import type * as Context from "effect/Context"
import { editorPreferences } from "../../shared/preferences"
import type {
	AccountPreferences,
	EditorPreferences,
	PreferencePatch,
} from "../../shared/preferences"
import { routeHref, settingsCategories } from "../../shared/routes"
import type { SettingsCategory } from "../../shared/routes"
import { syntaxFamilies } from "../../shared/syntax"
import type { BrowserAccount } from "../browser-account"
import type { BrowserLibrary } from "../browser-library"
import type { BrowserPreferences } from "../browser-preferences"
import { setMarkup } from "../dom"
import { icon } from "../icons"
import type { IconName } from "../icons"
import { html, joinMarkup, translate } from "../language"
import type { Markup } from "../language"
import { AccountAgentsElement } from "./account-agents"
import { pickerMarkup } from "./menu"

export interface SettingsPageOptions {
	readonly category: SettingsCategory
	readonly oauth?: string
	readonly back: string
	readonly workspace: string
	readonly preferences: Context.Service.Shape<typeof BrowserPreferences>
	readonly account: Context.Service.Shape<typeof BrowserAccount>
	readonly library: Context.Service.Shape<typeof BrowserLibrary>
	readonly prepareRestore: Effect.Effect<unknown, unknown>
	readonly choose: (category: SettingsCategory) => void
	readonly backup: () => void
	readonly importFiles: () => void
	readonly install: (() => Promise<unknown>) | undefined
	readonly report: (error: unknown) => void
}

let categories: Record<SettingsCategory, { label: string; icon: IconName }> = {
	general: { label: "General", icon: "sliders-horizontal" },
	editor: { label: "Editor", icon: "pen-line" },
	connections: { label: "Connections", icon: "plug-zap" },
	app: { label: "App & data", icon: "hard-drive" },
}
let numbers = {
	lineWidth: {
		label: "Line width",
		unit: "characters",
		min: 40,
		max: 120,
		step: 1,
	},
	fontSize: { label: "Font size", unit: "px", min: 12, max: 36, step: 1 },
	lineHeight: { label: "Line height", unit: "", min: 1.2, max: 2.5, step: 0.1 },
	letterSpacing: {
		label: "Letter spacing",
		unit: "em",
		min: -0.1,
		max: 0.1,
		step: 0.01,
	},
}
let display: { key: keyof EditorPreferences; label: string }[] = [
	{ key: "strikethroughDoneTasks", label: "Strike through done tasks" },
	{ key: "fadeDoneTasks", label: "Fade done tasks" },
	{ key: "highlightCurrentLine", label: "Highlight current line" },
	{ key: "autoSortTasks", label: "Auto-sort tasks" },
	{ key: "spellcheck", label: "Spellcheck" },
]
let authoring: { key: keyof EditorPreferences; label: string }[] = [
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
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => {
							host.content?.abort()
							host.run = undefined
						}),
					)
					host.renderFrame()
					host.showCategory()
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
				if (
					picker instanceof HTMLElement &&
					"value" in picker &&
					typeof picker.value === "string" &&
					isCategory(picker.value)
				)
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
		if (picker && "value" in picker) picker.value = options.category
		content.id = "settings-" + options.category
		let value = options.preferences.state.current().value
		setMarkup(
			content,
			options.category === "general"
				? generalMarkup(value, options.account.subject)
				: options.category === "editor"
					? editorMarkup(value)
					: options.category === "connections"
						? html`<alkalye-account-agents
								data-account-agents
							></alkalye-account-agents>`
						: appMarkup(Boolean(options.install)),
		)
		content.insertAdjacentHTML("beforeend", String(footerMarkup()))
		let announcement = this.querySelector("[data-settings-announcement]")
		if (announcement)
			announcement.textContent = translate(categories[options.category].label)
		this.scrollTop = 0
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
		content.addEventListener(
			"submit",
			event => {
				if (!(event.target instanceof HTMLFormElement)) return
				if (!event.target.matches("[data-name-form]")) return
				event.preventDefault()
				let name = String(new FormData(event.target).get("name") ?? "").trim()
				if (!name) return
				this.save({ name }, () => this.editName(false))
			},
			{ signal: events.signal },
		)
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
			target.closest("[data-account-agents]") ||
			target.closest("[data-name-form]")
		)
			return
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
			let limits = numbers[name]
			let number = Number(value)
			if (
				!Number.isFinite(number) ||
				number < limits.min ||
				number > limits.max
			) {
				this.options?.report(
					translate(limits.label) + ": " + limits.min + "–" + limits.max,
				)
				return
			}
			return name === "fontSize"
				? this.save({ fontSize: number })
				: this.save({ editor: { [name]: number } })
		}
		this.save({ editor: { [name]: value } })
	}
	private clicked(event: Event) {
		let options = this.options
		if (!options || !(event.target instanceof Element)) return
		let control = event.target.closest<HTMLButtonElement>("button")
		if (!control || control.disabled) return
		let action = control.dataset.preferenceAction ?? control.dataset.settings
		if (action === "edit-name") this.editName(true)
		else if (action === "cancel-name") this.editName(false)
		else if (action === "show-key") {
			let output = this.querySelector<HTMLOutputElement>("[data-recovery-key]")
			if (!output) return
			output.hidden = !output.hidden
			output.textContent = output.hidden
				? ""
				: Redacted.value(options.account.recovery)
			control.textContent = translate(
				output.hidden ? "Show recovery key" : "Hide recovery key",
			)
		} else if (action === "restore-account") {
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
		else if (action === "reset")
			this.save({ editor: editorPreferences(undefined), fontSize: 18 }, () =>
				this.showCategory(),
			)
		else if (action === "sign-in")
			this.run?.(
				options.account.switchAccount.pipe(
					Effect.andThen(options.library.refresh),
				),
			)
		else if (action === "sign-out") this.run?.(options.account.logout)
		else if (action === "backup") options.backup()
		else if (action === "import") options.importFiles()
		else if (action === "install")
			this.run?.(
				Effect.tryPromise(() => options.install?.() ?? Promise.resolve()),
			)
		else if (action === "check-updates") this.checkUpdates(control)
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
	private editName(editing: boolean) {
		let form = this.querySelector<HTMLFormElement>("[data-name-form]")
		let row = this.querySelector<HTMLElement>("[data-name-row]")
		if (!form || !row) return
		form.hidden = !editing
		row.hidden = editing
		let input = form.querySelector<HTMLInputElement>("input")
		if (editing && input) {
			input.value = this.options?.preferences.state.current().value.name ?? ""
			input.focus()
			input.select()
		}
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
		let status = this.querySelector("[data-preferences-status]")
		if (status)
			status.textContent =
				state.message ||
				(state.rejected.length
					? state.rejected.length + " unsynced changes preserved for recovery"
					: "") ||
				(state.pending
					? "Saved on this device; waiting to sync"
					: state.status === "saved"
						? "Synced"
						: "Settings are saved on this device first")
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
	private checkUpdates(control: HTMLButtonElement) {
		let status = this.querySelector("[data-update-status]")
		control.disabled = true
		if (status) status.textContent = translate("Checking…")
		this.run?.(
			Effect.tryPromise(async () => {
				let registration = await navigator.serviceWorker?.getRegistration()
				await registration?.update()
				return Boolean(registration?.waiting || registration?.installing)
			}).pipe(
				Effect.tap(ready =>
					Effect.sync(() => {
						if (status)
							status.textContent = translate(
								ready
									? "A new version is ready; choose Reload below"
									: "You're using the latest version",
							)
					}),
				),
				Effect.ensuring(
					Effect.sync(() => {
						control.disabled = false
					}),
				),
			),
		)
	}
}
customElements.define("alkalye-settings", SettingsPageElement)

function generalMarkup(value: AccountPreferences, subject: string) {
	return html`${section(
		"Profile",
		"The name collaborators see on shared documents.",
		html`<div class="settings-row" data-name-row>
				<span class="row-label">${translate("Display name")}</span
				><span class="row-value" data-name>${value.name}</span
				><button
					type="button"
					data-settings="edit-name"
					aria-label="${translate("Edit name")}"
				>
					${icon("pencil")}
				</button>
			</div>
			<form class="settings-row" data-name-form hidden>
				<input
					name="name"
					maxlength="100"
					required
					aria-label="${translate("Your name")}"
				/><button class="primary">${translate("Save")}</button
				><button type="button" data-settings="cancel-name">
					${translate("Cancel")}
				</button>
			</form>`,
	)}${section(
		"Account & sync",
		"Documents save on this device first and sync to your account.",
		html`<div class="settings-row">
				${icon("cloud")}<span
					class="row-label"
					data-preferences-status
					role="status"
				></span
				><button hidden type="button" data-preference-action="recovery">
					${translate("Download unsynced changes")}
				</button>
			</div>
			<div class="settings-row stacked">
				<label class="field"
					>${translate("Account ID")}<input readonly value="${subject}"
				/></label>
			</div>
			<div class="settings-row stacked">
				<p class="row-title">${translate("Recovery key")}</p>
				<p class="muted">
					${translate("Use your recovery key to open this account on another device or in the CLI.")}
				</p>
				<button type="button" data-preference-action="show-key">
					${translate("Show recovery key")}</button
				><output data-recovery-key hidden></output>
			</div>
			<div class="settings-row stacked">
				<label class="field"
					>${translate("Restore another account")}<input
						type="password"
						name="recovery-key"
						autocomplete="off"
				/></label>
				<button type="button" data-preference-action="restore-account">
					${translate("Restore account")}
				</button>
			</div>
			<div class="settings-row">
				<button type="button" data-settings="sign-in" data-action="sign-in">
					${translate("Sign in to another account")}</button
				><button type="button" data-settings="sign-out" data-action="sign-out">
					${translate("Sign out")}
				</button>
			</div>`,
	)}${section(
		"Appearance",
		"Theme, code highlighting, and interface language.",
		html`${row(
			"Theme",
			pickerMarkup(
				"appearance",
				translate("Theme"),
				[
					{ value: "system", label: translate("System") },
					{ value: "light", label: translate("Light") },
					{ value: "dark", label: translate("Dark") },
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
	)}`
}

function editorMarkup(value: AccountPreferences) {
	let numberValue = {
		lineWidth: value.editor.lineWidth,
		fontSize: value.fontSize,
		lineHeight: value.editor.lineHeight,
		letterSpacing: value.editor.letterSpacing,
	}
	return html`${section(
		"Editor",
		"How writing feels — spacing, task display, and typing behavior.",
		html`<h3>${translate("Typography")}</h3>
			${joinMarkup(
				numberSettings.map(name =>
					row(
						numbers[name].label,
						html`<span class="number-field"
							><input
								type="number"
								name="${name}"
								value="${numberValue[name]}"
								min="${numbers[name].min}"
								max="${numbers[name].max}"
								step="${numbers[name].step}"
								inputmode="decimal"
								aria-label="${translate(numbers[name].label)}"
							/>${numbers[name].unit ? html`<small>${translate(numbers[name].unit)}</small>` : ""}</span
						>`,
					),
				),
			)}
			<h3>${translate("Display")}</h3>
			${joinMarkup(display.map(item => toggle(item.key, item.label, value.editor[item.key] === true)))}
			${row(
				"Spellcheck language",
				pickerMarkup(
					"spellcheckLanguage",
					translate("Spellcheck language"),
					[
						{ value: "", label: translate("System default") },
						{ value: "en", label: "English" },
						{ value: "de", label: "Deutsch" },
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
			<h3>${translate("Authoring behavior")}</h3>
			${joinMarkup(authoring.map(item => toggle(item.key, item.label, value.editor[item.key] === true)))}
			<div class="settings-actions">
				<button type="button" data-preference-action="reset">
					${translate("Reset to defaults")}
				</button>
			</div>`,
	)}`
}

function appMarkup(installable: boolean) {
	let installed = matchMedia("(display-mode: standalone)").matches
	return html`${section(
		"Installation",
		"Install as an app on your device for offline access and better integration.",
		html`<div class="settings-row">
			${icon("smartphone")}<span class="row-label"
				>${translate(installed ? "Installed" : "Not installed")}</span
			>${
				installed
					? ""
					: installable
						? html`<button
								type="button"
								class="primary"
								data-settings="install"
							>
								${translate("Install")}
							</button>`
						: html`<span class="muted"
								>${translate("Use your browser's Share or Install menu")}</span
							>`
			}
		</div>`,
	)}${section(
		"App",
		"",
		html`<div class="settings-row">
				<span class="row-label">${translate("What's new")}</span
				><a href="/changelog" target="_blank" rel="noopener"
					>${translate("Changelog")} ↗</a
				>
			</div>
			<div class="settings-row">
				<span class="row-label" data-update-status
					>${translate("Latest version")}</span
				><button type="button" data-settings="check-updates">
					${translate("Check for updates")}
				</button>
			</div>`,
	)}${section(
		"Data",
		"Back up every document with its attachments, drawings, themes and comments, or import Markdown and backups.",
		html`<div class="settings-row">
				${icon("download")}<span class="row-label"
					>${translate("Back up all documents")}</span
				><button type="button" data-settings="backup">
					${translate("Download ZIP")}
				</button>
			</div>
			<div class="settings-row">
				${icon("upload")}<span class="row-label"
					>${translate("Import documents")}</span
				><button type="button" data-settings="import">
					${translate("Choose files")}
				</button>
			</div>`,
	)}`
}

function footerMarkup() {
	return html`<footer class="settings-footer">
		<a href="/privacy">${translate("Privacy")}</a
		><a href="/imprint">${translate("Imprint")}</a
		><a href="/terms">${translate("Terms")}</a
		><a href="/support">${translate("Support")}</a>
	</footer>`
}

function section(title: string, description: string, content: Markup) {
	return html`<section class="settings-section">
		<h2>${translate(title)}</h2>
		${description ? html`<p class="section-description">${translate(description)}</p>` : ""}
		<div class="settings-panel">${content}</div>
	</section>`
}
function row(label: string, control: Markup) {
	return html`<div class="settings-row">
		<span class="row-label">${translate(label)}</span>${control}
	</div>`
}
function toggle(name: string, label: string, checked: boolean) {
	return html`<label class="settings-row toggle"
		><span class="row-label">${translate(label)}</span
		><input
			type="checkbox"
			role="switch"
			name="${name}"
			${checked ? "checked" : ""}
	/></label>`
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
function isCategory(value: string): value is SettingsCategory {
	return settingsCategories.some(category => category === value)
}
function fromOf(back: string) {
	return back.startsWith("/app") && back !== "/app"
}
