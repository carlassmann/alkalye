// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import { app } from "@/jazz/schema"
import { permissions } from "@/jazz/permissions"
import {
	getEditHistory,
	historyQuery,
	restoreAssetsAtTime,
} from "./time-machine"
let fixture: PolicyTestApp
let aliceId = "00000000-0000-4000-8000-000000000001",
	bobId = "00000000-0000-4000-8000-000000000002"
beforeEach(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterEach(async () => {
	await fixture.shutdown()
})
function actor(id: string) {
	return fixture.as({
		issuer: "https://alkalye.test",
		user_id: id,
		account_id: id,
		claims: {},
		authMode: "external",
	})
}
test("accepted history merges imported dates and authors; restore is another accepted write", async () => {
	let alice = actor(aliceId),
		bob = actor(bobId)
	let doc = await alice
		.insert(app.documents, {
			ownerId: aliceId,
			title: "History",
			content: "Initial",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	await alice
		.insert(app.documentGrants, {
			documentId: doc.id,
			accountId: bobId,
			role: "writer",
		})
		.wait({ tier: "global" })
	await bob
		.update(app.documents, doc.id, { content: "Bob's edit" })
		.wait({ tier: "global" })
	await alice
		.update(app.documents, doc.id, { presentationLine: 1 })
		.wait({ tier: "global" })
	let imported = await fixture.seed(db =>
		db.insert(app.documentVersions, {
			documentId: doc.id,
			content: "Classic",
			authorId: "classic-author",
			authorName: "Classic author",
			createdAt: new Date("2020-01-01"),
		}),
	)
	let versions = await alice.all(historyQuery(doc.id)),
		edits = getEditHistory(versions, [imported])
	expect(edits.map(edit => edit.content)).toEqual([
		"Classic",
		"Initial",
		"Bob's edit",
	])
	expect(edits.map(edit => edit.accountId)).toEqual([
		"classic-author",
		aliceId,
		bobId,
	])
	await alice.transaction(tx =>
		tx.update(
			app.documents,
			doc.id,
			{ content: edits[0].content },
			{ editedFrom: { content: "Bob's edit" } },
		),
	)
	await alice.waitForSync()
	expect((await alice.one(app.documents.where({ id: doc.id })))?.content).toBe(
		"Classic",
	)
	expect((await alice.all(historyQuery(doc.id))).length).toBeGreaterThan(
		versions.length,
	)
})
test("asset restore recovers a previous whiteboard revision and removes later assets", async () => {
	let db = actor(aliceId)
	let doc = await db
		.insert(app.documents, {
			ownerId: aliceId,
			title: "Assets",
			content: "Text",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	let asset = await db
		.insert(app.assets, {
			documentId: doc.id,
			type: "image",
			name: "Original",
			data: new Uint8Array([1]),
			createdAt: new Date(),
		})
		.wait({ tier: "global" })
	let history = await db.all(app.$history.assets.where({ id: asset.id }))
	let timestamp = history[0].$acceptedAt.getTime()
	await db
		.update(app.assets, asset.id, { name: "New", data: new Uint8Array([2]) })
		.wait({ tier: "global" })
	let later = await db
		.insert(app.assets, {
			documentId: doc.id,
			type: "image",
			name: "Later",
			createdAt: new Date(),
		})
		.wait({ tier: "global" })
	await restoreAssetsAtTime(db, doc.id, timestamp)
	await db.waitForSync()
	expect((await db.one(app.assets.where({ id: asset.id })))?.name).toBe(
		"Original",
	)
	expect((await db.one(app.assets.where({ id: asset.id })))?.data).toEqual(
		new Uint8Array([1]),
	)
	expect(await db.one(app.assets.where({ id: later.id }))).toBeNull()
})

test("local-first author attribution uses the account rather than the device identity", () => {
	let edits = getEditHistory(
		[
			{
				content: "By device",
				$acceptedAt: new Date(),
				$transactionId: "tx",
				$updatedBy: {
					account: aliceId,
					identity: { subject: "device-identity" },
				},
			},
		],
		[],
	)
	expect(edits[0].accountId).toBe(aliceId)
})

test("historical copies retain assets and comments with new IDs", async () => {
	let db = actor(aliceId)
	let doc = await db
		.insert(app.documents, {
			ownerId: aliceId,
			title: "Original",
			content: "# Original\n\nSelected words",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	let { createCommentThreadFromQuote, loadCommentDocument, getExportComments } =
		await import("@/app/features/comments")
	createCommentThreadFromQuote(
		{ ...doc, db, comments: [] },
		"Selected words",
		"Keep this comment",
		"Alice",
	)
	await db.waitForSync()
	let { createTimeMachineCopy } = await import("./create-copy")
	let copy = await createTimeMachineCopy(
		db,
		aliceId,
		doc,
		doc.content,
		Date.now(),
	)
	await db.waitForSync()
	expect(copy.id).not.toBe(doc.id)
	expect(copy.content).toContain("# Original (restored)")
	let comments = getExportComments(await loadCommentDocument(db, copy))
	expect(comments[0]).toMatchObject({
		quote: "Selected words",
		replies: [{ body: "Keep this comment", authorName: "Alice" }],
	})
})

test("text-only documents can restore without an asset transaction", async () => {
	let db = actor(aliceId)
	let doc = await db
		.insert(app.documents, {
			ownerId: aliceId,
			title: "No assets",
			content: "Text",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	await restoreAssetsAtTime(db, doc.id, Date.now())
})

test("copies without comments and recovers deleted assets", async () => {
	let db = actor(aliceId)
	let doc = await db
		.insert(app.documents, {
			ownerId: aliceId,
			title: "Original",
			content: "# Original",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	let asset = await db
		.insert(app.assets, {
			documentId: doc.id,
			type: "image",
			name: "Original image",
			data: new Uint8Array([1, 2, 3]),
			createdAt: new Date(),
		})
		.wait({ tier: "global" })
	let versions = await db.all(app.$history.assets.where({ id: asset.id }))
	let timestamp = versions[0].$acceptedAt.getTime()
	await db.delete(app.assets, asset.id).wait({ tier: "global" })
	await restoreAssetsAtTime(db, doc.id, timestamp)
	await db.waitForSync()
	expect((await db.one(app.assets.where({ id: asset.id })))?.name).toBe(
		"Original image",
	)
	let { createTimeMachineCopy } = await import("./create-copy")
	let copy = await createTimeMachineCopy(
		db,
		aliceId,
		doc,
		`# Original\n\n![Image](asset:${asset.id})`,
		timestamp,
	)
	await db.waitForSync()
	let assets = await db.all(app.assets.where({ documentId: copy.id }))
	expect(assets).toHaveLength(1)
	expect(assets[0].id).not.toBe(asset.id)
	expect(copy.content).toContain(`asset:${assets[0].id}`)
	expect(assets[0].data).toEqual(new Uint8Array([1, 2, 3]))
})
