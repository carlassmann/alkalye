import type { Point, Shape } from "../shared/drawing"
import {
	drawingShapes,
	shapeBounds,
	textLineHeight,
	textLines,
	textSize,
} from "../shared/drawing"
export let drawingFont = '"Geist", ui-sans-serif, system-ui, sans-serif'
export function svg(tag: string, attributes: Record<string, string | number>) {
	let node = document.createElementNS("http://www.w3.org/2000/svg", tag)
	for (let [key, value] of Object.entries(attributes))
		node.setAttribute(key, String(value))
	return node
}
export function shapeElement(shape: Shape) {
	let first = shape.points[0] ?? { x: 0, y: 0 },
		last = shape.points[shape.points.length - 1] ?? first
	let attributes = {
		stroke: shape.color,
		"stroke-width": shape.width,
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
		fill: shape.fill ?? "none",
		...dashAttributes(shape),
	}
	let bounds = shapeBounds(shape)
	if (shape.kind === "rectangle")
		return svg("rect", {
			...attributes,
			...bounds,
			rx: Math.min(8, bounds.width / 4, bounds.height / 4),
		})
	if (shape.kind === "ellipse")
		return svg("ellipse", {
			...attributes,
			cx: bounds.x + bounds.width / 2,
			cy: bounds.y + bounds.height / 2,
			rx: bounds.width / 2,
			ry: bounds.height / 2,
		})
	if (shape.kind === "text") return textElement(shape, first)
	if (shape.kind === "pen")
		return svg("path", { ...attributes, d: smoothPath(shape.points) })
	let line = svg("polyline", {
		...attributes,
		points: shape.points.map(point => `${point.x},${point.y}`).join(" "),
	})
	if (shape.kind !== "arrow") return line
	let group = svg("g", {})
	group.append(
		line,
		svg("polyline", {
			...attributes,
			"stroke-dasharray": "none",
			points: arrowHead(first, last, shape.width)
				.map(point => `${point.x},${point.y}`)
				.join(" "),
		}),
	)
	return group
}

function textElement(shape: Shape, anchor: Point) {
	let node = svg("text", {
		x: anchor.x,
		y: anchor.y,
		fill: shape.color,
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

export function drawingPreview(fields: Record<string, string>) {
	let shapes = drawingShapes(fields)
	let left = Infinity,
		top = Infinity,
		right = -Infinity,
		bottom = -Infinity
	for (let shape of shapes.values()) {
		let bounds = shapeBounds(shape),
			padding = Math.max(20, shape.width * 4)
		left = Math.min(left, bounds.x - padding)
		top = Math.min(top, bounds.y - padding)
		right = Math.max(right, bounds.x + bounds.width + padding)
		bottom = Math.max(bottom, bounds.y + bounds.height + padding)
	}
	if (!shapes.size) {
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
	for (let shape of shapes.values()) image.append(shapeElement(shape))
	return new Blob([new XMLSerializer().serializeToString(image)], {
		type: "image/svg+xml",
	})
}
