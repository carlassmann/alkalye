import React, { act } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useAfterFirstPaint } from "./use-after-first-paint"

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	vi.useFakeTimers()
	vi.stubGlobal(
		"requestAnimationFrame",
		(callback: (timestamp: number) => void) =>
			window.setTimeout(() => callback(0), 1),
	)
	vi.stubGlobal("cancelAnimationFrame", (frame: number) =>
		window.clearTimeout(frame),
	)
})

afterEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = false
	vi.useRealTimers()
	vi.unstubAllGlobals()
	document.body.replaceChildren()
})

describe("useAfterFirstPaint", () => {
	test("never exposes the previous value while the next value is deferred", async () => {
		let container = document.createElement("div")
		document.body.append(container)
		let root = createRoot(container)

		act(() => {
			flushSync(() => {
				root.render(React.createElement(Fixture, { value: "document-a" }))
			})
		})
		expect(container.textContent).toBe("pending")
		await advancePastPaint()
		expect(container.textContent).toBe("document-a")

		act(() => {
			flushSync(() => {
				root.render(React.createElement(Fixture, { value: "document-b" }))
			})
		})
		expect(container.textContent).toBe("pending")
		await advancePastPaint()
		expect(container.textContent).toBe("document-b")

		act(() => flushSync(() => root.unmount()))
	})
})

function Fixture({ value }: { value: string }) {
	return useAfterFirstPaint(value) ?? "pending"
}

async function advancePastPaint() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(2)
	})
}
