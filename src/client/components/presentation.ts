import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { button, setMarkup } from "../dom"
import { icon } from "../icons"
import { html, rawMarkup, translate } from "../language"
import { screenIcon } from "./screen-icons"
import { TeleprompterElement } from "./teleprompter"

import { slides } from "../../shared/markdown"
import type { DocumentRecord, Presence } from "../../shared/model"
import {
	groupBySlide,
	itemProgress,
	presentationItems,
	slideStart,
	type PresentationItem,
} from "../../shared/presentation"
import { presenterMoves } from "../../shared/presentation-follow"
import { laserTrail, laserUpdates } from "../../shared/presentation-laser"

export interface PresentationOptions {
	mode: string
	index: number
	documentId: string
	document(): DocumentRecord | undefined
	presence(): Presence[]
	render(
		host: HTMLElement,
		source: string,
		slideshow?: boolean,
		number?: number,
	): void
	announce(x?: number, y?: number): Promise<void>
	changed(index: number): void
	// Readers watch the shared position but cannot move it. Defaults to true.
	writable?(): boolean
	// The document's persisted presentation item, the original's
	// `presentationLine`. Without it the position lives for this session.
	position?(): number | undefined
	present?(item: number): void
}
type PresentationView = Effect.Success<ReturnType<typeof presentationView>>
export class PresentationElement extends HTMLElement {
	private options: PresentationOptions | undefined
	private view: PresentationView | undefined
	private lifetime: Fiber.Fiber<never, never> | undefined
	configure(options: PresentationOptions) {
		this.options = options
	}
	connectedCallback() {
		let options = this.options
		if (!options || this.lifetime) return
		this.dataset.presentation = ""
		this.className =
			options.mode === "teleprompter" ? "prompter-stage" : "slideshow-stage"
		let host = this
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let view = yield* presentationView(host, options)
					host.view = view
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => {
							options.index = view.index
							if (host.view === view) host.view = undefined
						}),
					)
					return yield* Effect.never
				}),
			),
		)
	}
	disconnectedCallback() {
		this.dispose()
	}
	connectedMoveCallback() {}
	dispose() {
		let lifetime = this.lifetime
		if (!lifetime) return
		this.lifetime = undefined
		Effect.runFork(Fiber.interrupt(lifetime))
	}
	update() {
		this.view?.update()
	}
	presence() {
		this.view?.presence()
	}
	// Audience windows and readers watch; they do not announce a position.
	get following() {
		return this.view?.following ?? false
	}
	get index() {
		return this.view?.index ?? this.options?.index ?? 0
	}
	// The selected item; slide `index` stays the shared slide position.
	get item() {
		return this.view?.item
	}
	change(delta: number) {
		this.view?.change(delta)
	}
	stepNotes(direction: number) {
		this.view?.stepNotes(direction)
	}
	follow() {
		return this.view?.follow() ?? false
	}
	// The original teleprompter has no auto-scroll; kept until the root's
	// `scroll` action is removed.
	toggleScroll() {}
	receive(index: number) {
		this.view?.receive(index)
	}
}
customElements.define("alkalye-presentation", PresentationElement)

export function mountPresentation(
	main: HTMLElement,
	options: PresentationOptions,
) {
	let presentation = document.createElement("alkalye-presentation")
	if (!(presentation instanceof PresentationElement))
		throw new Error("Presentation element is not registered")
	presentation.configure(options)
	main.replaceChildren(presentation)
	return presentation
}

// Without a persisted position, selected items outlive mode switches within a
// session, like the original's shared presentation line did.
let rememberedItems = new Map<string, number>()

