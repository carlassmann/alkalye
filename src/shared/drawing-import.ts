import type { Binding, DrawingEntry, Point, Shape } from "./drawing"
import { parseShape } from "./drawing"
import { array, number, object, string } from "./model"

export function importDrawing(value: unknown): Shape[] {
	return importDrawingEntries(value).map(entry => entry.shape)
}

// Imported shapes keep the identity they had in their file, so arrows stay
// attached to their targets once the caller assigns fresh register keys.
export function importDrawingEntries(value: unknown): DrawingEntry[] {
	let document = object(value)
	if (document.format === "alkalye-drawing-v1")
		return array(document.shapes).map((shape, index) => {
			let record = object(shape)
			return {
				id:
					typeof record.id === "string" && record.id
						? record.id
						: `import:${index}`,
				shape: parseShape(JSON.stringify(shape)),
			}
		})
	if (document.format === "alkalye-tldraw-v1")
		return importDrawingEntries(JSON.parse(string(document.snapshot)))
	if (document.tldrawFileFormatVersion !== 1)
		throw new Error("Unsupported drawing format")
	let records = array(document.records).map(object)
	if (records.filter(record => record.typeName === "page").length !== 1)
		throw new Error("Import a drawing with one page")
	if (
		records.some(
			record =>
				record.typeName === "asset" ||
				["image", "video", "embed", "bookmark"].includes(String(record.type)),
		)
	)
		throw new Error("Embedded media is not supported in drawings")
	let byId = new Map(records.map(record => [string(record.id), record]))
	let result: DrawingEntry[] = []
	let shapes = records.filter(record => record.typeName === "shape")
	let ordered: Record<string, unknown>[] = []
	let visited = new Set<string>()
	let page = records.find(record => record.typeName === "page")
	walk(String(page?.id))
	if (ordered.length !== shapes.length)
		throw new Error("Drawing contains an orphan or parent cycle")
	function walk(parentId: string, depth = 0) {
		if (depth > 128) throw new Error("Drawing groups are nested too deeply")
		for (let record of shapes
			.filter(record => record.parentId === parentId)
			.sort((a, b) => String(a.index).localeCompare(String(b.index)))) {
			let id = string(record.id)
			if (visited.has(id))
				throw new Error("Drawing contains duplicate identities")
			visited.add(id)
			ordered.push(record)
			walk(id, depth + 1)
		}
	}
	for (let record of ordered) {
		let type = string(record.type),
			props = object(record.props)
		if (type === "group") continue
		let color = colors[String(props.color)] ?? "#34403b"
		let width = sizes[String(props.size)] ?? 3
		let text =
			typeof props.text === "string"
				? props.text
				: richText(props.richText).trimEnd()
		let label: Shape | undefined
		let points: Point[] = [],
			placed: Point[] | undefined,
			kind: Shape["kind"] = "pen"
		if (type === "draw" || type === "highlight") {
			points = array(props.segments).flatMap(segment =>
				drawingPoints(object(segment)),
			)
			points = points.map(point => ({
				x: point.x * number(props.scaleX ?? 1),
				y: point.y * number(props.scaleY ?? 1),
			}))
			if (props.isClosed && points[0]) points.push(points[0])
		} else if (type === "line") {
			points = Object.values(object(props.points))
				.map(object)
				.sort((a, b) => (String(a.index) < String(b.index) ? -1 : 1))
				.map(point => ({ x: number(point.x), y: number(point.y) }))
		} else if (type === "arrow") {
			kind = "arrow"
			points = [arrowPoint(record, "start"), arrowPoint(record, "end")]
		} else if (type === "text") {
			kind = "text"
			points = [{ x: 0, y: 0 }]
			width = { s: 3, m: 4, l: 6, xl: 8 }[String(props.size)] ?? 4
		} else if (["geo", "note", "frame"].includes(type)) {
			let w = number(props.w ?? (type === "note" ? 200 : 0)),
				h =
					number(props.h ?? (type === "note" ? 200 : 0)) +
					number(props.growY ?? 0)
			let form = type === "geo" ? String(props.geo) : "rectangle"
			if (["rectangle", "ellipse", "oval"].includes(form)) {
				kind = form === "rectangle" ? "rectangle" : "ellipse"
				let center = world(record, { x: w / 2, y: h / 2 })
				placed = [
					{ x: center.x - w / 2, y: center.y - h / 2 },
					{ x: center.x + w / 2, y: center.y + h / 2 },
				]
			} else if (form === "triangle")
				points = [
					{ x: w / 2, y: 0 },
					{ x: w, y: h },
					{ x: 0, y: h },
					{ x: w / 2, y: 0 },
				]
			else if (form === "diamond")
				points = [
					{ x: w / 2, y: 0 },
					{ x: w, y: h / 2 },
					{ x: w / 2, y: h },
					{ x: 0, y: h / 2 },
					{ x: w / 2, y: 0 },
				]
			else if (["pentagon", "hexagon", "octagon", "star"].includes(form)) {
				let sides =
					form === "star"
						? 10
						: form === "pentagon"
							? 5
							: form === "hexagon"
								? 6
								: 8
				points = Array.from({ length: sides + 1 }, (_, index) => {
					let radius = form === "star" && index % 2 ? 0.45 : 1
					return {
						x:
							w / 2 +
							(w / 2) *
								radius *
								Math.cos((index / sides) * Math.PI * 2 - Math.PI / 2),
						y:
							h / 2 +
							(h / 2) *
								radius *
								Math.sin((index / sides) * Math.PI * 2 - Math.PI / 2),
					}
				})
			} else throw new Error(`Unsupported drawing geometry: ${form}`)
			if (text && !placed)
				label = {
					kind: "text",
					color,
					width: 4,
					points: [world(record, { x: 12, y: 12 })],
					text,
				}
		} else throw new Error(`Unsupported drawing shape: ${type}`)
		let id = string(record.id)
		let shape: Shape = {
			kind,
			color,
			width,
			points: placed ?? points.map(point => world(record, point)),
			text: kind === "text" || placed ? text : "",
		}
		if (kind === "text" || placed) shape.rotation = rotation(record)
		if (props.fill && props.fill !== "none" && kind !== "text")
			shape.fill = color
		if (kind === "arrow") {
			let start = arrowBinding(record, "start"),
				end = arrowBinding(record, "end")
			if (start) shape.start = start
			if (end) shape.end = end
		}
		result.push({ id, shape: parseShape(JSON.stringify(shape)) })
		if (label) result.push({ id: id + ":label", shape: label })
	}
	return result
	// Only targets imported as boxes or text can hold an arrow; anything else
	// keeps the arrow at the position the file recorded.
	function arrowBinding(
		record: Record<string, unknown>,
		terminal: string,
	): Binding | undefined {
		let props = object(record.props),
			endpoint = object(props[terminal])
		let binding = records.find(
			binding =>
				binding.typeName === "binding" &&
				binding.type === "arrow" &&
				binding.fromId === record.id &&
				object(binding.props).terminal === terminal,
		)
		let target = byId.get(String(binding?.toId ?? endpoint.boundShapeId))
		if (!target || target.typeName !== "shape") return undefined
		let targetProps = object(target.props)
		let bindable =
			target.type === "text" ||
			target.type === "note" ||
			target.type === "frame" ||
			(target.type === "geo" &&
				["rectangle", "ellipse", "oval"].includes(String(targetProps.geo)))
		if (!bindable) return undefined
		let details = binding ? object(binding.props) : endpoint
		let anchor = object(details.normalizedAnchor ?? { x: 0.5, y: 0.5 })
		let precise = details.isPrecise === true || details.isExact === true
		return {
			shape: string(target.id),
			x: precise ? number(anchor.x) : 0.5,
			y: precise ? number(anchor.y) : 0.5,
		}
	}
	function rotation(
		record: Record<string, unknown>,
		visiting = new Set<string>(),
	): number {
		let id = string(record.id)
		if (visiting.has(id)) throw new Error("Drawing contains a parent cycle")
		visiting.add(id)
		let parent = byId.get(String(record.parentId))
		return (
			number(record.rotation ?? 0) +
			(parent?.typeName === "shape" ? rotation(parent, visiting) : 0)
		)
	}
	function world(
		record: Record<string, unknown>,
		point: Point,
		visiting = new Set<string>(),
	): Point {
		let id = string(record.id)
		if (visiting.has(id)) throw new Error("Drawing contains a parent cycle")
		visiting.add(id)
		let angle = number(record.rotation ?? 0)
		let transformed = {
			x:
				number(record.x ?? 0) +
				point.x * Math.cos(angle) -
				point.y * Math.sin(angle),
			y:
				number(record.y ?? 0) +
				point.x * Math.sin(angle) +
				point.y * Math.cos(angle),
		}
		let parent = byId.get(String(record.parentId))
		return parent?.typeName === "shape"
			? world(parent, transformed, visiting)
			: transformed
	}
	function arrowPoint(
		record: Record<string, unknown>,
		terminal: string,
	): Point {
		let props = object(record.props),
			endpoint = object(props[terminal])
		let binding = records.find(
			binding =>
				binding.typeName === "binding" &&
				binding.type === "arrow" &&
				binding.fromId === record.id &&
				object(binding.props).terminal === terminal,
		)
		let target = byId.get(String(binding?.toId ?? endpoint.boundShapeId))
		if (!target) return { x: number(endpoint.x), y: number(endpoint.y) }
		let anchor = object(
			binding
				? object(binding.props).normalizedAnchor
				: endpoint.normalizedAnchor,
		)
		let targetProps = object(target.props)
		let point = world(target, {
			x: number(anchor.x) * number(targetProps.w ?? 0),
			y: number(anchor.y) * number(targetProps.h ?? 0),
		})
		let origin = world(record, { x: 0, y: 0 }),
			angle = rotation(record)
		return {
			x:
				(point.x - origin.x) * Math.cos(angle) +
				(point.y - origin.y) * Math.sin(angle),
			y:
				-(point.x - origin.x) * Math.sin(angle) +
				(point.y - origin.y) * Math.cos(angle),
		}
	}
}

