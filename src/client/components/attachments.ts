import type { DocumentFailure } from "../document-failures"
import { button } from "../dom"
import { icon } from "../icons"
import { html, joinMarkup, translate } from "../language"

interface Attachment {
	id: string
	fields: Record<string, string>
	audible: boolean
}
export function attachmentsMarkup(
	assets: readonly Attachment[],
	writable: boolean,
	failures: ReadonlyMap<string, DocumentFailure>,
) {
	return html`<section data-attachments class="tool-section">
		<h3>
			<span>${translate("Assets")}</span
			>${writable ? button("asset", "Add media", icon("plus")) : ""}
		</h3>
		${
			assets.length
				? joinMarkup(
						assets.map(
							asset =>
								html`<div class="asset-row" data-asset-id="${asset.id}">
									${writable ? html`<button data-action="asset-insert:${asset.id}" title="${translate("Insert attachment")}">${icon("image")}<span>${asset.fields.name ?? "Asset"}</span></button>` : html`<span class="asset-name">${icon("image")}<span>${asset.fields.name ?? "Asset"}</span></span>`}
									<div class="asset-actions">
										${button(`asset-download:${asset.id}`, "Download", icon("download"))}
										${writable ? html`${button(`asset-rename:${asset.id}`, "Rename", icon("pencil"))}${asset.audible ? button(`asset-mute:${asset.id}`, asset.fields.muted === "true" ? "Unmute audio" : "Mute audio", icon(asset.fields.muted === "true" ? "message-square-off" : "message-square")) : ""}${button(`asset-delete:${asset.id}`, "Delete", icon("trash-2"))}` : ""}
									</div>
									${failures.has(asset.id) ? html`<small data-asset-failure>${failures.get(asset.id)?.message}</small>` : ""}
								</div>`,
						),
						"",
					)
				: html`<p class="assets-empty">
						${icon("image")}<span>${translate("No assets yet")}</span>
					</p>`
		}
		${failures.size ? button("media-retry", "Retry attachment previews", "Retry previews") : ""}
	</section>`
}
