import { expect, test } from "bun:test"
import type { Point, Shape } from "../src/shared/drawing"
import {
	drawingShapes,
	flipShape,
	localBounds,
	normalizeAngle,
	parseShape,
	resizeRotatedShape,
	rotateShape,
	scaleShape,
	shapeBounds,
	shapeCenter,
	shapeCorners,
	toLocal,
	toWorld,
	wrapText,
} from "../src/shared/drawing"
import {
	bindingAt,
	boundArrows,
	clipToOutline,
	keepBindings,
	releaseArrows,
	resolveArrow,
	resolveDrawing,
} from "../src/shared/drawing-arrows"
import {
	clipboardText,
	drawingDocument,
	rekeyShapes,
} from "../src/shared/drawing-clipboard"
import {
	importDrawing,
	importDrawingEntries,
} from "../src/shared/drawing-import"
import { hasPressure, strokeOutline } from "../src/shared/drawing-ink"
import {
	alignmentOffsets,
	distributionOffsets,
	snapBounds,
} from "../src/shared/drawing-layout"
import { contrastInk, inkColor } from "../src/shared/drawing-palette"

function box(
	x: number,
	y: number,
	width: number,
	height: number,
	extra: Partial<Shape> = {},
): Shape {
	return {
		kind: "rectangle",
		color: "#1d1d1d",
		width: 4,
		text: "",
		points: [
			{ x, y },
			{ x: x + width, y: y + height },
		],
		...extra,
	}
}
function arrow(from: Point, to: Point, extra: Partial<Shape> = {}): Shape {
	return {
		kind: "arrow",
		color: "#1d1d1d",
		width: 2,
		text: "",
		points: [from, to],
		...extra,
	}
}
function close(actual: Point | undefined, expected: Point, digits = 6) {
	expect(actual?.x).toBeCloseTo(expected.x, digits)
	expect(actual?.y).toBeCloseTo(expected.y, digits)
}

test("legacy shapes decode exactly as before, without new fields", () => {
	let legacy = parseShape(
		JSON.stringify({
			color: "#e03131",
			width: 3,
			points: "1,2 3,4",
		}),
	)
	expect(legacy).toEqual({
		kind: "pen",
		color: "#e03131",
		width: 3,
		points: [
			{ x: 1, y: 2 },
			{ x: 3, y: 4 },
		],
		text: "",
	})
	expect(Object.keys(legacy).sort()).toEqual(
		[
			"color",
			"dash",
			"fill",
			"kind",
			"order",
			"points",
			"text",
			"width",
		].sort(),
	)
	expect(JSON.parse(JSON.stringify(legacy))).toEqual({
		kind: "pen",
		color: "#e03131",
		width: 3,
		points: [
			{ x: 1, y: 2 },
			{ x: 3, y: 4 },
		],
		text: "",
	})
})

test("new optional fields survive parsing and malformed ones are dropped", () => {
	let full = parseShape(
		JSON.stringify({
			...arrow({ x: 0, y: 0 }, { x: 10, y: 0 }),
			start: { shape: "shape:a", x: 0.25, y: 2 },
			end: { shape: "shape:b", x: 0.5, y: 0.5 },
			group: "group:one",
			text: "label",
		}),
	)
	expect(full.start).toEqual({ shape: "shape:a", x: 0.25, y: 1 })
	expect(full.end).toEqual({ shape: "shape:b", x: 0.5, y: 0.5 })
	expect(full.group).toBe("group:one")
	expect(parseShape(JSON.stringify(full))).toEqual(full)

	let malformed = parseShape(
		JSON.stringify({
			...box(0, 0, 10, 10),
			rotation: "quarter",
			start: { shape: "shape:a", x: 0, y: 0 },
			group: "has spaces",
			pressure: [0.5, 0.5],
		}),
	)
	expect(malformed.rotation).toBeUndefined()
	expect(malformed.start).toBeUndefined()
	expect(malformed.group).toBeUndefined()
	expect(malformed.pressure).toBeUndefined()

	let pen = parseShape(
		JSON.stringify({
			kind: "pen",
			color: "#1d1d1d",
			width: 4,
			points: [
				{ x: 0, y: 0 },
				{ x: 4, y: 0 },
			],
			rotation: 1,
			pressure: [0.12345, 3],
			start: { shape: "shape:a", x: 0, y: 0 },
		}),
	)
	expect(pen.rotation).toBeUndefined()
	expect(pen.start).toBeUndefined()
	expect(pen.pressure).toEqual([0.123, 1])
	expect(
		parseShape(JSON.stringify({ ...pen, pressure: [0.5] })).pressure,
	).toBeUndefined()
	expect(
		parseShape(
			JSON.stringify({
				...arrow({ x: 0, y: 0 }, { x: 1, y: 1 }),
				start: { shape: '"><img>', x: 0, y: 0 },
			}),
		).start,
	).toBeUndefined()
	expect(
		parseShape(JSON.stringify({ ...box(0, 0, 4, 4), rotation: Math.PI * 4 }))
			.rotation,
	).toBeUndefined()
	expect(
		parseShape(JSON.stringify({ ...box(0, 0, 4, 4), rotation: Math.PI * 1.5 }))
			.rotation,
	).toBeCloseTo(-Math.PI / 2)
})

