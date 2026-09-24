import React from "react"
import { createRoot, type Root } from "react-dom/client"
import { flushSync } from "react-dom"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { LaserMessage } from "../lib/laser-schema"
import { laserLayoutKey } from "../lib/laser-session"

let transport = vi.hoisted(() => {
	let state: {
		receive: ((message: LaserMessage) => void) | null
		sent: LaserMessage[]
	} = { receive: null, sent: [] }
	return state
})
vi.mock("jazz-tools/react", () => {
	let account = { $isLoaded: true }
	return { useAccount: () => account }
})
vi.mock("@/shared/intl/setup", () => ({ useIntl: () => (key: string) => key }))
vi.mock("../lib/laser-channel", () => ({
	createLaserChannel(
		_account: unknown,
		_doc: string,
		receive: (message: LaserMessage) => void,
	) {
		transport.receive = receive
		return {
			postMessage: (message: LaserMessage) => transport.sent.push(message),
			close() {},
		}
	},
}))

let root: Root
let container: HTMLDivElement

beforeEach(async () => {
	transport.sent = []
	transport.receive = null
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	)
	container = document.createElement("div")
	document.body.append(container)
	root = createRoot(container)
	let { LaserPreview } = await import("./laser-pointer")
	flushSync(() =>
		root.render(React.createElement(LaserPreview, { docId: "doc" })),
	)
})
afterEach(() => {
	flushSync(() => root.unmount())
	container.remove()
	vi.unstubAllGlobals()
})

function advertise(id: string, confirmed = true) {
	let discovery = transport.sent.find(message => message.type === "discover")
	if (discovery?.type !== "discover") throw new Error("Discovery missing")
	let display = {
		type: "display",
		id,
		lease: `${id}-lease`,
		requests: confirmed ? [discovery.request] : [],
		width: 1920,
		height: 1080,
		slideNumber: 1,
		appearance: "dark",
	} satisfies LaserMessage
	flushSync(() => transport.receive?.(display))
	return display
}

function pointer(type: string, id: number, primary = true) {
	let event = new MouseEvent(type, {
		bubbles: true,
		clientX: 100,
		clientY: 50,
		button: 0,
	})
	Object.defineProperties(event, {
		pointerId: { value: id },
		pointerType: { value: "touch" },
		isPrimary: { value: primary },
	})
	return event
}

test("requires live discovery and keeps the chosen display when another connects", () => {
	advertise("cached", false)
	expect(container.querySelector("iframe")).toBeNull()
	advertise("first")
	expect(container.querySelector("iframe")).not.toBeNull()
	advertise("second")
	expect(container.querySelector("select")?.value).toBe("first")
	flushSync(() => transport.receive?.({ type: "closed", id: "first" }))
	expect(container.querySelector("iframe")).toBeNull()
	expect(container.querySelector("select")?.value).toBe("")
})

test("ignores secondary touches and clears pointing on cancellation", () => {
	let display = advertise("screen")
	let frame = container.querySelector("iframe")
	let surface = container.querySelector("[data-laser-surface]")
	if (!(surface instanceof HTMLElement) || !frame?.contentDocument)
		throw new Error("Preview missing")
	let slide = frame.contentDocument.createElement("div")
	slide.setAttribute("data-current-slide", "1")
	frame.contentDocument.append(slide)
	surface.setPointerCapture = vi.fn()
	surface.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100)
	surface.dispatchEvent(pointer("pointerdown", 1))
	let first = transport.sent.at(-1)
	expect(first).toMatchObject({
		type: "point",
		visible: true,
		x: 0.5,
		y: 0.5,
		lease: display.lease,
		layout: laserLayoutKey(display),
	})
	surface.dispatchEvent(pointer("pointerdown", 2, false))
	surface.dispatchEvent(pointer("lostpointercapture", 2, false))
	expect(transport.sent.at(-1)).toBe(first)
	surface.dispatchEvent(pointer("pointercancel", 1))
	expect(transport.sent.at(-1)).toMatchObject({ type: "point", visible: false })
	let count = transport.sent.length
	surface.dispatchEvent(pointer("pointermove", 1))
	expect(transport.sent).toHaveLength(count)
})
