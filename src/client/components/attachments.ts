import {
	freshPreview,
	previewField,
	darkPreviewField,
} from "../../shared/whiteboard"
import type { DocumentFailure } from "../document-failures"
import { button } from "../dom"
import { icon } from "../icons"
import type { IconName } from "../icons"
import { html, joinMarkup, translate } from "../language"

interface Attachment {
	id: string
	fields: Record<string, string>
	audible: boolean
}
export function attachmentsMarkup(
	assets: readonly Attachment[],
	boards: readonly { id: string; fields: Record<string, string> }[],
	writable: boolean,
	failures: ReadonlyMap<string, DocumentFailure>,
	canDraw = true,
) {
	let entries = [
		...assets,
		...boards.map(board => ({ ...board, audible: false })),
	]
	return html`<section data-attachments class="tool-section">
		<h3>
			<span>Assets</span>${
				writable
					? html`<alkalye-menu align="end"
							><button type="button" aria-label="Add asset">
								${icon("plus")}
							</button>
							<div id="asset-add-menu" class="menu-popover" popover role="menu">
								${canDraw ? action("new-whiteboard", "New whiteboard", "pen-tool") : ""}${action("asset-upload", "Upload or import", "upload")}
							</div></alkalye-menu
						>`
					: ""
			}
		</h3>
		${entries.length ? joinMarkup(entries.map(row)) : html`<p class="assets-empty">${icon("image")}<span>No assets yet</span></p>`}
		${failures.size ? button("media-retry", "Retry attachment previews", "Retry previews") : ""}
	</section>`
	function row(asset: Attachment) {
		let drawing = asset.fields.type === "whiteboard"
		let symbol: IconName = drawing
			? "pen-tool"
			: asset.audible
				? "film"
				: "image"
		let name = asset.fields.name || translate(drawing ? "Whiteboard" : "Asset")
		let svg = drawing
			? freshPreview(
					asset.fields,
					document.documentElement.dataset.appearance === "dark"
						? darkPreviewField
						: previewField,
				)
			: undefined
		let preview = svg
			? "data:image/svg+xml," + encodeURIComponent(svg)
			: undefined
		return html`<alkalye-menu
			class="asset-row"
			data-asset-id="${asset.id}"
			align="end"
		>
			<button type="button" aria-label="${name}">
				<span class="asset-thumbnail"
					>${preview ? html`<img src="${preview}" alt="" />` : icon(symbol)}</span
				><span>${name}</span>
			</button>
			<div
				id="asset-actions-${asset.id}"
				class="menu-popover"
				popover
				role="menu"
			>
				${drawing ? action("drawing:" + asset.id, "Edit whiteboard", "pen-tool") : ""}
				${writable ? action("asset-insert:" + asset.id, "Insert", "plus") : ""}
				${action("asset-download:" + asset.id, "Download", "download")}
				${writable ? html`${action("asset-rename:" + asset.id, "Rename", "pencil")}${asset.audible ? action("asset-mute:" + asset.id, asset.fields.muted === "true" ? "Unmute audio" : "Mute audio", "music") : ""}${action("asset-delete:" + asset.id, "Delete", "trash-2")}` : ""}
			</div>
			${failures.has(asset.id) ? html`<small data-asset-failure>${failures.get(asset.id)?.message}</small>` : ""}
		</alkalye-menu>`
	}
}
function action(command: string, label: string, symbol: IconName) {
	return button(
		command,
		translate(label),
		html`${icon(symbol)}<span>${translate(label)}</span>`,
	)
}
