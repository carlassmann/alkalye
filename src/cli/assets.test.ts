import { beforeEach, describe, expect, test } from "vitest"
import { Buffer } from "node:buffer"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { co, Group } from "jazz-tools"
import {
	createJazzTestAccount,
	setActiveAccount,
	setupJazzTestSync,
} from "jazz-tools/testing"
import { FilesystemError, NotFoundError, ValidationError } from "@/cli/errors"
import { createPersonalDocument } from "@/app/features/documents/lib/documents"
import {
	acceptDocumentInvite,
	createDocumentInvite,
	parseInviteLink,
} from "@/app/features/sharing"
import { Document, UserAccount, VideoAsset } from "@/schema"

let pngBytes = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
)

let {
	addAssetFromFile,
	listDocAssets,
	removeAsset,
	listableAssetDocumentResolve,
} = await import("./assets")

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
		let loaded = await Document.load(docId)
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")
		return loaded.$jazz.ensureLoaded({ resolve: listableAssetDocumentResolve })
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

	test("rejects tldraw, unencodable images, and unsupported files without attaching", async () => {
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

		let svgPath = join(dir, "logo.svg")
		await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" />')
		await expect(
			addAssetFromFile(docLoaded, { filePath: svgPath }),
		).rejects.toThrow(ValidationError)

		let bmpPath = join(dir, "logo.bmp")
		await writeFile(bmpPath, Buffer.from("BM", "ascii"))
		await expect(
			addAssetFromFile(docLoaded, { filePath: bmpPath }),
		).rejects.toThrow(ValidationError)

		await expect(
			addAssetFromFile(docLoaded, { filePath: join(dir, "missing.svg") }),
		).rejects.toThrow(ValidationError)

		await expect(
			addAssetFromFile(docLoaded, { filePath: join(dir, "missing.png") }),
		).rejects.toThrow(FilesystemError)

		let textPath = join(dir, "notes.txt")
		await writeFile(textPath, "text")
		await expect(
			addAssetFromFile(docLoaded, { filePath: textPath }),
		).rejects.toThrow(ValidationError)

		expect(listDocAssets(docLoaded)).toEqual([])
	})

	test("lists assets it did not create locally", async () => {
		let collaborator = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})
		let doc = await createPersonalDocument(account, "# Doc")
		let docLoaded = await loadDoc(doc.$jazz.id)
		let path = join(dir, "photo.png")
		await writeFile(path, pngBytes)
		let asset = await addAssetFromFile(docLoaded, { filePath: path })

		let { link } = await createDocumentInvite(docLoaded, "writer")
		await acceptDocumentInvite(collaborator, parseInviteLink(link))
		setActiveAccount(collaborator)

		let collaboratorDoc = await Document.load(doc.$jazz.id, {
			loadAs: collaborator,
		})
		if (!collaboratorDoc.$isLoaded) throw new Error("Doc not loaded")
		let resolved = await collaboratorDoc.$jazz.ensureLoaded({
			resolve: listableAssetDocumentResolve,
		})

		expect(listDocAssets(resolved).map(item => item.assetId)).toEqual([
			asset.assetId,
		])
	})

	test("skips assets the account cannot read", async () => {
		let collaborator = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})
		let doc = await createPersonalDocument(account, "# Doc")
		let docLoaded = await loadDoc(doc.$jazz.id)
		let path = join(dir, "photo.png")
		await writeFile(path, pngBytes)
		let readable = await addAssetFromFile(docLoaded, { filePath: path })

		let { link } = await createDocumentInvite(docLoaded, "writer")
		await acceptDocumentInvite(collaborator, parseInviteLink(link))
		setActiveAccount(collaborator)
		let collaboratorDoc = await Document.load(doc.$jazz.id, {
			resolve: { assets: true },
			loadAs: collaborator,
		})
		if (!collaboratorDoc.$isLoaded || !collaboratorDoc.assets?.$isLoaded) {
			throw new Error("Doc not loaded")
		}
		let privateGroup = Group.create(collaborator)
		let video = co.fileStream().create(privateGroup)
		collaboratorDoc.assets.$jazz.push(
			VideoAsset.create(
				{
					type: "video",
					name: "private",
					video,
					mimeType: "video/mp4",
					createdAt: new Date(),
				},
				privateGroup,
			),
		)

		setActiveAccount(account)
		let reloaded = await loadDoc(doc.$jazz.id)
		expect(reloaded.assets?.length).toBe(2)

		expect(listDocAssets(reloaded).map(item => item.assetId)).toEqual([
			readable.assetId,
		])
		await expect(
			removeAsset(reloaded, readable.assetId),
		).resolves.toMatchObject({
			assetId: readable.assetId,
		})
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
