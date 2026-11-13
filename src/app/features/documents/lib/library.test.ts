// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import {
	app,
	createDocument,
	updateContent,
	setPinned,
	type LibraryDocument,
} from "./library"
import { permissions } from "@/jazz/permissions"

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
function personal(
	doc: Awaited<ReturnType<typeof createDocument>>,
): LibraryDocument {
	return {
		...doc,
		deletedAt: undefined,
		path: null,
		pinned: false,
		canEdit: true,
		canAdmin: true,
	}
}
test("creates a library entry and nested folders, and keeps pins across reads", async () => {
	let db = actor()
	let doc = await createDocument(
		db,
		ownerId,
		"---\npath: Work/Notes\n---\n\n# Note",
	)
	await db.waitForSync()
	let folders = await db.all(app.folders)
	expect(folders.map(folder => folder.name).sort()).toEqual(["Notes", "Work"])
	let entry = await db.one(app.userDocuments.where({ documentId: doc.id }))
	expect(entry?.folderId).toBe(
		folders.find(folder => folder.name === "Notes")?.id,
	)
	await setPinned(db, ownerId, personal(doc), true)
	await db.waitForSync()
	expect(
		(await db.one(app.userDocuments.where({ documentId: doc.id })))?.pinned,
	).toBe(true)
	expect(
		(await db.one(app.documents.where({ id: doc.id })))?.content,
	).toContain("pinned: true")
})
test("adds and removes visible frontmatter backlinks without replacing target text", async () => {
	let db = actor()
	let source = await createDocument(db, ownerId, "# Source")
	let target = await createDocument(db, ownerId, "# Target\n\nKeep this text")
	await db.waitForSync()
	let linked = "# Source\n\n[[" + target.id + "]]"
	await updateContent(db, source, linked)
	await db.waitForSync()
	let backlink = await db.one(app.documents.where({ id: target.id }))
	expect(backlink?.content).toContain(source.id)
	expect(backlink?.content).toContain("Keep this text")
	await updateContent(db, { ...source, content: linked }, "# Source")
	await db.waitForSync()
	let removed = await db.one(app.documents.where({ id: target.id }))
	expect(removed?.content).not.toContain(source.id)
	expect(removed?.content).toContain("Keep this text")
})

test("browser creation in another owner's space preserves space ownership and inherited access", async () => {
	let spaceOwner = "00000000-0000-4000-8000-000000000002"
	let space = await fixture.seed(db =>
		db.insert(app.spaces, {
			ownerId: spaceOwner,
			name: "Team",
			createdAt: new Date(),
			updatedAt: new Date(),
		}),
	)
	let member = await fixture.seed(db =>
		db.insert(app.spaceMembers, {
			spaceId: space.id,
			accountId: ownerId,
			role: "writer",
		}),
	)
	let db = actor()
	let doc = await createDocument(db, ownerId, "# Team draft", space.id)
	await db.waitForSync()
	expect(doc.ownerId).toBe(spaceOwner)
	expect(await db.all(app.userDocuments.where({ documentId: doc.id }))).toEqual(
		[],
	)
	await db.expectDenied(db => db.delete(app.documents, doc.id))
	await fixture.seed(db => db.delete(app.spaceMembers, member.id))
	expect(await db.all(app.documents.where({ id: doc.id }))).toEqual([])
})
