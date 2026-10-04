import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { connectPopover } from "../ui/menu"
import { icon } from "../icons"
import type { IconName } from "../icons"
import { html, joinMarkup } from "../language"
import type { Markup } from "../language"
import { setMarkup } from "../dom"

// Dropdowns built on the Popover API: the browser supplies the top layer,
// light dismiss and Escape; these elements add placement, roving focus and
// selection. They replace native <select>s whose mobile pickers do not match
// the rest of the interface.

export interface MenuChoice {
	readonly value: string
	readonly label: string
	readonly icon?: IconName
}
export interface MenuCommand {
	readonly action: string
	readonly label: string
	readonly icon: IconName
}

let sequence = 0

export class PickerElement extends HTMLElement {
	static formAssociated = true
	private internals = this.attachInternals()
	private choices: MenuChoice[] = []
	private selected = ""
	private events: AbortController | undefined
	connectedCallback() {
		this.dataset.picker = ""
		if (!this.choices.length)
			this.choices = [...this.querySelectorAll("option")].map(option => ({
				value: option.value,
				label: option.textContent?.trim() ?? option.value,
			}))
		this.selected = this.getAttribute("value") ?? this.choices[0]?.value ?? ""
		this.render()
	}
	disconnectedCallback() {
		this.events?.abort()
		this.events = undefined
	}
	get value() {
		return this.selected
	}
	set value(value: string) {
		this.selected = value
		this.internals.setFormValue(value)
		this.update()
	}
	get name() {
		return this.getAttribute("name") ?? ""
	}
	setChoices(choices: readonly MenuChoice[], value = this.selected) {
		this.choices = [...choices]
		this.selected = value
		if (this.isConnected) this.render()
	}
	private render() {
		this.events?.abort()
		let events = new AbortController()
		this.events = events
		let id = "picker-" + ++sequence
		let label = this.getAttribute("label") ?? this.name
		setMarkup(
			this,
			html`<button
					type="button"
					class="menu-trigger"
					aria-haspopup="listbox"
					aria-expanded="false"
					aria-controls="${id}"
					aria-label="${label}"
				>
					<span class="menu-value"></span>${icon("chevron-down")}
				</button>
				<div
					class="menu-popover"
					id="${id}"
					popover
					role="listbox"
					aria-label="${label}"
				>
					${joinMarkup(this.choices.map(choice => html`<button type="button" role="option" data-value="${choice.value}" aria-selected="false" tabindex="-1">${choice.icon ? icon(choice.icon) : ""}<span>${choice.label}</span>${icon("check")}</button>`))}
				</div>`,
		)
		let trigger = this.querySelector<HTMLButtonElement>(".menu-trigger")
		let popover = this.querySelector<HTMLElement>(".menu-popover")
		if (!trigger || !popover) return
		connectPopover(trigger, popover, events.signal, {
			items: () => [...popover.querySelectorAll<HTMLElement>("[role=option]")],
			selected: () =>
				popover.querySelector<HTMLElement>('[aria-selected="true"]') ??
				undefined,
			choose: item => {
				this.value = item.dataset.value ?? ""
				this.dispatchEvent(new Event("input", { bubbles: true }))
				this.dispatchEvent(new Event("change", { bubbles: true }))
			},
		})
		this.internals.setFormValue(this.selected)
		this.update()
	}
	private update() {
		let current = this.choices.find(choice => choice.value === this.selected)
		let value = this.querySelector(".menu-value")
		if (value) value.textContent = current?.label ?? ""
		for (let item of this.querySelectorAll<HTMLElement>("[role=option]"))
			item.setAttribute(
				"aria-selected",
				String(item.dataset.value === this.selected),
			)
	}
}

