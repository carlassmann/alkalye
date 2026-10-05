import type { Point, Shape } from "../shared/drawing"
import {
	averageMeasure,
	canLabel,
	drawingShapes,
	labelSize,
	labelWidth,
	localBounds,
	shapeBounds,
	shapePivot,
	textLineHeight,
	textLines,
	textSize,
	wrapText,
} from "../shared/drawing"
import { resolveDrawing } from "../shared/drawing-arrows"
import { hasPressure, strokeOutline } from "../shared/drawing-ink"
import { contrastInk, lightCanvas } from "../shared/drawing-palette"

export let drawingFont = '"Geist", ui-sans-serif, system-ui, sans-serif'

// How a canvas shows stored colours; exports use the stored colours as-is.
export interface DrawingPalette {
	ink(color: string): string
	canvas: string
}
let storedPalette: DrawingPalette = { ink: color => color, canvas: lightCanvas }

export function svg(tag: string, attributes: Record<string, string | number>) {
	let node = document.createElementNS("http://www.w3.org/2000/svg", tag)
	for (let [key, value] of Object.entries(attributes))
		node.setAttribute(key, String(value))
	return node
}

// Rotation lives on the shape's group so its hit area turns with it.
export function shapeTransform(shape: Shape) {
	if (!shape.rotation) return undefined
	let pivot = shapePivot(shape)
	return `rotate(${(shape.rotation * 180) / Math.PI} ${pivot.x} ${pivot.y})`
}

export function shapeElement(shape: Shape, palette = storedPalette) {
	let content = shapeContent(shape, palette)
	let transform = shapeTransform(shape)
	if (!transform) return content
	let group = svg("g", { transform })
	group.append(content)
	return group
}

// A shape's drawing in its own unrotated frame.
export function shapeContent(shape: Shape, palette = storedPalette) {
	let first = shape.points[0] ?? { x: 0, y: 0 },
		last = shape.points[shape.points.length - 1] ?? first
	let stroke = palette.ink(shape.color)
	let attributes = {
		stroke,
		"stroke-width": shape.width,
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
		fill: shape.fill ? palette.ink(shape.fill) : "none",
		...dashAttributes(shape),
	}
	let bounds = localBounds(shape)
	if (shape.kind === "text") return textElement(shape, first, stroke)
	if (shape.kind === "pen") {
		if (hasPressure(shape.pressure) && !shape.dash)
			return svg("path", {
				d: closedPath(
					strokeOutline(shape.points, shape.pressure ?? [], shape.width),
				),
				fill: stroke,
				stroke: "none",
			})
		return svg("path", { ...attributes, d: smoothPath(shape.points) })
	}
	let body =
		shape.kind === "rectangle"
			? svg("rect", {
					...attributes,
					...bounds,
					rx: Math.min(8, bounds.width / 4, bounds.height / 4),
				})
			: shape.kind === "ellipse"
				? svg("ellipse", {
						...attributes,
						cx: bounds.x + bounds.width / 2,
						cy: bounds.y + bounds.height / 2,
						rx: bounds.width / 2,
						ry: bounds.height / 2,
					})
				: svg("polyline", {
						...attributes,
						points: shape.points
							.map(point => `${point.x},${point.y}`)
							.join(" "),
					})
	let label =
		canLabel(shape) && shape.text.trim()
			? labelElement(shape, palette)
			: undefined
	if (shape.kind !== "arrow" && !label) return body
	let group = svg("g", {})
	group.append(body)
	if (shape.kind === "arrow")
		group.append(
			svg("polyline", {
				...attributes,
				fill: "none",
				"stroke-dasharray": "none",
				points: arrowHead(
					shape.points[shape.points.length - 2] ?? first,
					last,
					shape.width,
				)
					.map(point => `${point.x},${point.y}`)
					.join(" "),
			}),
		)
	if (label) group.append(label)
	return group
}

// Wrapping uses the browser's own font metrics when it can, so a label wraps
// on the canvas where it wrapped while it was being typed.
let context: CanvasRenderingContext2D | null | undefined
export function measureLabel(size: number) {
	context ??= document.createElement("canvas").getContext("2d")
	let canvas = context
	if (!canvas) return averageMeasure(size)
	canvas.font = `${size}px ${drawingFont}`
	return (line: string) => canvas.measureText(line).width
}

export function labelLines(shape: Shape) {
	let size = labelSize(shape)
	return wrapText(
		shape.text.replace(/\s+$/, ""),
		labelWidth(shape),
		measureLabel(size),
	)
}

export function labelCenter(shape: Shape): Point {
	if (shape.kind !== "arrow") {
		let bounds = localBounds(shape)
		return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
	}
	let first = shape.points[0] ?? { x: 0, y: 0 },
		last = shape.points[shape.points.length - 1] ?? first
	return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }
}

