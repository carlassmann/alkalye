import { number, object, string } from "./model"

export type DrawingTool =
	| "select"
	| "pen"
	| "rectangle"
	| "ellipse"
	| "line"
	| "arrow"
	| "text"
	| "eraser"
	| "pan"
export type ShapeDash = "dashed" | "dotted"
export interface Point {
	x: number
	y: number
}
export interface Bounds {
	x: number
	y: number
	width: number
	height: number
}
export interface Shape {
	kind: "pen" | "rectangle" | "ellipse" | "line" | "arrow" | "text"
	color: string
	width: number
	points: Point[]
	text: string
	fill?: string
	dash?: ShapeDash
	order?: string
}

export function parseShape(source: string): Shape {
	let value = object(JSON.parse(source))
	let kind = value.kind ?? "pen"
	if (
		kind !== "pen" &&
		kind !== "rectangle" &&
		kind !== "ellipse" &&
		kind !== "line" &&
		kind !== "arrow" &&
		kind !== "text"
	)
		throw new Error("Unknown drawing shape")
	let color = string(value.color)
	if (!/^#[a-f\d]{6}$/i.test(color)) throw new Error("Invalid drawing color")
	let width = number(value.width)
	if (width < 1 || width > 100) throw new Error("Invalid drawing width")
	let points =
		typeof value.points === "string"
			? value.points
					.split(" ")
					.filter(Boolean)
					.map(pair => {
						let [x, y] = pair.split(",").map(Number)
						return { x: number(x), y: number(y) }
					})
			: Array.isArray(value.points)
				? value.points.map(point => {
						let record = object(point)
						return { x: number(record.x), y: number(record.y) }
					})
				: []
	if (!points.length || points.length > 100_000)
		throw new Error("Invalid drawing points")
	let fill = value.fill === undefined ? undefined : string(value.fill)
	if (fill && !/^#[a-f\d]{6}$/i.test(fill))
		throw new Error("Invalid drawing fill")
	return {
		order: typeof value.order === "string" ? value.order : undefined,
		fill,
		dash:
			value.dash === "dashed" || value.dash === "dotted"
				? value.dash
				: undefined,
		kind,
		color,
		width,
		points,
		text: typeof value.text === "string" ? value.text : "",
	}
}

export function drawingOrder(clock: number, actor: string, index = 0) {
	return `${String(clock).padStart(16, "0")}:${actor}:${String(index).padStart(8, "0")}`
}

// Orders begin with the zero-padded clock that created them, so stepping that
// clock down places a shape beneath everything ordered after it.
export function orderBelow(shapes: Iterable<Shape>, actor: string, index = 0) {
	let lowest = Infinity
	for (let shape of shapes) {
		let clock = Number(shape.order?.slice(0, 16))
		if (Number.isFinite(clock)) lowest = Math.min(lowest, clock)
	}
	let clock = Number.isFinite(lowest) ? Math.max(0, lowest - 1) : 0
	return drawingOrder(clock, actor, index)
}

export function orderedDrawing(shapes: Map<string, Shape>) {
	return new Map(
		[...shapes].sort(([a, first], [b, second]) => {
			let left = first.order ?? "",
				right = second.order ?? ""
			return left < right ? -1 : left > right ? 1 : a < b ? -1 : a > b ? 1 : 0
		}),
	)
}

export function translateShape(shape: Shape, delta: Point): Shape {
	return {
		...shape,
		points: shape.points.map(point => ({
			x: point.x + delta.x,
			y: point.y + delta.y,
		})),
	}
}

export function textSize(shape: Pick<Shape, "width">) {
	return Math.max(16, shape.width * 5)
}

export function textLineHeight(shape: Pick<Shape, "width">) {
	return textSize(shape) * 1.25
}

export function textLines(text: string) {
	return text.split("\n")
}

export function shapeBounds(shape: Shape): Bounds {
	let first = shape.points[0] ?? { x: 0, y: 0 }
	let left = first.x,
		top = first.y,
		right = first.x,
		bottom = first.y
	for (let point of shape.points) {
		left = Math.min(left, point.x)
		top = Math.min(top, point.y)
		right = Math.max(right, point.x)
		bottom = Math.max(bottom, point.y)
	}
	if (shape.kind === "text") {
		let lines = textLines(shape.text)
		let longest = Math.max(1, ...lines.map(line => line.length))
		right += longest * textSize(shape) * 0.6
		bottom += lines.length * textLineHeight(shape)
	}
	return {
		x: left,
		y: top,
		width: Math.max(1, right - left),
		height: Math.max(1, bottom - top),
	}
}

export function unionBounds(bounds: Iterable<Bounds>): Bounds | undefined {
	let left = Infinity,
		top = Infinity,
		right = -Infinity,
		bottom = -Infinity
	for (let box of bounds) {
		left = Math.min(left, box.x)
		top = Math.min(top, box.y)
		right = Math.max(right, box.x + box.width)
		bottom = Math.max(bottom, box.y + box.height)
	}
	if (left === Infinity) return undefined
	return { x: left, y: top, width: right - left, height: bottom - top }
}

export function boundsFromCorners(first: Point, second: Point): Bounds {
	return {
		x: Math.min(first.x, second.x),
		y: Math.min(first.y, second.y),
		width: Math.abs(second.x - first.x),
		height: Math.abs(second.y - first.y),
	}
}

export function boundsIntersect(first: Bounds, second: Bounds) {
	return (
		first.x <= second.x + second.width &&
		second.x <= first.x + first.width &&
		first.y <= second.y + second.height &&
		second.y <= first.y + first.height
	)
}

export function boundsContain(bounds: Bounds, point: Point) {
	return (
		point.x >= bounds.x &&
		point.x <= bounds.x + bounds.width &&
		point.y >= bounds.y &&
		point.y <= bounds.y + bounds.height
	)
}

export function shapesInBounds(shapes: Map<string, Shape>, area: Bounds) {
	return [...shapes]
		.filter(([, shape]) => boundsIntersect(shapeBounds(shape), area))
		.map(([key]) => key)
}

export function drawingShapes(fields: Record<string, string>) {
	let shapes = new Map<string, Shape>()
	for (let [key, value] of Object.entries(fields)) {
		if ((!key.startsWith("shape:") && !key.startsWith("stroke:")) || !value)
			continue
		try {
			shapes.set(key, parseShape(value))
		} catch {
			continue
		}
	}
	return orderedDrawing(shapes)
}

// Maps a shape from one box onto another, which moves and resizes every shape
// of a multiple selection together. Text keeps its anchor and grows its type.
export function scaleShape(shape: Shape, from: Bounds, to: Bounds): Shape {
	let horizontal = to.width / Math.max(1, from.width),
		vertical = to.height / Math.max(1, from.height)
	return {
		...shape,
		width:
			shape.kind === "text"
				? Math.min(
						100,
						Math.max(1, shape.width * Math.min(horizontal, vertical)),
					)
				: shape.width,
		points: shape.points.map(point => ({
			x: to.x + (point.x - from.x) * horizontal,
			y: to.y + (point.y - from.y) * vertical,
		})),
	}
}

export function resizeShape(
	shape: Shape,
	width: number,
	height: number,
): Shape {
	let bounds = shapeBounds(shape)
	return scaleShape(shape, bounds, {
		...bounds,
		width: Math.max(1, width),
		height: Math.max(1, height),
	})
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

// Drags one handle of a box while the opposite side stays put; the box never
// collapses below a minimum size so a resize can always be reversed.
export function resizeBounds(
	bounds: Bounds,
	handle: ResizeHandle,
	delta: Point,
	keepAspect = false,
): Bounds {
	let left = bounds.x,
		top = bounds.y,
		right = bounds.x + bounds.width,
		bottom = bounds.y + bounds.height
	if (handle.includes("w")) left = Math.min(right - 4, left + delta.x)
	if (handle.includes("e")) right = Math.max(left + 4, right + delta.x)
	if (handle.includes("n")) top = Math.min(bottom - 4, top + delta.y)
	if (handle.includes("s")) bottom = Math.max(top + 4, bottom + delta.y)
	let next = { x: left, y: top, width: right - left, height: bottom - top }
	if (!keepAspect || handle.length === 1) return next
	let scale = Math.max(
		next.width / Math.max(1, bounds.width),
		next.height / Math.max(1, bounds.height),
	)
	let width = bounds.width * scale,
		height = bounds.height * scale
	return {
		x: handle.includes("w") ? right - width : left,
		y: handle.includes("n") ? bottom - height : top,
		width,
		height,
	}
}

// A light tint of a hex colour, so a "tinted" fill stays a valid stored colour.
export function tintColor(color: string, amount = 0.82) {
	let channels = [1, 3, 5].map(index =>
		parseInt(color.slice(index, index + 2), 16),
	)
	return (
		"#" +
		channels
			.map(channel =>
				Math.round(channel + (255 - channel) * amount)
					.toString(16)
					.padStart(2, "0"),
			)
			.join("")
	)
}

export function canFill(shape: Pick<Shape, "kind">) {
	return shape.kind === "rectangle" || shape.kind === "ellipse"
}
