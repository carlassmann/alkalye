import { setMarkup } from "../dom"
import { html, translate } from "../language"

// Offers a waiting new version until the person reloads into it or dismisses
// the offer for this visit.
export class UpdateBannerElement extends HTMLElement {
	private apply: (() => void) | undefined
	private events: AbortController | undefined
	offer(apply: () => void) {
		this.apply = apply
	}
	enableReload() {
		let button = this.querySelector<HTMLButtonElement>("[data-update-apply]")
		if (button) button.disabled = false
	}
	connectedCallback() {
		this.dataset.update = ""
		setMarkup(
			this,
			html`<div data-content>
					<div data-title>${translate("Update available")}</div>
					<div data-update-description>
						${translate("Reload to update to the latest version")}
					</div>
				</div>
				<button type="button" data-update-apply>
					${translate("Reload")}
				</button>`,
		)
		let events = new AbortController()
		this.events = events
		this.addEventListener(
			"click",
			event => {
				if (!(event.target instanceof Element)) return
				let applyButton = event.target.closest("[data-update-apply]")
				if (
					applyButton instanceof HTMLButtonElement &&
					!applyButton.disabled &&
					this.apply
				) {
					for (let button of this.querySelectorAll("button"))
						button.disabled = true
					this.apply?.()
				}
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
