import { expect, test } from "bun:test"
import { Replica } from "../src/shared/crdt"
import type { Shape } from "../src/shared/drawing"
import {
	drawingOrder,
	orderedDrawing,
	resizeShape,
	shapeBounds,
} from "../src/shared/drawing"
import { importDrawing } from "../src/shared/drawing-import"
import { parseOperation, parseRole, parseRoom } from "../src/shared/model"

function drawing(shapes: unknown[]) {
	return {
		tldrawFileFormatVersion: 1,
		records: [{ id: "page:one", typeName: "page" }, ...shapes],
	}
}

test("drawing import flattens rotated groups and preserves rich text spaces", () => {
	let imported = importDrawing(
		drawing([
			{
				id: "shape:group",
				typeName: "shape",
				type: "group",
				parentId: "page:one",
				index: "a1",
				x: 100,
				y: 50,
				rotation: Math.PI / 2,
				props: {},
			},
			{
				id: "shape:rect",
				typeName: "shape",
				type: "geo",
				parentId: "shape:group",
				index: "a2",
				x: 10,
				y: 0,
				props: {
					geo: "rectangle",
					w: 20,
					h: 10,
					color: "red",
					richText: {
						type: "doc",
						content: [
							{
								type: "paragraph",
								content: [
									{ type: "text", text: "Hello " },
									{ type: "text", text: "world" },
								],
							},
						],
					},
				},
			},
		]),
	)
	expect(imported[1]?.text).toBe("Hello world")
	expect(imported[0]?.kind).toBe("pen")
	expect(imported[0]?.points[0]?.x).toBeCloseTo(100)
	expect(imported[0]?.points[0]?.y).toBeCloseTo(60)
	expect(imported[0]?.points[2]?.x).toBeCloseTo(90)
	expect(imported[0]?.points[2]?.y).toBeCloseTo(80)
	expect(
		importDrawing({ format: "alkalye-drawing-v1", shapes: imported }),
	).toEqual(imported)
})

test("drawing import rejects unsupported content before creating a document", () => {
	expect(() =>
		importDrawing(drawing([{ id: "asset:a", typeName: "asset" }])),
	).toThrow("Embedded media")
	expect(() =>
		importDrawing({ tldrawFileFormatVersion: 1, records: [] }),
	).toThrow("one page")
})

test("drawing import decodes native delta paths", () => {
	let bytes = new Uint8Array(12),
		view = new DataView(bytes.buffer)
	view.setFloat32(0, 10, true)
	view.setFloat32(4, 20, true)
	view.setUint16(8, 0x4000, true)
	view.setUint16(10, 0x4200, true)
	let path = btoa(String.fromCharCode(...bytes))
	let imported = importDrawing(
		drawing([
			{
				id: "shape:draw",
				typeName: "shape",
				type: "draw",
				parentId: "page:one",
				index: "a1",
				x: 0,
				y: 0,
				props: { segments: [{ dim: 2, path }] },
			},
		]),
	)
	expect(imported[0]?.points).toEqual([
		{ x: 10, y: 20 },
		{ x: 12, y: 23 },
	])
})

test("untrusted identifiers and workspace roles reject markup and unknown authority", () => {
	let replica = new Replica("writer")
	let before = replica.checkpoint()
	expect(() => replica.set('doc"><img src=x>', "title", "Title")).toThrow()
	expect(replica.checkpoint()).toEqual(before)
	let operation = replica.create("document", "set")
	expect(() =>
		parseOperation({
			...operation,
			target: 'doc"><img src=x>',
			field: "title",
			value: "Title",
		}),
	).toThrow()
	expect(() =>
		parseRoom({
			id: "<option selected>",
			key: "",
			read: "",
			write: "",
			admin: "",
			name: "",
			local: true,
		}),
	).toThrow()
	expect(() => parseRole("owner")).toThrow()
	expect(parseRole("manager")).toBe("manager")
})

test("templates escape text and attributes while allowing explicit markup", async () => {
	let { html, rawMarkup } = await import("../src/shared/html")
	let text = '\"><img src=x onerror=alert(1)>'
	expect(
		String(html`<button data-doc="${text}">${text}</button>`),
	).not.toContain("<img")
	expect(
		String(html`<div>${rawMarkup(html`<strong>${text}</strong>`)}</div>`),
	).toContain("<strong>&quot;&gt;&lt;img")
})

test("drawing layers preserve import order, with new shapes above legacy shapes", () => {
	let shape: Shape = {
		kind: "rectangle",
		color: "#000000",
		width: 2,
		points: [
			{ x: 0, y: 0 },
			{ x: 10, y: 10 },
		],
		text: "",
	}
	let first = { ...shape, order: drawingOrder(8, "actor", 0) },
		second = { ...shape, order: drawingOrder(8, "actor", 1) }
	let entries: [string, Shape][] = [
		["shape:a", second],
		["stroke:z", shape],
		["shape:z", first],
	]
	expect([...orderedDrawing(new Map(entries)).keys()]).toEqual([
		"stroke:z",
		"shape:z",
		"shape:a",
	])
	expect([...orderedDrawing(new Map(entries.reverse())).keys()]).toEqual([
		"stroke:z",
		"shape:z",
		"shape:a",
	])
})

test("resizing preserves its anchor and the original undo snapshot", () => {
	let shape: Shape = {
		kind: "rectangle",
		color: "#000000",
		width: 2,
		text: "",
		points: [
			{ x: 20, y: 30 },
			{ x: 120, y: 80 },
		],
	}
	let resized = resizeShape(shape, 200, 100)
	expect(shapeBounds(resized)).toEqual({
		x: 20,
		y: 30,
		width: 200,
		height: 100,
	})
	expect(shape.points[1]).toEqual({ x: 120, y: 80 })
	expect(resizeShape({ ...shape, kind: "text" }, 100000, 100000).width).toBe(
		100,
	)
})
