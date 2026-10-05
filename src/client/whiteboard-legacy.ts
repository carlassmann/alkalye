import { b64Vecs, getIndices, toRichText } from "tldraw"
import type { Point, Shape } from "../shared/legacy-drawing"
import {
	legacyBounds,
	legacyShapes,
	legacyTextSize,
} from "../shared/legacy-drawing"

let terminals: ("start" | "end")[] = ["start", "end"]

// Rebuilds a pre-tldraw drawing as tldraw document records. Identities come
// from the legacy register keys, so converting the same fields twice yields the
// same records and peers that convert independently agree.
export function legacyRecords(fields: Record<string, string>) {
	let shapes = legacyShapes(fields)
	let records = new Map<string, Record<string, unknown>>()
	let page = "page:page"
	records.set("document:document", {
		id: "document:document",
		typeName: "document",
		gridSize: 10,
		name: "",
		meta: {},
	})
	records.set(page, {
		id: page,
		typeName: "page",
		name: "Page 1",
		index: "a1",
		meta: {},
	})
	let ids = new Map([...shapes.keys()].map(key => [key, legacyId(key)]))
	let groups = new Map<string, string[]>()
	for (let [key, shape] of shapes)
		if (shape.group)
			groups.set(shape.group, [...(groups.get(shape.group) ?? []), key])
	let indices = getIndices(shapes.size + groups.size)
	let position = 0
	let placed = new Set<string>()
	for (let [key, shape] of shapes) {
		let members = shape.group ? (groups.get(shape.group) ?? []) : []
		let parent = page
		if (members.length > 1 && shape.group) {
			parent = "shape:legacy-group-" + safe(shape.group)
			if (!placed.has(parent)) {
				placed.add(parent)
				records.set(parent, {
					...base(parent, page, indices[position++] ?? "a1", { x: 0, y: 0 }, 0),
					type: "group",
					props: {},
				})
			}
		}
		let id = ids.get(key) ?? legacyId(key)
		let record = shapeRecord(id, parent, indices[position++] ?? "a1", shape)
		records.set(id, record)
		if (shape.kind !== "arrow") continue
		for (let terminal of terminals) {
			let binding = shape[terminal]
			let target = binding && ids.get(binding.shape)
			if (!binding || !target || target === id) continue
			let bindingId = "binding:legacy-" + safe(key) + "-" + terminal
			records.set(bindingId, {
				id: bindingId,
				typeName: "binding",
				type: "arrow",
				fromId: id,
				toId: target,
				props: {
					terminal,
					normalizedAnchor: { x: binding.x, y: binding.y },
					isExact: false,
					isPrecise: true,
					snap: "none",
				},
				meta: {},
			})
		}
	}
	return new Map(
		[...records].map(([id, record]) => [id, JSON.stringify(record)]),
	)
}

