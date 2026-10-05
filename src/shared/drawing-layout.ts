import type { Bounds, Point } from "./drawing"
import { unionBounds } from "./drawing"

export type Alignment =
	"left" | "center" | "right" | "top" | "middle" | "bottom"
export type Distribution = "horizontal" | "vertical"
export interface Guide {
	axis: "x" | "y"
	at: number
	from: number
	to: number
}

// Offsets that line every item up with the selection's own edge or centre.
export function alignmentOffsets(
	items: Map<string, Bounds>,
	alignment: Alignment,
): Map<string, Point> {
	let offsets = new Map<string, Point>()
	let area = unionBounds(items.values())
	if (!area || items.size < 2) return offsets
	let horizontal =
		alignment === "left" || alignment === "center" || alignment === "right"
	for (let [key, box] of items) {
		let offset =
			alignment === "left"
				? area.x - box.x
				: alignment === "right"
					? area.x + area.width - box.x - box.width
					: alignment === "center"
						? area.x + area.width / 2 - box.x - box.width / 2
						: alignment === "top"
							? area.y - box.y
							: alignment === "bottom"
								? area.y + area.height - box.y - box.height
								: area.y + area.height / 2 - box.y - box.height / 2
		if (Math.abs(offset) > 1e-9)
			offsets.set(key, horizontal ? { x: offset, y: 0 } : { x: 0, y: offset })
	}
	return offsets
}

// Spaces items with equal gaps between the outermost two, which stay put.
export function distributionOffsets(
	items: Map<string, Bounds>,
	direction: Distribution,
): Map<string, Point> {
	let offsets = new Map<string, Point>()
	if (items.size < 3) return offsets
	let horizontal = direction === "horizontal"
	let start = (box: Bounds) => (horizontal ? box.x : box.y),
		size = (box: Bounds) => (horizontal ? box.width : box.height)
	let ordered = [...items].sort(
		([a, first], [b, second]) =>
			start(first) + size(first) / 2 - start(second) - size(second) / 2 ||
			(a < b ? -1 : 1),
	)
	let first = ordered[0]?.[1],
		last = ordered[ordered.length - 1]?.[1]
	if (!first || !last) return offsets
	let total = ordered.reduce((sum, [, box]) => sum + size(box), 0)
	let gap =
		(start(last) + size(last) - start(first) - total) / (ordered.length - 1)
	let cursor = start(first)
	for (let [key, box] of ordered) {
		let offset = cursor - start(box)
		cursor += size(box) + gap
		if (Math.abs(offset) > 1e-9)
			offsets.set(key, horizontal ? { x: offset, y: 0 } : { x: 0, y: offset })
	}
	return offsets
}

// Snaps the chosen edges of a moving box (fractions across its width and
// height) to the nearest edge or centre of another box within `threshold`, and
// reports the guide lines that the snapped box now shares with its neighbours.
export function snapBounds(
	moving: Bounds,
	targets: readonly Bounds[],
	threshold: number,
	sides: { x: number[]; y: number[] } = { x: [0, 0.5, 1], y: [0, 0.5, 1] },
): { offset: Point; guides: Guide[] } {
	let x = nearest(
			sides.x.map(f => moving.x + moving.width * f),
			targets,
			"x",
			threshold,
		),
		y = nearest(
			sides.y.map(f => moving.y + moving.height * f),
			targets,
			"y",
			threshold,
		)
	let offset = { x: x ?? 0, y: y ?? 0 }
	let snapped = { ...moving, x: moving.x + offset.x, y: moving.y + offset.y }
	let guides = [
		...(x === undefined ? [] : lines(snapped, targets, "x", sides.x)),
		...(y === undefined ? [] : lines(snapped, targets, "y", sides.y)),
	]
	return { offset, guides }
}

function edges(box: Bounds, axis: "x" | "y") {
	let start = axis === "x" ? box.x : box.y,
		size = axis === "x" ? box.width : box.height
	return [start, start + size / 2, start + size]
}

function nearest(
	values: number[],
	targets: readonly Bounds[],
	axis: "x" | "y",
	threshold: number,
) {
	let best: number | undefined,
		distance = threshold
	for (let target of targets)
		for (let edge of edges(target, axis))
			for (let value of values) {
				let gap = Math.abs(edge - value)
				if (gap <= distance) {
					distance = gap
					best = edge - value
				}
			}
	return best
}

function lines(
	box: Bounds,
	targets: readonly Bounds[],
	axis: "x" | "y",
	sides: number[],
): Guide[] {
	let other: "x" | "y" = axis === "x" ? "y" : "x"
	let guides = new Map<number, Guide>()
	let values = sides.map(f =>
		axis === "x" ? box.x + box.width * f : box.y + box.height * f,
	)
	for (let target of targets)
		for (let edge of edges(target, axis))
			for (let value of values) {
				if (Math.abs(edge - value) > 1e-6) continue
				let [low, high] = [edges(box, other), edges(target, other)]
				let from = Math.min(low[0] ?? 0, high[0] ?? 0),
					to = Math.max(low[2] ?? 0, high[2] ?? 0)
				let key = Math.round(edge * 1000) / 1000
				let previous = guides.get(key)
				guides.set(key, {
					axis,
					at: edge,
					from: Math.min(from, previous?.from ?? from),
					to: Math.max(to, previous?.to ?? to),
				})
			}
	return [...guides.values()]
}
