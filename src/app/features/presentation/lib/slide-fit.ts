import type { PresentationSize } from "./presentation"

export {
	slideBaseSizes,
	getSlideGridTemplate,
	findSlideScale,
	fitPrintedSlides,
	waitForPrintedSlideAssets,
}
export type { SlideBaseSize, SlideGridTemplate }

type SlideBaseSize = { h1: number; body: number }
type SlideGridTemplate = { cols: string; rows: string }

let slideBaseSizes: Record<PresentationSize, SlideBaseSize> = {
	S: { h1: 72, body: 36 },
	M: { h1: 96, body: 48 },
	L: { h1: 120, body: 60 },
}

function getSlideGridTemplate(
	blockCount: number,
	isPortrait: boolean,
): SlideGridTemplate {
	if (blockCount === 1) return { cols: "1fr", rows: "1fr" }
	if (blockCount === 2) {
		return isPortrait
			? { cols: "1fr", rows: "1fr 1fr" }
			: { cols: "1fr 1fr", rows: "1fr" }
	}
	if (blockCount === 3) {
		return isPortrait
			? { cols: "1fr", rows: "1fr 1fr 1fr" }
			: { cols: "1fr 1fr 1fr", rows: "1fr" }
	}
	return { cols: "1fr 1fr", rows: "1fr 1fr" }
}

// Printable slide documents embed this function's source in an inline script,
// so it must stay self-contained: no imports, closures, or module helpers.
function findSlideScale(
	content: HTMLElement,
	options: { maxW: number; maxH: number; baseSize: SlideBaseSize },
): number {
	let { maxW, maxH, baseSize } = options
	let view = content.ownerDocument.defaultView
	if (!view) return 1
	let styleOf = view.getComputedStyle.bind(view)
	let overflowSensitiveElements = Array.from(
		content.querySelectorAll<HTMLElement>("pre, table"),
	)
	let overflowMeasurementElements = Array.from(
		content.querySelectorAll<HTMLElement>(
			"h1,h2,h3,h4,h5,h6,p,pre,table,blockquote,ol,ul,img",
		),
	)

	function fits(s: number): boolean {
		content.style.setProperty("--slide-h1-size", `${baseSize.h1 * s}px`)
		content.style.setProperty("--slide-body-size", `${baseSize.body * s}px`)
		content.style.setProperty("--slide-scale", `${s}`)
		void content.offsetHeight

		if (content.scrollWidth > maxW + 1) return false
		if (content.scrollHeight > maxH + 1) return false

		for (let cell of Array.from(content.children)) {
			if (cell.scrollWidth > cell.clientWidth + 1) return false
			if (cell.scrollHeight > cell.clientHeight + 1) return false
		}

		for (let el of overflowSensitiveElements) {
			if (el.scrollWidth > el.clientWidth + 1) return false
			if (el.scrollHeight > el.clientHeight + 1) return false
		}

		// scrollWidth/scrollHeight ignore margins; themes can add huge margins.
		// Measure block element boxes + margins against container bounds.
		let contentRect = content.getBoundingClientRect()
		for (let el of overflowMeasurementElements) {
			let rect = el.getBoundingClientRect()
			let style = styleOf(el)
			let marginTop = Number.parseFloat(style.marginTop) || 0
			let marginRight = Number.parseFloat(style.marginRight) || 0
			let marginBottom = Number.parseFloat(style.marginBottom) || 0
			let marginLeft = Number.parseFloat(style.marginLeft) || 0

			if (rect.right + marginRight > contentRect.right + 1) return false
			if (rect.bottom + marginBottom > contentRect.bottom + 1) return false
			if (rect.left - marginLeft < contentRect.left - 1) return false
			if (rect.top - marginTop < contentRect.top - 1) return false
		}

		return true
	}

	let low = 5
	let high = 100
	while (low <= high) {
		let mid = Math.floor((low + high) / 2)
		if (fits(mid / 100)) {
			low = mid + 1
		} else {
			high = mid - 1
		}
	}

	let finalScale = Math.max(5, Math.min(high, 100)) / 100
	fits(finalScale)
	return finalScale
}

// Embedded like findSlideScale, so the same self-contained rule applies.
// fonts.ready resolves before layout has requested any face, so every
// declared face is loaded explicitly; otherwise slides fit fallback metrics.
function waitForPrintedSlideAssets(document: Document): Promise<unknown> {
	let fonts = Array.from(document.fonts).map(font =>
		font.load().catch(() => undefined),
	)
	let images = Array.from(document.images).map(image =>
		image.decode().catch(() => undefined),
	)
	return Promise.all([...fonts, ...images]).then(() => document.fonts.ready)
}

// Embedded like findSlideScale, so the same self-contained rule applies.
function fitPrintedSlides(
	document: Document,
	findScale: typeof findSlideScale,
): void {
	let view = document.defaultView
	if (!view) return
	for (let content of Array.from(
		document.querySelectorAll<HTMLElement>("[data-print-slide-content]"),
	)) {
		let container = content.parentElement
		if (!container) continue
		let containerStyle = view.getComputedStyle(container)
		let paddingX =
			Number.parseFloat(containerStyle.paddingLeft) +
			Number.parseFloat(containerStyle.paddingRight)
		let paddingY =
			Number.parseFloat(containerStyle.paddingTop) +
			Number.parseFloat(containerStyle.paddingBottom)
		let margin = content.dataset.imageOnly === "true" ? 1 : 0.9
		let maxW = Math.max(0, container.clientWidth - paddingX) * margin
		let maxH = Math.max(0, container.clientHeight - paddingY) * margin
		content.style.width = `${maxW}px`
		content.style.height = `${maxH}px`
		findScale(content, {
			maxW,
			maxH,
			baseSize: {
				h1: Number(content.dataset.h1Size),
				body: Number(content.dataset.bodySize),
			},
		})
	}
	document.documentElement.dataset.slidesFitted = "true"
}
