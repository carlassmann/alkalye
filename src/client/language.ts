import { html as renderHtml } from "../shared/html"
import { escape } from "../shared/markdown"
import { german } from "./language.de"
export { joinMarkup, Markup, rawMarkup } from "../shared/html"

let selected = "system"
export function setLanguage(language: string) {
	selected = ["en", "de"].includes(language) ? language : "system"
	document.documentElement.lang = locale()
}
export function locale() {
	return selected === "system"
		? typeof window !== "undefined" && navigator.language.startsWith("de")
			? "de"
			: "en"
		: selected
}
export function translate(text: string, language = locale()) {
	return language === "de" ? (german[text] ?? text) : text
}
export function localizeMarkup(markup: string, language = locale()) {
	if (language !== "de") return markup
	return markup
		.replace(
			/(>|^)([^<>]+)(?=<|$)/g,
			(match: string, prefix: string, text: string) =>
				text.trim() in german
					? prefix +
						text.replace(text.trim(), escape(translate(text.trim(), language)))
					: match,
		)
		.replace(
			/\b(aria-label|title|placeholder)="([^"]+)"/g,
			(match: string, attribute: string, text: string) =>
				text in german
					? `${attribute}="${escape(translate(text, language))}"`
					: match,
		)
}

let templates = new WeakMap<TemplateStringsArray, Map<string, string[]>>()
export function html(parts: TemplateStringsArray, ...values: unknown[]) {
	let language = locale(),
		localized = templates.get(parts) ?? new Map<string, string[]>()
	templates.set(parts, localized)
	let text = localized.get(language)
	if (!text) {
		text = parts.map(part => localizeMarkup(part, language))
		localized.set(language, text)
	}
	return renderHtml(text, ...values)
}
