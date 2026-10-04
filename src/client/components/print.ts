import { slides } from "../../shared/markdown"
interface PrintOptions {
	slideshow: boolean
	render(host: HTMLElement, source: string, index: number): void
}
export async function printDocument(source: string, options: PrintOptions) {
	let frame = document.createElement("iframe")
	frame.dataset.print = ""
	frame.title = "Print preview"
	frame.srcdoc = "<!doctype html><html><head></head><body></body></html>"
	let loaded = new Promise<void>(resolve => {
		frame.addEventListener("load", () => resolve(), { once: true })
	})
	document.body.append(frame)
	await loaded
	let page = frame.contentDocument,
		view = frame.contentWindow
	if (!page || !view) {
		frame.remove()
		throw new Error("Print preview unavailable")
	}
	page.title = document.title
	page.body.dataset.print = ""
	page.body.dataset.mode = options.slideshow ? "slideshow" : "document"
	let stylesheet = page.createElement("link")
	stylesheet.rel = "stylesheet"
	stylesheet.href = "/components/print.css"
	let styled = new Promise<void>(resolve => {
		stylesheet.onload = () => resolve()
		stylesheet.onerror = () => resolve()
	})
	page.head.append(stylesheet)
	if (options.slideshow) {
		let layout = page.createElement("style")
		layout.textContent = "@page {size: 297mm 167mm}"
		page.head.append(layout)
	}
	let content = options.slideshow
		? slides(source).map(slide => slide.content)
		: [source]
	for (let [index, source] of content.entries()) {
		let host = page.createElement("section")
		host.className = "print-page"
		page.body.append(host)
		options.render(host, source, index)
	}
	let shadows = [...page.querySelectorAll("section")].flatMap(host => [
		...(host.shadowRoot?.querySelectorAll<HTMLLinkElement>("link") ?? []),
	])
	await Promise.all([
		styled,
		...shadows.map(
			link =>
				new Promise<void>(resolve => {
					if (link.sheet) resolve()
					else {
						link.addEventListener("load", () => resolve(), { once: true })
						link.addEventListener("error", () => resolve(), { once: true })
					}
				}),
		),
	])
	await page.fonts.ready
	await Promise.all(
		[...page.querySelectorAll("section")].flatMap(host =>
			[
				...(host.shadowRoot?.querySelectorAll<HTMLImageElement>("img") ?? []),
			].map(image => image.decode().catch(() => {})),
		),
	)
	view.addEventListener("afterprint", () => frame.remove(), { once: true })
	view.focus()
	view.print()
}