test("an unreadable register leaves the rest of the board readable", () => {
	let shapes = drawingShapes({
		"shape:good": JSON.stringify(box(0, 0, 10, 10, { rotation: 0.5 })),
		"shape:bad": "{",
		"stroke:legacy": JSON.stringify({
			color: "#000000",
			width: 2,
			points: "0,0 1,1",
		}),
		name: "Whiteboard",
	})
	expect([...shapes.keys()].sort()).toEqual(["shape:good", "stroke:legacy"])
	expect(shapes.get("shape:good")?.rotation).toBeCloseTo(0.5)
})

test("rotation turns boxes around their centre and text around its anchor", () => {
	let rectangle = box(0, 0, 100, 40)
	let turned = rotateShape(rectangle, { x: 50, y: 20 }, Math.PI / 2)
	expect(turned.points).toEqual(rectangle.points)
	expect(turned.rotation).toBeCloseTo(Math.PI / 2)
	let bounds = shapeBounds(turned)
	expect(bounds.x).toBeCloseTo(30)
	expect(bounds.y).toBeCloseTo(-30)
	expect(bounds.width).toBeCloseTo(40)
	expect(bounds.height).toBeCloseTo(100)
	expect(localBounds(turned)).toEqual(localBounds(rectangle))

	let around = rotateShape(rectangle, { x: 0, y: 0 }, Math.PI)
	close(shapeCenter(around), { x: -50, y: -20 })
	expect(Math.abs(around.rotation ?? 0)).toBeCloseTo(Math.PI)
	expect(rotateShape(turned, { x: 50, y: 20 }, -Math.PI / 2).rotation).toBe(
		undefined,
	)

	let point = { x: 13, y: -7 }
	close(toLocal(turned, toWorld(turned, point)), point)

	let text: Shape = {
		kind: "text",
		color: "#1d1d1d",
		width: 4,
		text: "Hi",
		points: [{ x: 10, y: 10 }],
	}
	let spun = rotateShape(text, { x: 10, y: 10 }, 1)
	expect(spun.points[0]).toEqual({ x: 10, y: 10 })
	expect(toWorld(spun, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 })
	let longer = { ...spun, text: "Hi there, much longer" }
	close(toWorld(longer, { x: 10, y: 10 }), { x: 10, y: 10 })

	let stroke: Shape = {
		kind: "pen",
		color: "#1d1d1d",
		width: 4,
		text: "",
		points: [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		],
		pressure: [0.2, 0.8],
	}
	let rotatedStroke = rotateShape(stroke, { x: 0, y: 0 }, Math.PI / 2)
	expect(rotatedStroke.rotation).toBeUndefined()
	close(rotatedStroke.points[1], { x: 0, y: 10 })
	expect(rotatedStroke.pressure).toEqual([0.2, 0.8])
	expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(-Math.PI)
	expect(normalizeAngle(-Math.PI / 4)).toBeCloseTo(-Math.PI / 4)
})

