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
// An arrow terminal attached to another shape. `x` and `y` place the anchor
// inside that shape's unrotated box, so the arrow follows the shape when it
// moves, resizes or turns without either register restating the other.
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
	dash?: ShapeDash
	order?: string
	// Radians around `shapePivot`; only boxes and text keep a rotation, while
	// strokes and lines turn their points instead.
	rotation?: number
	start?: Binding
	end?: Binding
	group?: string
	// Pen pressure from 0 to 1, one value per point.
	pressure?: number[]
}

// A shape with the register key it was exported under, which lets bindings and
// groups survive a round trip through a file or the clipboard.
export interface DrawingEntry {
	id: string
	shape: Shape
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
	// Later fields are optional and dropped when malformed, so a drawing
	// written by a newer client still opens in an older one and vice versa.
	let shape: Shape = {
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
	let rotation =
		typeof value.rotation === "number" && Number.isFinite(value.rotation)
			? value.rotation
			: 0
	shape = withRotation(shape, rotation)
	if (kind === "arrow") {
		let start = parseBinding(value.start),
			end = parseBinding(value.end)
		if (start) shape.start = start
		if (end) shape.end = end
	}
	if (typeof value.group === "string" && /^[\w:-]{1,200}$/.test(value.group))
		shape.group = value.group
	let pressure = parsePressure(value.pressure, points.length)
	if (kind === "pen" && pressure) shape.pressure = pressure
	return shape
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
	return { shape: record.shape, x: unit(record.x), y: unit(record.y) }
}

function parsePressure(value: unknown, length: number) {
	if (!Array.isArray(value) || value.length !== length) return undefined
	let pressure: number[] = []
	for (let sample of value) {
		if (typeof sample !== "number" || !Number.isFinite(sample)) return undefined
		pressure.push(Math.round(unit(sample) * 1000) / 1000)
	}
	return pressure
}

function unit(value: number) {
	return Math.min(1, Math.max(0, value))
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

export function rotates(shape: Pick<Shape, "kind">) {
	return (
		shape.kind === "rectangle" ||
		shape.kind === "ellipse" ||
		shape.kind === "text"
	)
}

export function canLabel(shape: Pick<Shape, "kind">) {
	return (
		shape.kind === "rectangle" ||
		shape.kind === "ellipse" ||
		shape.kind === "arrow"
	)
}

export function labelSize(shape: Pick<Shape, "width">) {
	return Math.min(48, 14 + shape.width * 1.6)
}

// The widest a label may run before wrapping: inside a box it keeps clear of
// the outline, and an ellipse loses its corners.
export function labelWidth(shape: Shape) {
	let bounds = localBounds(shape)
	if (shape.kind === "arrow") return 240
	let inner = shape.kind === "ellipse" ? bounds.width * 0.72 : bounds.width
	return Math.max(labelSize(shape), inner - 16)
}

// Greedy word wrapping with a caller-supplied measure, so the browser can use
// its real font metrics while pure code falls back to an average glyph width.
export function wrapText(
	text: string,
	width: number,
	measure: (line: string) => number,
) {
	let lines: string[] = []
	for (let paragraph of textLines(text)) {
		let line = ""
		for (let word of paragraph.split(/(?<=\s)/)) {
			let candidate = line + word
			if (!line || measure(candidate.trimEnd()) <= width) {
				line = candidate
				continue
			}
			lines.push(line.trimEnd())
			line = word
		}
		while (line.length > 1 && measure(line.trimEnd()) > width) {
			let cut = line.length - 1
			while (cut > 1 && measure(line.slice(0, cut)) > width) cut--
			lines.push(line.slice(0, cut))
			line = line.slice(cut)
		}
		lines.push(line.trimEnd())
	}
	return lines
}

export function averageMeasure(size: number) {
	return (line: string) => line.length * size * 0.6
}

// The unrotated box a shape is drawn in.
export function localBounds(shape: Shape): Bounds {
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

// Text turns around its anchor so typing never shifts it; boxes turn around
// their centre.
export function shapePivot(shape: Shape): Point {
	if (shape.kind === "text") return shape.points[0] ?? { x: 0, y: 0 }
	return boundsCenter(localBounds(shape))
}

export function toWorld(shape: Shape, point: Point): Point {
	if (!shape.rotation) return point
	return rotatePoint(point, shapePivot(shape), shape.rotation)
}

export function toLocal(shape: Shape, point: Point): Point {
	if (!shape.rotation) return point
	return rotatePoint(point, shapePivot(shape), -shape.rotation)
}

export function shapeCenter(shape: Shape) {
	return toWorld(shape, boundsCenter(localBounds(shape)))
}

export function shapeCorners(shape: Shape): Point[] {
	let box = localBounds(shape)
	return [
		{ x: box.x, y: box.y },
		{ x: box.x + box.width, y: box.y },
		{ x: box.x + box.width, y: box.y + box.height },
		{ x: box.x, y: box.y + box.height },
	].map(point => toWorld(shape, point))
}

// The axis-aligned box a shape covers on the page, including its rotation.
export function shapeBounds(shape: Shape): Bounds {
	if (!shape.rotation) return localBounds(shape)
	return pointBounds(shapeCorners(shape))
}

export function pointBounds(points: readonly Point[]): Bounds {
	let left = Infinity,
		top = Infinity,
		right = -Infinity,
		bottom = -Infinity
	for (let point of points) {
		left = Math.min(left, point.x)
		top = Math.min(top, point.y)
		right = Math.max(right, point.x)
		bottom = Math.max(bottom, point.y)
	}
	if (left === Infinity) return { x: 0, y: 0, width: 1, height: 1 }
	return {
		x: left,
		y: top,
		width: Math.max(1, right - left),
		height: Math.max(1, bottom - top),
	}
}

export function boundsCenter(bounds: Bounds): Point {
	return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
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

export let terminals: ("start" | "end")[] = ["start", "end"]

export function normalizeAngle(angle: number) {
	let turn = Math.PI * 2
	let result = ((((angle + Math.PI) % turn) + turn) % turn) - Math.PI
	return Math.abs(result) < 1e-9 ? 0 : result
}

export function rotatePoint(point: Point, center: Point, angle: number) {
	let cos = Math.cos(angle),
		sin = Math.sin(angle),
		x = point.x - center.x,
		y = point.y - center.y
	return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }
}

export function withRotation(shape: Shape, angle: number): Shape {
	let { rotation: _previous, ...rest } = shape
	let rotation = normalizeAngle(angle)
	return rotation && rotates(shape) ? { ...rest, rotation } : rest
}

// Turns a shape around `center`. Boxes and text keep their geometry and store
// the turn; strokes and lines have nothing to turn but their points.
export function rotateShape(shape: Shape, center: Point, angle: number): Shape {
	if (!rotates(shape))
		return {
			...shape,
			points: shape.points.map(point => rotatePoint(point, center, angle)),
		}
	let pivot = shapePivot(shape),
		moved = rotatePoint(pivot, center, angle)
	return withRotation(
		translateShape(shape, { x: moved.x - pivot.x, y: moved.y - pivot.y }),
		(shape.rotation ?? 0) + angle,
	)
}

// Mirrors a shape across a vertical (`horizontal`) or horizontal axis through
// `center`. Text keeps reading forwards; only its place is mirrored.
export function flipShape(
	shape: Shape,
	center: Point,
	direction: "horizontal" | "vertical",
): Shape {
	function mirror(point: Point) {
		return direction === "horizontal"
			? { x: center.x * 2 - point.x, y: point.y }
			: { x: point.x, y: center.y * 2 - point.y }
	}
	if (shape.kind === "text") {
		let before = shapeCenter(shape),
			after = mirror(before)
		return withRotation(
			translateShape(shape, { x: after.x - before.x, y: after.y - before.y }),
			-(shape.rotation ?? 0),
		)
	}
	let flipped: Shape = { ...shape, points: shape.points.map(mirror) }
	for (let terminal of terminals) {
		let binding = shape[terminal]
		if (binding)
			flipped[terminal] =
				direction === "horizontal"
					? { ...binding, x: 1 - binding.x }
					: { ...binding, y: 1 - binding.y }
	}
	return withRotation(flipped, -(shape.rotation ?? 0))
}

// Maps a shape from one box onto another, which moves and resizes every shape
// of a multiple selection together. Text keeps its anchor and grows its type;
// a turned shape keeps its turn and scales along its own axes.
export function scaleShape(shape: Shape, from: Bounds, to: Bounds): Shape {
	let horizontal = to.width / Math.max(1, from.width),
		vertical = to.height / Math.max(1, from.height)
	function map(point: Point) {
		return {
			x: to.x + (point.x - from.x) * horizontal,
			y: to.y + (point.y - from.y) * vertical,
		}
	}
	if (shape.rotation) {
		let target = map(shapeCenter(shape)),
			local = localBounds(shape)
		let scaled = withRotation(
			scaleShape(withRotation(shape, 0), local, {
				x: local.x,
				y: local.y,
				width: local.width * horizontal,
				height: local.height * vertical,
			}),
			shape.rotation,
		)
		let center = shapeCenter(scaled)
		return translateShape(scaled, {
			x: target.x - center.x,
			y: target.y - center.y,
		})
	}
	return {
		...shape,
		width:
			shape.kind === "text"
				? Math.min(
						100,
						Math.max(1, shape.width * Math.min(horizontal, vertical)),
					)
				: shape.width,
		points: shape.points.map(map),
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

// Resizes one turned shape along its own axes: the pointer's movement is read
// in the shape's frame, and the side opposite the handle stays where it was
// on the page.
export function resizeRotatedShape(
	shape: Shape,
	handle: ResizeHandle,
	delta: Point,
	keepAspect = false,
): Shape {
	let angle = shape.rotation ?? 0,
		local = localBounds(shape)
	let next = resizeBounds(
		local,
		handle,
		rotatePoint(delta, { x: 0, y: 0 }, -angle),
		keepAspect,
	)
	let resized = withRotation(
		scaleShape(withRotation(shape, 0), local, next),
		angle,
	)
	let fixed = {
		x: handle.includes("w") ? 1 : handle.includes("e") ? 0 : 0.5,
		y: handle.includes("n") ? 1 : handle.includes("s") ? 0 : 0.5,
	}
	let before = toWorld(shape, boundsPoint(local, fixed)),
		after = toWorld(resized, boundsPoint(localBounds(resized), fixed))
	return translateShape(resized, {
		x: before.x - after.x,
		y: before.y - after.y,
	})
}

export function boundsPoint(bounds: Bounds, fraction: Point): Point {
	return {
		x: bounds.x + bounds.width * fraction.x,
		y: bounds.y + bounds.height * fraction.y,
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
