import { describe, expect, test } from "bun:test"
import type { Presence } from "../src/shared/model"
import {
	leads,
	nextMove,
	presentationLeader,
} from "../src/shared/presentation-follow"
import { laserDisplays } from "../src/shared/presentation-laser"

function person(actor: string, values: Partial<Presence> = {}): Presence {
	return {
		actor,
		name: actor,
		document: "doc",
		cursor: 0,
		slide: 0,
		x: -1,
		y: -1,
		time: 10_000,
		presenting: true,
		...values,
	}
}

describe("simultaneous presenter moves", () => {
	test("the newest move leads, and equal times fall to the same actor", () => {
		let leader = presentationLeader(
			[
				person("a", { slide: 1, movedAt: 9_000 }),
				person("b", { slide: 2, movedAt: 9_500 }),
				person("c", { slide: 3, movedAt: 9_500 }),
			],
			"doc",
			10_000,
		)
		expect(leader?.actor).toBe("c")
		expect(leads({ movedAt: 5, actor: "a" }, { movedAt: 4, actor: "z" })).toBe(
			true,
		)
		expect(leads({ movedAt: 5, actor: "a" }, { movedAt: 5, actor: "z" })).toBe(
			false,
		)
	})

	test("two presenters who moved without seeing each other settle on one position", () => {
		let a = person("a", { slide: 1, movedAt: nextMove(9_000, []) })
		let b = person("b", { slide: 2, movedAt: nextMove(9_000, []) })
		// Each window compares the other's presence with its own move.
		let fromA = presentationLeader([b], "doc", 10_000)
		let fromB = presentationLeader([a], "doc", 10_000)
		let aYields = fromA
			? leads(fromA, { movedAt: a.movedAt ?? 0, actor: "a" })
			: false
		let bYields = fromB
			? leads(fromB, { movedAt: b.movedAt ?? 0, actor: "b" })
			: false
		expect(aYields).not.toBe(bYields)
		let winner = aYields ? b : a
		expect(winner.slide).toBe(2)
	})

	test("a move answering one it saw outranks it even on a slower clock", () => {
		let first = person("z", { slide: 1, movedAt: 9_800 })
		let answer = nextMove(9_000, [first])
		expect(answer).toBe(9_801)
		expect(
			presentationLeader(
				[first, person("a", { slide: 2, movedAt: answer })],
				"doc",
				10_000,
			)?.actor,
		).toBe("a")
		expect(nextMove(9_000, [], answer)).toBe(9_802)
		expect(nextMove(9_900, [], answer)).toBe(9_900)
	})

	test("watchers, boards, other documents, stale and unmoved presenters never lead", () => {
		expect(
			presentationLeader(
				[
					person("watcher", { movedAt: 9_900, presenting: false }),
					person("board", { movedAt: 9_900, board: "drawing" }),
					person("elsewhere", { movedAt: 9_900, document: "other" }),
					person("stale", { movedAt: 9_900, time: -1 }),
					person("unmoved"),
				],
				"doc",
				10_000,
			),
		).toBeUndefined()
	})
})

describe("laser displays", () => {
	test("only this account's slideshow windows on the document offer themselves", () => {
		let display = { width: 1024, height: 768, appearance: "dark" as const }
		expect(
			laserDisplays(
				[
					person("projector", { own: true, display, presenting: false }),
					person("collaborator", { own: false, display }),
					person("prompter", { own: true }),
					person("other", { own: true, display, document: "other" }),
					person("gone", { own: true, display, time: -1 }),
					person("drawing", { own: true, display, board: "drawing" }),
				],
				"doc",
				10_000,
			),
		).toEqual([{ actor: "projector", ...display }])
	})
})
