import type { PrintableAsset } from "@/app/features/assets"
import { type LoadedThemes } from "@/app/features/themes/lib/document-theme"
import {
	buildPrintableDocument,
	renderPrintableMarkdown,
	resolvePrintTheme,
	toPrintTheme,
} from "./printable-html"
import {
	buildPrintableSlides,
	type SlideAspectRatio,
	type SlidePrintLayout,
} from "./printable-slides"
import { getAppPrintFonts } from "./app-print-fonts"
import { parsePresentationTheme } from "@/app/features/presentation/lib/presentation"
import {
	findSlideScale,
	fitPrintedSlides,
	waitForPrintedSlideAssets,
} from "@/app/features/presentation/lib/slide-fit"

export { printToPdf, printSlidesToPdf, renderPrintableMarkdown }
export type { SlideAspectRatio, SlidePrintLayout }

async function printToPdf(params: {
	content: string
	themes: LoadedThemes | undefined
	defaultPreviewTheme: string | null
	defaultSyntaxTheme: string | null
	assets: PrintableAsset[]
}) {
	let { content, themes, defaultPreviewTheme, defaultSyntaxTheme, assets } =
		params
	let { theme, preset } = resolvePrintTheme({
		content,
		themes,
		defaultThemeName: defaultPreviewTheme,
	})
	let printableHtml = await buildPrintableDocument({
		content,
		theme: theme ? await toPrintTheme(theme, preset) : null,
		assets,
		defaultSyntaxTheme,
		parseHtml: parseHtmlInBrowser,
	})

	openPrintWindow(printableHtml)
}

async function printSlidesToPdf(params: {
	content: string
	themes: LoadedThemes | undefined
	defaultSlideshowTheme: string | null
	defaultSyntaxTheme: string | null
	assets: PrintableAsset[]
	layout: SlidePrintLayout
	aspectRatio: SlideAspectRatio
	wikilinkTitles?: Map<string, string>
}) {
	let { content, themes, defaultSlideshowTheme, ...rest } = params
	let { theme, preset } = resolvePrintTheme({
		content,
		themes,
		defaultThemeName: defaultSlideshowTheme,
		appearance: parsePresentationTheme(content) ?? "light",
	})
	let printableHtml = await buildPrintableSlides({
		...rest,
		content,
		theme: theme ? await toPrintTheme(theme, preset) : null,
		parseHtml: parseHtmlInBrowser,
		appFonts: getAppPrintFonts(),
	})

	// Scripts in the imported document do not run, so slides are fitted here.
	openPrintWindow(printableHtml, async document => {
		await waitForPrintedSlideAssets(document)
		fitPrintedSlides(document, findSlideScale)
	})
}

function parseHtmlInBrowser(html: string): Document {
	return new DOMParser().parseFromString(html, "text/html")
}

function openPrintWindow(
	html: string,
	prepare?: (document: Document) => Promise<void>,
): void {
	let printWindow = window.open("", "_blank")
	if (!printWindow) {
		let blob = new Blob([html], { type: "text/html" })
		let url = URL.createObjectURL(blob)
		window.open(url, "_blank")
		return
	}

	let parsed = new DOMParser().parseFromString(html, "text/html")
	let imported = printWindow.document.importNode(parsed.documentElement, true)
	printWindow.document.replaceChild(
		imported,
		printWindow.document.documentElement,
	)
	void printWhenReady(printWindow, prepare)
}

async function printWhenReady(
	printWindow: Window,
	prepare?: (document: Document) => Promise<void>,
) {
	if (printWindow.document.fonts?.ready) {
		await printWindow.document.fonts.ready
	}
	await waitForImages(printWindow.document)
	await prepare?.(printWindow.document)
	printWindow.print()
}

function waitForImages(document: Document): Promise<void[]> {
	return Promise.all(
		Array.from(document.images).map(image => {
			if (image.complete) return Promise.resolve()
			return new Promise<void>(resolve => {
				let timeout = window.setTimeout(finish, 5_000)

				function finish() {
					window.clearTimeout(timeout)
					image.removeEventListener("load", finish)
					image.removeEventListener("error", finish)
					resolve()
				}

				image.addEventListener("load", finish)
				image.addEventListener("error", finish)
			})
		}),
	)
}