test("resizing a turned shape keeps its opposite corner fixed on the page", () => {
	let rectangle = box(0, 0, 100, 50, { rotation: Math.PI / 6 })
	let before = shapeCorners(rectangle)
	let resized = resizeRotatedShape(rectangle, "se", { x: 40, y: 30 })
	let after = shapeCorners(resized)
	close(after[0], before[0] ?? { x: 0, y: 0 })
	expect(resized.rotation).toBeCloseTo(Math.PI / 6)
	let local = localBounds(resized)
	let expected = {
		x: 40 * Math.cos(-Math.PI / 6) - 30 * Math.sin(-Math.PI / 6),
		y: 40 * Math.sin(-Math.PI / 6) + 30 * Math.cos(-Math.PI / 6),
	}
	expect(local.width).toBeCloseTo(100 + expected.x)
	expect(local.height).toBeCloseTo(50 + expected.y)

	let west = resizeRotatedShape(rectangle, "w", { x: -20, y: 0 })
	let fixed = (corners: Point[]) => ({
		x: ((corners[1]?.x ?? 0) + (corners[2]?.x ?? 0)) / 2,
		y: ((corners[1]?.y ?? 0) + (corners[2]?.y ?? 0)) / 2,
	})
	close(fixed(shapeCorners(west)), fixed(before))

	let aspect = resizeRotatedShape(rectangle, "ne", { x: 60, y: -10 }, true)
	let aspectBounds = localBounds(aspect)
	expect(aspectBounds.width / aspectBounds.height).toBeCloseTo(2)
	close(shapeCorners(aspect)[3], before[3] ?? { x: 0, y: 0 })
})

test("scaling a selection moves turned shapes by their centre", () => {
	let rectangle = box(0, 0, 20, 10, { rotation: 0.4 })
	let from = { x: 0, y: -10, width: 40, height: 40 }
	let to = { x: 100, y: -10, width: 80, height: 80 }
	let scaled = scaleShape(rectangle, from, to)
	close(shapeCenter(scaled), { x: 120, y: 20 })
	expect(scaled.rotation).toBeCloseTo(0.4)
	expect(localBounds(scaled).width).toBeCloseTo(40)
	expect(localBounds(scaled).height).toBeCloseTo(20)
})

test("flipping mirrors shapes, turns and arrow anchors", () => {
	let rectangle = box(10, 0, 20, 10, { rotation: 0.3 })
	let flipped = flipShape(rectangle, { x: 0, y: 0 }, "horizontal")
	close(shapeCenter(flipped), { x: -20, y: 5 })
	expect(flipped.rotation).toBeCloseTo(-0.3)
	let attached = arrow(
		{ x: 0, y: 0 },
		{ x: 10, y: 10 },
		{ start: { shape: "shape:a", x: 0.2, y: 0.9 } },
	)
	let vertical = flipShape(attached, { x: 0, y: 5 }, "vertical")
	expect(vertical.start).toEqual({ shape: "shape:a", x: 0.2, y: 1 - 0.9 })
	close(vertical.points[1], { x: 10, y: 0 })
	let text: Shape = {
		kind: "text",
		color: "#1d1d1d",
		width: 4,
		text: "Readable",
		points: [{ x: 10, y: 0 }],
	}
	let mirrored = flipShape(text, { x: 0, y: 0 }, "horizontal")
	expect(mirrored.text).toBe("Readable")
	close(shapeCenter(mirrored), {
		x: -shapeCenter(text).x,
		y: shapeCenter(text).y,
	})
})

test("bound arrows end on their targets' outlines and follow them", () => {
	let shapes = new Map<string, Shape>([
		["shape:a", box(0, 0, 100, 100)],
		["shape:b", box(300, 0, 100, 100)],
		[
			"shape:arrow",
			arrow(
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
				{
					start: { shape: "shape:a", x: 0.5, y: 0.5 },
					end: { shape: "shape:b", x: 0.5, y: 0.5 },
				},
			),
		],
	])
	let resolved = resolveDrawing(shapes).get("shape:arrow")
	close(resolved?.points[0], { x: 102, y: 50 })
	close(resolved?.points[1], { x: 298, y: 50 })
	expect(resolved?.start).toEqual(shapes.get("shape:arrow")?.start)

	shapes.set("shape:b", box(300, 300, 100, 100))
	let moved = resolveDrawing(shapes).get("shape:arrow")
	let [from, to] = moved?.points ?? []
	expect(from?.x).toBeGreaterThan(100)
	expect(from?.y).toBeGreaterThan(100 - 1e-6)
	expect(to?.x).toBeLessThan(300 + 1e-6)
	expect(to?.y).toBeLessThan(300 + 1e-6)

	shapes.set("shape:b", box(300, 0, 100, 100, { rotation: Math.PI / 4 }))
	let turned = resolveDrawing(shapes).get("shape:arrow")
	close(turned?.points[1], { x: 350 - 50 * Math.SQRT2 - 2, y: 50 })

	shapes.delete("shape:a")
	shapes.delete("shape:b")
	expect(resolveDrawing(shapes).get("shape:arrow")?.points).toEqual([
		{ x: 0, y: 0 },
		{ x: 1, y: 1 },
	])
})

