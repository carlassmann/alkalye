// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import {
	app,
	createDocument,
	updateContent,
	setPinned,
	type LibraryDocument,
} from "./library"
import { watchWrite, localWriteReceipt } from "./writes"
import { permissions } from "@/jazz/permissions"

let fixture: PolicyTestApp
let ownerId = "00000000-0000-4000-8000-000000000001"
beforeEach(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterEach(async () => {
	await fixture.shutdown()
	vi.unstubAllGlobals()
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
test("a newer saved notification supersedes the earlier result without cancelling either write", async () => {
	let page = new EventTarget()
	vi.stubGlobal("window", page)
	let notifications: unknown[] = []
	page.addEventListener("alkalye:document-saved", event => {
		if (event instanceof CustomEvent) notifications.push(event.detail)
	})
	let db = actor()
	let doc = await createDocument(db, ownerId, "A")
	await Promise.all([
		updateContent(db, doc, "AB", "A"),
		updateContent(db, doc, "ABC", "AB"),
	])
	await db.waitForSync()
	await vi.waitFor(() =>
		expect(notifications).toEqual([{ documentId: doc.id, content: "ABC" }]),
	)
	expect((await db.one(app.documents.where({ id: doc.id })))?.content).toBe(
		"ABC",
	)
})
test("pagehide submits queued text writes in order before Promise continuations", async () => {
	let page = new EventTarget()
	vi.stubGlobal("window", page)
	vi.stubGlobal(
		"document",
		Object.assign(new EventTarget(), { visibilityState: "visible" }),
	)
	vi.stubGlobal("requestAnimationFrame", () => 1)
	vi.stubGlobal("cancelAnimationFrame", () => {})
	let db = actor()
	let doc = await createDocument(db, ownerId, "A")
	let transaction = db.beginTransaction()
	let update = vi.spyOn(transaction, "update")
	let transactions = vi
		.spyOn(db, "beginTransaction")
		.mockReturnValueOnce(transaction)
	let first = updateContent(db, doc, "AB", "A", {
		deferMetadata: true,
	})
	let second = updateContent(db, doc, "ABC", "AB", {
		deferMetadata: true,
	})
	page.dispatchEvent(new Event("pagehide"))
	expect(transactions).toHaveBeenCalledTimes(1)
	expect(update).toHaveBeenCalledWith(
		app.documents,
		doc.id,
		{ content: "ABC" },
		{
			editedFrom: { content: "A" },
		},
	)
	let current = db.one(app.documents.where({ id: doc.id }))
	expect((await current)?.content).toBe("ABC")
	await Promise.all([first, second])
	await updateContent(db, doc, "ABC", "ABC")
	await db.waitForSync()
})
test("queued writers with different bases keep both edits", async () => {
	let page = new EventTarget()
	vi.stubGlobal("window", page)
	vi.stubGlobal(
		"document",
		Object.assign(new EventTarget(), { visibilityState: "visible" }),
	)
	vi.stubGlobal("requestAnimationFrame", () => 1)
	vi.stubGlobal("cancelAnimationFrame", () => {})
	let db = actor()
	let doc = await createDocument(db, ownerId, "A")
	let first = updateContent(db, doc, "AB", "A", { deferMetadata: true })
	let second = updateContent(db, doc, "XA", "A", { deferMetadata: true })
	page.dispatchEvent(new Event("pagehide"))
	await Promise.all([first, second])
	expect((await db.one(app.documents.where({ id: doc.id })))?.content).toBe(
		"XAB",
	)
	await updateContent(db, doc, "XAB", "XAB")
	await db.waitForSync()
})
test("multiple observers share the same local receipt", async () => {
	let db = actor()
	let doc = await createDocument(db, ownerId, "A")
	let write = db.update(app.documents, doc.id, { title: "Changed" })
	let wait = vi.spyOn(write, "wait")
	watchWrite(write)
	watchWrite(write)
	let first = localWriteReceipt(write)
	let second = localWriteReceipt(write)
	expect(first).toBe(second)
	expect(wait).toHaveBeenCalledTimes(1)
	await first
})
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

test("large editedFrom writes preserve both stale-base insertions", async () => {
	let db = actor()
	let original = "# Guarded large edit\n\n" + "a😀é paragraph\n".repeat(4096)
	let doc = await createDocument(db, ownerId, original)
	await db.waitForSync()
	await updateContent(db, doc, original + " suffix", original)
	await updateContent(db, doc, "prefix " + original, original)
	await db.waitForSync()
	expect((await db.one(app.documents.where({ id: doc.id })))?.content).toBe(
		"prefix " + original + " suffix",
	)
})
