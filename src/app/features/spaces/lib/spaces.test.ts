// @vitest-environment node
import { beforeEach, afterEach, expect, test } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import { app } from "@/jazz/schema"
import { permissions } from "@/jazz/permissions"
import { copyToSynced, createSpaceDocument } from "./spaces"
let fixture: PolicyTestApp
let ownerId = "00000000-0000-4000-8000-000000000001"
let writerId = "00000000-0000-4000-8000-000000000002"
beforeEach(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterEach(async () => {
	await fixture.shutdown()
})
function actor(accountId = ownerId) {
	return fixture.as({
		issuer: "https://alkalye.test",
		user_id: accountId,
		account_id: accountId,
		authMode: "external",
		claims: {},
	})
}
test("copying local assets rewrites references and creates a personal library entry", async () => {
	let db = actor()
	let doc = await copyToSynced(
		db,
		ownerId,
		null,
		"# Notes\n\n![Photo](./assets/photo.png)",
		[
			{
				id: "photo.png",
				name: "Photo",
				type: "image",
				blob: new Blob(["image bytes"], { type: "image/png" }),
			},
		],
	)
	await db.waitForSync()
	let asset = await db.one(app.assets.where({ documentId: doc.id }))
	expect(asset?.data).toEqual(new TextEncoder().encode("image bytes"))
	expect(doc.content).toContain(`asset:${asset?.id}`)
	expect(
		await db.one(app.userDocuments.where({ documentId: doc.id })),
	).toMatchObject({ ownerId })
	await expect(
		copyToSynced(db, ownerId, null, "![Missing](asset:missing)", []),
	).rejects.toThrow("unavailable")
})
test("a writer creates documents belonging to the space owner", async () => {
	let space = await fixture.seed(db =>
		db.insert(app.spaces, {
			ownerId,
			name: "Team",
			createdAt: new Date(),
			updatedAt: new Date(),
		}),
	)
	await fixture.seed(db =>
		db.insert(app.spaceMembers, {
			spaceId: space.id,
			accountId: writerId,
			role: "writer",
		}),
	)
	let db = actor(writerId)
	let doc = await createSpaceDocument(db, writerId, space.id, "# Team notes")
	await db.waitForSync()
	expect(await db.one(app.documents.where({ id: doc.id }))).toMatchObject({
		ownerId,
		spaceId: space.id,
	})
})

test("copying a local drawing retains its snapshot and both previews", async () => {
	let { createTLStore } = await import("tldraw")
	let snapshot = JSON.stringify({
		tldrawFileFormatVersion: 1,
		schema: createTLStore().schema.serialize(),
		records: [
			{
				id: "page:page",
				typeName: "page",
				name: "Page 1",
				index: "a1",
				meta: {},
			},
			{
				id: "document:document",
				typeName: "document",
				gridSize: 10,
				name: "",
				meta: {},
			},
		],
	})
	let blob = new Blob([
		JSON.stringify({
			format: "alkalye-tldraw-v1",
			snapshot,
			lightPreview: "data:image/png;base64,bGlnaHQ=",
			darkPreview: "data:image/png;base64,ZGFyaw==",
		}),
	])
	let db = actor()
	let doc = await copyToSynced(
		db,
		ownerId,
		null,
		"![Board](asset:board.alkalye-tldraw)",
		[{ id: "board.alkalye-tldraw", name: "Board", type: "tldraw", blob }],
	)
	await db.waitForSync()
	let asset = await db.one(app.assets.where({ documentId: doc.id }))
	if (!asset?.revisionId) throw new Error("Missing drawing revision")
	let revision = await db.one(
		app.tldrawRevisions.where({ id: asset.revisionId }),
	)
	expect(revision?.snapshot).toEqual(new TextEncoder().encode(snapshot))
	expect(revision?.lightPreview).toEqual(new TextEncoder().encode("light"))
	expect(revision?.darkPreview).toEqual(new TextEncoder().encode("dark"))
})
