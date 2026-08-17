import { beforeEach, describe, expect, test } from "vitest"
import { co } from "jazz-tools"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { createPersonalDocument } from "@/app/features/documents"
import {
	applyContentDiffWithCommentAnchors,
	createCommentThread,
	getCommentRange,
} from "@/app/features/comments"
import {
	getContentAtEdit,
	getEditHistory,
} from "@/app/features/time-machine/lib/time-machine"
import { Document, UserAccount } from "@/schema"
import {
	compactCliDocument,
	replaceCliDocumentContent,
	summarizeDoc,
} from "@/cli/runtime"

describe("CLI document loading", () => {
	let account: co.loaded<typeof UserAccount>

	beforeEach(async () => {
		await setupJazzTestSync()
		account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
	})

	test("summarizes documents from metadata", async () => {
		let doc = await createPersonalDocument(account, "# Fast title\n\nBody")

		expect(summarizeDoc(doc).title).toBe("Fast title")
	})

	test("compacts content written through the CLI", async () => {
		let doc = await createPersonalDocument(account, "Version 1")
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: { replies: true } } },
		})
		applyContentDiffWithCommentAnchors(loaded, "Version 2")
		applyContentDiffWithCommentAnchors(loaded, "Version 3")

		expect(await compactCliDocument(loaded, 1)).toBe(true)
		expect(loaded.content.toString()).toBe("Version 3")
		expect(loaded.archivedContent).toHaveLength(1)
	})

	test("replaces large document content without oversized transactions", async () => {
		let quote = "comment target"
		let original = `${"a".repeat(25_000)}${quote}${"a".repeat(25_000)}`
		let replacement = "b".repeat(50_000)
		let doc = await createPersonalDocument(account, original)
		let loaded = await doc.$jazz.ensureLoaded({
			resolve: { content: true, comments: { $each: { replies: true } } },
		})
		let thread = createCommentThread(
			loaded,
			{ from: 25_000, to: 25_000 + quote.length },
			"Review this",
		)
		if (!thread) throw new Error("Comment not created")

		await replaceCliDocumentContent(loaded, replacement)

		expect(loaded.content.toString()).toBe(replacement)
		expect(loaded.archivedContent).toHaveLength(1)
		expect(thread.anchor.quote.length).toBeLessThanOrEqual(1_000)
		expect(getCommentRange(loaded, thread.anchor).orphaned).toBe(true)

		let historical = await Document.load(loaded.$jazz.id, {
			resolve: {
				content: true,
				assets: true,
				archivedContent: { $each: { content: true } },
			},
		})
		if (!historical.$isLoaded) throw new Error("History not loaded")
		let edits = getEditHistory(historical)
		expect(getContentAtEdit(historical, edits.length - 1)).toBe(replacement)
	})
})
