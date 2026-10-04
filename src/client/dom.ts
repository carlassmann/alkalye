import type { Markup } from "./language"
import { html, localizeMarkup, rawMarkup, translate } from "./language"

import { escape } from "../shared/markdown"

export function element(selector: string) {
	let found = document.querySelector<HTMLElement>(selector)
	if (!found) throw new Error(`Missing ${selector}`)
	return found
}
export function button(
	action: string,
	label: string,
	icon: string | Markup = "",
	extra = "",
) {
	label = translate(label)
	return html`<button
		type="button"
		data-action="${action}"
		${rawMarkup(extra)}
		title="${label}"
		aria-label="${label}"
	>
		${rawMarkup(typeof icon === "string" ? localizeMarkup(icon || escape(label)) : icon)}
	</button>`
}

let renderedMarkup = new WeakMap<Element, string>()
export function setMarkup(host: Element, markup: string | Markup) {
	host.innerHTML = String(markup)
}
export function updateMarkup(host: Element, value: string | Markup) {
	let markup = String(value)
	if (renderedMarkup.get(host) === markup) return
	host.innerHTML = markup
	renderedMarkup.set(host, markup)
}
