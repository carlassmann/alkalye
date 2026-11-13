// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import { app, createDocument } from "../lib/library"
import { permissions } from "@/jazz/permissions"
import { shareDocument, printSlidesToPdf } from "@/app/features/import-export"
import { makeShare, makePrintSlidesFactory } from "./sidebar-file-menu"

vi.mock("@/app/features/import-export/lib/export", async importOriginal => ({
	...(await importOriginal<
		typeof import("@/app/features/import-export/lib/export")
	>()),
	shareDocument: vi.fn(),
}))
vi.mock(
	"@/app/features/import-export/lib/pdf-export",
	async importOriginal => ({
		...(await importOriginal<
			typeof import("@/app/features/import-export/lib/pdf-export")
		>()),
		printSlidesToPdf: vi.fn(),
	}),
)
vi.mock("@/app/features/themes", () => ({ loadThemesForPdf: async () => ({}) }))

let fixture: PolicyTestApp
let ownerId = "00000000-0000-4000-8000-000000000001"
beforeEach(async () => {
	vi.clearAllMocks()
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterEach(async () => {
	await fixture.shutdown()
})

test("native sharing exports comments and slide printing receives wikilink titles", async () => {
	let db = fixture.as({
		issuer: "https://alkalye.test",
		user_id: ownerId,
		account_id: ownerId,
		claims: {},
		authMode: "external",
	})
	let now = new Date()
	let doc = await createDocument(db, ownerId, "# Slides\nQuoted words")
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
			body: "Share this comment",
			createdAt: now,
		})
		.wait({ tier: "global" })
	let loaded = {
		...doc,
		deletedAt: undefined,
		pinned: false,
		canEdit: true,
		canAdmin: true,
	}
	await makeShare(db, loaded, doc.content)()
	expect(shareDocument).toHaveBeenCalledWith(doc.content, "Slides", undefined, [
		expect.objectContaining({
			replies: [expect.objectContaining({ body: "Share this comment" })],
		}),
	])
	let titles = new Map([[doc.id, "Slides"]])
	await makePrintSlidesFactory(
		db,
		doc.content,
		loaded,
		titles,
	)({ layout: "notes", aspectRatio: "4:3" })()
	expect(printSlidesToPdf).toHaveBeenCalledWith(
		expect.objectContaining({
			wikilinkTitles: titles,
			layout: "notes",
			aspectRatio: "4:3",
		}),
	)
})
