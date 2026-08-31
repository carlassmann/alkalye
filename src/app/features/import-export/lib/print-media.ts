import type { PrintableAsset } from "@/app/features/assets"

export { replaceAssetSources }

async function replaceAssetSources(
	html: string,
	assets: PrintableAsset[],
): Promise<string> {
	let parser = new DOMParser()
	let document = parser.parseFromString(html, "text/html")
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

function blobToDataUri(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		let reader = new FileReader()
		reader.onloadend = () => {
			if (typeof reader.result === "string") {
				resolve(reader.result)
				return
			}
			reject(new Error("Could not read blob"))
		}
		reader.onerror = reject
		reader.readAsDataURL(blob)
	})
}
