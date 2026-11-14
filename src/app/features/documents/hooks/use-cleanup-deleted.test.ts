// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import { app, createDocument, type LibraryDocument } from "../lib/library"
import { permissions } from "@/jazz/permissions"
import { cleanupDeletedDocuments } from "./use-cleanup-deleted"

let fixture: PolicyTestApp
let ownerId = "00000000-0000-4000-8000-000000000001"
beforeEach(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterEach(async () => {
	await fixture.shutdown()
})

test("cleanup keeps recent and non-admin trash and deletes only expired admin trash", async () => {
	let db = fixture.as({
		issuer: "https://alkalye.test",
		user_id: ownerId,
		account_id: ownerId,
		claims: {},
		authMode: "external",
	})
	let now = Date.now()
	let docs: LibraryDocument[] = []
	for (let [days, canAdmin] of [
		[31, true],
		[29, true],
		[31, false],
	] as const) {
		let doc = await createDocument(db, ownerId, "# Trash")
		let deletedAt = new Date(now - days * 86400000)
		await db
			.update(app.documents, doc.id, { deletedAt })
			.wait({ tier: "global" })
		docs.push({ ...doc, deletedAt, canAdmin, canEdit: true, pinned: false })
	}
	await cleanupDeletedDocuments(db, docs, now)
	await db.waitForSync()
	expect((await db.all(app.documents)).map(doc => doc.id)).toEqual(
		expect.arrayContaining(docs.slice(1).map(doc => doc.id)),
	)
	expect(await db.one(app.documents.where({ id: docs[0]!.id }))).toBeNull()
})
