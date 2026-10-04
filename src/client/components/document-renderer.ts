import * as Effect from "effect/Effect"
import { resolvePreset } from "../../shared/themes"
import { setMarkup } from "../dom"
import { html, joinMarkup, localizeMarkup, rawMarkup } from "../language"
import { readVideoDuration } from "../video-duration"

import {
	compileTheme,
	markdown,
	safeUrl,
	slideBlocks,
} from "../../shared/markdown"
import { syntaxColors } from "../../shared/syntax"
export interface DocumentOptions {
	size?: string
	theme?: string
	mode?: string
	appearance?: string
	preset?: string
	syntaxTheme?: string
	slideNumber?: number
	assets?: Map<string, string>
	mutedAssets?: string[]
	resolve?: (id: string) => string
}
let previousRender = new WeakMap<
	HTMLElement,
	{
		source: string
		settings: string
		assets: Map<string, string>
	}
>()
let fitting = new WeakMap<HTMLElement, ResizeObserver>()
export function sanitize(html: string) {
	let parsed = new DOMParser().parseFromString(html, "text/html")
	for (let node of parsed.querySelectorAll(
		"script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select,animate,set,animateMotion,animateTransform",
	))
		node.remove()
	for (let node of parsed.querySelectorAll("*")) {
		for (let attribute of [...node.attributes]) {
			if (
				attribute.name.startsWith("on") ||
				attribute.name === "srcdoc" ||
				attribute.name === "style" ||
				attribute.name === "formaction"
			)
				node.removeAttribute(attribute.name)
			if (["href", "src", "xlink:href"].includes(attribute.name))
				node.setAttribute(attribute.name, safeUrl(attribute.value))
		}
	}
	return parsed.body.innerHTML
}
export function renderDocument(
	host: HTMLElement,
	source: string,
	options: DocumentOptions = {},
) {
	let settings = JSON.stringify([
		options.size,
		options.theme,
		options.mode,
		options.appearance,
		options.preset,
		options.syntaxTheme,
		options.slideNumber,
		[...source.matchAll(/\[\[([^\]]+)\]\]/g)].map(match =>
			options.resolve?.(match[1] ?? ""),
		),
	])
	let previous = previousRender.get(host)
	let assets = options.assets ?? new Map<string, string>()
	if (
		previous?.source === source &&
		previous.settings === settings &&
		previous.assets.size === assets.size &&
		[...assets].every(([id, url]) => previous.assets.get(id) === url)
	)
		return updateMuted(host, options.mutedAssets)
	host.dataset.documentRenderer = ""
	let root = host.shadowRoot ?? host.attachShadow({ mode: "open" })
	let compiled = options.theme
		? compileTheme(options.theme)
		: { css: "", document: "", slide: "", metadata: { name: "", presets: [] } }
	let style = document.createElement("style")
	style.textContent = compiled.css
		.replace(/:root\b/g, ":host")
		.replace(/:scope\b/g, ".theme")
	loadFonts(compiled.css, host.ownerDocument)
	let stylesheet = document.createElement("link")
	stylesheet.rel = "stylesheet"
	stylesheet.href = "/components/document-renderer.css"
	let wrapper = document.createElement("div")
	wrapper.dataset.documentRenderer = ""
	wrapper.className =
		options.mode === "slideshow" ? "theme slide" : "theme document"
	wrapper.dataset.mode = options.mode ?? "document"
	let preset = resolvePreset(
		compiled.metadata.presets,
		options.preset,
		options.appearance,
	)
	wrapper.dataset.appearance =
		preset?.appearance ?? options.appearance ?? "dark"
	wrapper.dataset.preset = preset?.name ?? ""
	for (let [name, value] of Object.entries(preset?.variables ?? {}))
		wrapper.style.setProperty(name, value)
	let colors = syntaxColors(options.syntaxTheme, options.appearance)
	for (let [index, kind] of [
		"keyword",
		"string",
		"comment",
		"number",
	].entries())
		wrapper.style.setProperty("--syntax-" + kind, colors[index] ?? "")
	let template =
		options.mode === "slideshow" ? compiled.slide : compiled.document
	setMarkup(
		wrapper,
		template
			? sanitize(template)
			: localizeMarkup('<article class="content" data-content></article>'),
	)
	let slot = wrapper.querySelector<HTMLElement>(
		"[data-content],[data-document]",
	)
	if (!slot) throw new Error("Theme content slot missing")
	slot.classList.add("content")
	setMarkup(
		slot,
		options.mode === "slideshow"
			? html`<div class="slideshow-grid">
					${joinMarkup(
						slideBlocks(source).map(
							block =>
								html`<div class="slideshow-cell">
									${rawMarkup(markdown(block))}
								</div>`,
						),
						"",
					)}
				</div>`
			: markdown(source),
	)
	for (let image of slot.querySelectorAll("img")) {
		let src = image.getAttribute("src") ?? ""
		if (src.startsWith("asset:") || options.assets?.has(src)) {
			if (src.startsWith("asset:")) image.dataset.asset = src.slice(6)
			let url = options.assets?.get(
				src.startsWith("asset:") ? src.slice(6) : src,
			)
			if (url) {
				let type = decodeURIComponent(url.split("#type=")[1] ?? "")
				if (
					url.startsWith("data:video") ||
					url.startsWith("data:audio") ||
					type.startsWith("video/") ||
					type.startsWith("audio/")
				) {
					let media =
						url.startsWith("data:audio") || type.startsWith("audio/")
							? document.createElement("audio")
							: document.createElement("video")
					media.src = url
					media.dataset.asset = image.dataset.asset ?? src
					media.controls = true
					if (media instanceof HTMLVideoElement)
						media.onloadedmetadata = () => {
							void Effect.runPromise(readVideoDuration(media)).catch(() => {})
						}
					media.muted =
						options.mutedAssets?.includes(media.dataset.asset) ?? false
					image.replaceWith(media)
				} else image.src = url
			}
		}
	}
	for (let link of slot.querySelectorAll<HTMLElement>("[data-wikilink]"))
		link.textContent =
			link.dataset.wikilabel ??
			options.resolve?.(link.dataset.wikilink ?? "") ??
			link.textContent
	for (let number of wrapper.querySelectorAll("[data-slide-number]"))
		number.textContent = String(options.slideNumber ?? 1)
	root.replaceChildren(stylesheet, style, wrapper)
	previousRender.set(host, { source, settings, assets })
	if (options.mode === "slideshow") {
		stylesheet.onload = () => fitSlide(host, options.size)
		for (let image of root.querySelectorAll("img"))
			image.onload = () => fitSlide(host, options.size)
		if (!fitting.has(host)) {
			let observer = new ResizeObserver(() => {
				if (!host.isConnected) {
					observer.disconnect()
					fitting.delete(host)
				} else fitSlide(host, options.size)
			})
			observer.observe(host)
			fitting.set(host, observer)
		}
		requestAnimationFrame(() => fitSlide(host, options.size))
	} else {
		fitting.get(host)?.disconnect()
		fitting.delete(host)
	}
}
export function clearDocument(host: HTMLElement) {
	previousRender.delete(host)
	fitting.get(host)?.disconnect()
	fitting.delete(host)
	host.shadowRoot?.replaceChildren()
}
function updateMuted(host: HTMLElement, muted: string[] = []) {
	for (let media of host.shadowRoot?.querySelectorAll("audio,video") ?? [])
		if (media instanceof HTMLMediaElement)
			media.muted = muted.includes(media.dataset.asset ?? "")
}
let fontDocuments = new WeakMap<Document, Set<string>>()
function loadFonts(css: string, document: Document) {
	let loadedFonts = fontDocuments.get(document) ?? new Set<string>()
	fontDocuments.set(document, loadedFonts)
	let sheet = new CSSStyleSheet()
	sheet.replaceSync(css)
	function visit(rules: CSSRuleList) {
		for (let rule of rules) {
			if (rule instanceof CSSFontFaceRule) {
				let key = rule.cssText
				if (loadedFonts.has(key)) continue
				loadedFonts.add(key)
				let style = rule.style
				let family = style
					.getPropertyValue("font-family")
					.replace(/^['"]|['"]$/g, "")
				let face = new FontFace(family, style.getPropertyValue("src"), {
					weight: style.getPropertyValue("font-weight") || "normal",
					style: style.getPropertyValue("font-style") || "normal",
					display: "swap",
				})
				document.fonts.add(face)
				void face.load().catch(() => loadedFonts.delete(key))
			} else if (rule instanceof CSSGroupingRule) visit(rule.cssRules)
		}
	}
	visit(sheet.cssRules)
}
function fitSlide(host: HTMLElement, requestedSize?: string) {
	let grid = host.shadowRoot?.querySelector<HTMLElement>(".slide .content")
	if (!grid || !host.isConnected) return
	let low = 12,
		high = Math.min(
			requestedSize === "S" ? 36 : requestedSize === "L" ? 60 : 48,
			host.clientWidth / 14,
		)
	for (let step = 0; step < 7; step++) {
		let size = (low + high) / 2
		grid.style.setProperty("--slide-body-size", `${size}px`)
		grid.style.setProperty("--slide-h1-size", `${size * 1.7}px`)
		grid.style.setProperty("--slide-scale", String(size / 48))
		if (
			grid.scrollHeight > grid.clientHeight + 1 ||
			grid.scrollWidth > grid.clientWidth + 1
		)
			high = size
		else low = size
	}
	grid.style.setProperty("--slide-body-size", `${low}px`)
	grid.style.setProperty("--slide-h1-size", `${low * 1.7}px`)
	grid.style.setProperty("--slide-scale", String(low / 48))
}
