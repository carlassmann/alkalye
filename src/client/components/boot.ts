import { html } from "../../shared/html"
import { toolbarMarkup } from "./toolbar"

export function bootMarkup(showToolbar = true) {
	return html`<div data-boot role="status" aria-label="Opening your workspace">
		${showToolbar ? html`<div inert aria-hidden="true">${toolbarMarkup()}</div>` : ""}
	</div>`
}
