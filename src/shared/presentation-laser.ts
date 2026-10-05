import type { Presence } from "./model"

// The original's laser: a presenter drags on the slide preview and every
// audience slideshow draws the stroke, which fades once the pointer is
// released. Coordinates are fractions of the slide.

export interface LaserPoint {
	x: number
	y: number
	stroke: string
	visible: boolean
}

let delay = 1200
let fadeDuration = 500
let pointLimit = 2048

export function laserTrail(now = () => performance.now()) {
	let points: Omit<LaserPoint, "visible">[] = []
	let path: string | undefined = ""
	let lastActivity = -Infinity
	let drawing = false

	function clear() {
		points = []
		path = ""
		lastActivity = -Infinity
		drawing = false
	}
	function push(point: LaserPoint) {
		points.push({ x: point.x, y: point.y, stroke: point.stroke })
		path = undefined
		if (points.length > pointLimit) points.shift()
	}

	return {
		clear,
		get drawing() {
			return drawing
		},
		add(point: LaserPoint) {
			let time = now()
			if (!drawing && time - lastActivity >= delay + fadeDuration) clear()
			let previous = points.at(-1)
			if (!point.visible) {
				if (drawing && previous && point.x >= 0)
					if (previous.x !== point.x || previous.y !== point.y)
						push({ ...point, stroke: previous.stroke })
				if (drawing) lastActivity = time
				drawing = false
				return
			}
			drawing = true
			lastActivity = time
			if (
				previous?.stroke === point.stroke &&
				previous.x === point.x &&
				previous.y === point.y
			)
				return
			push(point)
		},
		// The trail stays solid while drawing and for a moment after release,
		// then fades out quadratically.
		frame() {
			let elapsed = drawing ? 0 : Math.max(0, now() - lastActivity - delay)
			if (elapsed >= fadeDuration) clear()
			path ??= points
				.map((point, index) => {
					let start = index === 0 || points[index - 1]?.stroke !== point.stroke
					let position = `${point.x * 1000} ${point.y * 1000}`
					return start ? `M${position}l0.01 0` : `L${position}`
				})
				.join(" ")
			return {
				path,
				opacity: points.length ? 1 - (elapsed / fadeDuration) ** 2 : 0,
			}
		},
	}
}

// Presence carries one pointer position per heartbeat; consecutive positions
// from the same presenter on the shown slide form a stroke. A presenter with
// no position (x < 0) has released the pointer.
export function laserUpdates(
	seen: Map<string, { time: number; stroke: number; visible: boolean }>,
	people: readonly Presence[],
	document: string,
	slide: number,
) {
	let updates: LaserPoint[] = []
	for (let person of people) {
		if (person.board || person.document !== document) continue
		let previous = seen.get(person.actor)
		if (previous?.time === person.time) continue
		let visible = person.x >= 0 && person.slide === slide
		let stroke =
			(previous?.stroke ?? 0) + (visible && !previous?.visible ? 1 : 0)
		seen.set(person.actor, { time: person.time, stroke, visible })
		if (visible || previous?.visible)
			updates.push({
				x: visible ? person.x : -1,
				y: visible ? person.y : -1,
				stroke: person.actor + ":" + stroke,
				visible,
			})
	}
	// A presenter who left mid-stroke releases it, so the trail still fades.
	for (let [actor, previous] of seen)
		if (!people.some(person => person.actor === actor)) {
			seen.delete(actor)
			if (previous.visible)
				updates.push({
					x: -1,
					y: -1,
					stroke: actor + ":" + previous.stroke,
					visible: false,
				})
		}
	return updates
}
