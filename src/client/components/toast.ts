import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as SubscriptionRef from "effect/SubscriptionRef"

import { element } from "../dom"
import { translate } from "../language"
import {
	countdown,
	stackLayout,
	swipeAmount,
	swipeAxis,
	swipeOut,
	toastLifetime,
	unmountDelay,
} from "../toast-stack"
import type { SwipeAxis } from "../toast-stack"

export function toast(text: string) {
	let host = element("#toast")
	if (host instanceof ToasterElement) host.show(text)
}

// Sonner's default toaster: a polite notification region stacked bottom-right.
// It lives in the top layer as a manual popover so failures stay visible over
// modal dialogs, and it never takes focus until Alt+T asks for it.
export class ToasterElement extends HTMLElement {
	private lifetime: Fiber.Fiber<never> | undefined
	private run: ((item: Toast) => void) | undefined
	private clear: (() => void) | undefined
	private paused: SubscriptionRef.SubscriptionRef<boolean> | undefined
	private list = document.createElement("ol")
	private toasts: Toast[] = []
	private expanded = false
	private interacting = false
	private returnFocus: HTMLElement | undefined

	show(text: string) {
		let content = document.createElement("div")
		let title = document.createElement("div")
		title.dataset.title = ""
		title.textContent = text
		content.dataset.content = ""
		content.append(title)
		return this.showContent(content)
	}
	showContent(content: HTMLElement, persistent = false) {
		let run = this.run
		if (!run) return
		if (this.list.parentNode !== this) {
			this.clear?.()
			this.toasts = []
			this.replaceChildren(this.list)
		}
		let node = document.createElement("li")
		node.append(content)
		Object.assign(node.dataset, {
			sonnerToast: "",
			styled: "true",
			mounted: "false",
			removed: "false",
			swiping: "false",
			swiped: "false",
			swipeOut: "false",
			yPosition: "bottom",
			xPosition: "right",
		})
		node.tabIndex = 0
		let item: Toast = { node, height: 0, removed: false, offset: 0, persistent }
		run(item)
		return () => item.dismiss?.()
	}

	connectedCallback() {
		if (this.lifetime) return
		Object.assign(this.dataset, { toast: "", sonnerTheme: "light" })
		this.setAttribute("popover", "manual")
		this.setAttribute("role", "region")
		this.setAttribute("aria-label", translate("Notifications") + " alt+T")
		this.setAttribute("aria-live", "polite")
		this.setAttribute("aria-relevant", "additions text")
		this.setAttribute("aria-atomic", "false")
		this.tabIndex = -1
		Object.assign(this.list.dataset, {
			sonnerToaster: "",
			yPosition: "bottom",
			xPosition: "right",
		})
		this.list.tabIndex = -1
		this.replaceChildren(this.list)
		this.showPopover()
		let host = this
		this.lifetime = Effect.runFork(
			Effect.gen(function* () {
				let toasts = yield* FiberSet.make<void>()
				let run = yield* FiberSet.runtime(toasts)<never>()
				let paused = yield* SubscriptionRef.make(document.hidden)
				host.paused = paused
				host.run = item => void run(host.present(item, paused))
				host.clear = () => void Effect.runFork(FiberSet.clear(toasts))
				yield* Effect.acquireRelease(
					Effect.sync(() => host.listen()),
					events =>
						Effect.sync(() => {
							events.abort()
							host.run = undefined
							host.clear = undefined
						}),
				)
				return yield* Effect.never
			}).pipe(Effect.scoped),
		)
	}
	disconnectedCallback() {
		let lifetime = this.lifetime
		this.lifetime = undefined
		if (lifetime) Effect.runFork(Fiber.interrupt(lifetime))
	}

