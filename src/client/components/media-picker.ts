import { safeUrl } from "../../shared/markdown"
import { setMarkup } from "../dom"
import { icon } from "../icons"
import { html, joinMarkup, translate } from "../language"
import { openDialog } from "./dialog"

export interface MediaChoice {
	id: string
	name: string
	kind: "image" | "video" | "audio" | "whiteboard"
}
interface MediaPickerOptions {
	dialog: HTMLDialogElement
	choices: readonly MediaChoice[]
	kind?: "media" | "whiteboard"
	canDraw: boolean
	select(id: string): Promise<unknown>
	link(url: string): Promise<unknown>
	upload(): void
	createDrawing(): void
	report(error: unknown): void
	closed(): void
}

export function openMediaPicker(options: MediaPickerOptions) {
	let kind = options.kind ?? "media"
	openDialog(
		options.dialog,
		options.report,
		() => {},
		title(kind),
		html`<alkalye-media-picker data-media-picker></alkalye-media-picker>`,
	)
	let picker = options.dialog.querySelector("alkalye-media-picker")
	if (!(picker instanceof MediaPickerElement)) return
	picker.configure(options)
}

export class MediaPickerElement extends HTMLElement {
	private options: MediaPickerOptions | undefined
	private kind: "media" | "whiteboard" = "media"
	private active = 0
	private busy = false
	private events: AbortController | undefined