function presentationView(host: HTMLElement, options: PresentationOptions) {
	return Effect.gen(function* () {
		let prompting = options.mode === "teleprompter"
		setMarkup(host, prompting ? prompterMarkup() : slideshowMarkup())
		let events = yield* Effect.acquireRelease(
			Effect.sync(() => new AbortController()),
			controller => Effect.sync(() => controller.abort()),
		)
		let signal = events.signal
		let documentId = options.documentId
		let writable = () => options.writable?.() ?? true
		let items: PresentationItem[] = presentationItems(
			options.document()?.content ?? "",
		)
		let persisted = options.position?.()
		let item: number | undefined =
			persisted ?? rememberedItems.get(documentId) ?? undefined
		if (item !== undefined && !items[item]) item = undefined
		let slideIndex = items[item ?? -1]?.slide ?? options.index,
			shownSlide = -1,
			following = !writable(),
			movedAt = 0,
			moved = false
		if (prompting && item === undefined && slideIndex > 0) {
			let start = slideStart(items, slideIndex)
			item = start >= 0 ? start : undefined
		}
		let seenPresenters = new Map<string, string>()
		let seenPointers = new Map<
			string,
			{ time: number; stroke: number; visible: boolean }
		>()
		let pointer: number | undefined,
			pointerStroke = 0,
			pointerAnnouncement = 0
		let timerStarted = Date.now()
		let wide = matchMedia("(min-width: 768px)")
		let desktopPreview = true,
			mobilePreview = false
		let script = host.querySelector("alkalye-teleprompter")
		let prompter = script instanceof TeleprompterElement ? script : undefined
		let slide = part("#slide"),
			surface = part(".presentation-canvas"),
			trailPath = part(".laser-trail path")
		let trail = laserTrail()
		let trailFrame = 0

		yield* Effect.acquireRelease(
			Effect.sync(() => window.setInterval(tick, 1000)),
			interval => Effect.sync(() => clearInterval(interval)),
		)
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => cancelAnimationFrame(trailFrame)),
		)
		if ("wakeLock" in navigator)
			yield* Effect.forkScoped(
				Effect.scoped(
					Effect.acquireRelease(
						Effect.tryPromise(() => navigator.wakeLock.request("screen")),
						lock => Effect.promise(() => lock.release()),
					).pipe(Effect.flatMap(() => Effect.never)),
				).pipe(Effect.ignore),
			)

		document.addEventListener("keydown", navigate, { signal })
		on('[data-command="fullscreen"]', toggleFullscreen)
		if (prompter) {
			prompter.configure(index => select(index))
			wide.addEventListener("change", layout, { signal })
			on("#preview-toggle", () => {
				if (wide.matches) desktopPreview = !desktopPreview
				else mobilePreview = !mobilePreview
				layout()
			})
			on("#preview-close", closeMobilePreview)
			let dialog = part(".prompter-preview-dialog")
			// Escape closes only the preview, not the screen. Closing it here
			// rather than through the dialog's own cancel keeps the browser's
			// close request handling for the application's dialogs intact.
			dialog.addEventListener(
				"keydown",
				event => {
					if (event.key !== "Escape") return
					event.preventDefault()
					event.stopPropagation()
					closeMobilePreview()
				},
				{ signal },
			)
			dialog.addEventListener("close", closeMobilePreview, { signal })
			on("#previous-item", () => stepNotes(-1))
			on("#next-item", () => stepNotes(1))
			on("#presentation-timer", () => {
				timerStarted = Date.now()
				tick()
			})
			surface.addEventListener("pointerdown", pointerDown, { signal })
			surface.addEventListener("pointermove", pointerMove, { signal })
			for (let type of ["pointerup", "pointercancel", "lostpointercapture"])
				surface.addEventListener(type, pointerEnd, { signal })
			window.addEventListener("blur", releasePointer, { signal })
			document.addEventListener("visibilitychange", releasePointer, {
				signal,
			})
			layout()
		} else surface.addEventListener("click", advance, { signal })
		update()
		tick()
		if (item !== undefined) prompter?.reveal()

		return {
			update,
			presence: updatePresence,
			get following() {
				return following || !writable()
			},
			get index() {
				return slideIndex
			},
			get item() {
				return item
			},
			change,
			stepNotes,
			follow,
			receive,
		}

		function part(selector: string) {
			let found = host.querySelector<HTMLElement>(selector)
			if (!found) throw new Error(`Missing ${selector}`)
			return found
		}
		function on(selector: string, listener: (event: Event) => void) {
			host
				.querySelector(selector)
				?.addEventListener("click", listener, { signal })
		}
		function update() {
			let doc = options.document()
			if (!doc) return
			let parsed = slides(doc.content)
			items = presentationItems(doc.content)
			if (item !== undefined && item >= items.length)
				item = items.length ? items.length - 1 : undefined
			let shared = options.position?.()
			if (shared !== undefined && shared !== persisted && items[shared]) {
				persisted = shared
				item = shared
				slideIndex = items[shared]?.slide ?? slideIndex
			}
			slideIndex = Math.max(0, Math.min(parsed.length - 1, slideIndex))
			host.toggleAttribute("data-empty", prompting && !items.length)
			host.dataset.slide = String(slideIndex + 1)
			if (prompter) {
				prompter.show(items, item)
				let groups = groupBySlide(items)
				let position = groups.findIndex(
					group => group.slide === items[item ?? -1]?.slide,
				)
				part("#slide-count").textContent =
					`${translate("Slide")} ${position + 1} / ${groups.length}`
				part("#prompter-progress").style.inlineSize =
					`${itemProgress(items, item) * 100}%`
				updateNavigation(groups.length, position)
			} else updateMenu(parsed.length)
			options.render(
				slide,
				parsed[slideIndex]?.content ?? "",
				true,
				slideIndex + 1,
			)
			if (shownSlide !== slideIndex) {
				trail.clear()
				paintTrail()
			}
			shownSlide = slideIndex
		}
		function updateMenu(count: number) {
			let editable = writable()
			for (let [selector, enabled] of [
				['[data-action="previous"]', editable && slideIndex > 0],
				['[data-action="next"]', editable && slideIndex < count - 1],
			] satisfies [string, boolean][]) {
				let control = host.querySelector(selector)
				if (control instanceof HTMLButtonElement) control.disabled = !enabled
			}
			for (let control of host.querySelectorAll<HTMLElement>("[data-edit]"))
				control.hidden = !editable
		}
		// A local move takes over the shared position from whoever led before.
		function moveTo(index: number | undefined, slideTarget: number) {
			if (!writable()) return
			following = false
			moved = true
			movedAt = Date.now()
			let previousSlide = slideIndex
			item = index
			slideIndex = slideTarget
			if (index !== undefined) {
				rememberedItems.set(documentId, index)
				persisted = index
				options.present?.(index)
			}
			prompter?.select(index)
			update()
			if (previousSlide !== slideIndex) options.changed(slideIndex)
			void options.announce()
		}
		function select(index: number | undefined) {
			if (index === undefined || index === item || !items[index]) return
			moveTo(index, items[index]?.slide ?? slideIndex)
		}
		function change(delta: number) {
			if (!writable() || (!wide.matches && mobilePreview)) return
			if (!prompter) {
				let count = slides(options.document()?.content ?? "").length
				let target = Math.max(0, Math.min(count - 1, slideIndex + delta))
				if (target === slideIndex) return
				moveTo(startOf(target), target)
				return
			}
			let groups = groupBySlide(items)
			let position = groups.findIndex(
				group => group.slide === items[item ?? -1]?.slide,
			)
			let target = groups[position + delta]
			if (target && (position >= 0 || delta > 0))
				select(slideStart(items, target.slide))
		}
		function stepNotes(direction: number) {
			if (item === undefined) return
			select(item + direction)
		}
		function receive(index: number) {
			if (index === slideIndex && (!prompter || item !== undefined)) return
			adopt(startOf(index), index)
		}
		function startOf(slideTarget: number) {
			let start = slideStart(items, slideTarget)
			return start >= 0 ? start : undefined
		}
		function adopt(index: number | undefined, slideTarget: number) {
			let previousSlide = slideIndex
			item = index
			slideIndex = slideTarget
			if (index !== undefined) rememberedItems.set(documentId, index)
			prompter?.select(index)
			update()
			if (previousSlide !== slideIndex) options.changed(slideIndex)
		}
		function advance(event: Event) {
			let path = event.composedPath()
			if (
				path.some(
					node =>
						node instanceof HTMLAnchorElement ||
						node instanceof HTMLMediaElement,
				)
			)
				return
			change(1)
		}
		function navigate(event: KeyboardEvent) {
			if (event.defaultPrevented || event.metaKey || event.ctrlKey) return
			if (event.altKey || document.querySelector("dialog[open]")) return
			let target = event.target instanceof Element ? event.target : undefined
			if (target?.closest("input, textarea, select, [contenteditable]")) return
			if (target?.closest("[popover]")) return
			if (!prompter) {
				if (event.key === " ") {
					event.preventDefault()
					change(1)
				} else if (event.key === "f" || event.key === "F") {
					event.preventDefault()
					toggleFullscreen()
				}
				return
			}
			let direction =
				event.key === "ArrowUp"
					? -1
					: event.key === "ArrowDown" || event.key === " "
						? 1
						: 0
			if (!direction) return
			event.preventDefault()
			stepNotes(direction)
		}
		function toggleFullscreen() {
			if (document.fullscreenElement) void document.exitFullscreen()
			else void document.documentElement.requestFullscreen()
		}
		// Readers follow the shared position and cannot move it.
		function updateNavigation(count: number, position: number) {
			let editable = writable()
			for (let [selector, enabled] of [
				['[data-action="previous"]', position > 0],
				['[data-action="next"]', position < count - 1],
				["#previous-item", item !== undefined && item > 0],
				["#next-item", item !== undefined && item < items.length - 1],
				["[data-start]", true],
			] satisfies [string, boolean][]) {
				let control = host.querySelector(selector)
				if (control instanceof HTMLButtonElement)
					control.disabled = !enabled || !editable
			}
		}
		function layout() {
			let open = wide.matches ? desktopPreview : mobilePreview
			host.dataset.layout = wide.matches ? "wide" : "narrow"
			let aside = part(".prompter-preview")
			let dialog = host.querySelector("dialog")
			if (!(dialog instanceof HTMLDialogElement)) return
			if (wide.matches) {
				if (dialog.open) dialog.close()
				part(".prompter-body").append(aside)
				aside.hidden = !open
			} else {
				dialog.append(aside)
				aside.hidden = false
				if (open && !dialog.open) dialog.showModal()
				if (!open && dialog.open) dialog.close()
			}
			let toggle = part("#preview-toggle")
			let label = translate(open ? "Hide slide preview" : "Show slide preview")
			toggle.setAttribute("aria-label", label)
			toggle.title = label
			if (wide.matches) {
				toggle.setAttribute("aria-pressed", String(open))
				toggle.removeAttribute("aria-haspopup")
				toggle.removeAttribute("aria-expanded")
			} else {
				toggle.setAttribute("aria-haspopup", "dialog")
				toggle.setAttribute("aria-expanded", String(open))
				toggle.removeAttribute("aria-pressed")
			}
			toggle.toggleAttribute("data-open", open)
			part("#preview-toggle-label").textContent = translate(
				open ? "Text only" : "Preview",
			)
			releasePointer()
			trail.clear()
			paintTrail()
		}
		function closeMobilePreview() {
			if (!mobilePreview) return
			mobilePreview = false
			layout()
			part("#preview-toggle").focus()
		}
		function tick() {
			let clock = host.querySelector("#prompter-clock")
			if (clock)
				clock.textContent = new Date().toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
				})
			let timer = host.querySelector("#presentation-timer")
			if (timer) {
				let seconds = Math.max(
					0,
					Math.floor((Date.now() - timerStarted) / 1000),
				)
				timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
			}
		}
		function pointerDown(event: PointerEvent) {
			if (!event.isPrimary || (event.pointerType === "mouse" && event.button))
				return
			event.preventDefault()
			pointer = event.pointerId
			pointerStroke++
			surface.setPointerCapture(event.pointerId)
			pointerMove(event)
		}
		function pointerMove(event: PointerEvent) {
			if (pointer !== event.pointerId) return
			let bounds = slide.getBoundingClientRect()
			let last: { x: number; y: number } | undefined
			for (let sample of [...(event.getCoalescedEvents?.() ?? []), event]) {
				let x = (sample.clientX - bounds.left) / bounds.width,
					y = (sample.clientY - bounds.top) / bounds.height
				last = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined
				if (last)
					trail.add({
						...last,
						stroke: "local:" + pointerStroke,
						visible: true,
					})
				else pausePointer()
			}
			if (last && Date.now() - pointerAnnouncement > 50) {
				pointerAnnouncement = Date.now()
				void options.announce(last.x, last.y)
			}
			paintTrail()
		}
		function pointerEnd(event: Event) {
			if (!(event instanceof PointerEvent) || pointer !== event.pointerId)
				return
			if (event.type === "pointerup") pointerMove(event)
			releasePointer()
		}
		function pausePointer() {
			if (!trail.drawing) return
			trail.add({
				x: -1,
				y: -1,
				stroke: "local:" + pointerStroke,
				visible: false,
			})
			pointerStroke++
			void options.announce()
		}
		function releasePointer() {
			if (pointer === undefined) return
			pointer = undefined
			pausePointer()
			paintTrail()
		}
		function paintTrail() {
			cancelAnimationFrame(trailFrame)
			let frame = trail.frame()
			trailPath.setAttribute("d", frame.path)
			trailPath.style.opacity = String(frame.opacity)
			trailFrame = frame.opacity > 0 ? requestAnimationFrame(paintTrail) : 0
		}
		function updatePresence() {
			let people = options.presence()
			let { moved: move, joined } = presenterMoves(
				seenPresenters,
				people,
				documentId,
				Date.now(),
			)
			// Simultaneous moves keep their own position instead of trading places.
			let leader =
				move && Date.now() - movedAt > 750
					? move
					: joined &&
						  (following || (!moved && !options.position)) &&
						  (joined.slide > 0 || joined.item !== undefined)
						? joined
						: undefined
			if (leader) {
				let index =
					leader.item !== undefined &&
					items[leader.item]?.slide === leader.slide
						? leader.item
						: undefined
				if (index !== item || leader.slide !== slideIndex)
					adopt(index ?? startOf(leader.slide), leader.slide)
			}
			if (prompter) return
			for (let point of laserUpdates(
				seenPointers,
				people,
				documentId,
				slideIndex,
			))
				trail.add(point)
			paintTrail()
		}
		function follow() {
			following = !following || !writable()
			if (following) {
				seenPresenters.clear()
				updatePresence()
			}
			void options.announce()
			return following
		}
	})
}

