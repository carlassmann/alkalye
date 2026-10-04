import { setMarkup } from "../dom"
import { icon } from "../icons"
import { html, translate } from "../language"

// Offers a waiting new version until the person reloads into it or dismisses
// the offer for this visit.
export class UpdateBannerElement extends HTMLElement {
	private apply: (() => void) | undefined
	private events: AbortController | undefined
	offer(apply: () => void) {
		this.apply = apply
	}
	connectedCallback() {
		this.dataset.update = ""
		this.setAttribute("role", "status")
		setMarkup(
			this,
			html`<p>${translate("A new version of Alkalye is ready.")}</p>
				<button type="button" class="primary" data-update-apply>
					${translate("Reload")}</button
				><button
					type="button"
					data-update-dismiss
					aria-label="${translate("Later")}"
				>
					${icon("x")}
				</button>`,
		)
		let events = new AbortController()
		this.events = events
		this.addEventListener(
			"click",
			event => {
				if (!(event.target instanceof Element)) return
				if (event.target.closest("[data-update-apply]")) {
					for (let button of this.querySelectorAll("button"))
						button.disabled = true
					this.apply?.()
				} else if (event.target.closest("[data-update-dismiss]")) this.remove()
			},
			{ signal: events.signal },
		)
	}
	disconnectedCallback() {
		this.events?.abort()
		this.events = undefined
	}
	connectedMoveCallback() {}
}
customElements.define("alkalye-update", UpdateBannerElement)
