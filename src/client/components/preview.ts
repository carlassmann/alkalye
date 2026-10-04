import { html } from "../language"
import { icon } from "../icons"
import type { DocumentOptions } from "./document-renderer"
import { renderDocument } from "./document-renderer"

export function renderPreview(
	host: HTMLElement,
	source: string,
	options: DocumentOptions,
	navigate: (id: string) => void,
	openDrawing?: (id: string) => void,
) {
	renderDocument(host, source, options)
	let root = host.shadowRoot
	if (!root) return
	root.addEventListener("click", navigateLink, { signal: replaceEvents(host) })
	function navigateLink(event: Event) {
		let image = event
			.composedPath()
			.find(node => node instanceof HTMLImageElement)
		if (image instanceof HTMLImageElement && image.dataset.asset)
			openDrawing?.(image.dataset.asset)
		let anchor = event
			.composedPath()
			.find(node => node instanceof HTMLAnchorElement)
		if (anchor instanceof HTMLAnchorElement && anchor.dataset.wikilink) {
			event.preventDefault()
			navigate(anchor.dataset.wikilink)
		}
	}
}
let events = new WeakMap<HTMLElement, AbortController>()
function replaceEvents(host: HTMLElement) {
	events.get(host)?.abort()
	let controller = new AbortController()
	events.set(host, controller)
	return controller.signal
}

export function previewMarkup(
	title: string,
	editorHref: string,
	comments: boolean,
) {
	return html`<section data-preview class="preview-screen">
		<header class="preview-header">
			<a class="preview-back" href="${editorHref}">Editor</a>
			<span id="preview-title" class="preview-title">${title}</span>
			<div class="preview-actions">
				${comments ? html`<button type="button" data-action="preview-comments" aria-label="Comments">${icon("message-square")}</button>` : ""}
				<alkalye-menu align="end">
					<button type="button" aria-label="Preview options">
						${icon("ellipsis")}
					</button>
					<div
						id="preview-options"
						class="menu-popover"
						popover
						role="menu"
						aria-label="Preview options"
					>
						<a href="${editorHref}" role="menuitem"><span>Editor</span></a>
						<button type="button" data-action="toggle-tools">
							<span>Document tools</span>
						</button>
						<button type="button" data-action="slideshow">
							<span>Slideshow</span>
						</button>
						<button type="button" data-action="teleprompter">
							<span>Teleprompter</span>
						</button>
						<hr />
						<button type="button" data-action="appearance-light">
							<span>Light appearance</span>
						</button>
						<button type="button" data-action="appearance-dark">
							<span>Dark appearance</span>
						</button>
						<button type="button" data-action="appearance-system">
							<span>System appearance</span>
						</button>
						<hr />
						<button type="button" data-action="print">
							<span>Print / PDF</span>
						</button>
					</div>
				</alkalye-menu>
			</div>
		</header>
		<div class="preview-scroll">
			<div data-preview id="preview" class="preview-paper"></div>
		</div>
	</section>`
}
