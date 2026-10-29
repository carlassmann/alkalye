import { JSDOM } from "jsdom"
import { readFile } from "node:fs/promises"
import { extname, resolve } from "node:path"

export { embedLocalImages }

let imageMimeTypes: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg": "image/svg+xml",
}

// Chrome prints a temporary copy of the HTML, so image paths relative to the
// Markdown file would not resolve; local images are embedded instead.
async function embedLocalImages(html: string, baseDir: string) {
	let dom = new JSDOM(html)
	let images = Array.from(dom.window.document.querySelectorAll("img"))
	let localImages = images.filter(image =>
		isLocalPath(image.getAttribute("src") ?? ""),
	)
	if (localImages.length === 0) return html

	for (let image of localImages) {
		let path = resolve(baseDir, decodeURI(image.getAttribute("src") ?? ""))
		let dataUri = await readImageDataUri(path)
		if (dataUri) image.setAttribute("src", dataUri)
	}
	return dom.serialize()
}

function isLocalPath(src: string) {
	return src !== "" && !src.startsWith("//") && !/^[a-z][a-z\d+.-]*:/i.test(src)
}

async function readImageDataUri(path: string) {
	let mimeType = imageMimeTypes[extname(path).toLowerCase()]
	if (!mimeType) return null
	let bytes = await readFile(path).catch(() => null)
	return bytes ? `data:${mimeType};base64,${bytes.toString("base64")}` : null
}
