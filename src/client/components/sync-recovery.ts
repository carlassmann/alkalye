import { setMarkup } from "../dom"
import { html } from "../language"
import { icon } from "../icons"

export class SyncRecoveryElement extends HTMLElement {
	connectedCallback() {
		this.dataset.syncRecovery = ""
		this.hidden = true
		setMarkup(
			this,
			html`<div role="status">
					<strong>Your changes couldn’t sync</strong>
					<p>
						Your access changed. Your edits remain on this device. Save a
						personal copy, export them, or retry after access is restored.
					</p>
				</div>
				<div class="recovery-actions">
					<button type="button" data-action="recover-copy">
						${icon("copy")}<span>Save personal copy</span>
					</button>
					<button type="button" data-action="recover-export">
						${icon("download")}<span>Export Markdown</span>
					</button>
					<button type="button" data-action="retry-sync">
						${icon("refresh-cw")}<span>Retry sync</span>
					</button>
				</div>`,
		)
	}
	update(
		blocked: boolean,
		syncing: boolean,
		canCopy: boolean,
		copying = false,
		authentication = false,
	) {
		this.hidden = !blocked
		let explanation = this.querySelector("p")
		let message = authentication
			? "Your account is disconnected. Your edits remain on this device. Export the Markdown source, or sign in to the original account and retry sync."
			: "This document is no longer available for syncing. Your edits remain on this device. Save a personal copy, export the Markdown source, or retry after access is restored."
		if (explanation && explanation.textContent !== message)
			explanation.textContent = message
		let retry = this.querySelector<HTMLButtonElement>(
			'[data-action="retry-sync"]',
		)
		if (retry) retry.disabled = syncing
		let copy = this.querySelector<HTMLButtonElement>(
			'[data-action="recover-copy"]',
		)
		if (copy) copy.disabled = !canCopy || copying
		let label = copy?.querySelector("span")
		if (label)
			label.textContent = copying ? "Saving copy…" : "Save personal copy"
	}
}
customElements.define("alkalye-sync-recovery", SyncRecoveryElement)
