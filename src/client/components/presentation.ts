import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { button, setMarkup } from "../dom"
import { icon } from "../icons"
import { html, translate } from "../language"
import { TeleprompterElement } from "./teleprompter"

import { slides } from "../../shared/markdown"
import type { DocumentRecord, Presence } from "../../shared/model"
import {
	groupBySlide,
	itemProgress,
	presentationItems,
	slideStart,
	stepItem,
	stepSlide,
	type PresentationItem,
} from "../../shared/presentation"
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
			options.mode === "teleprompter" ? "prompter-stage" : "presentation-stage"
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
	get following() {
		return this.view?.following ?? false
	}
	get index() {
		return this.view?.index ?? this.options?.index ?? 0
	}
	// The selected teleprompter item; slide `index` stays the shared position.
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
	toggleScroll() {
		this.view?.toggleScroll()
	}
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

// Selected items outlive mode switches within a session, like the original
// shared presentation line did.
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
		let slideIndex = options.index,
			shownSlide = -1,
			following = false
		let items: PresentationItem[] = [],
			item: number | undefined
		let scrolling = false,
			scrollSpeed = 35,
			lastFrame = 0,
			lastAnnouncement = 0,
			frameId = 0
		let elapsed = 0,
			timerStarted = 0,
			timerRunning = false
		let pointerTime = 0,
			pointerAnnouncement = 0
		let wide = matchMedia("(min-width: 768px)")
		let desktopPreview = true,
			mobilePreview = false
		let script = host.querySelector("alkalye-teleprompter")
		let prompter = script instanceof TeleprompterElement ? script : undefined
		let slide = part("#slide"),
			laser = part("#laser"),
			canvas = part(".presentation-canvas")

		yield* Effect.acquireRelease(
			Effect.sync(() => window.setInterval(tick, 1000)),
			interval => Effect.sync(() => clearInterval(interval)),
		)
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => cancelAnimationFrame(frameId)),
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

		if (prompter) {
			let remembered = rememberedItems.get(documentId)
			items = presentationItems(options.document()?.content ?? "")
			item =
				remembered !== undefined && items[remembered]?.slide === slideIndex
					? remembered
					: slideIndex > 0
						? slideStart(items, slideIndex)
						: undefined
			if (item !== undefined && item < 0) item = undefined
			prompter.configure(index => select(index))
			wide.addEventListener("change", layout, { signal })
			document.addEventListener("keydown", navigate, { signal })
			on("#preview-toggle", "click", () => {
				if (wide.matches) desktopPreview = !desktopPreview
				else mobilePreview = !mobilePreview
				layout()
				if (!wide.matches && mobilePreview) part("#preview-close").focus()
			})
			on("#preview-close", "click", () => {
				mobilePreview = false
				layout()
				part("#preview-toggle").focus()
			})
			on("#previous-note", "click", () => stepNotes(-1))
			on("#next-note", "click", () => stepNotes(1))
			on("#scroll-speed", "input", event => {
				if (event.target instanceof HTMLInputElement)
					scrollSpeed = Number(event.target.value)
			})
			on("#prompter-size", "input", event => {
				if (event.target instanceof HTMLInputElement)
					prompter.style.fontSize = `${event.target.value}px`
			})
			on('[data-action="mirror"]', "click", () => {
				let mirrored = prompter.classList.toggle("mirror")
				part('[data-action="mirror"]').setAttribute(
					"aria-pressed",
					String(mirrored),
				)
			})
			layout()
		} else on("#slide-overview-toggle", "click", toggleOverview)
		on("#presentation-timer", "click", () => {
			if (timerRunning) pauseTimer()
			else startTimer()
		})
		on("#reset-presentation-timer", "click", () => {
			pauseTimer()
			elapsed = 0
			renderTimer()
		})
		canvas.addEventListener("pointermove", point, { signal })
		canvas.addEventListener("pointerdown", point, { signal })
		update()
		tick()
		if (item !== undefined) prompter?.reveal()

		return {
			update,
			presence: updatePresence,
			get following() {
				return following
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
			toggleScroll,
			receive,
		}

		function part(selector: string) {
			let found = host.querySelector<HTMLElement>(selector)
			if (!found) throw new Error(`Missing ${selector}`)
			return found
		}
		function on(
			selector: string,
			type: "click" | "input",
			listener: (event: Event) => void,
		) {
			host.querySelector(selector)?.addEventListener(type, listener, { signal })
		}
		function update() {
			let doc = options.document()
			if (!doc) return
			let count = slides(doc.content).length
			slideIndex = Math.max(0, Math.min(count - 1, slideIndex))
			if (prompter) {
				items = presentationItems(doc.content)
				if (item !== undefined && item >= items.length)
					item = items.length ? items.length - 1 : undefined
				prompter.show(items, item)
				part("#prompter-title").textContent = doc.title
				part("#slide-count").textContent =
					`${translate("Slide")} ${slideIndex + 1} / ${count}`
				part("#prompter-progress").style.inlineSize =
					`${itemProgress(items, item) * 100}%`
				updateNavigation()
			} else part("#slide-count").textContent = `${slideIndex + 1} / ${count}`
			options.render(
				slide,
				slides(doc.content)[slideIndex]?.content ?? "",
				true,
			)
			if (
				shownSlide !== slideIndex &&
				!matchMedia("(prefers-reduced-motion: reduce)").matches
			)
				slide.animate(
					[
						{ opacity: 0, transform: "translateY(6px)" },
						{ opacity: 1, transform: "translateY(0)" },
					],
					{ duration: 180, easing: "ease-out" },
				)
			shownSlide = slideIndex
			updateLaser()
			refreshOverview()
		}
		function select(index: number | undefined, reveal = true) {
			if (index === undefined || index === item || !items[index]) return
			if (item === undefined && !timerRunning && !elapsed) startTimer()
			item = index
			rememberedItems.set(documentId, index)
			prompter?.select(index, reveal)
			let selected = items[index]?.slide ?? slideIndex
			let moved = selected !== slideIndex
			slideIndex = selected
			update()
			if (moved) options.changed(slideIndex)
			void options.announce()
		}
		function change(delta: number) {
			if (!prompter) {
				let count = slides(options.document()?.content ?? "").length
				slideIndex = Math.max(0, Math.min(count - 1, slideIndex + delta))
				update()
				options.changed(slideIndex)
				void options.announce()
				return
			}
			let start = slideStart(items, slideIndex)
			select(
				item === undefined && delta > 0 ? start : stepSlide(items, item, delta),
			)
		}
		function stepNotes(direction: number) {
			select(stepItem(items, item, direction))
		}
		function receive(index: number) {
			if (!prompter) {
				slideIndex = index
				update()
				return
			}
			if (items[item ?? -1]?.slide === index) return
			select(slideStart(items, index), !following)
		}
		function navigate(event: KeyboardEvent) {
			if (event.defaultPrevented || event.metaKey || event.ctrlKey) return
			if (event.altKey || (!wide.matches && mobilePreview)) return
			if (document.querySelector("dialog[open]")) return
			let target = event.target instanceof Element ? event.target : undefined
			if (target?.closest("input, textarea, select, [contenteditable]")) return
			if (event.key === " " && target?.closest("button, a")) return
			let direction =
				event.key === "ArrowUp" || (event.key === " " && event.shiftKey)
					? -1
					: event.key === "ArrowDown" || event.key === " "
						? 1
						: 0
			if (!direction) return
			event.preventDefault()
			stepNotes(direction)
		}
		function updateNavigation() {
			let groups = groupBySlide(items)
			let position = groups.findIndex(
				group => group.slide === items[item ?? -1]?.slide,
			)
			for (let [selector, enabled] of [
				['[data-action="previous"]', position > 0],
				['[data-action="next"]', position < groups.length - 1],
				["#previous-note", item !== undefined && item > 0],
				["#next-note", items.length > 0 && (item ?? -1) < items.length - 1],
			] satisfies [string, boolean][]) {
				let control = host.querySelector(selector)
				if (control instanceof HTMLButtonElement) control.disabled = !enabled
			}
		}
		function layout() {
			let open = wide.matches ? desktopPreview : mobilePreview
			host.dataset.layout = wide.matches ? "wide" : "narrow"
			host.toggleAttribute("data-preview", open)
			let toggle = part("#preview-toggle")
			let label = translate(open ? "Hide slide preview" : "Show slide preview")
			toggle.setAttribute("aria-label", label)
			toggle.title = label
			if (wide.matches) {
				toggle.setAttribute("aria-pressed", String(open))
				toggle.removeAttribute("aria-expanded")
			} else {
				toggle.setAttribute("aria-expanded", String(open))
				toggle.removeAttribute("aria-pressed")
			}
			updateLaser()
		}
		function tick() {
			let clock = host.querySelector("#prompter-clock")
			if (clock)
				clock.textContent = new Date().toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
				})
			renderTimer()
		}
		function startTimer() {
			timerRunning = true
			timerStarted = performance.now()
			renderTimer()
		}
		function pauseTimer() {
			if (timerRunning) elapsed += performance.now() - timerStarted
			timerRunning = false
			renderTimer()
		}
		function renderTimer() {
			let seconds = Math.floor(
				(elapsed + (timerRunning ? performance.now() - timerStarted : 0)) /
					1000,
			)
			let timer = part("#presentation-timer")
			timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
			timer.classList.toggle("active", timerRunning)
		}
		function point(event: PointerEvent) {
			if (!event.shiftKey && (event.pointerType === "mouse" || !event.buttons))
				return
			let bounds = slide.getBoundingClientRect()
			let x = (event.clientX - bounds.left) / bounds.width,
				y = (event.clientY - bounds.top) / bounds.height
			if (x < 0 || x > 1 || y < 0 || y > 1) return
			paintPointer(x, y)
			if (Date.now() - pointerAnnouncement > 50) {
				pointerAnnouncement = Date.now()
				void options.announce(x, y)
			}
		}
		function updateLaser() {
			let presence = options
				.presence()
				.filter(
					value =>
						!value.board &&
						value.document === documentId &&
						value.slide === slideIndex &&
						value.x >= 0 &&
						Date.now() - value.time < 3000,
				)
				.sort((a, b) => b.time - a.time)[0]
			laser.hidden = !presence
			if (presence && presence.time !== pointerTime) {
				pointerTime = presence.time
				paintPointer(presence.x, presence.y)
			}
			if (presence) placeLaser(presence.x, presence.y)
		}
		function paintPointer(x: number, y: number) {
			laser.hidden = false
			let position = placeLaser(x, y)
			if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
			let trail = document.createElement("span")
			trail.className = "laser-trail"
			trail.style.left = `${position.x}px`
			trail.style.top = `${position.y}px`
			canvas.append(trail)
			let animation = trail.animate(
				[
					{ opacity: 0.65, transform: "translate(-50%, -50%) scale(1)" },
					{ opacity: 0, transform: "translate(-50%, -50%) scale(0.2)" },
				],
				{ duration: 500 },
			)
			animation.onfinish = () => trail.remove()
		}
		function placeLaser(x: number, y: number) {
			let bounds = slide.getBoundingClientRect(),
				frame = canvas.getBoundingClientRect()
			let position = {
				x: bounds.left - frame.left + x * bounds.width,
				y: bounds.top - frame.top + y * bounds.height,
			}
			laser.style.left = `${position.x}px`
			laser.style.top = `${position.y}px`
			return position
		}
		function frame(time: number) {
			if (scrolling && !following && prompter) {
				prompter.scrollTop +=
					(Math.min(lastFrame ? time - lastFrame : 0, 100) * scrollSpeed) / 1000
				select(prompter.readingItem(), false)
			}
			if (scrolling && !following && time - lastAnnouncement > 250) {
				lastAnnouncement = time
				void options.announce()
			}
			lastFrame = time
			frameId = scrolling && !following ? requestAnimationFrame(frame) : 0
		}
		function toggleScroll() {
			scrolling = !scrolling
			let toggle = host.querySelector("#scroll-toggle")
			if (toggle) {
				toggle.textContent = translate(scrolling ? "Pause" : "Play")
				toggle.setAttribute("aria-pressed", String(scrolling))
			}
			updateScrollFrame()
		}
		function updateScrollFrame() {
			cancelAnimationFrame(frameId)
			lastFrame = 0
			frameId = scrolling && !following ? requestAnimationFrame(frame) : 0
		}
		function updatePresence() {
			if (following) {
				let presenter = options
					.presence()
					.filter(
						value =>
							value.presenting &&
							!value.board &&
							value.document === documentId &&
							Date.now() - value.time < 10000,
					)
					.sort((a, b) => b.time - a.time)[0]
				if (presenter) {
					if (
						presenter.item !== undefined &&
						items[presenter.item]?.slide === presenter.slide
					)
						select(presenter.item, false)
					else if (slideIndex !== presenter.slide) receive(presenter.slide)
					if (prompter && typeof presenter.scroll === "number")
						prompter.scrollTop =
							presenter.scroll *
							Math.max(0, prompter.scrollHeight - prompter.clientHeight)
				}
			}
			updateLaser()
		}
		function follow() {
			following = !following
			host
				.querySelector('[data-action="follow"]')
				?.setAttribute("aria-pressed", String(following))
			updateScrollFrame()
			updatePresence()
			void options.announce()
			update()
			return following
		}
		function toggleOverview() {
			let grid = part("#slide-overview")
			grid.hidden = !grid.hidden
			if (grid.hidden) return
			grid.replaceChildren()
			for (let [index, content] of slides(
				options.document()?.content ?? "",
			).entries()) {
				let choice = document.createElement("button"),
					preview = document.createElement("div"),
					number = document.createElement("span")
				choice.type = "button"
				choice.dataset.slideIndex = String(index)
				choice.setAttribute("aria-label", `${translate("Slide")} ${index + 1}`)
				preview.className = "overview-preview"
				number.textContent = String(index + 1)
				choice.append(preview, number)
				grid.append(choice)
				options.render(preview, content.content, true, index + 1)
				choice.onclick = () => {
					grid.hidden = true
					change(index - slideIndex)
				}
			}
		}
		function refreshOverview() {
			let grid = host.querySelector<HTMLElement>("#slide-overview")
			if (!grid || grid.hidden) return
			let parsed = slides(options.document()?.content ?? "")
			for (let [index, preview] of [
				...grid.querySelectorAll<HTMLElement>(".overview-preview"),
			].entries())
				options.render(preview, parsed[index]?.content ?? "", true, index + 1)
		}
	})
}

