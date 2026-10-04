import { html, joinMarkup, rawMarkup, translate } from "../language"
import { inline, markdown } from "../../shared/markdown"
import { groupBySlide, type PresentationItem } from "../../shared/presentation"

// The presenter's script: every slide's visual blocks and spoken lines in
// reading order. Selection is owned by the presentation; this element only
// paints it and reports clicks.
export class TeleprompterElement extends HTMLElement {
	private items: PresentationItem[] = []
	private markup = ""
	private current: number | undefined
	private chosen: (index: number) => void = () => {}
	constructor() {
		super()
		this.addEventListener("click", event => this.choose(event))
	}
	configure(chosen: (index: number) => void) {
		this.chosen = chosen
	}
	connectedCallback() {
		this.dataset.teleprompter = ""
	}
	get selected() {
		return this.current
	}
	show(items: PresentationItem[], selected: number | undefined) {
		this.items = items
		let markup = String(scriptMarkup(items))
		if (markup !== this.markup) {
			this.markup = markup
			// An inert template keeps unresolved asset images from loading.
			let template = document.createElement("template")
			template.innerHTML = markup
			for (let image of template.content.querySelectorAll("img"))
				image.replaceWith(imageLabel(image))
			this.replaceChildren(template.content)
			this.paint()
		}
		this.select(selected)
	}
	select(index: number | undefined, reveal = true) {
		if (index === this.current) return
		this.current = index
		this.paint()
		if (reveal) this.reveal()
	}
	// The item under the reading line, so auto-scroll can carry the selection.
	readingItem() {
		let line = this.getBoundingClientRect().top + this.clientHeight * 0.25
		let found = this.current
		for (let item of this.querySelectorAll<HTMLElement>("[data-item]"))
			if (item.getBoundingClientRect().top <= line)
				found = Number(item.dataset.item)
		return found
	}
	reveal() {
		let item = this.itemElement(this.current)
		if (!item) return
		let top =
			this.scrollTop +
			item.getBoundingClientRect().top -
			this.getBoundingClientRect().top -
			this.clientHeight * 0.2
		this.scrollTo({
			top,
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
		})
	}
	private paint() {
		this.toggleAttribute("data-started", this.current !== undefined)
		let slide = this.items[this.current ?? -1]?.slide
		for (let section of this.querySelectorAll<HTMLElement>("[data-slide]"))
			section.toggleAttribute(
				"data-current",
				Number(section.dataset.slide) === slide,
			)
		for (let item of this.querySelectorAll<HTMLElement>("[data-item]")) {
			if (Number(item.dataset.item) === this.current)
				item.setAttribute("aria-current", "step")
			else item.removeAttribute("aria-current")
		}
	}
	private itemElement(index: number | undefined) {
		return this.querySelector<HTMLElement>(`[data-item="${index ?? -1}"]`)
	}
	private choose(event: MouseEvent) {
		if (!(event.target instanceof Element) || event.target.closest("a")) return
		if (event.target.closest("[data-start]")) return this.chosen(0)
		let item = event.target.closest<HTMLElement>("[data-item]")
		if (item) this.chosen(Number(item.dataset.item))
	}
}
customElements.define("alkalye-teleprompter", TeleprompterElement)

function scriptMarkup(items: PresentationItem[]) {
	if (!items.length)
		return html`<div class="prompter-empty">
			<strong>No slides yet</strong>
			<p>Add a heading or indented text to put something on a slide.</p>
		</div>`
	let groups = groupBySlide(items)
	return html`<div class="prompter-start">
			<p>Select a line or start from the top.</p>
			<button type="button" data-start>Start</button>
		</div>
		${joinMarkup(
			groups.map(
				group =>
					html`<section class="prompter-slide" data-slide="${group.slide}">
						<h2 class="prompter-slide-label">
							${translate("Slide")} ${group.slide + 1}
						</h2>
						${joinMarkup(
							group.items.map((item, offset) =>
								itemMarkup(item, group.first + offset),
							),
						)}
					</section>`,
			),
		)}`
}

function itemMarkup(item: PresentationItem, index: number) {
	return item.kind === "visual"
		? html`<div
				class="prompter-item prompter-visual"
				data-item="${index}"
				data-line="${item.start}"
			>
				${rawMarkup(markdown(item.source))}
			</div>`
		: html`<p
				class="prompter-item prompter-note"
				data-item="${index}"
				data-line="${item.line}"
			>
				${rawMarkup(inline(item.text))}
			</p>`
}

function imageLabel(image: HTMLImageElement) {
	let label = document.createElement("span")
	label.className = "prompter-image"
	label.textContent = `${translate("Image")}: ${image.alt || image.getAttribute("src") || ""}`
	return label
}
