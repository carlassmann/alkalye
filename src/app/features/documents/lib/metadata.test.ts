import { beforeEach, describe, expect, test } from "vitest"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { UserAccount } from "@/schema"
import { createPersonalDocument } from "./documents"
import {
	backfillDocumentMetadata,
	createDocumentMetadata,
	extractDocumentMetadata,
	needsMetadataBackfill,
	syncDocumentMetadata,
} from "./metadata"
import { togglePinned } from "@/app/features/editor"
import { applyContentDiffWithCommentAnchors } from "@/app/features/comments"
import type { co } from "jazz-tools"

describe("document metadata", () => {
	let account: co.loaded<typeof UserAccount>

	beforeEach(async () => {
		await setupJazzTestSync()

		account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
	})

	test("extracts sidebar metadata from frontmatter and body", () => {
		let metadata = extractDocumentMetadata(
			"---\ntitle: Launch Notes\npath: Work/Plans\npinned: true\nmode: presentation\n---\n\n# Ignored",
		)

		expect(metadata).toEqual({
			title: "Launch Notes",
			path: "Work/Plans",
			pinned: true,
			tags: [],
			isPresentation: true,
		})
	})

	test("extracts denormalized tags", () => {
		let metadata = extractDocumentMetadata(
			"---\ntags: launch, performance\n---\n\n# Notes",
		)

		expect(metadata.tags).toEqual(["launch", "performance"])
	})

	test("uses first meaningful body line as title fallback", () => {
		expect(extractDocumentMetadata("\n\n## Body Title\n\nText").title).toBe(
			"Body Title",
		)
		expect(extractDocumentMetadata("").title).toBe("Untitled")
	})

	test("skips leading image assets when deriving the title", () => {
		expect(
			extractDocumentMetadata(
				"![Cover](asset:co_asset)\n\n# Project Notes\n\nBody",
			).title,
		).toBe("Project Notes")
		expect(
			extractDocumentMetadata(
				"![Cover](asset:co_asset)# Recovered Title\n\nBody",
			).title,
		).toBe("Recovered Title")
	})

	test("adds metadata timestamp for new documents", () => {
		let updatedAt = new Date("2026-01-01T00:00:00Z")

		expect(createDocumentMetadata("# Created", updatedAt)).toMatchObject({
			title: "Created",
			metadataUpdatedAt: updatedAt,
		})
	})

	test("new personal documents store metadata at creation", async () => {
		let doc = await createPersonalDocument(
			account,
			"---\ntitle: Created\npath: Inbox\n---\n\nBody",
		)

		expect(doc.title).toBe("Created")
		expect(doc.path).toBe("Inbox")
		expect(doc.tags).toEqual([])
		expect(doc.pinned).toBe(false)
		expect(doc.isPresentation).toBe(false)
	})

	test("syncs metadata after frontmatter edits", async () => {
		let doc = await createPersonalDocument(account, "# Draft")
		let content = togglePinned(
			"---\ntitle: Final\npath: Shipped\nmode: presentation\n---\n\nBody",
		)
		let updatedAt = new Date("2026-01-02T00:00:00Z")

		applyContentDiffWithCommentAnchors(doc, content)
		doc.$jazz.set("updatedAt", updatedAt)
		syncDocumentMetadata(doc)

		expect(doc.title).toBe("Final")
		expect(doc.path).toBe("Shipped")
		expect(doc.tags).toEqual([])
		expect(doc.pinned).toBe(true)
		expect(doc.isPresentation).toBe(true)
		expect(doc.contentUpdatedAt?.getTime()).toBe(updatedAt.getTime())
		expect(doc.metadataUpdatedAt?.getTime()).toBe(updatedAt.getTime())
	})

	test("newer comment-like updates advance only the metadata checkpoint", async () => {
		let doc = await createPersonalDocument(account, "# Draft")
		let contentUpdatedAt = doc.contentUpdatedAt
		let updatedAt = new Date((contentUpdatedAt?.getTime() ?? 0) + 1_000)

		doc.$jazz.set("title", "Stale title")
		doc.$jazz.set("updatedAt", updatedAt)
		syncDocumentMetadata(doc, { contentChanged: false })

		expect(doc.title).toBe("Draft")
		expect(doc.contentUpdatedAt?.getTime()).toBe(contentUpdatedAt?.getTime())
		expect(doc.metadataUpdatedAt?.getTime()).toBe(updatedAt.getTime())
		expect(needsMetadataBackfill(doc)).toBe(false)
	})

	test("identifies incomplete and stale metadata", () => {
		let current = new Date("2026-01-02T00:00:00Z")
		let stale = new Date("2026-01-01T00:00:00Z")

		expect(needsMetadataBackfill({ title: undefined })).toBe(true)
		expect(
			needsMetadataBackfill({
				title: "Old",
				tags: [],
				pinned: false,
				isPresentation: false,
				contentUpdatedAt: current,
				metadataUpdatedAt: stale,
				updatedAt: current,
			}),
		).toBe(true)
		expect(
			needsMetadataBackfill({
				title: "Current",
				tags: [],
				pinned: false,
				isPresentation: false,
				contentUpdatedAt: current,
				metadataUpdatedAt: current,
				updatedAt: current,
			}),
		).toBe(false)
	})

	test("identifies mixed-version content edits", () => {
		let contentUpdatedAt = new Date("2026-01-01T00:00:00Z")
		let updatedAt = new Date("2026-01-02T00:00:00Z")

		expect(
			needsMetadataBackfill({
				title: "Current",
				tags: [],
				pinned: false,
				isPresentation: false,
				contentUpdatedAt,
				metadataUpdatedAt: contentUpdatedAt,
				updatedAt,
			}),
		).toBe(true)
	})

	test("backfill initializes documents with missing legacy timestamps", async () => {
		let doc = await createPersonalDocument(account, "# Legacy")
		let updatedAt = new Date("2026-01-03T00:00:00Z")

		doc.$jazz.set("title", undefined)
		doc.$jazz.set("contentUpdatedAt", undefined)
		doc.$jazz.set("metadataUpdatedAt", undefined)
		doc.$jazz.set("updatedAt", updatedAt)
		backfillDocumentMetadata(doc)

		expect(doc.title).toBe("Legacy")
		expect(doc.contentUpdatedAt?.getTime()).toBe(updatedAt.getTime())
		expect(doc.metadataUpdatedAt?.getTime()).toBe(updatedAt.getTime())
	})

	test("backfill infers old-client content updates", async () => {
		let doc = await createPersonalDocument(account, "# Old")
		let contentUpdatedAt = doc.contentUpdatedAt
		let updatedAt = new Date((contentUpdatedAt?.getTime() ?? 0) + 1_000)

		applyContentDiffWithCommentAnchors(doc, "# New")
		doc.$jazz.set("updatedAt", updatedAt)
		backfillDocumentMetadata(doc)

		expect(contentUpdatedAt?.getTime()).toBeLessThan(updatedAt.getTime())
		expect(doc.title).toBe("New")
		expect(doc.contentUpdatedAt?.getTime()).toBe(updatedAt.getTime())
		expect(doc.metadataUpdatedAt?.getTime()).toBe(updatedAt.getTime())
	})

	test("content metadata sync advances content and metadata timestamps", async () => {
		let doc = await createPersonalDocument(account, "# Draft")
		let updatedAt = new Date("2026-01-04T00:00:00Z")

		applyContentDiffWithCommentAnchors(doc, "# Final")
		doc.$jazz.set("updatedAt", updatedAt)
		syncDocumentMetadata(doc)

		expect(doc.title).toBe("Final")
		expect(doc.contentUpdatedAt?.getTime()).toBe(updatedAt.getTime())
		expect(doc.metadataUpdatedAt?.getTime()).toBe(updatedAt.getTime())
	})
})
