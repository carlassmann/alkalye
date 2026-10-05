import { array, number, object, string } from "./model"

// Drawings made before whiteboards used tldraw kept one `shape:` or `stroke:`
// register per shape. This module only reads them, so existing boards and old
// `alkalye-drawing-v1` backups can be converted into tldraw records.
export interface Point {
	x: number
	y: number
}
export interface Binding {
	shape: string
	x: number
	y: number
}
export interface Shape {
	kind: "pen" | "rectangle" | "ellipse" | "line" | "arrow" | "text"
	color: string
	width: number
	points: Point[]
	text: string
	fill?: string
	dash?: "dashed" | "dotted"
	order?: string
	rotation?: number
	start?: Binding
	end?: Binding
	group?: string
	pressure?: number[]
}

export function legacyShapes(fields: Record<string, string>) {
	let shapes: [string, Shape][] = []
	for (let [key, value] of Object.entries(fields)) {
		if (!isLegacyField(key) || !value) continue
		try {
			shapes.push([key, parseShape(value)])
		} catch {
			continue
		}
	}
	return new Map(
		shapes.sort(([a, first], [b, second]) => {
			let left = first.order ?? "",
				right = second.order ?? ""
			return left < right ? -1 : left > right ? 1 : a < b ? -1 : a > b ? 1 : 0
		}),
	)
}

export function isLegacyField(key: string) {
	return key.startsWith("shape:") || key.startsWith("stroke:")
}

export function legacyOrder(clock: number, actor: string, index = 0) {
	return `${String(clock).padStart(16, "0")}:${actor}:${String(index).padStart(8, "0")}`
}

export function parseLegacyDrawing(value: unknown): Shape[] {
	let document = object(value)
	if (document.format !== "alkalye-drawing-v1")
		throw new Error("Unsupported drawing format")
	return array(document.shapes).map(shape => parseShape(JSON.stringify(shape)))
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
			: array(value.points).map(point => {
					let record = object(point)
					return { x: number(record.x), y: number(record.y) }
				})
	if (!points.length || points.length > 100_000)
		throw new Error("Invalid drawing points")
	let fill = value.fill === undefined ? undefined : string(value.fill)
	if (fill && !/^#[a-f\d]{6}$/i.test(fill))
		throw new Error("Invalid drawing fill")
	// Later fields are optional and dropped when malformed, matching how the
	// editor that wrote them read drawings from newer and older clients.
	let shape: Shape = {
		kind,
		color,
		width,
		points,
		text: typeof value.text === "string" ? value.text : "",
	}
	if (fill) shape.fill = fill
	if (value.dash === "dashed" || value.dash === "dotted")
		shape.dash = value.dash
	if (typeof value.order === "string") shape.order = value.order
	if (
		typeof value.rotation === "number" &&
		Number.isFinite(value.rotation) &&
		value.rotation &&
		(kind === "rectangle" || kind === "ellipse" || kind === "text")
	)
		shape.rotation = value.rotation
	if (kind === "arrow") {
		let start = parseBinding(value.start),
			end = parseBinding(value.end)
		if (start) shape.start = start
		if (end) shape.end = end
	}
	if (typeof value.group === "string" && /^[\w:-]{1,200}$/.test(value.group))
		shape.group = value.group
	if (
		kind === "pen" &&
		Array.isArray(value.pressure) &&
		value.pressure.length === points.length &&
		value.pressure.every(
			sample => typeof sample === "number" && Number.isFinite(sample),
		)
	)
		shape.pressure = value.pressure.map(sample =>
			Math.min(1, Math.max(0, Number(sample))),
		)
	return shape
}

// The unrotated box a shape was drawn in; text grew from its anchor by an
// average glyph width.
export function legacyBounds(shape: Shape) {
	let xs = shape.points.map(point => point.x),
		ys = shape.points.map(point => point.y)
	let left = Math.min(...xs),
		top = Math.min(...ys),
		right = Math.max(...xs),
		bottom = Math.max(...ys)
	if (shape.kind === "text") {
		let lines = shape.text.split("\n")
		let size = legacyTextSize(shape)
		right += Math.max(1, ...lines.map(line => line.length)) * size * 0.6
		bottom += lines.length * size * 1.25
	}
	return {
		x: left,
		y: top,
		width: Math.max(1, right - left),
		height: Math.max(1, bottom - top),
	}
}

export function legacyTextSize(shape: Pick<Shape, "width">) {
	return Math.max(16, shape.width * 5)
}

function parseBinding(value: unknown): Binding | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined
	let record = object(value)
	if (
		typeof record.shape !== "string" ||
		!/^[\w:.-]{1,200}$/.test(record.shape) ||
		typeof record.x !== "number" ||
		typeof record.y !== "number" ||
		!Number.isFinite(record.x) ||
		!Number.isFinite(record.y)
	)
		return undefined
	return {
		shape: record.shape,
		x: Math.min(1, Math.max(0, record.x)),
		y: Math.min(1, Math.max(0, record.y)),
	}
}
