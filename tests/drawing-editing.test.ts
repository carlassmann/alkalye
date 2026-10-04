import { expect, test } from "bun:test"
import {
	fitBounds,
	nextZoomStop,
	panBy,
	screenToWorld,
	worldToScreen,
	zoomAt,
} from "../src/client/drawing-camera"
import type { Shape } from "../src/shared/drawing"
import {
	drawingOrder,
	orderBelow,
	orderedDrawing,
	parseShape,
	resizeBounds,
	scaleShape,
	shapeBounds,
	shapesInBounds,
	tintColor,
} from "../src/shared/drawing"

function shape(points: Shape["points"], extra: Partial<Shape> = {}): Shape {
	return {
		kind: "rectangle",
		color: "#1d1d1d",
		width: 4,
		points,
		text: "",
		...extra,
	}
}

test("a multiple selection resizes as one box", () => {
	let left = shape([
			{ x: 0, y: 0 },
			{ x: 10, y: 10 },
		]),
		right = shape([
			{ x: 90, y: 40 },
			{ x: 100, y: 50 },
		])
	let from = { x: 0, y: 0, width: 100, height: 50 }
	let to = resizeBounds(from, "se", { x: 100, y: 50 })
	expect(to).toEqual({ x: 0, y: 0, width: 200, height: 100 })
	expect(shapeBounds(scaleShape(left, from, to))).toEqual({
		x: 0,
		y: 0,
		width: 20,
		height: 20,
	})
	expect(shapeBounds(scaleShape(right, from, to))).toEqual({
		x: 180,
		y: 80,
		width: 20,
		height: 20,
	})
})

test("resizing keeps the opposite corner, a minimum size and optionally the aspect", () => {
	let box = { x: 10, y: 10, width: 100, height: 50 }
	expect(resizeBounds(box, "nw", { x: 500, y: 500 })).toEqual({
		x: 106,
		y: 56,
		width: 4,
		height: 4,
	})
	let kept = resizeBounds(box, "nw", { x: -100, y: 0 }, true)
	expect(kept.width / kept.height).toBeCloseTo(2)
	expect(kept.x + kept.width).toBeCloseTo(110)
	expect(kept.y + kept.height).toBeCloseTo(60)
	expect(resizeBounds(box, "e", { x: 20, y: 99 }, true)).toEqual({
		...box,
		width: 120,
	})
})

test("marquee selection finds every shape it touches", () => {
	let shapes = new Map([
		[
			"shape:a",
			shape([
				{ x: 0, y: 0 },
				{ x: 10, y: 10 },
			]),
		],
		[
			"shape:b",
			shape([
				{ x: 50, y: 50 },
				{ x: 60, y: 60 },
			]),
		],
		[
			"shape:c",
			shape([
				{ x: 200, y: 200 },
				{ x: 210, y: 210 },
			]),
		],
	])
	expect(shapesInBounds(shapes, { x: 5, y: 5, width: 50, height: 50 })).toEqual(
		["shape:a", "shape:b"],
	)
})

test("send to back orders a shape beneath every other shape", () => {
	let shapes = new Map([
		["shape:a", shape([{ x: 0, y: 0 }], { order: drawingOrder(5, "x") })],
		["shape:b", shape([{ x: 0, y: 0 }], { order: drawingOrder(9, "x") })],
	])
	let lowered = shape([{ x: 0, y: 0 }], {
		order: orderBelow(shapes.values(), "y"),
	})
	shapes.set("shape:c", lowered)
	expect([...orderedDrawing(shapes).keys()][0]).toBe("shape:c")
	expect(orderBelow([], "y")).toBe(drawingOrder(0, "y"))
})

test("multiline text measures every line and dashes survive parsing", () => {
	let single = shapeBounds(
		shape([{ x: 0, y: 0 }], { kind: "text", text: "Hi" }),
	)
	let double = shapeBounds(
		shape([{ x: 0, y: 0 }], { kind: "text", text: "Hi\nthere" }),
	)
	expect(double.height).toBeCloseTo(single.height * 2)
	expect(double.width).toBeGreaterThan(single.width)
	let parsed = parseShape(
		JSON.stringify(shape([{ x: 1, y: 2 }], { dash: "dotted" })),
	)
	expect(parsed.dash).toBe("dotted")
	expect(
		parseShape(JSON.stringify({ ...parsed, dash: "wavy" })).dash,
	).toBeUndefined()
})

test("tinted fills stay valid stored colours", () => {
	expect(tintColor("#000000")).toMatch(/^#[a-f\d]{6}$/)
	expect(tintColor("#ffffff")).toBe("#ffffff")
	expect(tintColor("#e03131", 0)).toBe("#e03131")
})

test("zooming keeps the point under the pointer still", () => {
	let camera = { x: -40, y: 25, zoom: 1.5 }
	let pointer = { x: 320, y: 180 }
	let before = screenToWorld(camera, pointer)
	let zoomed = zoomAt(camera, pointer, 3)
	let after = screenToWorld(zoomed, pointer)
	expect(after.x).toBeCloseTo(before.x)
	expect(after.y).toBeCloseTo(before.y)
	expect(zoomAt(camera, pointer, 1000).zoom).toBe(8)
	let point = { x: 12, y: -7 }
	let screen = worldToScreen(zoomed, point)
	expect(screenToWorld(zoomed, screen).x).toBeCloseTo(point.x)
	expect(panBy(camera, { x: 30, y: -15 })).toEqual({ x: -60, y: 35, zoom: 1.5 })
})

test("fitting centres content without magnifying small drawings", () => {
	let viewport = { width: 800, height: 600 }
	let small = fitBounds({ x: 100, y: 100, width: 50, height: 50 }, viewport)
	expect(small.zoom).toBe(1)
	let center = worldToScreen(small, { x: 125, y: 125 })
	expect(center).toEqual({ x: 400, y: 300 })
	let large = fitBounds({ x: 0, y: 0, width: 4000, height: 1000 }, viewport)
	expect(large.zoom).toBeLessThan(1)
	expect(fitBounds(undefined, viewport)).toEqual({ x: 0, y: 0, zoom: 1 })
	expect(nextZoomStop(1, 1)).toBe(1.5)
	expect(nextZoomStop(1, -1)).toBe(0.75)
	expect(nextZoomStop(8, 1)).toBe(8)
})