test("arrows clip to ellipses and honour precise anchors", () => {
	let ellipse: Shape = { ...box(0, 0, 200, 100), kind: "ellipse" }
	let end = clipToOutline({ x: -100, y: -100 }, { x: 100, y: 50 }, ellipse)
	let x = ((end.x - 100) / 100) ** 2 + ((end.y - 50) / 50) ** 2
	expect(x).toBeCloseTo(1, 6)
	let inside = clipToOutline({ x: 90, y: 50 }, { x: 100, y: 50 }, ellipse)
	expect(inside).toEqual({ x: 100, y: 50 })
	let shapes = new Map<string, Shape>([
		["shape:a", box(0, 0, 100, 100)],
		[
			"shape:arrow",
			arrow(
				{ x: 200, y: 25 },
				{ x: 0, y: 0 },
				{ end: { shape: "shape:a", x: 0.75, y: 0.25 } },
			),
		],
	])
	let resolved = resolveDrawing(shapes).get("shape:arrow")
	close(resolved?.points[1], { x: 102, y: 25 })
	let self = new Map<string, Shape>([
		[
			"shape:self",
			arrow(
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{
					end: { shape: "shape:self", x: 0.5, y: 0.5 },
				},
			),
		],
	])
	expect(resolveDrawing(self).get("shape:self")?.points).toEqual([
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
	])
})

test("binding finds the topmost target and releases arrows from deleted shapes", () => {
	let shapes = new Map<string, Shape>([
		["shape:below", box(0, 0, 100, 100)],
		["shape:above", box(50, 50, 100, 100, { rotation: Math.PI / 4 })],
		[
			"shape:line",
			{ ...arrow({ x: 0, y: 0 }, { x: 10, y: 10 }), kind: "line" },
		],
	])
	expect(bindingAt(shapes, { x: 90, y: 90 })).toEqual({
		shape: "shape:above",
		x: 0.5,
		y: 0.5,
	})
	expect(
		bindingAt(shapes, { x: 90, y: 90 }, { exclude: new Set(["shape:above"]) })
			?.shape,
	).toBe("shape:below")
	let precise = bindingAt(shapes, { x: 25, y: 75 }, { precise: true })
	expect(precise).toEqual({ shape: "shape:below", x: 0.25, y: 0.75 })
	expect(bindingAt(shapes, { x: 500, y: 500 })).toBeUndefined()
	expect(bindingAt(shapes, { x: 52, y: 52 })?.shape).toBe("shape:below")

	shapes.set(
		"shape:arrow",
		arrow(
			{ x: 400, y: 50 },
			{ x: 0, y: 0 },
			{
				end: { shape: "shape:below", x: 0.5, y: 0.5 },
			},
		),
	)
	expect([...boundArrows(shapes, new Set(["shape:below"]))]).toEqual([
		"shape:arrow",
	])
	let released = releaseArrows(shapes, new Set(["shape:below"]))
	expect(released).toHaveLength(1)
	let [key, shape] = released[0] ?? []
	expect(key).toBe("shape:arrow")
	expect(shape?.end).toBeUndefined()
	expect(shape?.points[1]?.x).toBeGreaterThan(0)
	expect(
		releaseArrows(shapes, new Set(["shape:below", "shape:arrow"])),
	).toEqual([])
	let kept = keepBindings(
		arrow(
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
			{
				start: { shape: "shape:a", x: 0.5, y: 0.5 },
				end: { shape: "shape:b", x: 0.5, y: 0.5 },
			},
		),
		key => key === "shape:a",
	)
	expect(kept.start?.shape).toBe("shape:a")
	expect(kept.end).toBeUndefined()
	let target = shapes.get("shape:below")
	expect(target && resolveArrow(target, () => undefined)).toBe(target)
})

