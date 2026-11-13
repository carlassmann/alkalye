// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import {
	app,
	createDocument,
	type Database,
} from "@/app/features/documents/lib/library"
import { permissions } from "@/jazz/permissions"
import { DEFAULT_EDITOR_SETTINGS } from "@/jazz/value-types"
import { saveGuestTransfer, restoreGuestTransfer } from "./guest-transfer"

vi.mock("idb-keyval", () => {
	let values = new Map<string, unknown>()
	return {
		get: async (key: string) => values.get(key),
		set: async (key: string, value: unknown) => {
			values.set(key, structuredClone(value))
		},
		del: async (key: string) => {
			values.delete(key)
		},
	}
})

let fixture: PolicyTestApp
let guestId = "00000000-0000-4000-8000-000000000001"
let targetId = "00000000-0000-4000-8000-000000000002"
beforeEach(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterEach(async () => {
	await fixture.shutdown()
})

function actor(ownerId: string) {
	return fixture.as({
		issuer: "https://alkalye.test",
		user_id: ownerId,
		account_id: ownerId,
		claims: {},
		authMode: "external",
	})
}

test("guest transfer retries without duplicates and preserves folders, deleted notes, settings, assets and comments", async () => {
	let guest = actor(guestId)
	let target = actor(targetId)
	let now = new Date()
	let folder = await guest
		.insert(app.folders, { ownerId: guestId, name: "Private", rank: 1 })
		.wait({ tier: "global" })
	let doc = await createDocument(guest, guestId, "# Guest note\nA quote")
	let asset = await guest
		.insert(app.assets, {
			documentId: doc.id,
			type: "image",
			name: "photo",
			data: new Uint8Array([1, 2, 3]),
			createdAt: now,
		})
		.wait({ tier: "global" })
	await guest
		.update(app.documents, doc.id, {
			content: `${doc.content}\n![photo](asset:${asset.id})`,
			deletedAt: now,
		})
		.wait({ tier: "global" })
	let entry = await guest.one(app.userDocuments.where({ documentId: doc.id }))
	if (!entry) throw new Error("Missing entry")
	await guest
		.update(app.userDocuments, entry.id, {
			folderId: folder.id,
			pinned: true,
			archived: true,
		})
		.wait({ tier: "global" })
	let theme = await guest
		.insert(app.themes, {
			ownerId: guestId,
			name: "Guest theme",
			type: "preview",
			css: "p { color: red }",
			createdAt: now,
			updatedAt: now,
			sourceDocId: doc.id,
		})
		.wait({ tier: "global" })
	await guest
		.insert(app.themeAssets, {
			themeId: theme.id,
			name: "texture",
			mimeType: "image/png",
			data: new Uint8Array([4, 5]),
			createdAt: now,
		})
		.wait({ tier: "global" })
	await guest
		.insert(app.settings, {
			ownerId: guestId,
			editor: { ...DEFAULT_EDITOR_SETTINGS, fontSize: 23 },
			language: "de",
			defaultPreviewTheme: theme.id,
		})
		.wait({ tier: "global" })
	let thread = await guest
		.insert(app.commentThreads, {
			documentId: doc.id,
			authorId: guestId,
			anchor: { quote: "A quote", contextBefore: "", contextAfter: "" },
			createdAt: now,
			updatedAt: now,
		})
		.wait({ tier: "global" })
	await guest
		.insert(app.commentReplies, {
			threadId: thread.id,
			authorId: guestId,
			body: "Keep me",
			createdAt: now,
		})
		.wait({ tier: "global" })
	await guest
		.update(app.documents, doc.id, { commentsDisabled: true })
		.wait({ tier: "global" })
	await transfer(guest, target)
	let copies = await target.all(app.documents.where({ ownerId: targetId }))
	expect(copies).toHaveLength(1)
	let copy = copies[0]!
	expect(copy.id).not.toBe(doc.id)
	expect(copy.deletedAt).toEqual(now)
	expect(copy.commentsDisabled).toBe(true)
	let assets = await target.all(app.assets.where({ documentId: copy.id }))
	expect(assets[0]?.data).toEqual(new Uint8Array([1, 2, 3]))
	expect(copy.content).toContain(`asset:${assets[0]?.id}`)
	expect(copy.content).not.toContain(asset.id)
	let copiedEntry = await target.one(
		app.userDocuments.where({ documentId: copy.id }),
	)
	expect(copiedEntry).toMatchObject({ pinned: true, archived: true })
	expect(
		await target.one(app.folders.where({ id: copiedEntry?.folderId ?? "" })),
	).toMatchObject({ name: "Private" })
	expect(
		await target.one(app.settings.where({ ownerId: targetId })),
	).toMatchObject({ editor: { fontSize: 23 }, language: "de" })
	let copiedSettings = await target.one(
		app.settings.where({ ownerId: targetId }),
	)
	let copiedTheme = await target.one(
		app.themes.where({ id: copiedSettings?.defaultPreviewTheme ?? "" }),
	)
	expect(copiedTheme).toMatchObject({
		name: "Guest theme",
		sourceDocId: copy.id,
	})
	expect((await target.all(app.themeAssets))[0]?.data).toEqual(
		new Uint8Array([4, 5]),
	)

	expect(await target.all(app.commentReplies)).toEqual([
		expect.objectContaining({ body: "Keep me", authorId: targetId }),
	])
	expect(await guest.one(app.documents.where({ id: doc.id }))).not.toBeNull()
})

async function transfer(guest: Database, target: Database) {
	let key = `test-${crypto.randomUUID()}`
	await saveGuestTransfer(guest, guestId, key)
	await restoreGuestTransfer(target, targetId, key)
	await restoreGuestTransfer(target, targetId, key)
	await target.waitForSync()
}

test("a failed sign-in can recapture newer guest edits, including an edited welcome note", async () => {
	let guest = actor(guestId)
	let target = actor(targetId)
	let key = crypto.randomUUID()
	let doc = await createDocument(
		guest,
		guestId,
		"# Welcome to Alkalye\nOriginal",
	)
	await saveGuestTransfer(guest, guestId, key)
	await guest
		.update(app.documents, doc.id, {
			content: "# Welcome to Alkalye\nMy own writing",
			updatedAt: new Date(doc.createdAt.getTime() + 100),
		})
		.wait({ tier: "global" })
	await createDocument(guest, guestId, "# Another guest note")
	await saveGuestTransfer(guest, guestId, key)
	await restoreGuestTransfer(target, targetId, key)
	await target.waitForSync()
	let notes = await target.all(app.documents)
	expect(notes).toHaveLength(2)
	expect(notes.some(note => note.content.includes("My own writing"))).toBe(true)
})
