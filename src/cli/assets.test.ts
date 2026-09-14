import { beforeEach, describe, expect, test } from "vitest"
import { Buffer } from "node:buffer"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { co } from "jazz-tools"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { NotFoundError, ValidationError } from "@/cli/errors"
import { createPersonalDocument } from "@/app/features/documents/lib/documents"
import { Document, UserAccount } from "@/schema"

let pngBytes = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
)

let { addAssetFromFile, listDocAssets, removeAsset } = await import("./assets")

describe("CLI doc assets", () => {
	let account: co.loaded<typeof UserAccount>
	let dir: string

	beforeEach(async () => {
		await setupJazzTestSync()
		account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		dir = await mkdtemp(join(tmpdir(), "alkalye-cli-assets-"))
	})

	async function loadDoc(docId: string) {
		let loaded = await Document.load(docId, {
			resolve: {
				content: true,
				comments: { $each: { replies: true } },
				cursors: true,
				assets: true,
			},
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")
		return loaded
	}

	test("adds an image asset and lists it", async () => {
		let doc = await createPersonalDocument(account, "# Doc")
		let docLoaded = await loadDoc(doc.$jazz.id)

		expect(listDocAssets(docLoaded)).toEqual([])

		let path = join(dir, "photo.png")
		await writeFile(path, pngBytes)
		let asset = await addAssetFromFile(docLoaded, { filePath: path })

		expect(asset.type).toBe("image")
		expect(asset.name).toBe("photo")
		expect(asset.inContent).toBe(false)
		expect(asset.reference).toBe(`![photo](asset:${asset.assetId})`)
		expect(listDocAssets(docLoaded).map(item => item.assetId)).toEqual([
			asset.assetId,
		])
	})

	test("uses the provided name", async () => {
		let doc = await createPersonalDocument(account, "# Doc")
		let docLoaded = await loadDoc(doc.$jazz.id)

		let path = join(dir, "photo.png")
		await writeFile(path, pngBytes)
		let asset = await addAssetFromFile(docLoaded, {
			filePath: path,
			name: "Screenshot",
		})

		expect(asset.name).toBe("Screenshot")
		expect(asset.reference).toBe(`![Screenshot](asset:${asset.assetId})`)
	})

	test("rejects tldraw and unsupported files without attaching", async () => {
		let doc = await createPersonalDocument(account, "# Doc")
		let docLoaded = await loadDoc(doc.$jazz.id)

		let tldrawPath = join(dir, "board.alkalye-tldraw")
		await writeFile(
			tldrawPath,
			JSON.stringify({
				format: "alkalye-tldraw-v1",
				snapshot: "{}",
			}),
		)
		await expect(
			addAssetFromFile(docLoaded, { filePath: tldrawPath }),
		).rejects.toThrow(ValidationError)

		let textPath = join(dir, "notes.txt")
		await writeFile(textPath, "text")
		await expect(
			addAssetFromFile(docLoaded, { filePath: textPath }),
		).rejects.toThrow(ValidationError)

		expect(listDocAssets(docLoaded)).toEqual([])
	})

	test("removes the asset and strips its references", async () => {
		let doc = await createPersonalDocument(account, "# Doc")
		let docLoaded = await loadDoc(doc.$jazz.id)

		let path = join(dir, "photo.png")
		await writeFile(path, pngBytes)
		let asset = await addAssetFromFile(docLoaded, { filePath: path })
		docLoaded.content.$jazz.applyDiff(
			`# Doc\n\nIntro\n\n${asset.reference}\n\nEnd`,
		)

		let result = await removeAsset(docLoaded, asset.assetId)
		expect(result).toEqual({
			assetId: asset.assetId,
			removedFromContent: true,
		})
		expect(docLoaded.content.toString()).toBe("# Doc\n\nIntro\n\n\n\nEnd")
		expect(listDocAssets(docLoaded)).toEqual([])

		await expect(removeAsset(docLoaded, asset.assetId)).rejects.toThrow(
			NotFoundError,
		)
	})
})
