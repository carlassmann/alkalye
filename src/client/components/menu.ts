import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { connectPopover } from "../ui/menu"
import { icon } from "../icons"
import type { IconName } from "../icons"
import { spaceAvatar } from "./space-avatar"
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
	// A space shows its avatar or initials instead of an icon.
	readonly avatar?: { readonly name: string; readonly image?: string }
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
	private initialized = false
	private events: AbortController | undefined
	connectedCallback() {
		this.dataset.picker = ""
		if (!this.choices.length)
			this.choices = [...this.querySelectorAll("option")].map(option => ({
				value: option.value,
				label: option.textContent?.trim() ?? option.value,
			}))
		if (!this.initialized) {
			this.selected = this.getAttribute("value") ?? this.choices[0]?.value ?? ""
			this.initialized = true
		}
		this.render()
	}
	disconnectedCallback() {
		this.events?.abort()
		this.events = undefined
	}
	get value() {
		return this.selected
	}
	connectedMoveCallback() {}
	focus(options?: FocusOptions) {
		this.querySelector<HTMLButtonElement>(".menu-trigger")?.focus(options)
	}
	set value(value: string) {
		this.initialized = true
		this.selected = value
		this.internals.setFormValue(value)
		this.update()
	}
	get name() {
		return this.getAttribute("name") ?? ""
	}
	setChoices(choices: readonly MenuChoice[], value = this.selected) {
		this.initialized = true
		let changed = JSON.stringify(choices) !== JSON.stringify(this.choices)
		this.choices = [...choices]
		this.selected = value
		if (this.isConnected && changed) this.render()
		else this.update()
	}
	private render() {
		let previous = this.querySelector<HTMLElement>(".menu-popover")
		let reopen = previous?.matches(":popover-open") ?? false
		let active =
			document.activeElement instanceof HTMLElement &&
			previous?.contains(document.activeElement)
				? (document.activeElement.dataset.value ??
					document.activeElement.dataset.action)
				: undefined
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
		let control = connectPopover(trigger, popover, events.signal, {
			alignSelected: true,
			minWidth: 144,
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
		this.addEventListener(
			"click",
			event => {
				if (event.target === this) trigger.click()
			},
			{ signal: events.signal },
		)
		if (reopen) {
			control.show()
			let item = [
				...popover.querySelectorAll<HTMLElement>("[data-value]"),
			].find(item => item.dataset.value === active)
			item?.focus({ preventScroll: true })
		}
	}
	private update() {
		let current = this.choices.find(choice => choice.value === this.selected)
		let value = this.querySelector(".menu-value")
		if (value) value.textContent = current?.label ?? ""
		this.querySelector(".menu-trigger")?.setAttribute(
			"aria-label",
			(this.getAttribute("label") ?? this.name) + ": " + (current?.label ?? ""),
		)
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
		trigger?.setAttribute(
			"aria-label",
			"Workspace: " + (current?.label ?? "Personal"),
		)
		let leading = trigger?.querySelector(".menu-icon")
		if (leading)
			setMarkup(
				leading,
				current?.avatar
					? spaceAvatar(current.avatar.name, current.avatar.image)
					: icon(current?.icon ?? "user"),
			)
		for (let item of this.querySelectorAll<HTMLElement>("[role=menuitemradio]"))
			item.setAttribute(
				"aria-checked",
				String(item.dataset.value === this.selected),
			)
	}
	private render() {
		let previous = this.querySelector<HTMLElement>(".menu-popover")
		let reopen = previous?.matches(":popover-open") ?? false
		let active =
			document.activeElement instanceof HTMLElement &&
			previous?.contains(document.activeElement)
				? (document.activeElement.dataset.value ??
					document.activeElement.dataset.action)
				: undefined
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
					${joinMarkup(this.choices.map(choice => html`<button type="button" role="menuitemradio" data-value="${choice.value}" aria-checked="false" tabindex="-1">${choice.avatar ? spaceAvatar(choice.avatar.name, choice.avatar.image) : icon(choice.icon ?? "users")}<span>${choice.label}</span>${icon("check")}</button>`))}
					<hr />
					${joinMarkup(this.commands.map(command => html`<button type="button" role="menuitem" data-action="${command.action}" tabindex="-1">${icon(command.icon)}<span>${command.label}</span></button>`))}
				</div>`,
		)
		let trigger = this.querySelector<HTMLButtonElement>(".menu-trigger")
		let popover = this.querySelector<HTMLElement>(".menu-popover")
		if (!trigger || !popover) return
		let control = connectPopover(trigger, popover, events.signal, {
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
		if (reopen) {
			control.show()
			let item = [
				...popover.querySelectorAll<HTMLElement>("[data-value], [data-action]"),
			].find(item => (item.dataset.value ?? item.dataset.action) === active)
			item?.focus({ preventScroll: true })
		}
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
					let control = connectPopover(trigger, panel, events.signal, {
						submenu: host.hasAttribute("data-submenu"),
						matchTriggerWidth: !host.classList.contains("tool-group"),
						minWidth: host.classList.contains("tool-group") ? 192 : undefined,
						items,
						selected: () =>
							items().find(
								item => item.getAttribute("aria-checked") === "true",
							),
						side: () =>
							host.hasAttribute("data-submenu")
								? host.parentElement
										?.closest("[popover]")
										?.getAttribute("data-side") === "left"
									? "left"
									: "right"
								: host.getAttribute("side") === "left"
									? matchMedia("(max-width: 1100px)").matches
										? "bottom"
										: "left"
									: host.getAttribute("side") === "right"
										? "right"
										: host.getAttribute("side") === "top"
											? "top"
											: "bottom",
						choose: () => {
							let ancestor = host.parentElement?.closest("alkalye-menu")
							while (ancestor) {
								ancestor
									.querySelector<HTMLElement>(":scope > [popover]")
									?.hidePopover()
								ancestor
									.querySelector<HTMLButtonElement>(":scope > button")
									?.focus()
								ancestor = ancestor.parentElement?.closest("alkalye-menu")
							}
						},
						align: host.getAttribute("align") === "end" ? "end" : "start",
					})

					panel.addEventListener(
						"pointermove",
						event => {
							if (
								event.pointerType !== "mouse" ||
								!(event.target instanceof Element) ||
								event.target.closest("[popover]") !== panel
							)
								return
							for (let submenu of panel.querySelectorAll<HTMLElement>(
								"[data-submenu]",
							)) {
								let childTrigger = submenu.querySelector(":scope > button")
								if (!childTrigger?.contains(event.target))
									submenu
										.querySelector<HTMLElement>(
											":scope > [popover]:popover-open",
										)
										?.hidePopover()
							}
						},
						{ signal: events.signal },
					)
					panel.addEventListener(
						"focusin",
						event => {
							if (
								!(event.target instanceof Element) ||
								event.target.closest("[popover]") !== panel
							)
								return
							for (let submenu of panel.querySelectorAll<HTMLElement>(
								"[data-submenu]",
							)) {
								if (
									!submenu
										.querySelector(":scope > button")
										?.contains(event.target)
								)
									submenu
										.querySelector<HTMLElement>(
											":scope > [popover]:popover-open",
										)
										?.hidePopover()
							}
						},
						{ signal: events.signal },
					)
					panel.addEventListener(
						"keydown",
						event => {
							if (event.key !== "Tab") return
							panel.hidePopover()
							let ancestor = host.parentElement?.closest("alkalye-menu")
							while (ancestor) {
								ancestor
									.querySelector<HTMLElement>(":scope > [popover]")
									?.hidePopover()
								ancestor = ancestor.parentElement?.closest("alkalye-menu")
							}
						},
						{ signal: events.signal },
					)
					if (host.hasAttribute("data-submenu")) {
						trigger.addEventListener(
							"pointerenter",
							event => {
								if (
									event.pointerType === "mouse" &&
									!trigger.disabled &&
									!panel.matches(":popover-open")
								)
									control.show("first", false)
							},
							{ signal: events.signal },
						)
						trigger.addEventListener(
							"keydown",
							event => {
								if (event.key !== "ArrowRight") return
								event.preventDefault()
								event.stopPropagation()
								control.show("first")
							},
							{ signal: events.signal },
						)
						panel.addEventListener(
							"keydown",
							event => {
								if (event.key !== "ArrowLeft" || event.defaultPrevented) return
								event.preventDefault()
								event.stopPropagation()
								panel.hidePopover()
								trigger.focus()
							},
							{ signal: events.signal },
						)
					}
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