function shapeRecord(id: string, parent: string, index: string, shape: Shape) {
	let color = nearestColor(shape.color)
	let size = sizeOf(shape.width)
	let dash = shape.dash ?? "solid"
	let bounds = legacyBounds(shape)
	let first = shape.points[0] ?? { x: 0, y: 0 }
	if (shape.kind === "pen") {
		let pen = Boolean(shape.pressure)
		return {
			...base(id, parent, index, bounds, 0),
			type: "draw",
			props: {
				color,
				fill: "none",
				dash: shape.dash ?? "draw",
				size,
				segments: [
					{
						type: "free",
						path: b64Vecs.encodePoints(
							shape.points.map((point, at) => ({
								x: point.x - bounds.x,
								y: point.y - bounds.y,
								z: shape.pressure?.[at] ?? 0.5,
							})),
							3,
						),
					},
				],
				isComplete: true,
				isClosed: false,
				isPen: pen,
				scale: 1,
				scaleX: 1,
				scaleY: 1,
			},
		}
	}
	if (shape.kind === "rectangle" || shape.kind === "ellipse") {
		let rotation = shape.rotation ?? 0
		let corner = rotate(
			{ x: bounds.x, y: bounds.y },
			{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
			rotation,
		)
		return {
			...base(id, parent, index, corner, rotation),
			type: "geo",
			props: {
				geo: shape.kind === "rectangle" ? "rectangle" : "ellipse",
				dash,
				url: "",
				w: bounds.width,
				h: bounds.height,
				growY: 0,
				scale: 1,
				labelColor: color,
				color,
				fill: !shape.fill
					? "none"
					: shape.fill === shape.color
						? "solid"
						: "semi",
				size,
				font: "sans",
				align: "middle",
				verticalAlign: "middle",
				richText: toRichText(shape.text),
			},
		}
	}
	if (shape.kind === "line") {
		let indices = getIndices(shape.points.length)
		return {
			...base(id, parent, index, first, 0),
			type: "line",
			props: {
				color,
				dash,
				size,
				spline: "line",
				scale: 1,
				points: Object.fromEntries(
					shape.points.map((point, at) => {
						let key = indices[at] ?? "a1"
						return [
							key,
							{
								id: key,
								index: key,
								x: point.x - first.x,
								y: point.y - first.y,
							},
						]
					}),
				),
			},
		}
	}
	if (shape.kind === "arrow") {
		let last = shape.points.at(-1) ?? first
		return {
			...base(id, parent, index, first, 0),
			type: "arrow",
			props: {
				kind: "arc",
				labelColor: color,
				color,
				fill: "none",
				dash,
				size,
				arrowheadStart: "none",
				arrowheadEnd: "arrow",
				font: "sans",
				start: { x: 0, y: 0 },
				end: { x: last.x - first.x, y: last.y - first.y },
				bend: 0,
				richText: toRichText(shape.text),
				labelPosition: 0.5,
				scale: 1,
				elbowMidPoint: 0.5,
			},
		}
	}
	return {
		...base(id, parent, index, first, shape.rotation ?? 0),
		type: "text",
		props: {
			color,
			size: sizeOf(legacyTextSize(shape) / 5),
			font: "sans",
			textAlign: "start",
			w: bounds.width,
			richText: toRichText(shape.text),
			scale: 1,
			autoSize: true,
		},
	}
}

function base(
	id: string,
	parentId: string,
	index: string,
	at: Point,
	rotation: number,
) {
	return {
		id,
		typeName: "shape",
		parentId,
		index,
		x: at.x,
		y: at.y,
		rotation,
		isLocked: false,
		opacity: 1,
		meta: {},
	}
}

function rotate(point: Point, center: Point, angle: number) {
	if (!angle) return point
	let cos = Math.cos(angle),
		sin = Math.sin(angle),
		x = point.x - center.x,
		y = point.y - center.y
	return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }
}

function legacyId(key: string) {
	return "shape:legacy-" + safe(key)
}

function safe(value: string) {
	return value.replace(/[^\w-]/g, "-")
}

function sizeOf(width: number) {
	return width <= 3 ? "s" : width <= 6 ? "m" : width <= 10 ? "l" : "xl"
}

// tldraw draws with named colours; a legacy hex keeps the closest one.
let palette: [string, string][] = [
	["black", "#1d1d1d"],
	["grey", "#9fa8b2"],
	["light-violet", "#e085f4"],
	["violet", "#ae3ec9"],
	["blue", "#4465e9"],
	["light-blue", "#4ba1f1"],
	["yellow", "#f1ac4b"],
	["orange", "#e16919"],
	["green", "#099268"],
	["light-green", "#4cb05e"],
	["light-red", "#f87777"],
	["red", "#e03131"],
	["white", "#ffffff"],
]

function nearestColor(hex: string) {
	let [r, g, b] = channels(hex)
	let best = "black",
		distance = Infinity
	for (let [name, value] of palette) {
		let [red, green, blue] = channels(value)
		let current = (r - red) ** 2 + (g - green) ** 2 + (b - blue) ** 2
		if (current < distance) {
			best = name
			distance = current
		}
	}
	return best
}

function channels(hex: string): [number, number, number] {
	let channel = (at: number) => parseInt(hex.slice(at, at + 2), 16) || 0
	return [channel(1), channel(3), channel(5)]
}
