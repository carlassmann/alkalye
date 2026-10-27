import { Marked } from "marked"
import type { PrintableAsset } from "@/app/features/assets"
import { getDocumentTitle } from "@/app/features/documents/lib/title"
import {
	parsePresentation,
	parsePresentationSize,
	parsePresentationTheme,
	type SlideContent,
	type TextSegment,
	type VisualBlock,
} from "@/app/features/presentation/lib/presentation"
import {
	findSlideScale,
	fitPrintedSlides,
	getSlideGridTemplate,
	slideBaseSizes,
	waitForPrintedSlideAssets,
} from "@/app/features/presentation/lib/slide-fit"
import {
	loadSyntaxHighlighter,
	resolveSyntaxTheme,
} from "@/app/features/syntax-highlighting"
import { getSlideshowBaseCss } from "@/app/features/themes/lib/default-theme"
import { escapeHtml, type PrintTheme } from "./printable-html"
import {
	replaceAssetSources,
	sanitizePrintableHtml,
	type HtmlParser,
} from "./print-media"

export {
	buildPrintableSlides,
	groupPrintedSlides,
	slideAspectRatios,
	slidePrintLayouts,
}
export type { SlideAspectRatio, SlidePrintLayout, PrintedSlide, AppFontSources }

let slideAspectRatios = ["16:9", "4:3"] as const
let slidePrintLayouts = ["slides", "notes"] as const

type SlideAspectRatio = (typeof slideAspectRatios)[number]
type SlidePrintLayout = (typeof slidePrintLayouts)[number]
type PrintedSlide = {
	slideNumber: number
	blocks: VisualBlock[]
	noteLines: number[]
}
// URLs (or data URIs) of the app's own Geist fonts, so unthemed slides print
// with the same typeface as the slideshow.
type AppFontSources = Record<
	"sans" | "mono",
	{ latin: string; latinExt: string }
>
type Highlight = (code: string, language: string | undefined) => string

// PowerPoint's default slide sizes (13.333 × 7.5 in and 10 × 7.5 in) at 96 dpi.
let slideFrameSizes: Record<
	SlideAspectRatio,
	{ width: number; height: number }
> = {
	"16:9": { width: 1280, height: 720 },
	"4:3": { width: 960, height: 720 },
}

// A4 width minus the notes page margins, in CSS pixels.
let notesSlideWidth = 680

