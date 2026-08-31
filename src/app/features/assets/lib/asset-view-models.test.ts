import { beforeEach, describe, expect, it } from "vitest"
import { co } from "jazz-tools"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import {
	ImageAsset,
	TldrawAsset,
	TldrawRevision,
	UserAccount,
	VideoAsset,
} from "@/schema"
import { getLoadedAssets, toPrintableAsset } from "./asset-view-models"

describe("loaded assets", () => {
	it("treats a loading asset relation as temporarily empty", () => {
		expect(getLoadedAssets({ $isLoaded: false })).toEqual([])
	})
})

describe("printable assets", () => {
	let account: co.loaded<typeof UserAccount>

	beforeEach(async () => {
		await setupJazzTestSync()
		account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
	})

	it("loads image, whiteboard preview, and video blobs", async () => {
		let imageFile = await createFile("image", "image/png")
		let image = co.image().create(
			{
				original: imageFile,
				originalSize: [1, 1],
				progressive: false,
			},
			account,
		)
		let imageAsset = ImageAsset.create(
			{ type: "image", name: "Image", image, createdAt: new Date() },
			account,
		)

		let revision = TldrawRevision.create(
			{
				snapshot: await createFile("snapshot", "application/json"),
				lightPreview: image,
				darkPreview: image,
				createdAt: new Date(),
			},
			account,
		)
		let whiteboardAsset = TldrawAsset.create(
			{
				type: "tldraw",
				name: "Whiteboard",
				revision,
				createdAt: new Date(),
			},
			account,
		)

		let videoAsset = VideoAsset.create(
			{
				type: "video",
				name: "Video",
				video: await createFile("video", "video/mp4"),
				mimeType: "video/mp4",
				createdAt: new Date(),
			},
			account,
		)

		let blobs = await Promise.all(
			[imageAsset, whiteboardAsset, videoAsset].map(asset =>
				toPrintableAsset(asset).getBlob(),
			),
		)

		expect(await readBlob(blobs[0])).toBe("image")
		expect(await readBlob(blobs[1])).toBe("image")
		expect(await readBlob(blobs[2])).toBe("video")
	})

	async function createFile(content: string, type: string) {
		return co
			.fileStream()
			.createFromBlob(new ReadableBlob(content, type), { owner: account })
	}
})

function readBlob(blob: Blob | undefined): Promise<string> {
	if (!blob) throw new Error("Blob was not loaded")
	return new Promise((resolve, reject) => {
		let reader = new FileReader()
		reader.onload = () => {
			if (typeof reader.result === "string") resolve(reader.result)
			else reject(new Error("Blob did not contain text"))
		}
		reader.onerror = reject
		reader.readAsText(blob)
	})
}

class ReadableBlob extends Blob {
	readonly content: string

	constructor(content: string, type: string) {
		super([content], { type })
		this.content = content
	}

	async arrayBuffer() {
		return new TextEncoder().encode(this.content).buffer
	}
}
