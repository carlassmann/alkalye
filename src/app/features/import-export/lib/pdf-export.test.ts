import { describe, expect, it, vi } from "vitest"
import type { PrintableAsset } from "@/app/features/assets"
import { replaceAssetSources } from "./print-media"

describe("print media", () => {
	it("inlines image and whiteboard assets while preserving external images", async () => {
		let image = printableAsset("image-1", "image", "image/png", "image")
		let whiteboard = printableAsset(
			"whiteboard-1",
			"tldraw",
			"image/png",
			"whiteboard",
		)

		let html = await replaceAssetSources(
			'<img src="asset:image-1"><img src="asset:whiteboard-1"><img src="https://example.com/photo.jpg">',
			[image, whiteboard],
		)
		let document = new DOMParser().parseFromString(html, "text/html")
		let sources = Array.from(document.images).map(element =>
			element.getAttribute("src"),
		)

		expect(sources).toEqual([
			"data:image/png;base64,aW1hZ2U=",
			"data:image/png;base64,d2hpdGVib2FyZA==",
			"https://example.com/photo.jpg",
		])
		expect(image.getBlob).toHaveBeenCalledOnce()
		expect(whiteboard.getBlob).toHaveBeenCalledOnce()
	})
})

function printableAsset(
	id: string,
	type: PrintableAsset["type"],
	mimeType: string,
	content: string,
): PrintableAsset {
	return {
		id,
		name: id,
		type,
		getBlob: vi.fn(async () => new Blob([content], { type: mimeType })),
	}
}
