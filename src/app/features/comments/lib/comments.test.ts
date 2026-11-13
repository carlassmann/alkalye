// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import { app } from "@/jazz/schema"
import { permissions } from "@/jazz/permissions"
import {
	loadCommentDocument,
	createCommentThread,
	createCommentThreadFromQuote,
	addCommentReply,
	resolveCommentThread,
	reopenCommentThread,
	deleteCommentThread,
	getCommentRange,
	getExportComments,
	restoreExportedComments,
	recoverRange,
	type LoadedCommentDocument,
} from "./comments"

let fixture: PolicyTestApp
let aliceId = "00000000-0000-4000-8000-000000000001"
let bobId = "00000000-0000-4000-8000-000000000002"
beforeEach(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterEach(async () => {
	await fixture.shutdown()
})
function actor(id = aliceId) {
	return fixture.as({
		issuer: "https://alkalye.test",
		user_id: id,
		account_id: id,
		claims: {},
		authMode: "external",
	})
}
async function document(): Promise<LoadedCommentDocument> {
	let db = actor()
	let doc = await db
		.insert(app.documents, {
			ownerId: aliceId,
			title: "Comments",
			content: "Before. Selected words. After.",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	return { ...doc, db, comments: [] }
}
async function reload(
	doc: LoadedCommentDocument,
): Promise<LoadedCommentDocument> {
	await doc.db.waitForSync()
	let row = await doc.db.one(app.documents.where({ id: doc.id }))
	if (!row) throw new Error("Document missing")
	return loadCommentDocument(doc.db, row)
}

test("comments and replies sync to a second author; ranges survive surrounding edits", async () => {
	let doc = await document(),
		bob = actor(bobId)
	await doc.db
		.insert(app.documentGrants, {
			documentId: doc.id,
			accountId: bobId,
			role: "writer",
		})
		.wait({ tier: "global" })
	let created = createCommentThreadFromQuote(
		doc,
		"Selected words",
		"First comment",
		"Alice",
	)
	expect(created).not.toBeNull()
	doc = await reload(doc)
	expect(
		await bob.all(app.commentThreads.where({ documentId: doc.id })),
	).toHaveLength(1)
	let thread = doc.comments[0]
	await addCommentReply({ ...thread, db: bob }, "Reply", "Bob")
	await bob.waitForSync()
	expect(
		await doc.db.all(app.commentReplies.where({ threadId: thread.id })),
	).toHaveLength(2)
	let content = "Inserted. Before. Selected words. After. Appended."
	await doc.db.transaction(tx =>
		tx.update(
			app.documents,
			doc.id,
			{ content },
			{ editedFrom: { content: doc.content } },
		),
	)
	expect(getCommentRange({ ...doc, content }, thread.anchor)).toEqual({
		from: 18,
		to: 32,
		orphaned: false,
	})
	await resolveCommentThread(thread).wait({ tier: "global" })
	expect(
		(await bob.one(app.commentThreads.where({ id: thread.id })))?.resolvedAt,
	).toBeInstanceOf(Date)
	await reopenCommentThread(thread).wait({ tier: "global" })
	expect(
		(await bob.one(app.commentThreads.where({ id: thread.id })))?.resolvedAt,
	).toBeNull()
	await deleteCommentThread(thread).wait({ tier: "global" })
	expect(
		(await bob.one(app.commentThreads.where({ id: thread.id })))?.deletedAt,
	).toBeInstanceOf(Date)
})
test("export and restore preserve the portable format, including disabled comments", async () => {
	let doc = await document()
	createCommentThread(doc, { from: 8, to: 22 }, "Export me", "Alice")
	doc = await reload(doc)
	let exported = getExportComments({ ...doc, commentsDisabled: true })
	expect(exported[0]).toMatchObject({
		quote: "Selected words",
		from: 8,
		to: 22,
		resolved: false,
		replies: [{ body: "Export me", authorName: "Alice", updatedAt: null }],
	})
	await restoreExportedComments(doc, exported)
	await doc.db.waitForSync()
	let restored = await doc.db.all(
		app.commentThreads.where({ documentId: doc.id }),
	)
	expect(restored).toHaveLength(1)
	expect(restored[0].createdAt.toISOString()).toBe(exported[0].createdAt)
})
test("deleted or ambiguous quotes stay orphaned rather than pointing at other text", async () => {
	let doc = await document()
	let range = doc.db.textAnchors().captureRange(doc.content, 8, 22)
	let anchor = {
		range,
		quote: "Selected words",
		contextBefore: "Before. ",
		contextAfter: ". After.",
	}
	expect(
		getCommentRange({ ...doc, content: "Completely replaced" }, anchor)
			.orphaned,
	).toBe(true)
	expect(
		recoverRange("Repeat. Repeat.", {
			quote: "Repeat.",
			contextBefore: "",
			contextAfter: "",
		}),
	).toBeNull()
	expect(
		recoverRange("A Repeat. B Repeat. C", {
			quote: "Repeat.",
			contextBefore: "B ",
			contextAfter: " C",
		}),
	).toEqual({ from: 12, to: 19 })
})
