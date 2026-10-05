import type { Binding, Point, Shape } from "./drawing"
import {
	boundsPoint,
	localBounds,
	terminals,
	toLocal,
	toWorld,
} from "./drawing"

// Arrows store the shapes they point at, never the shapes' positions. Every
// view derives the terminals from the targets' current registers, so moving a
// target is one write and concurrent edits to the arrow and its target merge.

export function canBind(shape: Pick<Shape, "kind">) {
	return (
		shape.kind === "rectangle" ||
		shape.kind === "ellipse" ||
		shape.kind === "text"
	)
}

export function anchorPoint(target: Shape, binding: Binding): Point {
	return toWorld(target, boundsPoint(localBounds(target), binding))
}

export function resolveArrow(
	shape: Shape,
	lookup: (key: string) => Shape | undefined,
): Shape {
	if (shape.kind !== "arrow" || (!shape.start && !shape.end)) return shape
	let first = shape.points[0] ?? { x: 0, y: 0 },
		last = shape.points[shape.points.length - 1] ?? first
	let startTarget = shape.start && lookup(shape.start.shape),
		endTarget = shape.end && lookup(shape.end.shape)
	let startAnchor =
			startTarget && shape.start && canBind(startTarget)
				? anchorPoint(startTarget, shape.start)
				: undefined,
		endAnchor =
			endTarget && shape.end && canBind(endTarget)
				? anchorPoint(endTarget, shape.end)
				: undefined
	if (!startAnchor && !endAnchor) return shape
	let from = startAnchor ?? first,
		to = endAnchor ?? last
	let gap = Math.max(2, shape.width)
	let start =
		startTarget && startAnchor
			? clipToOutline(to, from, startTarget, gap)
			: from
	let end =
		endTarget && endAnchor ? clipToOutline(from, to, endTarget, gap) : to
	return { ...shape, points: [start, end] }
}

export function resolveDrawing(shapes: Map<string, Shape>) {
	let resolved = new Map<string, Shape>()
	for (let [key, shape] of shapes)
		resolved.set(
			key,
			resolveArrow(shape, target =>
				target === key ? undefined : shapes.get(target),
			),
		)
	return resolved
}

// Arrows that must be redrawn when any of `keys` changes.
export function boundArrows(shapes: Map<string, Shape>, keys: Set<string>) {
	let found = new Set<string>()
	if (!keys.size) return found
	for (let [key, shape] of shapes)
		if (
			(shape.start && keys.has(shape.start.shape)) ||
			(shape.end && keys.has(shape.end.shape))
		)
			found.add(key)
	return found
}

// Keeps only the bindings whose targets travel with the arrow; the others are
// released at the arrow's resolved position so it does not jump back.
export function keepBindings(shape: Shape, keep: (key: string) => boolean) {
	if (!shape.start && !shape.end) return shape
	let result = { ...shape }
	for (let terminal of terminals) {
		let binding = result[terminal]
		if (binding && !keep(binding.shape)) delete result[terminal]
	}
	return result
}

// Releases arrows from shapes that are being deleted, in the same action, so
// the arrows stay where they were drawn.
export function releaseArrows(
	shapes: Map<string, Shape>,
	deleted: Set<string>,
): [string, Shape][] {
	let released: [string, Shape][] = []
	for (let key of boundArrows(shapes, deleted)) {
		let shape = shapes.get(key)
		if (!shape || deleted.has(key)) continue
		let resolved = resolveArrow(shape, target => shapes.get(target))
		released.push([key, keepBindings(resolved, target => !deleted.has(target))])
	}
	return released
}

// The topmost bindable shape under `point`. A loose aim points at the centre,
// as most diagrams want; a precise aim keeps the exact spot.
export function bindingAt(
	shapes: Map<string, Shape>,
	point: Point,
	options: {
		exclude?: ReadonlySet<string>
		precise?: boolean
		margin?: number
	} = {},
): Binding | undefined {
	let margin = options.margin ?? 0
	let entries = [...shapes]
	for (let index = entries.length - 1; index >= 0; index--) {
		let entry = entries[index]
		if (!entry) continue
		let [key, shape] = entry
		if (!canBind(shape) || options.exclude?.has(key)) continue
		let local = toLocal(shape, point),
			box = localBounds(shape)
		if (
			local.x < box.x - margin ||
			local.x > box.x + box.width + margin ||
			local.y < box.y - margin ||
			local.y > box.y + box.height + margin
		)
			continue
		if (!options.precise) return { shape: key, x: 0.5, y: 0.5 }
		return {
			shape: key,
			x: clamp((local.x - box.x) / box.width),
			y: clamp((local.y - box.y) / box.height),
		}
	}
	return undefined
}

// Where a segment from `outside` to `anchor` first enters the target's
// outline, stepped back by `gap` so the arrowhead touches rather than overlaps.
export function clipToOutline(
	outside: Point,
	anchor: Point,
	target: Shape,
	gap = 0,
): Point {
	let from = toLocal(target, outside),
		to = toLocal(target, anchor),
		box = localBounds(target)
	let entry =
		target.kind === "ellipse"
			? ellipseEntry(from, to, box)
			: rectangleEntry(from, to, box)
	if (entry === undefined || entry <= 0) return anchor
	let length = Math.hypot(anchor.x - outside.x, anchor.y - outside.y)
	let back = length > gap * 3 ? gap / length : 0
	let t = Math.max(0, entry - back)
	return {
		x: outside.x + (anchor.x - outside.x) * t,
		y: outside.y + (anchor.y - outside.y) * t,
	}
}

function rectangleEntry(
	from: Point,
	to: Point,
	box: { x: number; y: number; width: number; height: number },
) {
	let dx = to.x - from.x,
		dy = to.y - from.y
	let enter = 0,
		exit = 1
	let edges: [number, number][] = [
		[-dx, from.x - box.x],
		[dx, box.x + box.width - from.x],
		[-dy, from.y - box.y],
		[dy, box.y + box.height - from.y],
	]
	for (let [direction, distance] of edges) {
		if (direction === 0) {
			if (distance < 0) return undefined
			continue
		}
		let t = distance / direction
		if (direction < 0) enter = Math.max(enter, t)
		else exit = Math.min(exit, t)
	}
	return enter <= exit ? enter : undefined
}

function ellipseEntry(
	from: Point,
	to: Point,
	box: { x: number; y: number; width: number; height: number },
) {
	let rx = box.width / 2,
		ry = box.height / 2
	let x = (from.x - box.x - rx) / rx,
		y = (from.y - box.y - ry) / ry,
		dx = (to.x - from.x) / rx,
		dy = (to.y - from.y) / ry
	let a = dx * dx + dy * dy,
		b = 2 * (x * dx + y * dy),
		c = x * x + y * y - 1
	if (c <= 0) return 0
	let discriminant = b * b - 4 * a * c
	if (a === 0 || discriminant < 0) return undefined
	let t = (-b - Math.sqrt(discriminant)) / (2 * a)
	return t >= 0 && t <= 1 ? t : undefined
}

function clamp(value: number) {
	return Math.min(1, Math.max(0, value))
}
