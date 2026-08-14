import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	clearLastOpenedDocument,
	readLastOpenedDocument,
	writeLastOpenedDocument,
} from "./last-opened-document"

describe("last opened document", () => {
	beforeEach(() => {
		localStorage.clear()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("stores one device-local document per account", () => {
		writeLastOpenedDocument("account-a", "doc-a", "space-a")

		expect(readLastOpenedDocument("account-a")).toEqual({
			documentId: "doc-a",
			spaceId: "space-a",
		})
		expect(readLastOpenedDocument("account-b")).toBeNull()
	})

	test("does not rewrite unchanged navigation state", () => {
		let setItem = vi.spyOn(Storage.prototype, "setItem")

		writeLastOpenedDocument("account-a", "doc-a")
		writeLastOpenedDocument("account-a", "doc-a")

		expect(setItem).toHaveBeenCalledOnce()
	})

	test("clears only the current account state", () => {
		writeLastOpenedDocument("account-a", "doc-a")
		clearLastOpenedDocument("account-b")
		expect(readLastOpenedDocument("account-a")?.documentId).toBe("doc-a")

		clearLastOpenedDocument("account-a")
		expect(readLastOpenedDocument("account-a")).toBeNull()
	})
})