function control(
	id: string,
	label: string,
	content: string | ReturnType<typeof icon>,
) {
	let text = translate(label)
	return html`<button
		id="${id}"
		type="button"
		title="${text}"
		aria-label="${text}"
	>
		${content}
	</button>`
}

function timerControls() {
	return html`${control("presentation-timer", "Start or pause timer", "00:00")}${control("reset-presentation-timer", "Reset timer", "↺")}`
}

function slideshowMarkup() {
	return html`<div class="presentation-controls">
			${button("edit", translate("Exit"), "← Write")}${button("previous", translate("Previous slide"), "←")}<span
				id="slide-count"
			></span
			>${button("next", translate("Next slide"), "→")}${control("slide-overview-toggle", "All slides", "▦")}${timerControls()}${button("print", "Print / PDF", "▧")}${button("fullscreen", "Fullscreen", "⛶")}${button("follow", translate("Follow presenter"), "Follow", 'aria-pressed="false"')}
		</div>
		<div class="presentation-canvas">
			<div id="slide" class="slide-host"></div>
			<div id="laser" hidden></div>
			<div id="slide-overview" class="slide-overview" hidden></div>
		</div>`
}

function prompterMarkup() {
	return html`<header class="prompter-header">
			${button("edit", "Back to editor", html`${icon("arrow-left")}<span>${translate("Editor")}</span>`)}
			<div class="prompter-heading">
				<strong id="prompter-title"></strong>
				<span id="slide-count"></span>
			</div>
			<div class="prompter-actions">
				${control("preview-toggle", "Hide slide preview", html`${icon("panel-right")}<span>${translate("Slides")}</span>`)}${button("presenter", "Open audience window", html`${icon("presentation")}<span>${translate("Audience")}</span>`)}${button("follow", "Follow presenter", icon("users"), 'aria-pressed="false"')}${button("print", "Print / PDF", icon("printer"))}${button("fullscreen", "Fullscreen", icon("maximize-2"))}
			</div>
		</header>
		<div class="prompter-progress" aria-hidden="true">
			<span id="prompter-progress"></span>
		</div>
		<div class="prompter-body">
			<alkalye-teleprompter
				id="speaker-notes"
				class="speaker-notes"
				aria-label="${translate("Speaker notes")}"
			></alkalye-teleprompter>
			<aside
				class="prompter-preview"
				aria-label="${translate("Audience view")}"
			>
				<div class="prompter-preview-bar">
					<span>${translate("Audience view")}</span>
					${control("preview-close", "Back to notes", html`${icon("x")}<span>${translate("Notes")}</span>`)}
				</div>
				<div class="presentation-canvas">
					<div id="slide" class="slide-host"></div>
					<div id="laser" hidden></div>
				</div>
				<p class="prompter-hint">
					<span data-hint="pointer"
						>${translate("Hold Shift and move over the slide to point.")}</span
					><span data-hint="touch"
						>${translate("Touch and drag on the slide to point.")}</span
					>
				</p>
			</aside>
		</div>
		<footer class="prompter-toolbar">
			<span id="prompter-clock" class="prompter-clock"></span>
			<div class="prompter-navigation">
				${button("previous", "Previous slide", icon("chevron-left"))}${control("previous-note", "Previous item", icon("chevron-up"))}${control("next-note", "Next item", icon("chevron-down"))}${button("next", "Next slide", icon("chevron-right"))}
			</div>
			<div class="prompter-scroll">
				${button("scroll", "Auto-scroll", translate("Play"), 'id="scroll-toggle" aria-pressed="false"')}
				<label
					>${translate("Speed")}<input
						id="scroll-speed"
						aria-label="${translate("Scroll speed")}"
						type="range"
						min="5"
						max="150"
						value="35"
				/></label>
				<label
					>${translate("Size")}<input
						id="prompter-size"
						aria-label="${translate("Teleprompter text size")}"
						type="range"
						min="18"
						max="72"
						value="28"
				/></label>
				${button("mirror", "Mirror text", translate("Mirror"), 'aria-pressed="false"')}
			</div>
			<div class="prompter-timer">${timerControls()}</div>
		</footer>`
}
