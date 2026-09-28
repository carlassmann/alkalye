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

function pointer(
	type: string,
	id: number,
	primary = true,
	x = 100,
	pointerType = "touch",
) {
	let event = new MouseEvent(type, {
		bubbles: true,
		clientX: x,
		clientY: 50,
		button: 0,
	})
	Object.defineProperties(event, {
		pointerId: { value: id },
		pointerType: { value: pointerType },
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

test("hiding and showing the preview preserves the chosen display", async () => {
	let { LaserPreview } = await import("./laser-pointer")
	advertise("first")
	advertise("second")
	flushSync(() =>
		root.render(
			React.createElement(LaserPreview, { docId: "doc", visible: false }),
		),
	)
	expect(container.querySelector("iframe")).toBeNull()
	expect(container.querySelector("aside")).toBeNull()
	flushSync(() =>
		root.render(
			React.createElement(LaserPreview, { docId: "doc", visible: true }),
		),
	)
	expect(container.querySelector("iframe")).not.toBeNull()
	expect(container.querySelector("select")?.value).toBe("first")
})

test.each(["mouse", "touch"])(
	"resumes %s drags after re-entry, but not after release outside",
	pointerType => {
		advertise("screen")
		let frame = container.querySelector("iframe")
		let surface = container.querySelector("[data-laser-surface]")
		if (!(surface instanceof HTMLElement) || !frame?.contentDocument)
			throw new Error("Preview missing")
		let slide = frame.contentDocument.createElement("div")
		slide.setAttribute("data-current-slide", "1")
		frame.contentDocument.append(slide)
		surface.setPointerCapture = vi.fn()
		surface.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100)
		let pointerSurface = surface
		function move(type: string, x: number) {
			pointerSurface.dispatchEvent(pointer(type, 1, true, x, pointerType))
		}
		move("pointerdown", 100)
		let first = transport.sent.at(-1)
		if (first?.type !== "point") throw new Error("Point missing")
		move("pointermove", 250)
		expect(transport.sent.at(-1)).toMatchObject({ visible: false })
		let count = transport.sent.length
		move("pointermove", 260)
		expect(transport.sent).toHaveLength(count)
		move("pointermove", 150)
		let resumed = transport.sent.at(-1)
		expect(resumed).toMatchObject({ visible: true, x: 0.75 })
		if (resumed?.type !== "point") throw new Error("Point missing")
		expect(resumed.stroke).not.toBe(first.stroke)
		move("pointermove", 250)
		move("pointerup", 250)
		count = transport.sent.length
		move("pointermove", 100)
		expect(transport.sent).toHaveLength(count)
	},
)

test("retains coalesced fast movement in the final synced message", () => {
	advertise("screen")
	let frame = container.querySelector("iframe")
	let surface = container.querySelector("[data-laser-surface]")
	if (!(surface instanceof HTMLElement) || !frame?.contentDocument)
		throw new Error("Preview missing")
	let slide = frame.contentDocument.createElement("div")
	slide.setAttribute("data-current-slide", "1")
	frame.contentDocument.append(slide)
	surface.setPointerCapture = vi.fn()
	surface.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100)
	let clock = vi.spyOn(performance, "now").mockReturnValue(0)
	try {
		surface.dispatchEvent(pointer("pointerdown", 1))
		let move = pointer("pointermove", 1)
		let samples = Array.from({ length: 60 }, (_, index) => ({
			clientX: 100 + Math.cos((index / 59) * Math.PI * 2) * 40,
			clientY: 50 + Math.sin((index / 59) * Math.PI * 2) * 40,
		}))
		Object.defineProperty(move, "getCoalescedEvents", { value: () => samples })
		surface.dispatchEvent(move)
		expect(
			transport.sent.filter(message => message.type === "point"),
		).toHaveLength(1)
		surface.dispatchEvent(pointer("pointerup", 1))
		let end = transport.sent.at(-1)
		if (end?.type !== "point") throw new Error("Point missing")
		expect(end.visible).toBe(false)
		expect(end.samples).toHaveLength(62)
		expect(end.samples?.slice(1, 61)).toEqual(
			samples.map((sample, index) => ({
				index: index + 1,
				x: sample.clientX / 200,
				y: sample.clientY / 100,
			})),
		)
	} finally {
		clock.mockRestore()
	}
})
