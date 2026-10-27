import type { PrintableAsset } from "@/app/features/assets"
import { type LoadedThemes } from "@/app/features/themes/lib/document-theme"
import {
	buildPrintableDocument,
	renderPrintableMarkdown,
	resolvePrintTheme,
	toPrintTheme,
} from "./printable-html"

export { printToPdf, renderPrintableMarkdown }

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
		defaultPreviewTheme,
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

function parseHtmlInBrowser(html: string): Document {
	return new DOMParser().parseFromString(html, "text/html")
}

function openPrintWindow(html: string): void {
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
	void printWhenReady(printWindow)
}

async function printWhenReady(printWindow: Window) {
	if (printWindow.document.fonts?.ready) {
		await printWindow.document.fonts.ready
	}
	await waitForImages(printWindow.document)
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
