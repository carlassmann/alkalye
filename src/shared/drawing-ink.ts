import type { Point } from "./drawing"

// The filled outline of a pressure-sensitive stroke. Each sample widens the
// stroke between 30% and 170% of its nominal width; round caps close it.
export function strokeOutline(
	points: readonly Point[],
	pressure: readonly number[],
	width: number,
): Point[] {
	let samples = distinctSamples(points, pressure)
	let first = samples[0]
	if (!first) return []
	let radii = smooth(samples.map(sample => sample.pressure)).map(
		value => (width * (0.3 + 1.4 * value)) / 2,
	)
	if (samples.length === 1) return circle(first.point, radii[0] ?? width / 2)
	let left: Point[] = [],
		right: Point[] = []
	let normal = { x: 0, y: -1 }
	samples.forEach((sample, index) => {
		let previous = samples[Math.max(0, index - 1)]?.point ?? sample.point,
			next =
				samples[Math.min(samples.length - 1, index + 1)]?.point ?? sample.point
		let dx = next.x - previous.x,
			dy = next.y - previous.y,
			length = Math.hypot(dx, dy)
		if (length > 1e-9) normal = { x: -dy / length, y: dx / length }
		let radius = radii[index] ?? width / 2
		left.push({
			x: sample.point.x + normal.x * radius,
			y: sample.point.y + normal.y * radius,
		})
		right.push({
			x: sample.point.x - normal.x * radius,
			y: sample.point.y - normal.y * radius,
		})
	})
	let last = samples[samples.length - 1] ?? first
	return [
		...left,
		...cap(last.point, left[left.length - 1], radii[radii.length - 1]),
		...right.reverse(),
		...cap(first.point, right[right.length - 1], radii[0]),
	]
}

// True when the samples carry real variation; a pen reporting a constant
// pressure draws an ordinary uniform stroke.
export function hasPressure(pressure: readonly number[] | undefined) {
	if (!pressure?.length) return false
	let low = Infinity,
		high = -Infinity
	for (let value of pressure) {
		low = Math.min(low, value)
		high = Math.max(high, value)
	}
	return high - low > 0.02
}

function distinctSamples(
	points: readonly Point[],
	pressure: readonly number[],
) {
	let samples: { point: Point; pressure: number }[] = []
	points.forEach((point, index) => {
		let previous = samples[samples.length - 1]
		let value = pressure[index] ?? 0.5
		if (
			previous &&
			Math.hypot(point.x - previous.point.x, point.y - previous.point.y) < 0.5
		) {
			previous.pressure = Math.max(previous.pressure, value)
			return
		}
		samples.push({ point, pressure: value })
	})
	return samples
}

function smooth(values: number[]) {
	return values.map((value, index) => {
		let before = values[index - 1] ?? value,
			after = values[index + 1] ?? value
		return (before + value * 2 + after) / 4
	})
}

// Half a circle from `from` around `center`, sweeping through the stroke's
// outward end on either side.
function cap(center: Point, from: Point | undefined, radius = 1): Point[] {
	if (!from) return []
	let angle = Math.atan2(from.y - center.y, from.x - center.x)
	return Array.from({ length: 5 }, (_, index) => {
		let step = angle - ((index + 1) / 6) * Math.PI
		return {
			x: center.x + Math.cos(step) * radius,
			y: center.y + Math.sin(step) * radius,
		}
	})
}

function circle(center: Point, radius: number) {
	return Array.from({ length: 12 }, (_, index) => ({
		x: center.x + Math.cos((index / 12) * Math.PI * 2) * radius,
		y: center.y + Math.sin((index / 12) * Math.PI * 2) * radius,
	}))
}