	private present(
		item: Toast,
		paused: SubscriptionRef.SubscriptionRef<boolean>,
	) {
		let host = this
		return Effect.gen(function* () {
			let dismissed = yield* Deferred.make<void>()
			yield* Effect.acquireRelease(
				Effect.sync(() =>
					host.mount(item, () => Deferred.doneUnsafe(dismissed, Effect.void)),
				),
				() => Effect.sync(() => host.unmount(item)),
			)

			let content = item.node.firstElementChild
			if (content instanceof HTMLElement) {
				yield* Effect.acquireRelease(
					Effect.sync(() => {
						let observer = new ResizeObserver(entries => {
							let style = getComputedStyle(item.node)
							let height =
								(entries[0]?.borderBoxSize[0]?.blockSize ??
									content.offsetHeight) +
								[
									style.paddingTop,
									style.paddingBottom,
									style.borderTopWidth,
									style.borderBottomWidth,
								].reduce((total, value) => total + parseFloat(value), 0)
							if (height === item.height) return
							item.height = height
							host.layout()
						})
						observer.observe(content)
						return observer
					}),
					observer => Effect.sync(() => observer.disconnect()),
				)
			}
			yield* Effect.raceFirst(
				item.persistent ? Effect.never : countdown(paused, toastLifetime),
				Deferred.await(dismissed),
			)
			host.retire(item)
			yield* Effect.sleep(unmountDelay)
		}).pipe(Effect.scoped)
	}

	private mount(item: Toast, dismiss: () => void) {
		item.dismiss = dismiss
		this.toasts.unshift(item)
		this.raise()
		this.list.prepend(item.node)
		item.node.style.height = "auto"
		item.height = item.node.getBoundingClientRect().height
		item.node.style.removeProperty("height")
		this.layout()
		item.node.getBoundingClientRect()
		item.node.dataset.mounted = "true"
	}
	private retire(item: Toast) {
		if (item.removed) return
		item.removed = true
		item.node.dataset.removed = "true"
		this.layout()
	}
	private unmount(item: Toast) {
		let returnFocus = item.node.contains(document.activeElement)
			? this.returnFocus
			: undefined
		item.node.remove()
		if (!this.toasts.includes(item)) return
		this.toasts = this.toasts.filter(other => other !== item)
		if (this.toasts.length < 2 && !this.list.matches(":focus-within"))
			this.expanded = false
		if (returnFocus) {
			this.returnFocus = undefined
			returnFocus.focus({ preventScroll: true })
		}
		this.layout()
	}

	private layout() {
		let placements = stackLayout(
			this.toasts.map(item => ({
				height: item.height,
				removed: item.removed,
				offsetBeforeRemove: item.offset,
			})),
		)
		let front = this.toasts.find(item => !item.removed)
		this.list.style.setProperty(
			"--front-toast-height",
			`${front?.height ?? 0}px`,
		)
		for (let [index, item] of this.toasts.entries()) {
			let place = placements[index]
			if (!place) continue
			item.offset = place.offset
			Object.assign(item.node.dataset, {
				index: String(index),
				front: String(place.front),
				visible: String(place.visible),
				expanded: String(this.expanded),
			})
			item.node.style.setProperty("--index", String(index))
			item.node.style.setProperty("--toasts-before", String(index))
			item.node.style.setProperty("--z-index", String(place.zIndex))
			item.node.style.setProperty("--offset", `${place.offset}px`)
			item.node.style.setProperty("--initial-height", `${item.height}px`)
		}
		let paused = this.paused
		if (paused)
			Effect.runSync(
				SubscriptionRef.set(
					paused,
					this.expanded || this.interacting || document.hidden,
				),
			)
	}
	private expand(expanded: boolean) {
		this.expanded = expanded
		this.layout()
	}

	// A modal dialog opened after the toaster sits above it in the top layer;
	// reopening the popover moves the toaster back to the top.
	private raise() {
		if (
			this.matches(":focus-within") ||
			!document.querySelector("dialog:modal")
		)
			return
		if (this.matches(":popover-open")) this.hidePopover()
		this.showPopover()
	}

