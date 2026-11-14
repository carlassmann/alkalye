import { z } from "zod"
import { validateDrawingSnapshot } from "@/app/features/assets"
export { decodeLocalDrawing }
let previewLimit = 8 * 1024 * 1024
let prefix = "data:image/png;base64,"
let drawingBundle = z.object({
	format: z.literal("alkalye-tldraw-v1"),
	snapshot: z.string().max(8 * 1024 * 1024),
	lightPreview: z.string().max(prefix.length + 4 * Math.ceil(previewLimit / 3)),
	darkPreview: z.string().max(prefix.length + 4 * Math.ceil(previewLimit / 3)),
})
async function decodeLocalDrawing(blob: Blob) {
	if (blob.size > 32 * 1024 * 1024)
		throw new Error("Whiteboard backup is too large")
	let bundle = drawingBundle.parse(JSON.parse(await blob.text()))
	await validateDrawingSnapshot(bundle.snapshot)
	return {
		snapshot: new TextEncoder().encode(bundle.snapshot),
		lightPreview: decodePng(bundle.lightPreview),
		darkPreview: decodePng(bundle.darkPreview),
	}
}
function decodePng(dataUrl: string) {
	if (!dataUrl.startsWith(prefix))
		throw new Error("Whiteboard preview must be a PNG data URL")
	let encoded = dataUrl.slice(prefix.length)
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
		throw new Error("Whiteboard preview is not valid base64")
	let binary = atob(encoded)
	if (binary.length > previewLimit)
		throw new Error("Whiteboard preview is too large")
	return Uint8Array.from(binary, character => character.charCodeAt(0))
}