async function buildPrintableSlides(params: {
	content: string
	theme: PrintTheme | null
	assets: PrintableAsset[]
	defaultSyntaxTheme: string | null
	parseHtml: HtmlParser
	layout: SlidePrintLayout
	aspectRatio: SlideAspectRatio
	wikilinkTitles?: Map<string, string>
	appFonts?: AppFontSources
}): Promise<string> {
	let { content, theme, layout, aspectRatio, parseHtml } = params
	let appearance = parsePresentationTheme(content) ?? "light"
	let syntaxTheme = resolveSyntaxTheme({
		content,
		defaultFamilyId: params.defaultSyntaxTheme,
		appearance,
	})
	let highlighter = await loadSyntaxHighlighter(syntaxTheme)
	let renderer: SlideRenderer = {
		highlight: (code, language) =>
			highlighter.highlight({ code, language, theme: syntaxTheme }),
		wikilinkTitles: params.wikilinkTitles ?? new Map(),
	}
	let frame = slideFrameSizes[aspectRatio]
	let baseSize = slideBaseSizes[parsePresentationSize(content)]
	let slides = groupPrintedSlides(parsePresentation(content))
	let slideTemplate = theme?.slideTemplate
		? parseSlideTemplate(theme.slideTemplate, parseHtml)
		: null

	let sourceLines = content.split("\n")
	let pages = slides.map((slide, index) => {
		let slideHtml = renderSlideFrame({
			slide,
			theme,
			appearance,
			baseSize,
			slideTemplate,
			renderer,
		})
		return layout === "notes"
			? renderNotesPage({
					pageNumber: index + 1,
					slideHtml,
					notes: getNotesMarkdown(slide.noteLines, sourceLines),
					renderer,
					frame,
				})
			: `<section class="print-page">${slideHtml}</section>`
	})
	let body = sanitizePrintableHtml(
		await replaceAssetSources(pages.join("\n"), params.assets, parseHtml),
		parseHtml,
	)

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<title>${escapeHtml(getDocumentTitle(content))}</title>
	${params.appFonts ? `<style>\n${buildAppFontFaceRules(params.appFonts)}\n</style>` : ""}
	<style>
${getPrintedSlidesCss(layout, frame)}
${getSlideshowBaseCss()}
	</style>
	${theme?.fontFaceRules ? `<style>\n${theme.fontFaceRules}\n</style>` : ""}
	${theme?.presetVariables ? `<style>\n${theme.presetVariables}\n</style>` : ""}
	${theme?.css ? `<style>\n${theme.css}\n</style>` : ""}
	${slideTemplate?.styles ?? ""}
	<style>
${getPrintedPageCss(layout, frame)}
	</style>
</head>
<body>
${body}
<script>
(${waitForPrintedSlideAssets.toString()})(document).then(function () {
	(${fitPrintedSlides.toString()})(document, ${findSlideScale.toString()})
})
</script>
</body>
</html>`
}

// Slides without visual blocks never appear in the slideshow, so their
// speaker notes belong to the slide shown while they are spoken.
function groupPrintedSlides(
	items: ReturnType<typeof parsePresentation>,
): PrintedSlide[] {
	let slideNumbers = new Set(
		items.flatMap(item => (item.type === "block" ? [item.slideNumber] : [])),
	)
	let slides: PrintedSlide[] = []
	let notesBeforeFirstSlide: number[] = []

	for (let item of items) {
		let current = slides.at(-1)
		if (
			slideNumbers.has(item.slideNumber) &&
			current?.slideNumber !== item.slideNumber
		) {
			current = { slideNumber: item.slideNumber, blocks: [], noteLines: [] }
			slides.push(current)
		}
		if (item.type === "block") current?.blocks.push(item.block)
		else (current?.noteLines ?? notesBeforeFirstSlide).push(item.lineNumber)
	}
	slides[0]?.noteLines.unshift(...notesBeforeFirstSlide)
	return slides
}

type SlideRenderer = {
	highlight: Highlight
	wikilinkTitles: Map<string, string>
}

type SlideTemplate = {
	document: Document
	slot: Element
	styles: string
}

function parseSlideTemplate(
	template: string,
	parseHtml: HtmlParser,
): SlideTemplate | null {
	let document = parseHtml(template)
	let slot = document.querySelector("[data-content], [data-document]")
	if (!slot) return null
	let styles = Array.from(document.head.querySelectorAll("style"))
		.map(style => style.outerHTML)
		.join("\n")
	return { document, slot, styles }
}

function renderSlideFrame(params: {
	slide: PrintedSlide
	theme: PrintTheme | null
	appearance: "light" | "dark"
	baseSize: { h1: number; body: number }
	slideTemplate: SlideTemplate | null
	renderer: SlideRenderer
}): string {
	let { slide, theme, appearance, baseSize, slideTemplate, renderer } = params
	let grid = getSlideGridTemplate(slide.blocks.length, false)
	let isImageOnly = slide.blocks.every(block =>
		block.content.every(item => item.type === "image"),
	)
	let cells = slide.blocks
		.map(
			block =>
				`<div class="slideshow-cell">${block.content.map(item => renderSlideContent(item, renderer)).join("")}</div>`,
		)
		.join("")
	let fittedContent = `<div class="slide print-slide-fit"><div class="content slideshow-grid" data-print-slide-content data-h1-size="${baseSize.h1}" data-body-size="${baseSize.body}" data-image-only="${isImageOnly}" style="grid-template-columns: ${grid.cols}; grid-template-rows: ${grid.rows}; --slide-h1-size: ${baseSize.h1}px; --slide-body-size: ${baseSize.body}px; --slide-scale: 1">${cells}</div></div>`
	let slideBody = slideTemplate
		? fillSlideTemplate(slideTemplate, fittedContent, slide.slideNumber)
		: fittedContent

	return `<div class="print-slide" data-theme-scope="print" data-mode="slideshow" data-appearance="${appearance}"><article class="theme print-slide-article" data-mode="slideshow" data-theme="${escapeHtml(theme?.name ?? "")}" data-appearance="${appearance}">${slideBody}</article></div>`
}

function fillSlideTemplate(
	template: SlideTemplate,
	content: string,
	slideNumber: number,
): string {
	template.slot.innerHTML = content
	for (let footer of template.document.querySelectorAll(
		"[data-slide-number]",
	)) {
		footer.textContent = String(slideNumber)
	}
	return `<div class="slide print-slide-template">${template.document.body.innerHTML}</div>`
}

// Parsed note lines drop list markers and quotes, so notes are re-read from
// the source; a gap in line numbers marks a paragraph break.
function getNotesMarkdown(noteLines: number[], sourceLines: string[]) {
	return noteLines
		.map((lineNumber, index) => {
			let text = sourceLines[lineNumber] ?? ""
			let previous = noteLines[index - 1]
			let isContinuation = previous === undefined || previous === lineNumber - 1
			return isContinuation ? text : `\n${text}`
		})
		.join("\n")
}

function renderNotesPage(params: {
	pageNumber: number
	slideHtml: string
	notes: string
	renderer: SlideRenderer
	frame: { width: number; height: number }
}): string {
	let { pageNumber, slideHtml, renderer, frame } = params
	let scale = notesSlideWidth / frame.width
	let notes = notesMarked.parse(
		replaceWikilinks(params.notes, renderer.wikilinkTitles),
		{ async: false },
	)
	return `<section class="print-page print-notes-page">
	<div class="print-notes-slide" style="width: ${notesSlideWidth}px; height: ${frame.height * scale}px">
		<div class="print-notes-slide-scale" style="transform: scale(${scale})">${slideHtml}</div>
	</div>
	<div class="print-notes">${notes}</div>
	<footer class="print-notes-number">${pageNumber}</footer>
</section>`
}

let notesMarked = new Marked({ gfm: true, breaks: true })

function replaceWikilinks(text: string, titles: Map<string, string>): string {
	return text.replace(
		/\[\[([^\]|]+)(?:\|([^\]]+))?\]\](\w*)/g,
		(_, docId: string, alias: string | undefined, suffix: string) =>
			(alias?.trim() || titles.get(docId.trim()) || docId.trim()) + suffix,
	)
}

function renderSlideContent(item: SlideContent, renderer: SlideRenderer) {
	switch (item.type) {
		case "heading": {
			let depth = Math.min(Math.max(item.depth, 1), 6)
			return `<h${depth}>${renderSegments(item.segments, renderer)}</h${depth}>`
		}
		case "code":
			return `<div class="slideshow-codeblock">${renderer.highlight(item.text, item.language)}</div>`
		case "image":
			return `<div class="slideshow-image-container"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}" class="slideshow-image" style="width: 100%; height: 100%; object-fit: contain"></div>`
		case "list": {
			let tag = item.ordered ? "ol" : "ul"
			let items = item.items
				.map(
					listItem => `<li>${renderSegments(listItem.segments, renderer)}</li>`,
				)
				.join("")
			return `<${tag}>${items}</${tag}>`
		}
		case "blockquote":
			return `<blockquote>${renderSegments(item.segments, renderer)}</blockquote>`
		case "table": {
			let [header, ...body] = item.rows
			let head = header
				? `<thead><tr>${header.map(cell => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>`
				: ""
			let rows = body
				.map(
					row =>
						`<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
				)
				.join("")
			return `<table>${head}<tbody>${rows}</tbody></table>`
		}
		case "text":
			return `<p>${renderSegments(item.segments, renderer)}</p>`
	}
}

function renderSegments(
	segments: TextSegment[],
	renderer: SlideRenderer,
): string {
	return segments.map(segment => renderSegment(segment, renderer)).join("")
}

function renderSegment(segment: TextSegment, renderer: SlideRenderer): string {
	switch (segment.type) {
		case "text":
			return escapeHtml(segment.text)
		case "link":
			return `<a href="${escapeHtml(segment.href)}">${escapeHtml(segment.text)}</a>`
		case "wikilink": {
			let title = renderer.wikilinkTitles.get(segment.docId)
			let className = title ? "wikilink" : "wikilink wikilink-broken"
			return `<span class="${className}">${escapeHtml(segment.alias ?? title ?? segment.docId)}</span>`
		}
		case "strong":
			return `<strong>${renderSegments(segment.segments, renderer)}</strong>`
		case "em":
			return `<em>${renderSegments(segment.segments, renderer)}</em>`
		case "codespan":
			return `<code>${escapeHtml(segment.text)}</code>`
		case "del":
			return `<del>${renderSegments(segment.segments, renderer)}</del>`
	}
}

// Document themes ship their own @page rules (A4, page numbers in margin boxes);
// this sheet is emitted after theme CSS so slide pages keep their own size.
function getPrintedPageCss(
	layout: SlidePrintLayout,
	frame: { width: number; height: number },
): string {
	let page =
		layout === "notes"
			? "size: A4; margin: 16mm 15mm;"
			: `size: ${frame.width}px ${frame.height}px; margin: 0;`
	let marginBoxes = [
		"top-left",
		"top-center",
		"top-right",
		"bottom-left",
		"bottom-center",
		"bottom-right",
	]
		.map(box => `@${box} { content: none; }`)
		.join(" ")
	return `@page { ${page} ${marginBoxes} }
@page :first { ${page} }
@page :left { ${page} }
@page :right { ${page} }`
}

function buildAppFontFaceRules(fonts: AppFontSources): string {
	let latinRange =
		"U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"
	let latinExtRange =
		"U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"
	let families = [
		{ name: "Geist Variable", sources: fonts.sans },
		{ name: "Geist Mono Variable", sources: fonts.mono },
	]
	return families
		.flatMap(({ name, sources }) => [
			[name, sources.latinExt, latinExtRange],
			[name, sources.latin, latinRange],
		])
		.map(
			([name, url, range]) =>
				`@font-face { font-family: "${name}"; font-style: normal; font-weight: 100 900; font-display: block; src: url("${url}") format("woff2-variations"); unicode-range: ${range}; }`,
		)
		.join("\n")
}

function getPrintedSlidesCss(
	layout: SlidePrintLayout,
	frame: { width: number; height: number },
): string {
	let pageRules =
		layout === "notes"
			? `.print-page { break-after: page; display: flex; flex-direction: column; gap: 10mm; min-height: calc(297mm - 32mm - 1px); }
.print-notes-slide { flex: none; overflow: hidden; border: 1px solid #d4d4d4; }
.print-notes-slide-scale { transform-origin: top left; width: ${frame.width}px; height: ${frame.height}px; }
.print-notes { flex: 1; font: 11pt/1.5 var(--font-sans); color: #171717; }
.print-notes :is(p, ul, ol, blockquote, pre) { margin: 0 0 0.6em; }
.print-notes :is(ul, ol) { padding-left: 1.4em; }
.print-notes ul { list-style: disc; }
.print-notes ol { list-style: decimal; }
.print-notes blockquote { padding-left: 0.8em; border-left: 2px solid #d4d4d4; }
.print-notes-number { font: 9pt var(--font-sans); color: #737373; text-align: right; }`
			: `.print-page { break-after: page; width: ${frame.width}px; height: ${frame.height}px; overflow: hidden; }`

	return `${pageRules}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid; animation: none !important; transition: none !important; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; --border: rgba(127, 127, 127, 0.3); --font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif; --font-mono: "Geist Mono Variable", ui-monospace, monospace; }
body { font-family: var(--font-sans); line-height: 1.5; }
h1, h2, h3, h4, h5, h6 { font-weight: inherit; }
img, video { display: block; max-width: 100%; }
.print-page:last-child { break-after: auto; }
.print-slide { display: flex; flex-direction: column; width: ${frame.width}px; height: ${frame.height}px; overflow: hidden; }
.print-slide-article { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.print-slide-template { width: 100%; height: 100%; }
.print-slide-fit { display: flex; flex: 1; min-height: 0; min-width: 0; align-items: center; justify-content: center; overflow: hidden; }
.print-slide-template .print-slide-fit { width: 100%; height: 100%; }
.slideshow-grid { display: grid; min-height: 0; min-width: 0; gap: 2rem; }`
}
