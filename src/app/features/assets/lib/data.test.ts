// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import { app } from "@/jazz/schema"
import { permissions } from "@/jazz/permissions"
import { createDocument } from "@/app/features/documents/lib/library"
import { assetQuery, readAssetBlob, copyDocumentAssets } from "./data"
import { createTldrawAsset, updateTldrawAsset } from "./tldraw"
import { createDefaultTheme } from "@/app/features/themes/lib/create"
import { syncThemeFromSource } from "@/app/features/themes/lib/source"
import {
	exportComments,
	importComments,
} from "@/app/features/import-export/lib/comment-format"

let fixture: PolicyTestApp
let ownerId = "00000000-0000-4000-8000-000000000001"
beforeEach(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterEach(async () => {
	await fixture.shutdown()
})
function actor() {
	return fixture.as({
		issuer: "https://alkalye.test",
		user_id: ownerId,
		account_id: ownerId,
		claims: {},
		authMode: "external",
	})
}

test("streams bytes while asset listings select metadata, and deep copies binary references", async () => {
	let db = actor()
	let doc = await createDocument(db, ownerId, "# Assets")
	let bytes = new Uint8Array(128 * 1024).map((_, index) => index % 251)
	let write = await db.insertStreaming(app.assets, {
		documentId: doc.id,
		name: "clip",
		type: "video",
		mimeType: "video/mp4",
		data: new Blob([bytes]).stream(),
		muteAudio: true,
		createdAt: new Date(),
	})
	await write.wait({ tier: "global" })
	let rows = await db.all(assetQuery.where({ documentId: doc.id }))
	expect(rows).toHaveLength(1)
	expect(rows[0]).not.toHaveProperty("data")
	expect(
		new Uint8Array(
			await (await readAssetBlob(db, write.value.id)).arrayBuffer(),
		),
	).toEqual(bytes)
	let copy = await createDocument(db, ownerId)
	let content = await copyDocumentAssets(
		db,
		doc.id,
		copy.id,
		`![clip](asset:${write.value.id})`,
	)
	let copied = await db.one(app.assets.where({ documentId: copy.id }))
	expect(copied?.id).not.toBe(write.value.id)
	expect(copied?.muteAudio).toBe(true)
	expect(copied?.data).toEqual(bytes)
	expect(content).toBe(`![clip](asset:${copied?.id})`)
})
test("whiteboard saves retain earlier snapshots and both previews", async () => {
	let db = actor()
	let doc = await createDocument(db, ownerId)
	let save = {
		json: "first snapshot",
		lightPreview: new Blob(["light"]),
		darkPreview: new Blob(["dark"]),
	}
	let asset = await createTldrawAsset(db, doc.id, "Whiteboard", save)
	let first = await db.one(app.assets.where({ id: asset.id }))
	await updateTldrawAsset(db, doc.id, asset.id, {
		...save,
		json: "second snapshot",
	})
	let revisions = await db.all(
		app.tldrawRevisions.where({ documentId: doc.id }),
	)
	expect(revisions).toHaveLength(2)
	expect(
		new TextDecoder().decode(
			revisions.find(row => row.id === first?.revisionId)?.snapshot,
		),
	).toBe("first snapshot")
	for (let row of revisions) {
		expect(new TextDecoder().decode(row.lightPreview)).toBe("light")
		expect(new TextDecoder().decode(row.darkPreview)).toBe("dark")
	}
})
test("default themes have editable sources and update from valid markdown", async () => {
	let db = actor()
	let theme = await createDefaultTheme(db, ownerId)
	expect(theme.sourceDocId).toBeTruthy()
	let source = await db.one(app.documents.where({ id: theme.sourceDocId }))
	expect(source?.content).toContain(theme.id)
	expect(
		await syncThemeFromSource(
			db,
			theme.sourceDocId,
			`---\ntheme-source: ${theme.id}\n---\n\n\`\`\`css theme\n.document { color: red; }\n\`\`\``,
		),
	).toBe(true)
	expect((await db.one(app.themes.where({ id: theme.id })))?.css).toContain(
		"red",
	)
})
test("comment sidecars preserve quotes, timestamps, resolution and reply names", async () => {
	let db = actor()
	let doc = await createDocument(db, ownerId, "# Comment")
	let timestamp = new Date().toISOString()
	let comment = {
		id: "original",
		quote: "Comment",
		contextBefore: "# ",
		contextAfter: "",
		from: 2,
		to: 9,
		resolved: true,
		createdAt: timestamp,
		updatedAt: timestamp,
		replies: [
			{
				body: "Keep",
				authorName: "Writer",
				createdAt: timestamp,
				updatedAt: null,
			},
		],
	}
	await importComments(db, doc.id, ownerId, [comment])
	let exported = await exportComments(db, doc.id)
	expect(exported).toEqual([{ ...comment, id: expect.any(String) }])
})