test("alignment and distribution move whole items", () => {
	let items = new Map([
		["a", { x: 0, y: 0, width: 10, height: 10 }],
		["b", { x: 50, y: 20, width: 30, height: 10 }],
		["c", { x: 200, y: 5, width: 20, height: 40 }],
	])
	expect(alignmentOffsets(items, "left")).toEqual(
		new Map([
			["b", { x: -50, y: 0 }],
			["c", { x: -200, y: 0 }],
		]),
	)
	expect(alignmentOffsets(items, "right").get("a")).toEqual({ x: 210, y: 0 })
	expect(alignmentOffsets(items, "center").get("b")).toEqual({ x: 45, y: 0 })
	expect(alignmentOffsets(items, "top").get("b")).toEqual({ x: 0, y: -20 })
	expect(alignmentOffsets(items, "middle").get("a")).toEqual({
		x: 0,
		y: 17.5,
	})
	expect(alignmentOffsets(items, "bottom").has("c")).toBe(false)
	expect(
		alignmentOffsets(
			new Map([["a", { x: 0, y: 0, width: 1, height: 1 }]]),
			"left",
		).size,
	).toBe(0)
	let spaced = distributionOffsets(items, "horizontal")
	expect(spaced.has("a")).toBe(false)
	expect(spaced.has("c")).toBe(false)
	expect(spaced.get("b")).toEqual({ x: 40, y: 0 })
	let vertical = distributionOffsets(
		new Map([
			["a", { x: 0, y: 0, width: 10, height: 10 }],
			["b", { x: 0, y: 12, width: 10, height: 20 }],
			["c", { x: 0, y: 100, width: 10, height: 10 }],
		]),
		"vertical",
	)
	expect(vertical.get("b")).toEqual({ x: 0, y: 33 })
	expect(
		distributionOffsets(new Map([...items].slice(0, 2)), "vertical").size,
	).toBe(0)
})

test("snapping pulls edges and centres within the threshold and reports guides", () => {
	let targets = [{ x: 100, y: 100, width: 50, height: 50 }]
	let near = snapBounds({ x: 103, y: 300, width: 30, height: 20 }, targets, 8)
	expect(near.offset).toEqual({ x: -3, y: 0 })
	expect(near.guides).toEqual([{ axis: "x", at: 100, from: 100, to: 320 }])
	let centre = snapBounds({ x: 112, y: 112, width: 20, height: 20 }, targets, 8)
	expect(centre.offset).toEqual({ x: 3, y: 3 })
	expect(centre.guides.map(guide => guide.axis).sort()).toEqual(["x", "y"])
	let far = snapBounds({ x: 300, y: 300, width: 20, height: 20 }, targets, 8)
	expect(far).toEqual({ offset: { x: 0, y: 0 }, guides: [] })
	let aligned = snapBounds(
		{ x: 100, y: 300, width: 20, height: 20 },
		targets,
		8,
	)
	expect(aligned.offset).toEqual({ x: 0, y: 0 })
	expect(aligned.guides).toHaveLength(1)
	let edge = snapBounds({ x: 0, y: 0, width: 96, height: 20 }, targets, 8, {
		x: [1],
		y: [],
	})
	expect(edge.offset).toEqual({ x: 4, y: 0 })
})

test("pressure widens and narrows a stroke's outline", () => {
	let points = Array.from({ length: 11 }, (_, index) => ({
		x: index * 10,
		y: 0,
	}))
	let light = strokeOutline(
		points,
		points.map(() => 0.1),
		10,
	)
	let heavy = strokeOutline(
		points,
		points.map(() => 0.9),
		10,
	)
	let thickness = (outline: Point[]) =>
		Math.max(...outline.map(point => point.y)) -
		Math.min(...outline.map(point => point.y))
	expect(thickness(heavy)).toBeGreaterThan(thickness(light) * 3)
	let tapered = strokeOutline(
		points,
		points.map((_, index) => index / 10),
		10,
	)
	let left = tapered.slice(0, 11)
	expect(Math.abs(left[10]?.y ?? 0)).toBeGreaterThan(Math.abs(left[1]?.y ?? 0))
	expect(strokeOutline([{ x: 5, y: 5 }], [0.5], 10)).toHaveLength(12)
	expect(strokeOutline([], [], 10)).toEqual([])
	expect(hasPressure([0.5, 0.5, 0.5])).toBe(false)
	expect(hasPressure([0.2, 0.6])).toBe(true)
	expect(hasPressure(undefined)).toBe(false)
	expect(
		heavy.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)),
	).toBe(true)
})

