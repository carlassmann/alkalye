import { placePanel } from "./placement"
export interface MenuNavigationOptions {
	items(): HTMLElement[]
	selected?(): HTMLElement | undefined
	close(restore?: boolean): void
}

export function menuNavigation(
	panel: HTMLElement,
	options: MenuNavigationOptions,
	signal: AbortSignal,
) {
	let search = ""
	let searchedAt = 0
	function items() {
		return options
			.items()
			.filter(
				item =>
					!item.hasAttribute("disabled") &&
					item.getAttribute("aria-disabled") !== "true" &&
					!item.hidden,
			)
	}
	function focus(position: "first" | "last" | "selected" = "selected") {
		let list = items()
		let selected = options.selected?.()
		let item =
			position === "last"
				? list.at(-1)
				: position === "selected" && selected && list.includes(selected)
					? selected
					: list[0]
		item?.focus({ preventScroll: true })
		item?.scrollIntoView({ block: "nearest" })
	}
	panel.addEventListener(
		"keydown",
		event => {
			if (event.defaultPrevented || event.isComposing) return
			let list = items()
			let current = list.findIndex(item => item === document.activeElement)
			let target = event.target
			if (
				target instanceof Element &&
				!list.some(item => item.contains(target))
			)
				return
			let next =
				event.key === "Home"
					? list[0]
					: event.key === "End"
						? list.at(-1)
						: event.key === "ArrowDown"
							? list[(current + 1) % list.length]
							: event.key === "ArrowUp"
								? list[(current - 1 + list.length) % list.length]
								: undefined
			if (event.key === "Escape") {
				event.preventDefault()
				event.stopPropagation()
				options.close()
				return
			}
			if (event.key === "Tab") {
				options.close(false)
				return
			}
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault()
				event.stopPropagation()
				list[current]?.click()
				return
			}
			if (
				!next &&
				event.key.length === 1 &&
				!event.ctrlKey &&
				!event.metaKey &&
				!event.altKey
			) {
				let letter = event.key.toLocaleLowerCase()
				search = event.timeStamp - searchedAt > 600 ? letter : search + letter
				searchedAt = event.timeStamp
				let query = [...search].every(character => character === letter)
					? letter
					: search
				let ordered = [
					...list.slice(current + 1),
					...list.slice(0, current + 1),
				]
				next = ordered.find(item =>
					(
						item.dataset.textValue ??
						item.querySelector("span")?.textContent ??
						item.textContent ??
						""
					)
						.trim()
						.toLocaleLowerCase()
						.startsWith(query),
				)
			}
			if (!next) return
			event.preventDefault()
			event.stopPropagation()
			next.focus({ preventScroll: true })
			next.scrollIntoView({ block: "nearest" })
		},
		{ signal },
	)
	return { focus }
}

export interface PopoverOptions {
	items(): HTMLElement[]
	selected?(): HTMLElement | undefined
	choose?(item: HTMLElement): void
	side?: "top" | "bottom"
	align?: "start" | "end"
}

export function connectPopover(
	trigger: HTMLButtonElement,
	panel: HTMLElement,
	signal: AbortSignal,
	options: PopoverOptions,
) {
	let supported = typeof panel.showPopover === "function"
	let openingFocus: "selected" | "first" | "last" = "selected"
	trigger.setAttribute("aria-haspopup", panel.getAttribute("role") ?? "menu")
	trigger.setAttribute("aria-expanded", "false")
	trigger.setAttribute("aria-controls", panel.id)
	function isOpen() {
		return supported ? panel.matches(":popover-open") : !panel.hidden
	}
	function place() {
		let bounds = trigger.getBoundingClientRect()
		let width = Math.min(Math.max(bounds.width, 200), innerWidth - 16)
		panel.style.minWidth = width + "px"
		panel.style.maxWidth = "calc(100vw - 16px)"
		let position = placePanel(
			bounds,
			{ width: panel.offsetWidth, height: panel.offsetHeight },
			{ width: innerWidth, height: innerHeight },
			options,
		)
		panel.style.left = position.x + "px"
		panel.style.top = position.y + "px"
		panel.dataset.side = position.side
	}
	function close(restore = true) {
		if (isOpen()) {
			if (supported) panel.hidePopover()
			else panel.hidden = true
		}
		trigger.setAttribute("aria-expanded", "false")
		if (restore && trigger.isConnected) trigger.focus({ preventScroll: true })
	}
	let navigation = menuNavigation(
		panel,
		{ items: options.items, selected: options.selected, close },
		signal,
	)
	function show(focus: "selected" | "first" | "last" = "selected") {
		openingFocus = focus
		if (!isOpen()) {
			if (supported) panel.showPopover()
			else panel.hidden = false
		}
		place()
		trigger.setAttribute("aria-expanded", "true")
		navigation.focus(focus)
	}
	panel.hidden = !supported
	if (supported) trigger.popoverTargetElement = panel
	trigger.addEventListener(
		"click",
		() => {
			openingFocus = "selected"
			if (!supported) isOpen() ? close() : show()
		},
		{ signal },
	)
	trigger.addEventListener(
		"keydown",
		event => {
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
			event.preventDefault()
			event.stopPropagation()
			show(event.key === "ArrowUp" ? "last" : "selected")
		},
		{ signal },
	)
	panel.addEventListener(
		"toggle",
		event => {
			if (!(event instanceof ToggleEvent) || event.target !== panel) return
			if (event.newState === "open" && isOpen()) show(openingFocus)
			else trigger.setAttribute("aria-expanded", "false")
		},
		{ signal },
	)
	panel.addEventListener(
		"click",
		event => {
			let target = event.target
			if (!(target instanceof Element) || event.defaultPrevented) return
			let item = options.items().find(item => item.contains(target))
			if (
				!item ||
				item.hasAttribute("disabled") ||
				item.getAttribute("aria-disabled") === "true"
			)
				return
			options.choose?.(item)
			close(item.dataset.action === undefined)
		},
		{ signal },
	)
	window.addEventListener(
		"resize",
		() => {
			if (isOpen()) place()
		},
		{ signal },
	)
	document.addEventListener(
		"scroll",
		event => {
			if (
				isOpen() &&
				event.target instanceof Node &&
				!panel.contains(event.target)
			)
				place()
		},
		{ signal, capture: true },
	)
	signal.addEventListener(
		"abort",
		() => {
			close(false)
			if (trigger.popoverTargetElement === panel)
				trigger.popoverTargetElement = null
		},
		{ once: true },
	)
	return { show, close, isOpen }
}
