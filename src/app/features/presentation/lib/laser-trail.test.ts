import { expect, test } from "vitest"
import { createLaserTrailState } from "./laser-trail"
import type { LaserPoint } from "./laser-session"

let point: LaserPoint = {
	type: "point",
	target: "screen",
	lease: "lease",
	layout: "layout",
	slideNumber: 1,
	x: 0.1,
	y: 0.2,
	visible: true,
	stroke: "first",
}

test("draws connected points, keeps separate strokes apart, and includes the released endpoint", () => {
	let trail = createLaserTrailState(() => 0)
	trail.add(point)
	trail.add({ ...point, x: 0.3 })
	trail.add({ ...point, x: 0.4, visible: false })
	trail.add({ ...point, stroke: "second", x: 0.8 })
	expect(trail.frame().path).toBe(
		"M100 200l0.01 0 L300 200 L400 200 M800 200l0.01 0",
	)
})

test("holds the line through heartbeats and fades after release without remote clocks", () => {
	let time = 0
	let trail = createLaserTrailState(() => time)
	trail.add(point)
	time = 1000
	trail.add(point)
	expect(trail.frame().path).toBe("M100 200l0.01 0")
	trail.add({ ...point, visible: false })
	time = 2200
	expect(trail.frame().opacity).toBe(1)
	time = 2450
	expect(trail.frame().opacity).toBe(0.75)
	time = 2700
	expect(trail.frame()).toEqual({ path: "", opacity: 0 })
})

test("expires without a release message and clears immediately on slide changes", () => {
	let time = 0
	let trail = createLaserTrailState(() => time)
	trail.add(point)
	time = 1700
	expect(trail.frame().path).toBe("")
	trail.add(point)
	trail.clear()
	expect(trail.frame().path).toBe("")
})

test("bounds very long strokes", () => {
	let trail = createLaserTrailState(() => 0)
	for (let index = 0; index < 3000; index++)
		trail.add({ ...point, x: index / 3000 })
	expect(
		trail
			.frame()
			.path.split(" ")
			.filter(token => token.startsWith("L")),
	).toHaveLength(2047)
})