	configure(options: MediaPickerOptions) {
		this.options = options
		this.kind = options.kind ?? "media"
		this.render()
	}
	disconnectedCallback() {
		this.events?.abort()
	}
	private render() {
		let options = this.options
		if (!options) return
		this.events?.abort()
		let events = new AbortController()
		this.events = events
		setMarkup(
			this,
			html`<p>
					${this.kind === "media" ? "Search for media to insert." : "Search for whiteboards to insert."}
				</p>
				<input
					id="media-search"
					type="search"
					placeholder="${this.kind === "media" ? "Search media…" : "Search whiteboards…"}"
					aria-label="${this.kind === "media" ? "Search media" : "Search whiteboards"}"
					role="combobox"
					aria-autocomplete="list"
					aria-controls="media-choices"
					aria-expanded="true"
					spellcheck="false"
				/>
				<div
					id="media-choices"
					role="listbox"
					aria-label="${title(this.kind)}"
				></div>
				<div class="media-create">
					<button type="button" data-media-action="upload">
						${icon("plus")}<span>New media</span>
					</button>
					${options.canDraw ? html`<button type="button" data-media-action="drawing">${icon("pen-tool")}<span>New whiteboard</span></button>` : ""}
				</div>
				${
					this.kind === "media"
						? html`<details>
								<summary>${icon("link")}<span>Insert from URL</span></summary>
								<label
									>Media URL<input
										type="url"
										id="media-url"
										placeholder="https://…" /></label
								><button type="button" data-media-action="url">Insert</button>
							</details>`
						: ""
				}
				<footer>
					${options.canDraw ? html`<button type="button" data-media-action="switch">${icon(this.kind === "media" ? "pen-tool" : "image")}<span>${this.kind === "media" ? "Select whiteboard" : "Select media"}</span></button>` : ""}<button
						type="button"
						class="ghost"
						value="cancel"
					>
						Cancel
					</button>
				</footer>`,
		)
		let search = this.querySelector("#media-search")
		if (!(search instanceof HTMLInputElement)) return
		search.addEventListener(
			"input",
			() => {
				this.active = 0
				this.show()
			},
			{ signal: events.signal },
		)
		search.addEventListener(
			"keydown",
			event => {
				if (event.isComposing) return
				let count = this.filtered().length
				if (event.key === "Enter") {
					event.preventDefault()
					let choice = this.filtered()[this.active]
					if (choice) this.run(() => options.select(choice.id))
				} else if (
					["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
				) {
					event.preventDefault()
					this.active =
						event.key === "Home"
							? 0
							: event.key === "End"
								? count - 1
								: count
									? (this.active +
											(event.key === "ArrowDown" ? 1 : -1) +
											count) %
										count
									: 0
					this.highlight()
				}
			},
			{ signal: events.signal },
		)
		this.addEventListener(
			"click",
			event => {
				if (!(event.target instanceof Element) || this.busy) return
				let selected =
					event.target.closest<HTMLElement>("[data-media-id]")?.dataset.mediaId
				if (selected) {
					this.run(() => options.select(selected))
					return
				}
				let action = event.target.closest<HTMLElement>("[data-media-action]")
					?.dataset.mediaAction
				if (action === "switch") {
					this.kind = this.kind === "media" ? "whiteboard" : "media"
					this.active = 0
					let heading = options.dialog.querySelector("h2")
					if (heading) heading.textContent = title(this.kind)
					this.render()
				} else if (action === "upload" || action === "drawing") {
					options.dialog.close("create")
					if (action === "upload") options.upload()
					else options.createDrawing()
				} else if (action === "url") this.insertUrl()
				else if (event.target.closest('button[value="cancel"]'))
					options.dialog.close("cancel")
			},
			{ signal: events.signal },
		)
		this.addEventListener(
			"pointermove",
			event => {
				if (!(event.target instanceof Element) || this.busy) return
				let option = event.target.closest('[role="option"]')
				if (!option) return
				this.active = [...this.querySelectorAll('[role="option"]')].indexOf(
					option,
				)
				this.highlight()
			},
			{ signal: events.signal },
		)
		this.querySelector("#media-url")?.addEventListener(
			"keydown",
			event => {
				if (event instanceof KeyboardEvent && event.key === "Enter") {
					event.preventDefault()
					this.insertUrl()
				}
			},
			{ signal: events.signal },
		)
		options.dialog.addEventListener(
			"close",
			() => {
				events.abort()
				options.closed()
			},
			{ signal: events.signal, once: true },
		)
		this.show()
		search.focus({ preventScroll: true })
	}
	private filtered() {
		let search = this.querySelector("#media-search")
		let query =
			search instanceof HTMLInputElement ? search.value.toLocaleLowerCase() : ""
		return (this.options?.choices ?? []).filter(
			choice =>
				(this.kind === "whiteboard"
					? choice.kind === "whiteboard"
					: choice.kind !== "whiteboard") &&
				choice.name.toLocaleLowerCase().includes(query),
		)
	}
	private show() {
		let list = this.querySelector("#media-choices")
		if (!list) return
		let choices = this.filtered()
		setMarkup(
			list,
			choices.length
				? joinMarkup(
						choices.map(
							(choice, index) =>
								html`<button
									type="button"
									role="option"
									tabindex="-1"
									id="media-choice-${index}"
									data-media-id="${choice.id}"
								>
									${icon(choice.kind === "whiteboard" ? "pen-tool" : choice.kind === "video" ? "film" : choice.kind === "audio" ? "music" : "image")}<span
										>${choice.name}</span
									>
								</button>`,
						),
					)
				: html`<p class="media-empty">
						${this.kind === "media" ? "No media found" : "No whiteboards found"}
					</p>`,
		)
		this.highlight()
	}
	private highlight() {
		let buttons = [...this.querySelectorAll<HTMLElement>('[role="option"]')]
		for (let [index, button] of buttons.entries())
			button.setAttribute("aria-selected", String(index === this.active))
		let selected = buttons[this.active]
		let search = this.querySelector("#media-search")
		if (selected) {
			search?.setAttribute("aria-activedescendant", selected.id)
			selected.scrollIntoView({ block: "nearest" })
		} else search?.removeAttribute("aria-activedescendant")
	}
	private insertUrl() {
		let input = this.querySelector("#media-url")
		if (!(input instanceof HTMLInputElement) || !this.options) return
		let url = input.value.trim()
		if (
			!/^https?:\/\//i.test(url) ||
			safeUrl(url) === "#" ||
			!input.checkValidity()
		) {
			input.setCustomValidity("Enter an HTTP or HTTPS media URL")
			input.reportValidity()
			input.addEventListener("input", () => input.setCustomValidity(""), {
				once: true,
				signal: this.events?.signal,
			})
			return
		}
		let options = this.options
		this.run(() => options.link(url))
	}
	private run(command: () => Promise<unknown>) {
		if (this.busy || !this.options) return
		let options = this.options
		this.busy = true
		this.setAttribute("aria-busy", "true")
		void command()
			.then(() => {
				if (this.isConnected) options.dialog.close("insert")
			})
			.catch(options.report)
			.finally(() => {
				this.busy = false
				this.removeAttribute("aria-busy")
			})
	}
}
customElements.define("alkalye-media-picker", MediaPickerElement)

function title(kind: "media" | "whiteboard") {
	return translate(kind === "media" ? "Select media" : "Select whiteboard")
}
