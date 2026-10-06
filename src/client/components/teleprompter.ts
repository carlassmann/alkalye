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
	private resolve: ((id: string) => string | undefined) | undefined
	constructor() {
		super()
		this.addEventListener("click", event => this.choose(event))
	}
	configure(
		chosen: (index: number) => void,
		resolve?: (id: string) => string | undefined,
	) {
		this.chosen = chosen
		this.resolve = resolve
	}
	connectedCallback() {
		this.dataset.teleprompter = ""
	}
	get selected() {
		return this.current
	}
	show(items: PresentationItem[], selected: number | undefined) {
		this.items = items
		// An inert template keeps unresolved asset images from loading.
		let template = document.createElement("template")
		template.innerHTML = String(scriptMarkup(items))
		for (let image of template.content.querySelectorAll("img"))
			image.replaceWith(imageLabel(image))
		for (let link of template.content.querySelectorAll("a")) {
			let id = link.dataset.wikilink
			if (id) {
				let title = this.resolve?.(id)
				let label = document.createElement("span")
				label.className = title ? "wikilink" : "wikilink wikilink-broken"
				label.textContent = link.dataset.wikilabel ?? title ?? link.textContent
				link.replaceWith(label)
			} else link.target = "_blank"
		}
		let markup = template.innerHTML
		if (markup !== this.markup) {
			this.markup = markup
			this.replaceChildren(template.content)
			this.current = undefined
		}
		this.select(selected)
	}
	select(index: number | undefined, reveal = true) {
		if (index === this.current) return
		this.current = index
		this.paint()
		if (reveal) this.reveal()
	}
	// The original kept the selected item a header's height below the top.
	reveal() {
		let item = this.itemElement(this.current)
		if (!item) return
		let top =
			this.scrollTop +
			item.getBoundingClientRect().top -
			this.getBoundingClientRect().top -
			48
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
	return html`<div class="prompter-script">
		<div class="prompter-start">
			<p>${translate("Press any arrow key or click an item to start")}</p>
			<button type="button" data-start>
				${translate("Start Presentation")}
			</button>
		</div>
		${joinMarkup(
			groupBySlide(items).map(
				group =>
					html`<section class="prompter-slide" data-slide="${group.slide}">
						<div class="prompter-slide-label">
							${translate("Slide")} ${group.slide + 1}
						</div>
						${joinMarkup(
							group.items.map((item, offset) =>
								itemMarkup(item, group.first + offset),
							),
						)}
					</section>`,
			),
		)}
	</div>`
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
		: html`<div
				class="prompter-item prompter-note"
				data-item="${index}"
				data-line="${item.line}"
			>
				${rawMarkup(inline(item.text))}
			</div>`
}

function imageLabel(image: HTMLImageElement) {
	let label = document.createElement("span")
	label.className = "prompter-image"
	label.textContent = `[${translate("Image")}: ${image.alt || image.getAttribute("src") || ""}]`
	return label
}