function laserMarkup() {
	return html`<svg
		class="laser-trail"
		aria-hidden="true"
		viewBox="0 0 1000 1000"
		preserveAspectRatio="none"
	>
		<path
			fill="none"
			stroke="#ff304f"
			stroke-width="4"
			stroke-linecap="round"
			stroke-linejoin="round"
			vector-effect="non-scaling-stroke"
		/>
	</svg>`
}

function menuItem(attributes: string, label: string, shortcut = "") {
	return html`<button type="button" ${rawMarkup(attributes)}>
		<span>${translate(label)}</span
		>${shortcut ? html`<kbd>${shortcut}</kbd>` : ""}
	</button>`
}

function slideshowMarkup() {
	let options = translate("Slideshow options")
	return html`<div class="presentation-canvas">
			<div id="slide" class="slide-host"></div>
			${laserMarkup()}
		</div>
		<alkalye-menu class="slideshow-options" side="top" align="end">
			<button type="button" aria-label="${options}" title="${options}">
				${icon("ellipsis")}
			</button>
			<div
				id="slideshow-options"
				class="menu-popover"
				popover
				role="menu"
				aria-label="${options}"
			>
				${menuItem('data-action="previous"', "Previous slide", "←")}
				${menuItem('data-action="next"', "Next slide", "→")}
				<hr />
				${menuItem('data-command="fullscreen"', "Toggle fullscreen", "F")}
				<hr data-edit />
				${menuItem('data-action="edit" data-edit', "Go to editor", "Esc")}
				${menuItem('data-action="teleprompter" data-edit', "Go to teleprompter")}
			</div>
		</alkalye-menu>`
}

