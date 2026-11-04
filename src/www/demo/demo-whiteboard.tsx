import { lazy, useEffect, useState } from "react"
import {
	Box,
	createShapeId,
	toRichText,
	type Editor,
	type TLShapePartial,
} from "tldraw"
import { loadTldrawCanvas } from "@/app/features/assets"

export { DemoWhiteboard }

let TldrawCanvas = lazy(() =>
	loadTldrawCanvas().then(module => ({ default: module.TldrawCanvas })),
)

// A fixed camera keeps the sketch still while shapes appear.
let sketchBounds = new Box(-40, -40, 800, 540)

function DemoWhiteboard({
	progress,
	labels,
}: {
	progress: number
	labels: SketchLabels
}) {
	let [editor, setEditor] = useState<Editor | null>(null)
	let sketch = sketchShapes(labels)
	let visibleShapes = Math.ceil(progress * sketch.length)

	useEffect(() => {
		if (!editor) return
		let wanted = sketch.slice(0, visibleShapes)
		let wantedIds = new Set(wanted.map(shape => shape.id))
		// Read-only hides the style panel, which would cover the sketch. It
		// blocks edits from code too, so it lifts for the scripted ones.
		editor.updateInstanceState({ isReadonly: false })
		editor.run(() => {
			let stale = [...editor.getCurrentPageShapeIds()].filter(
				id => !wantedIds.has(id),
			)
			if (stale.length) editor.deleteShapes(stale)
			let missing = wanted.filter(shape => !editor.getShape(shape.id))
			if (missing.length) editor.createShapes(missing)
		})
		editor.updateInstanceState({ isReadonly: true })
	}, [editor, visibleShapes, sketch])

	useEffect(() => {
		if (!editor) return
		editor.zoomToBounds(sketchBounds, { animation: { duration: 0 } })
	}, [editor])

	return (
		<div className="relative min-h-0 flex-1">
			<TldrawCanvas
				onReady={() => {}}
				onDirty={() => {}}
				onEditorMount={setEditor}
			/>
		</div>
	)
}

interface SketchLabels {
	phone: string
	laptop: string
	agent: string
	document: string
}

// Three hands on one document: the phone, the Mac and the agent.
function sketchShapes(labels: SketchLabels): TLShapePartial[] {
	return [
		geo("phone", 0, 0, labels.phone, "light-green"),
		geo("laptop", 0, 170, labels.laptop, "light-blue"),
		geo("agent", 0, 340, labels.agent, "light-violet"),
		arrow("phone-doc", 210, 60, 470, 200),
		arrow("laptop-doc", 210, 230, 470, 230),
		arrow("agent-doc", 210, 400, 470, 260),
		{
			id: createShapeId("document"),
			type: "note",
			x: 480,
			y: 130,
			props: { richText: toRichText(labels.document), color: "yellow" },
		},
	]
}

function geo(
	name: string,
	x: number,
	y: number,
	label: string,
	color: "light-blue" | "light-violet" | "light-green",
): TLShapePartial {
	return {
		id: createShapeId(name),
		type: "geo",
		x,
		y,
		props: {
			w: 200,
			h: 120,
			geo: "rectangle",
			richText: toRichText(label),
			color,
			fill: "semi",
		},
	}
}

function arrow(
	name: string,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): TLShapePartial {
	return {
		id: createShapeId(name),
		type: "arrow",
		x: x1,
		y: y1,
		props: { start: { x: 0, y: 0 }, end: { x: x2 - x1, y: y2 - y1 } },
	}
}