function lightnessOf(color: string) {
	let channels = [1, 3, 5].map(index =>
		parseInt(color.slice(index, index + 2), 16),
	)
	return (Math.max(...channels) + Math.min(...channels)) / 510
}

test("dark canvases show inks by role while stored colours stay unchanged", () => {
	expect(inkColor("#1d1d1d", false)).toBe("#1d1d1d")
	expect(inkColor("#1d1d1d", true)).toBe("#f2f2f2")
	expect(inkColor("#4465e9", true)).toBe("#4f72fc")
	expect(inkColor("#e03131", true)).toBe("#e03131")
	expect(inkColor("#099268", true)).toBe("#099268")
	expect(lightnessOf(inkColor("#0a0a3a", true))).toBeGreaterThan(0.6)
	expect(
		hasPressure(Array.from({ length: 100_000 }, (_, i) => (i % 7) / 7)),
	).toBe(true)
	let lightness = (color: string) => {
		let channels = [1, 3, 5].map(index =>
			parseInt(color.slice(index, index + 2), 16),
		)
		return (Math.max(...channels) + Math.min(...channels)) / 510
	}
	expect(lightness(inkColor("#34403b", true))).toBeGreaterThan(0.6)
	expect(lightness(inkColor("#fbd5d5", true))).toBeLessThan(0.3)
	expect(inkColor("#ffffff", true)).toBe("#1d1d1d")
	expect(inkColor("#000000", true)).toMatch(/^#[a-f\d]{6}$/)
	expect(inkColor("not a colour", true)).toBe("not a colour")
	expect(contrastInk("#1d1d1d")).toBe("#ffffff")
	expect(contrastInk("#f1ac4b")).toBe("#1d1d1d")
})

test("clipboard documents round trip with fresh keys, bindings and groups", () => {
	let entries: [string, Shape][] = [
		["shape:a", box(0, 0, 10, 10, { group: "group:g", text: "First" })],
		["shape:b", box(20, 0, 10, 10, { group: "group:g" })],
		[
			"shape:arrow",
			arrow(
				{ x: 0, y: 0 },
				{ x: 20, y: 0 },
				{
					start: { shape: "shape:a", x: 0.5, y: 0.5 },
					end: { shape: "shape:outside", x: 0.5, y: 0.5 },
					group: "group:lonely",
					text: "Second",
				},
			),
		],
	]
	let document = JSON.parse(JSON.stringify(drawingDocument(entries)))
	let imported = importDrawingEntries(document)
	expect(imported.map(entry => entry.id)).toEqual([
		"shape:a",
		"shape:b",
		"shape:arrow",
	])
	expect(imported.map(entry => entry.shape)).toEqual(entries.map(([, s]) => s))
	let counter = 0
	let rekeyed = rekeyShapes(
		imported,
		() => `shape:new-${counter++}`,
		() => "group:fresh",
	)
	expect(rekeyed.map(([key]) => key)).toEqual([
		"shape:new-0",
		"shape:new-1",
		"shape:new-2",
	])
	let pasted = new Map(rekeyed)
	expect(pasted.get("shape:new-0")?.group).toBe("group:fresh")
	expect(pasted.get("shape:new-1")?.group).toBe("group:fresh")
	let copiedArrow = pasted.get("shape:new-2")
	expect(copiedArrow?.start?.shape).toBe("shape:new-0")
	expect(copiedArrow?.end).toBeUndefined()
	expect(copiedArrow?.group).toBeUndefined()
	expect(imported[0]?.shape.group).toBe("group:g")
	expect(clipboardText(entries.map(([, shape]) => shape))).toBe("First\nSecond")

	let duplicates = rekeyShapes(
		[
			{ id: "same", shape: box(0, 0, 1, 1) },
			{ id: "same", shape: box(5, 5, 1, 1) },
		],
		() => `shape:${counter++}`,
		() => "group:unused",
	)
	expect(new Set(duplicates.map(([key]) => key)).size).toBe(2)
	expect(
		importDrawingEntries({
			format: "alkalye-drawing-v1",
			shapes: [box(0, 0, 1, 1)],
		})[0]?.id,
	).toBe("import:0")
})

test("tldraw files import rotated boxes, labels and arrow bindings natively", () => {
	let entries = importDrawingEntries({
		tldrawFileFormatVersion: 1,
		records: [
			{ id: "page:one", typeName: "page" },
			{
				id: "shape:box",
				typeName: "shape",
				type: "geo",
				parentId: "page:one",
				index: "a1",
				x: 0,
				y: 0,
				rotation: Math.PI / 2,
				props: { geo: "rectangle", w: 100, h: 50, text: "Inside" },
			},
			{
				id: "shape:oval",
				typeName: "shape",
				type: "geo",
				parentId: "page:one",
				index: "a2",
				x: 300,
				y: 0,
				props: { geo: "ellipse", w: 80, h: 40, fill: "solid", color: "blue" },
			},
			{
				id: "shape:diamond",
				typeName: "shape",
				type: "geo",
				parentId: "page:one",
				index: "a3",
				x: 0,
				y: 300,
				props: { geo: "diamond", w: 40, h: 40, text: "Beside" },
			},
			{
				id: "shape:link",
				typeName: "shape",
				type: "arrow",
				parentId: "page:one",
				index: "a4",
				x: 0,
				y: 0,
				props: {
					start: { x: 0, y: 0 },
					end: { x: 300, y: 0 },
				},
			},
			{
				id: "binding:end",
				typeName: "binding",
				type: "arrow",
				fromId: "shape:link",
				toId: "shape:oval",
				props: {
					terminal: "end",
					normalizedAnchor: { x: 0.1, y: 0.9 },
					isPrecise: false,
				},
			},
			{
				id: "binding:start",
				typeName: "binding",
				type: "arrow",
				fromId: "shape:link",
				toId: "shape:diamond",
				props: {
					terminal: "start",
					normalizedAnchor: { x: 0.3, y: 0.3 },
					isPrecise: true,
				},
			},
			{
				id: "shape:words",
				typeName: "shape",
				type: "text",
				parentId: "page:one",
				index: "a5",
				x: 10,
				y: 10,
				rotation: 0.5,
				props: { text: "Turned", size: "m" },
			},
		],
	})
	let byId = new Map(entries.map(entry => [entry.id, entry.shape]))
	let rectangle = byId.get("shape:box")
	expect(rectangle?.kind).toBe("rectangle")
	expect(rectangle?.text).toBe("Inside")
	expect(rectangle?.rotation).toBeCloseTo(Math.PI / 2)
	close(rectangle ? shapeCorners(rectangle)[0] : undefined, { x: 0, y: 0 })
	let oval = byId.get("shape:oval")
	expect(oval?.kind).toBe("ellipse")
	expect(oval?.fill).toBe(oval?.color)
	expect(byId.get("shape:diamond")?.kind).toBe("pen")
	expect(byId.get("shape:diamond:label")?.text).toBe("Beside")
	let link = byId.get("shape:link")
	expect(link?.end).toEqual({ shape: "shape:oval", x: 0.5, y: 0.5 })
	expect(link?.start).toBeUndefined()
	expect(byId.get("shape:words")?.rotation).toBeCloseTo(0.5)
	let rekeyed = rekeyShapes(
		entries,
		() => crypto.randomUUID(),
		() => "g",
	)
	let placed = new Map(rekeyed)
	let [arrowKey] = [...placed].find(([, shape]) => shape.kind === "arrow") ?? []
	let ovalKey = [...placed].find(([, shape]) => shape.kind === "ellipse")?.[0]
	expect(arrowKey && placed.get(arrowKey)?.end?.shape).toBe(ovalKey)
	expect(importDrawing({ format: "alkalye-drawing-v1", shapes: [] })).toEqual(
		[],
	)
})

test("labels wrap by words, break long words and keep explicit lines", () => {
	let measure = (line: string) => line.length * 10
	expect(wrapText("one two three", 80, measure)).toEqual(["one two", "three"])
	expect(wrapText("abcdefghijkl", 50, measure)).toEqual([
		"abcde",
		"fghij",
		"kl",
	])
	expect(wrapText("first\n\nthird", 500, measure)).toEqual([
		"first",
		"",
		"third",
	])
	expect(wrapText("", 100, measure)).toEqual([""])
})
