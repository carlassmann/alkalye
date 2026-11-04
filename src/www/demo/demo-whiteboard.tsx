import { lazy, useEffect, useState } from "react"
import {
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

let sketch: TLShapePartial[] = [
	geo("write", 0, 0, "Write", "light-blue"),
	geo("share", 320, 0, "Share", "light-violet"),
	geo("present", 640, 0, "Present", "light-green"),
	arrow("write-share", 200, 60, 310, 60),
	arrow("share-present", 520, 60, 630, 60),
	{
		id: createShapeId("note"),
		type: "note",
		x: 330,
		y: 180,
		props: { richText: toRichText("tldraw ♥"), color: "yellow" },
	},
]

function DemoWhiteboard({ progress }: { progress: number }) {
	let [editor, setEditor] = useState<Editor | null>(null)
	let visibleShapes = Math.ceil(progress * sketch.length)

	useEffect(() => {
		if (!editor) return
		let wanted = sketch.slice(0, visibleShapes)
		let wantedIds = new Set(wanted.map(shape => shape.id))
		editor.run(() => {
			let stale = [...editor.getCurrentPageShapeIds()].filter(
				id => !wantedIds.has(id),
			)
			if (stale.length) editor.deleteShapes(stale)
			let missing = wanted.filter(shape => !editor.getShape(shape.id))
			if (missing.length) editor.createShapes(missing)
		})
		editor.zoomToFit({ animation: { duration: 0 } })
	}, [editor, visibleShapes])

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