function labelElement(shape: Shape, palette: DrawingPalette) {
	let size = labelSize(shape),
		height = size * 1.25,
		lines = labelLines(shape),
		center = labelCenter(shape)
	let top = center.y - (lines.length * height) / 2
	let solid = shape.fill && shape.fill === shape.color
	let group = svg("g", { "data-label": "" })
	if (shape.kind === "arrow") {
		let measure = measureLabel(size)
		let width = Math.max(...lines.map(line => measure(line))) + 12
		group.append(
			svg("rect", {
				x: center.x - width / 2,
				y: top - 2,
				width,
				height: lines.length * height + 4,
				rx: 4,
				fill: palette.canvas,
				stroke: "none",
			}),
		)
	}
	let node = svg("text", {
		x: center.x,
		y: top,
		fill: solid
			? contrastInk(palette.ink(shape.fill ?? shape.color))
			: palette.ink(shape.color),
		stroke: "none",
		"font-size": size,
		"font-family": drawingFont,
		"text-anchor": "middle",
		"dominant-baseline": "hanging",
		style: "white-space: pre",
	})
	lines.forEach((line, index) => {
		let span = svg("tspan", {
			x: center.x,
			y: top + index * height + (height - size) / 2,
		})
		span.textContent = line
		node.append(span)
	})
	group.append(node)
	return group
}

function textElement(shape: Shape, anchor: Point, color: string) {
	let node = svg("text", {
		x: anchor.x,
		y: anchor.y,
		fill: color,
		"font-size": textSize(shape),
		"font-family": drawingFont,
		"dominant-baseline": "hanging",
		style: "white-space: pre",
	})
	textLines(shape.text).forEach((line, index) => {
		let span = svg("tspan", {
			x: anchor.x,
			y: anchor.y + index * textLineHeight(shape),
		})
		span.textContent = line
		node.append(span)
	})
	return node
}

function dashAttributes(shape: Shape): Record<string, string> {
	if (shape.dash === "dashed")
		return {
			"stroke-dasharray": `${shape.width * 2.5} ${shape.width * 2}`,
		}
	if (shape.dash === "dotted")
		return { "stroke-dasharray": `0 ${shape.width * 2}` }
	return {}
}

function arrowHead(from: Point, to: Point, width: number) {
	let angle = Math.atan2(to.y - from.y, to.x - from.x),
		length = Math.max(12, width * 4)
	return [
		{
			x: to.x - length * Math.cos(angle - Math.PI / 6),
			y: to.y - length * Math.sin(angle - Math.PI / 6),
		},
		to,
		{
			x: to.x - length * Math.cos(angle + Math.PI / 6),
			y: to.y - length * Math.sin(angle + Math.PI / 6),
		},
	]
}

// Curves through the midpoints of a freehand stroke, so hand-drawn lines stay
// smooth instead of showing every sampled corner.
export function smoothPath(points: readonly Point[]) {
	let [first, ...rest] = points
	if (!first) return ""
	if (!rest.length) return `M${first.x} ${first.y}l0.01 0`
	let path = `M${first.x} ${first.y}`
	for (let index = 0; index < rest.length - 1; index++) {
		let point = rest[index],
			next = rest[index + 1]
		if (!point || !next) continue
		path += `Q${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`
	}
	let last = rest[rest.length - 1] ?? first
	return path + `L${last.x} ${last.y}`
}

// The same midpoint smoothing around a closed outline.
export function closedPath(points: readonly Point[]) {
	let count = points.length
	let first = points[0],
		second = points[1 % count]
	if (!first || !second) return ""
	let path = `M${(first.x + second.x) / 2} ${(first.y + second.y) / 2}`
	for (let index = 1; index <= count; index++) {
		let point = points[index % count],
			next = points[(index + 1) % count]
		if (!point || !next) continue
		path += `Q${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`
	}
	return path + "Z"
}

export function drawingImage(shapes: Map<string, Shape>) {
	let resolved = resolveDrawing(shapes)
	let left = Infinity,
		top = Infinity,
		right = -Infinity,
		bottom = -Infinity
	for (let shape of resolved.values()) {
		let bounds = shapeBounds(shape),
			padding = Math.max(20, shape.width * 4)
		left = Math.min(left, bounds.x - padding)
		top = Math.min(top, bounds.y - padding)
		right = Math.max(right, bounds.x + bounds.width + padding)
		bottom = Math.max(bottom, bounds.y + bounds.height + padding)
		if (shape.kind === "arrow" && shape.text.trim()) {
			let center = labelCenter(shape)
			left = Math.min(left, center.x - 130)
			right = Math.max(right, center.x + 130)
		}
	}
	if (!resolved.size) {
		left = 0
		top = 0
		right = 100
		bottom = 60
	}
	let image = svg("svg", {
		xmlns: "http://www.w3.org/2000/svg",
		viewBox: `${left} ${top} ${right - left} ${bottom - top}`,
		width: right - left,
		height: bottom - top,
	})
	for (let shape of resolved.values()) image.append(shapeElement(shape))
	return new XMLSerializer().serializeToString(image)
}

export function drawingPreview(fields: Record<string, string>) {
	return new Blob([drawingImage(drawingShapes(fields))], {
		type: "image/svg+xml",
	})
}
