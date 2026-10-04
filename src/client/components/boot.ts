import { html } from "../../shared/html"

export function bootMarkup() {
	return html`<div data-boot role="status" aria-label="Opening your workspace">
		<div class="boot-toolbar" aria-hidden="true"><span>Alkalye</span></div>
		<div class="boot-page" aria-hidden="true">
			<div class="boot-line boot-title"></div>
			<div class="boot-line"></div>
			<div class="boot-line"></div>
			<div class="boot-line boot-short"></div>
		</div>
		<span class="boot-label">Opening your workspace…</span>
	</div>`
}
