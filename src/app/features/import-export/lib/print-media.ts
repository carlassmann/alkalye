import DOMPurify from "dompurify"
import type { PrintableAsset } from "@/app/features/assets"

export {
	replaceAssetSources,
	sanitizePrintableHtml,
	blobToBase64,
	type HtmlParser,
}

type HtmlParser = (html: string) => Document

async function replaceAssetSources(
	html: string,
	assets: PrintableAsset[],
	parseHtml: HtmlParser = parseHtmlInBrowser,
): Promise<string> {
	if (assets.length === 0) return html
	let document = parseHtml(html)
	let assetsById = new Map(assets.map(asset => [asset.id, asset]))

	for (let image of document.querySelectorAll("img")) {
		let match = image.getAttribute("src")?.match(/^asset:(.+)$/)
		if (!match) continue

		let asset = assetsById.get(match[1])
		if (!asset) continue

		let blob = await asset.getBlob()
		if (!blob) continue

		let source =
			asset.type === "video"
				? await createVideoPoster(blob)
				: await blobToDataUri(blob)
		if (source) image.setAttribute("src", source)
	}

	return document.body.innerHTML
}

// Markdown and theme templates may carry raw HTML. The app's print window
// shares its origin and CLI Chrome runs scripts, so only markup is kept.
function sanitizePrintableHtml(
	html: string,
	parseHtml: HtmlParser = parseHtmlInBrowser,
): string {
	let view = parseHtml("").defaultView ?? window
	return DOMPurify(view).sanitize(html, { FORCE_BODY: true })
}

async function blobToBase64(blob: Blob): Promise<string> {
	// Browsers and jsdom read blobs via FileReader; Node blobs (CLI) lack it.
	if (typeof FileReader !== "undefined") return readBase64WithFileReader(blob)
	let bytes = new Uint8Array(await blob.arrayBuffer())
	let binary = ""
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
	}
	return btoa(binary)
}

async function createVideoPoster(blob: Blob): Promise<string | null> {
	let url = URL.createObjectURL(blob)
	let video = document.createElement("video")
	video.muted = true
	video.preload = "auto"
	video.src = url

	try {
		await waitForMediaEvent(video, "loadeddata")
		let canvas = document.createElement("canvas")
		canvas.width = video.videoWidth
		canvas.height = video.videoHeight
		let context = canvas.getContext("2d")
		if (!context || !canvas.width || !canvas.height) return null
		context.drawImage(video, 0, 0)
		return canvas.toDataURL("image/png")
	} catch {
		return null
	} finally {
		URL.revokeObjectURL(url)
	}
}

function waitForMediaEvent(video: HTMLVideoElement, eventName: "loadeddata") {
	return new Promise<void>((resolve, reject) => {
		let timeout = window.setTimeout(() => finish(reject), 5_000)

		function finish(callback: () => void) {
			window.clearTimeout(timeout)
			video.removeEventListener(eventName, handleLoad)
			video.removeEventListener("error", handleError)
			callback()
		}

		function handleLoad() {
			finish(resolve)
		}

		function handleError() {
			finish(reject)
		}

		video.addEventListener(eventName, handleLoad)
		video.addEventListener("error", handleError)
		video.load()
	})
}

function parseHtmlInBrowser(html: string): Document {
	return new DOMParser().parseFromString(html, "text/html")
}

async function blobToDataUri(blob: Blob): Promise<string> {
	return `data:${blob.type};base64,${await blobToBase64(blob)}`
}

function readBase64WithFileReader(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		let reader = new FileReader()
		reader.onload = () => {
			let result = typeof reader.result === "string" ? reader.result : ""
			resolve(result.slice(result.indexOf(",") + 1))
		}
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(blob)
	})
}