	private listen() {
		let events = new AbortController()
		let signal = events.signal
		let list = this.list
		document.addEventListener(
			"keydown",
			event => {
				if (event.altKey && event.code === "KeyT" && this.toasts.length) {
					event.preventDefault()
					if (
						!list.matches(":focus-within") &&
						document.activeElement instanceof HTMLElement
					)
						this.returnFocus = document.activeElement
					this.expand(true)
					list.focus()
				} else if (event.key === "Escape" && list.matches(":focus-within"))
					this.expand(false)
			},
			{ signal },
		)
		document.addEventListener("visibilitychange", () => this.layout(), {
			signal,
		})
		new MutationObserver(() => {
			if (document.querySelector("dialog:modal")) this.raise()
		}).observe(document.body, {
			attributeFilter: ["open"],
			subtree: true,
		})
		list.addEventListener("mouseenter", () => this.expand(true), { signal })
		list.addEventListener(
			"mousemove",
			() => {
				if (!this.expanded) this.expand(true)
			},
			{ signal },
		)
		list.addEventListener(
			"mouseleave",
			() => {
				if (!this.interacting && !list.matches(":focus-within"))
					this.expand(false)
			},
			{ signal },
		)
		list.addEventListener(
			"focusin",
			event => {
				if (
					!(
						event.relatedTarget instanceof Node &&
						list.contains(event.relatedTarget)
					) &&
					event.relatedTarget instanceof HTMLElement
				)
					this.returnFocus ??= event.relatedTarget
				this.expand(true)
			},
			{ signal },
		)
		list.addEventListener(
			"focusout",
			event => {
				if (
					event.relatedTarget instanceof Node &&
					list.contains(event.relatedTarget)
				)
					return
				this.returnFocus = undefined
				if (!list.matches(":hover")) this.expand(false)
			},
			{ signal },
		)
		list.addEventListener("pointerdown", event => this.swipe(event), { signal })
		return events
	}

	private swipe(start: PointerEvent) {
		if (start.target instanceof Element && start.target.closest("button, a"))
			return
		let node =
			start.target instanceof Element ? start.target.closest("li") : null
		let item = this.toasts.find(other => other.node === node)
		if (!item || item.removed || start.button !== 0) return
		let swiped = item
		let target = swiped.node
		let axis: SwipeAxis | undefined
		let amount = 0
		let gesture = new AbortController()
		this.interacting = true
		this.layout()
		target.setPointerCapture(start.pointerId)
		target.dataset.swiping = "true"
		target.addEventListener(
			"pointermove",
			event => {
				if (event.pointerId !== start.pointerId) return
				let dx = event.clientX - start.clientX
				let dy = event.clientY - start.clientY
				axis ??= swipeAxis(dx, dy)
				if (!axis) return
				amount = swipeAmount(axis === "x" ? dx : dy)
				target.style.setProperty(
					"--swipe-amount-x",
					`${axis === "x" ? amount : 0}px`,
				)
				target.style.setProperty(
					"--swipe-amount-y",
					`${axis === "y" ? amount : 0}px`,
				)
				if (Math.abs(amount) > 0) target.dataset.swiped = "true"
			},
			{ signal: gesture.signal },
		)
		let finish = (event: PointerEvent) => {
			if (event.pointerId !== start.pointerId) return
			gesture.abort()
			this.interacting = false
			target.dataset.swiping = "false"
			let direction =
				event.type === "pointerup" && axis
					? swipeOut(axis, amount, event.timeStamp - start.timeStamp)
					: undefined
			if (direction) {
				target.dataset.swipeDirection = direction
				target.dataset.swipeOut = "true"
				swiped.dismiss?.()
			} else {
				target.style.setProperty("--swipe-amount-x", "0px")
				target.style.setProperty("--swipe-amount-y", "0px")
				target.dataset.swiped = "false"
			}
			if (!this.list.matches(":hover")) this.expand(false)
			else this.layout()
		}
		target.addEventListener("pointerup", finish, { signal: gesture.signal })
		target.addEventListener("pointercancel", finish, { signal: gesture.signal })
	}
}
customElements.define("alkalye-toaster", ToasterElement)

type Toast = {
	persistent: boolean
	node: HTMLLIElement
	height: number
	removed: boolean
	offset: number
	dismiss?: () => void
}
