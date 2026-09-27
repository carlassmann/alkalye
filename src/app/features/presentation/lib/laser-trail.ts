import type { LaserPoint } from "./laser-session"

export { createLaserTrail, createLaserTrailState }

let delay = 1200
let fadeDuration = 500
let pointLimit = 2048

function createLaserTrailState(now = () => performance.now()) {
	let points: { x: number; y: number; stroke: string }[] = []
	let lastActivity = -Infinity
	let drawing = false
	let legacyStroke = 0

	function clear() {
		points = []
		lastActivity = -Infinity
		drawing = false
	}

	return {
		clear,
		add(point: LaserPoint) {
			let time = now()
			if (time - lastActivity >= delay + fadeDuration) clear()
			if (!point.visible) {
				let previous = points.at(-1)
				if (
					drawing &&
					previous &&
					(previous.x !== point.x || previous.y !== point.y)
				) {
					points.push({ x: point.x, y: point.y, stroke: previous.stroke })
					if (points.length > pointLimit) points.shift()
				}
				if (drawing) lastActivity = time
				drawing = false
				return
			}
			if (!drawing) legacyStroke++
			drawing = true
			lastActivity = time
			let stroke = point.stroke ?? String(legacyStroke)
			let previous = points.at(-1)
			if (
				previous?.stroke === stroke &&
				previous.x === point.x &&
				previous.y === point.y
			)
				return
			points.push({ x: point.x, y: point.y, stroke })
			if (points.length > pointLimit) points.shift()
		},
		frame() {
			let elapsed = Math.max(0, now() - lastActivity - delay)
			if (elapsed >= fadeDuration) clear()
			let path = points
				.map((point, index) => {
					let start = index === 0 || points[index - 1].stroke !== point.stroke
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

function createLaserTrail(path: SVGPathElement) {
	let state = createLaserTrailState()
	let animation: number | undefined
	function render() {
		let frame = state.frame()
		path.setAttribute("d", frame.path)
		path.style.opacity = String(frame.opacity)
		animation = frame.opacity > 0 ? requestAnimationFrame(render) : undefined
	}
	function clear() {
		if (animation !== undefined) cancelAnimationFrame(animation)
		animation = undefined
		state.clear()
		path.setAttribute("d", "")
	}
	return {
		clear,
		add(point: LaserPoint) {
			state.add(point)
			if (animation === undefined) render()
		},
	}
}