function navigationButton(attributes: string, label: string, content: unknown) {
	let text = translate(label)
	return html`<button
		type="button"
		${rawMarkup(attributes)}
		title="${text}"
		aria-label="${text}"
	>
		${content}
	</button>`
}

function prompterMarkup() {
	return html`<div class="prompter-empty">
			${icon("file-text")}
			<strong>${translate("No slides found")}</strong>
			<p>${translate("Add headings (# or ##) to create slides")}</p>
			<button type="button" data-action="edit">
				${translate("Back to Editor")}
			</button>
		</div>
		<header class="prompter-header">
			<button type="button" data-action="edit" class="prompter-editor">
				${translate("Editor")}
			</button>
			<span id="slide-count" class="prompter-count"></span>
			<div class="prompter-actions">
				<button type="button" id="preview-toggle">
					<span class="prompter-wide"
						><span data-closed>${screenIcon("panel-right-open")}</span
						><span data-opened>${screenIcon("panel-right-close")}</span></span
					><span class="prompter-narrow">${screenIcon("scan")}</span
					><span id="preview-toggle-label" class="prompter-narrow"></span>
				</button>
				${button(
					"presenter",
					"Slideshow",
					html`<span class="prompter-narrow">${icon("presentation")}</span
						><span class="prompter-wide-label"
							>${translate("Slideshow")}</span
						>`,
				)}
			</div>
		</header>
		<div class="prompter-body">
			<div class="prompter-column">
				<div class="prompter-progress" aria-hidden="true">
					<span id="prompter-progress"></span>
				</div>
				<alkalye-teleprompter
					id="speaker-notes"
					class="speaker-notes"
					aria-label="${translate("Speaker notes")}"
				></alkalye-teleprompter>
				<footer class="prompter-toolbar">
					<span id="prompter-clock" class="prompter-clock"></span>
					<div class="prompter-navigation">
						${navigationButton('data-action="previous"', "Prev Slide (←)", icon("chevron-left"))}${navigationButton('id="previous-item"', "Prev Item (↑)", screenIcon("arrow-up"))}${navigationButton('id="next-item"', "Next Item (↓)", screenIcon("arrow-down"))}${navigationButton('data-action="next"', "Next Slide (→)", icon("chevron-right"))}
					</div>
					<button
						type="button"
						id="presentation-timer"
						class="prompter-timer"
						title="${translate("Click to reset timer")}"
					></button>
				</footer>
			</div>
			<aside
				class="prompter-preview"
				aria-label="${translate("Laser pointer")}"
			>
				<div class="prompter-preview-bar">
					<strong>${translate("Slide preview")}</strong>
				</div>
				<div
					class="presentation-canvas"
					role="img"
					aria-label="${translate("Hold and drag to draw a laser trail. It fades after you release.")}"
				>
					<div id="slide" class="slide-host"></div>
					${laserMarkup()}
				</div>
				<p class="prompter-hint">
					${translate("Hold and drag to draw a laser trail. It fades after you release.")}
				</p>
			</aside>
		</div>
		<dialog
			class="prompter-preview-dialog"
			aria-label="${translate("Slide preview")}"
		>
			<div class="prompter-dialog-bar">
				<strong>${translate("Slide preview")}</strong>
				<button type="button" id="preview-close">
					${icon("x")}<span>${translate("Text only")}</span>
				</button>
			</div>
		</dialog>`
}
