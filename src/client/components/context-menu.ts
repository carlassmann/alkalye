import { menuNavigation } from "../ui/menu"
import { fitPanel } from "../ui/placement"
import { icon } from "../icons"
import type { IconName } from "../icons"
import { translate } from "../language"

export interface MenuItem {
	icon?: IconName
	label: string
	shortcut?: string
	disabled?: boolean
	run(): void
}
export interface MenuGroup {
	icon?: IconName
	label: string
	items: MenuEntry[]
}
export type MenuEntry = MenuItem | MenuGroup | "separator" | { note: string }

export function openContextMenu(event: MouseEvent, items: MenuEntry[]) {
	event.preventDefault()
	let invoker = document.activeElement
	let events = new AbortController()
	document.querySelector("[data-context-menu]")?.remove()
	let menu = renderMenu(items, () => menu.hidePopover(), events.signal)
	document.body.append(menu)
	menu.showPopover()
	place(menu, event.clientX, event.clientY)
	menu.addEventListener("keydown", event => {
		if (event.key !== "Escape") return
		event.preventDefault()
		event.stopPropagation()
		menu.hidePopover()
		if (invoker instanceof HTMLElement && invoker.isConnected)
			invoker.focus({ preventScroll: true })
	})
	menu.addEventListener("toggle", event => {
		if (event.newState === "closed")
			void Promise.allSettled(
				menu.getAnimations().map(animation => animation.finished),
			).then(() => {
				menu.remove()
				events.abort()
			})
	})
	focusFirst(menu)
	return {
		close() {
			if (menu.matches(":popover-open")) menu.hidePopover()
			else {
				menu.remove()
				events.abort()
			}
		},
	}
}

function renderMenu(
	entries: MenuEntry[],
	close: () => void,
	signal: AbortSignal,
) {
	let menu = document.createElement("div")
	menu.dataset.contextMenu = ""
	menu.popover = "auto"
	menu.setAttribute("role", "menu")
	for (let entry of entries) {
		if (entry === "separator") {
			let separator = document.createElement("hr")
			separator.setAttribute("role", "separator")
			menu.append(separator)
			continue
		}
		if ("note" in entry) {
			let note = document.createElement("p")
			note.textContent = translate(entry.note)
			menu.append(note)
			continue
		}
		let button = document.createElement("button")
		button.type = "button"
		button.setAttribute("role", "menuitem")
		if ("icon" in entry && entry.icon)
			button.insertAdjacentHTML("beforeend", icon(entry.icon).value)
		let label = document.createElement("span")
		label.textContent = translate(entry.label)
		button.append(label)
		menu.append(button)
		if ("items" in entry) {
			let submenu = renderMenu(entry.items, close, signal)
			button.setAttribute("aria-haspopup", "menu")
			button.setAttribute("aria-expanded", "false")
			button.dataset.submenu = ""
			// Nested inside the parent so the browser treats it as a child popover
			// and keeps the parent open while it shows.
			menu.append(submenu)
			submenu.addEventListener("toggle", event => {
				button.setAttribute("aria-expanded", String(event.newState === "open"))
			})
			let open = (focus: boolean) => {
				for (let other of menu.querySelectorAll<HTMLElement>(
					":scope > [data-context-menu]:popover-open",
				))
					if (other !== submenu) other.hidePopover()
				if (!submenu.matches(":popover-open")) {
					submenu.showPopover()
					let bounds = button.getBoundingClientRect()
					let right = bounds.right + submenu.offsetWidth + 8 <= innerWidth
					place(
						submenu,
						right ? bounds.right : bounds.left - submenu.offsetWidth,
						bounds.top - 5,
					)
				}
				if (focus) focusFirst(submenu)
			}
			button.onclick = () => open(true)
			button.onpointerenter = event => {
				if (event.pointerType === "mouse") open(false)
			}
			button.onkeydown = event => {
				if (event.key !== "ArrowRight") return
				event.preventDefault()
				event.stopPropagation()
				open(true)
			}
			submenu.addEventListener("keydown", event => {
				if (event.key !== "ArrowLeft" && event.key !== "Escape") return
				event.preventDefault()
				event.stopPropagation()
				submenu.hidePopover()
				button.focus()
			})
			continue
		}
		let item = entry
		if (item.shortcut) {
			let shortcut = document.createElement("kbd")
			shortcut.textContent = item.shortcut
			button.append(shortcut)
		}
		button.disabled = item.disabled ?? false
		button.onpointerenter = event => {
			if (event.pointerType !== "mouse") return
			for (let other of menu.querySelectorAll<HTMLElement>(
				":scope > [data-context-menu]:popover-open",
			))
				other.hidePopover()
		}
		button.onclick = () => {
			close()
			item.run()
		}
	}
	menuNavigation(
		menu,
		{
			items: () => [...menu.querySelectorAll<HTMLElement>(":scope > button")],
			close: restore => {
				menu.hidePopover()
				if (
					restore !== false &&
					menu.parentElement?.hasAttribute("data-context-menu")
				)
					menu.parentElement
						.querySelector<HTMLElement>('[aria-expanded="true"]')
						?.focus()
			},
		},
		signal,
	)
	return menu
}

function place(menu: HTMLElement, x: number, y: number) {
	let position = fitPanel(
		{ x, y },
		{ width: menu.offsetWidth, height: menu.offsetHeight },
		{ width: innerWidth, height: innerHeight },
	)
	menu.style.left = position.x + "px"
	menu.style.top = position.y + "px"
}

function focusFirst(menu: HTMLElement) {
	menu
		.querySelector<HTMLButtonElement>(":scope > button:not(:disabled)")
		?.focus()
}