// The original's workspace selector: the current workspace opens a menu of
// workspaces followed by commands to create or open more.
export class WorkspaceMenuElement extends HTMLElement {
	private choices: MenuChoice[] = []
	private commands: MenuCommand[] = []
	private selected = ""
	private events: AbortController | undefined
	connectedCallback() {
		this.dataset.workspaceMenu = ""
		this.render()
	}
	disconnectedCallback() {
		this.events?.abort()
		this.events = undefined
	}
	get value() {
		return this.selected
	}
	set value(value: string) {
		this.selected = value
		this.update()
	}
	update(
		choices: readonly MenuChoice[] = this.choices,
		commands: readonly MenuCommand[] = this.commands,
	) {
		let changed =
			JSON.stringify(choices) !== JSON.stringify(this.choices) ||
			JSON.stringify(commands) !== JSON.stringify(this.commands)
		this.choices = [...choices]
		this.commands = [...commands]
		if (changed && this.isConnected) return this.render()
		let current = this.choices.find(choice => choice.value === this.selected)
		let trigger = this.querySelector(".menu-trigger")
		let label = trigger?.querySelector(".menu-value")
		if (label) label.textContent = current?.label ?? "Personal"
		let leading = trigger?.querySelector(".menu-icon")
		if (leading) setMarkup(leading, icon(current?.icon ?? "user"))
		for (let item of this.querySelectorAll<HTMLElement>("[role=menuitemradio]"))
			item.setAttribute(
				"aria-checked",
				String(item.dataset.value === this.selected),
			)
	}
	private render() {
		this.events?.abort()
		let events = new AbortController()
		this.events = events
		let id = "workspace-menu-" + ++sequence
		setMarkup(
			this,
			html`<button
					type="button"
					class="menu-trigger"
					id="workspace"
					aria-haspopup="menu"
					aria-expanded="false"
					aria-controls="${id}"
					aria-label="Workspace"
				>
					<span class="menu-icon"></span
					><span class="menu-value"></span>${icon("chevron-down")}
				</button>
				<div
					class="menu-popover"
					id="${id}"
					popover
					role="menu"
					aria-label="Workspaces"
				>
					${joinMarkup(this.choices.map(choice => html`<button type="button" role="menuitemradio" data-value="${choice.value}" aria-checked="false" tabindex="-1">${icon(choice.icon ?? "users")}<span>${choice.label}</span>${icon("check")}</button>`))}
					<hr />
					${joinMarkup(this.commands.map(command => html`<button type="button" role="menuitem" data-action="${command.action}" tabindex="-1">${icon(command.icon)}<span>${command.label}</span></button>`))}
				</div>`,
		)
		let trigger = this.querySelector<HTMLButtonElement>(".menu-trigger")
		let popover = this.querySelector<HTMLElement>(".menu-popover")
		if (!trigger || !popover) return
		connectPopover(trigger, popover, events.signal, {
			items: () => [
				...popover.querySelectorAll<HTMLElement>(
					"[role=menuitemradio], [role=menuitem]",
				),
			],
			selected: () =>
				popover.querySelector<HTMLElement>('[aria-checked="true"]') ??
				undefined,
			choose: item => {
				if (item.dataset.value === undefined) return
				this.selected = item.dataset.value
				this.update()
				this.dispatchEvent(new Event("change", { bubbles: true }))
			},
		})
		this.update()
	}
}

export function pickerMarkup(
	name: string,
	label: string,
	choices: readonly MenuChoice[],
	value: string,
	member?: string,
): Markup {
	return html`<alkalye-picker
		name="${name}"
		label="${label}"
		value="${value}"
		${member ? html`data-member="${member}"` : ""}
		>${joinMarkup(choices.map(choice => html`<option value="${choice.value}">${choice.label}</option>`))}</alkalye-picker
	>`
}

customElements.define("alkalye-picker", PickerElement)
customElements.define("alkalye-workspace-menu", WorkspaceMenuElement)

export class MenuElement extends HTMLElement {
	private lifetime: Fiber.Fiber<void, never> | undefined
	connectedCallback() {
		if (this.lifetime) return
		this.dataset.menu = ""
		let host = this
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let events = yield* Effect.acquireRelease(
						Effect.sync(() => new AbortController()),
						events => Effect.sync(() => events.abort()),
					)
					let trigger = host.querySelector<HTMLButtonElement>(":scope > button")
					let panel = host.querySelector<HTMLElement>(":scope > [popover]")
					if (!trigger || !panel) return
					let items = () => {
						let result = [
							...panel.querySelectorAll<HTMLElement>("button, a[href]"),
						].filter(item => item.closest("[popover]") === panel)
						if (panel.getAttribute("role") === "menu")
							for (let item of result) {
								if (!item.hasAttribute("role"))
									item.setAttribute("role", "menuitem")
								item.tabIndex = -1
							}
						return result
					}
					connectPopover(trigger, panel, events.signal, {
						items,
						selected: () =>
							items().find(
								item => item.getAttribute("aria-checked") === "true",
							),
						side: host.getAttribute("side") === "top" ? "top" : "bottom",
						align: host.getAttribute("align") === "end" ? "end" : "start",
					})
					return yield* Effect.never
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
customElements.define("alkalye-menu", MenuElement)
