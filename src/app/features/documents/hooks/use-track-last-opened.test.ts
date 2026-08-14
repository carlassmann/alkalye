import React from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useTrackLastOpened } from "./use-track-last-opened"

afterEach(() => {
	vi.restoreAllMocks()
	document.body.replaceChildren()
})

beforeEach(() => {
	localStorage.clear()
})

describe("useTrackLastOpened", () => {
	test("writes only when local navigation identity changes", () => {
		let setItem = vi.spyOn(Storage.prototype, "setItem")
		let container = document.createElement("div")
		document.body.append(container)
		let root = createRoot(container)

		flushSync(() => {
			root.render(
				React.createElement(LastOpenedFixture, {
					accountId: "account-a",
					documentId: "document-a",
				}),
			)
		})
		flushSync(() => {
			root.render(
				React.createElement(LastOpenedFixture, {
					accountId: "account-a",
					documentId: "document-a",
				}),
			)
		})
		expect(setItem).toHaveBeenCalledOnce()

		flushSync(() => {
			root.render(
				React.createElement(LastOpenedFixture, {
					accountId: "account-a",
					documentId: "document-b",
				}),
			)
		})
		expect(setItem).toHaveBeenCalledTimes(2)
		flushSync(() => root.unmount())
	})
})

function LastOpenedFixture({
	accountId,
	documentId,
}: {
	accountId: string
	documentId: string
}) {
	useTrackLastOpened(accountId, documentId)
	return null
}