function richText(value: unknown): string {
	if (!value) return ""
	let node = object(value)
	if (typeof node.text === "string") return node.text
	return array(node.content ?? [])
		.map(child => {
			let text = richText(child)
			return object(child).type === "paragraph" ? text + "\n" : text
		})
		.join("")
}
function drawingPoints(segment: Record<string, unknown>): Point[] {
	if (Array.isArray(segment.points))
		return segment.points.map(point => {
			let value = object(point)
			return { x: number(value.x), y: number(value.y) }
		})
	let encoded = string(segment.path ?? segment.points)
	let bytes = Uint8Array.from(atob(encoded), character =>
			character.charCodeAt(0),
		),
		view = new DataView(bytes.buffer)
	let dimensions = segment.dim === 2 ? 2 : 3
	let points: Point[] = []
	if (segment.path === undefined) {
		if (bytes.length % 6) throw new Error("Invalid drawing points")
		for (let offset = 0; offset < bytes.length; offset += 6)
			points.push({
				x: half(view.getUint16(offset, true)),
				y: half(view.getUint16(offset + 2, true)),
			})
		return points
	}
	let firstSize = dimensions * 4,
		step = dimensions * 2
	if (bytes.length < firstSize || (bytes.length - firstSize) % step)
		throw new Error("Invalid drawing path")
	let x = view.getFloat32(0, true),
		y = view.getFloat32(4, true)
	points.push({ x, y })
	for (let offset = firstSize; offset < bytes.length; offset += step) {
		x += half(view.getUint16(offset, true))
		y += half(view.getUint16(offset + 2, true))
		points.push({ x, y })
	}
	return points
}
function half(bits: number) {
	let sign = bits & 0x8000 ? -1 : 1,
		exponent = (bits >> 10) & 31,
		fraction = bits & 1023
	return (
		sign *
		(exponent === 0
			? 2 ** -14 * (fraction / 1024)
			: exponent === 31
				? fraction
					? NaN
					: Infinity
				: 2 ** (exponent - 15) * (1 + fraction / 1024))
	)
}
let colors: Record<string, string> = {
	black: "#34403b",
	white: "#f7f8f2",
	grey: "#8a958d",
	red: "#e75f62",
	orange: "#f2a34f",
	yellow: "#e5c54f",
	green: "#35b38b",
	blue: "#4c8fd8",
	violet: "#946bd2",
	pink: "#db82b4",
	"light-red": "#e89a99",
	"light-green": "#8ec5a4",
	"light-blue": "#91b8e1",
	"light-violet": "#b59bde",
}
let sizes: Record<string, number> = { s: 2, m: 3, l: 5, xl: 8 }
