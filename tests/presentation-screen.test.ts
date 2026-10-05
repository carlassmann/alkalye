import { describe, expect, test } from "bun:test"
import type { Presence } from "../src/shared/model"
import { presenterMoves } from "../src/shared/presentation-follow"
import { laserTrail, laserUpdates } from "../src/shared/presentation-laser"

function person(actor: string, values: Partial<Presence> = {}): Presence {
	return {
		actor,
		name: actor,
		document: "doc",
		cursor: 0,
		slide: 0,
		x: -1,
		y: -1,
		time: 1000,
		presenting: true,
		...values,
	}
}

describe("shared presentation position", () => {
	test("a presenter seen first has joined; a changed position has moved", () => {
		let seen = new Map<string, string>()
		let first = presenterMoves(
			seen,
			[person("a", { slide: 2, item: 4 })],
			"doc",
			1000,
		)
		expect(first.joined?.actor).toBe("a")
		expect(first.moved).toBeUndefined()
		let same = presenterMoves(
			seen,
			[person("a", { slide: 2, item: 4, time: 2000 })],
			"doc",
			2000,
		)
		expect(same).toEqual({ moved: undefined, joined: undefined })
		let next = presenterMoves(
			seen,
			[person("a", { slide: 2, item: 5, time: 3000 })],
			"doc",
			3000,
		)
		expect(next.moved?.item).toBe(5)
	})

	test("the latest move wins and watchers, boards and other documents never lead", () => {
		let seen = new Map([
			["a", "0:"],
			["b", "0:"],
			["c", "0:"],
			["d", "0:"],
		])
		let { moved } = presenterMoves(
			seen,
			[
				person("a", { slide: 1, time: 1000 }),
				person("b", { slide: 2, time: 1500 }),
				person("c", { slide: 3, time: 2000, presenting: false }),
				person("d", { slide: 4, time: 2000, board: "board" }),
				person("e", { slide: 5, time: 2000, document: "other" }),
			],
			"doc",
			2000,
		)
		expect(moved?.actor).toBe("b")
	})

	test("stale presenters are ignored", () => {
		let seen = new Map([["a", "0:"]])
		let { moved } = presenterMoves(
			seen,
			[person("a", { slide: 3, time: 0 })],
			"doc",
			20000,
		)
		expect(moved).toBeUndefined()
	})
})

describe("laser trail", () => {
	test("draws while held, then fades after release", () => {
		let time = 0
		let trail = laserTrail(() => time)
		trail.add({ x: 0.1, y: 0.2, stroke: "s", visible: true })
		trail.add({ x: 0.3, y: 0.4, stroke: "s", visible: true })
		expect(trail.frame()).toEqual({
			path: "M100 200l0.01 0 L300 400",
			opacity: 1,
		})
		time = 5000
		expect(trail.frame().opacity).toBe(1)
		trail.add({ x: -1, y: -1, stroke: "s", visible: false })
		time = 6200 + 250
		let fading = trail.frame()
		expect(fading.opacity).toBeGreaterThan(0)
		expect(fading.opacity).toBeLessThan(1)
		time = 7000
		expect(trail.frame()).toEqual({ path: "", opacity: 0 })
	})

	test("separate strokes start new path segments", () => {
		let trail = laserTrail(() => 0)
		trail.add({ x: 0.1, y: 0.1, stroke: "a", visible: true })
		trail.add({ x: 0.1, y: 0.1, stroke: "a", visible: true })
		trail.add({ x: 0.5, y: 0.5, stroke: "b", visible: true })
		expect(trail.frame().path).toBe("M100 100l0.01 0 M500 500l0.01 0")
	})

	test("presence positions become strokes on the shown slide only", () => {
		let seen = new Map<
			string,
			{ time: number; stroke: number; visible: boolean }
		>()
		expect(
			laserUpdates(
				seen,
				[person("a", { x: 0.5, y: 0.5, slide: 1, time: 1 })],
				"doc",
				0,
			),
		).toEqual([])
		let drawn = laserUpdates(
			seen,
			[person("a", { x: 0.5, y: 0.5, time: 2 })],
			"doc",
			0,
		)
		expect(drawn).toEqual([{ x: 0.5, y: 0.5, stroke: "a:1", visible: true }])
		expect(
			laserUpdates(seen, [person("a", { x: 0.5, y: 0.5, time: 2 })], "doc", 0),
		).toEqual([])
		let released = laserUpdates(seen, [person("a", { time: 3 })], "doc", 0)
		expect(released).toEqual([{ x: -1, y: -1, stroke: "a:1", visible: false }])
		let again = laserUpdates(
			seen,
			[person("a", { x: 0.2, y: 0.2, time: 4 })],
			"doc",
			0,
		)
		expect(again[0]?.stroke).toBe("a:2")
		expect(laserUpdates(seen, [], "doc", 0)).toEqual([
			{ x: -1, y: -1, stroke: "a:2", visible: false },
		])
	})
})
