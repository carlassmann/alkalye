import { beforeEach, describe, expect, test } from "vitest"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { UserAccount } from "@/schema"
import { getPath } from "@/app/features/editor"
import { createPersonalDocument } from "./documents"
import {
	applyFolderPathToContent,
	makeFolderDocumentContent,
	moveDocumentsToFolder,
} from "./folders"
import type { co } from "jazz-tools"

describe("document folders", () => {
	let account: co.loaded<typeof UserAccount>

	beforeEach(async () => {
		await setupJazzTestSync()

		account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
	})

	test("creates placeholder document content for an empty folder", () => {
		let content = makeFolderDocumentContent("Projects/Ideas")

		expect(getPath(content)).toBe("Projects/Ideas")
		expect(content).toContain("title: Untitled")
	})

	test("adds a folder path to a document without frontmatter", () => {
		let content = applyFolderPathToContent("# Notes\n\nBody", "Projects")

		expect(getPath(content)).toBe("Projects")
		expect(content).toContain("# Notes")
	})

	test("moves existing documents into a new folder", async () => {
		let first = await createPersonalDocument(account, "# First\n")
		let second = await createPersonalDocument(
			account,
			"---\ntitle: Second\npath: Old\n---\n\nBody",
		)

		let moved = await moveDocumentsToFolder([first, second], "Projects")

		expect(moved).toEqual({ changed: 2, skipped: 0 })
		expect(getPath(first.content?.toString() ?? "")).toBe("Projects")
		expect(getPath(second.content?.toString() ?? "")).toBe("Projects")
		expect(first.path).toBe("Projects")
		expect(second.path).toBe("Projects")
	})
})
