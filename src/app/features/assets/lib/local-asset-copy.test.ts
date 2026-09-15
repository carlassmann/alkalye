import { describe, expect, it } from "vitest"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { UserAccount } from "@/schema"
import { Document } from "@/app/features/documents/lib/schema"
import { createPersonalDocument } from "@/app/features/documents/lib/documents"
import { createMockBlob } from "@/test-helpers/mock-filesystem"
import { attachLocalAssetCopy, prepareLocalAssetCopy } from "./local-asset-copy"

describe("copying local assets to a synced document", () => {
	it("moves an asset into the document group and remaps its Markdown link", async () => {
		await setupJazzTestSync()
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		let doc = await createPersonalDocument(account, "")
		let filename = "Clip.webm"
		let copy = await prepareLocalAssetCopy(
			`![Clip](assets/${filename})`,
			[
				{
					id: filename,
					name: "Clip",
					type: "video",
					blob: createMockBlob("video data", "video/webm"),
				},
				{
					id: "Unused.webm",
					name: "Unused",
					type: "video",
					blob: createMockBlob("unused", "video/webm"),
				},
			],
			doc.$jazz.owner,
		)
		doc.content.$jazz.applyDiff(copy.content)
		attachLocalAssetCopy(doc, copy.assets, doc.$jazz.owner)

		let loaded = await Document.load(doc.$jazz.id, {
			resolve: { content: true, assets: true },
		})
		if (!loaded.$isLoaded || !loaded.assets?.$isLoaded) {
			throw new Error("Copied document is unavailable")
		}
		let asset = loaded.assets[0]
		expect(loaded.assets).toHaveLength(1)
		if (!asset?.$isLoaded) throw new Error("Copied asset is unavailable")
		expect(asset.type).toBe("video")
		expect(asset.$jazz.owner.$jazz.id).toBe(doc.$jazz.owner.$jazz.id)
		expect(loaded.content.toString()).toBe(`![Clip](asset:${asset.$jazz.id})`)
	})

	it("refuses to copy a document whose local asset is missing", async () => {
		await setupJazzTestSync()
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		let doc = await createPersonalDocument(account, "")
		await expect(
			prepareLocalAssetCopy(
				"![Missing](./assets/missing.png)",
				[],
				doc.$jazz.owner,
			),
		).rejects.toThrow("missing.png is unavailable")
	})
})
