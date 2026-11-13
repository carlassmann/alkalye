// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import { app } from "@/jazz/schema"
import { permissions } from "@/jazz/permissions"
import { handleImportFiles } from "@/app/features/import-export"
import { makeDuplicate } from "./document-file-actions"
import { createDocument } from "./library"

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

test("space import and sidebar duplicate retain scope, asset references and comments", async () => {
	let db = actor()
	let now = new Date()
	let space = await db
		.insert(app.spaces, {
			ownerId,
			name: "Library",
			createdAt: now,
			updatedAt: now,
		})
		.wait({ tier: "global" })
	await createDocument(db, ownerId, "# Personal")
	await handleImportFiles(
		[
			{
				name: "Space import",
				content: "# Space import\nQuoted words",
				assets: [],
				path: "Folder",
			},
		],
		db,
		ownerId,
		{ spaceId: space.id },
	)
	let docs = await db.all(app.documents.where({ spaceId: space.id }))
	expect(docs).toHaveLength(1)
	let doc = docs[0]!
	let asset = await db
		.insert(app.assets, {
			documentId: doc.id,
			type: "image",
			name: "photo",
			data: new Uint8Array([1, 2]),
			createdAt: now,
		})
		.wait({ tier: "global" })
	await db
		.update(app.documents, doc.id, {
			content: `${doc.content}\n![photo](asset:${asset.id})`,
		})
		.wait({ tier: "global" })
	let thread = await db
		.insert(app.commentThreads, {
			documentId: doc.id,
			authorId: ownerId,
			anchor: { quote: "Quoted words", contextBefore: "", contextAfter: "" },
			createdAt: now,
			updatedAt: now,
		})
		.wait({ tier: "global" })
	await db
		.insert(app.commentReplies, {
			threadId: thread.id,
			authorId: ownerId,
			body: "Comment",
			createdAt: now,
		})
		.wait({ tier: "global" })
	await makeDuplicate(
		db,
		{
			...doc,
			deletedAt: undefined,
			canEdit: true,
			canAdmin: true,
			pinned: false,
		},
		ownerId,
		space.id,
		async () => {},
	)()
	await db.waitForSync()
	let copy = (await db.all(app.documents.where({ spaceId: space.id }))).find(
		row => row.id !== doc.id,
	)
	if (!copy) throw new Error("Missing copy")
	let assets = await db.all(app.assets.where({ documentId: copy.id }))
	expect(assets[0]?.data).toEqual(new Uint8Array([1, 2]))
	expect(copy.content).toContain(`asset:${assets[0]?.id}`)
	expect(copy.content).not.toContain(asset.id)
	let comments = await db.all(app.commentThreads.where({ documentId: copy.id }))
	expect(comments).toHaveLength(1)
	expect(
		await db.all(app.commentReplies.where({ threadId: comments[0]!.id })),
	).toEqual([expect.objectContaining({ body: "Comment" })])
	expect(await db.all(app.documents.where({ spaceId: null }))).toHaveLength(1)
})
