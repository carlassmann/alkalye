import { expect, test } from "bun:test"
import { presentationPresence } from "../src/server/presentation-presence"
import type { LivePresence } from "../src/shared/document-live"
import {
	nextMove,
	presentationLeader,
	maximumPresentationSkew,
} from "../src/shared/presentation-follow"
import { laserUpdates } from "../src/shared/presentation-laser"

let presence: LivePresence = {
	actor: "peer",
	name: "Peer",
	document: "document",
	cursor: 0,
	slide: 2,
	item: 3,
	x: 0.5,
	y: 0.5,
	time: 1000,
	presenting: true,
	movedAt: 1000,
	target: "display",
	own: true,
}

test("readers retain audience presence but cannot lead or draw a laser", () => {
	let reader = presentationPresence(presence, "reader", 1000)
	expect(reader).toMatchObject({
		actor: "peer",
		slide: 2,
		presenting: false,
		x: -1,
		y: -1,
	})
	expect(reader.movedAt).toBeUndefined()
	expect(reader.target).toBeUndefined()
	expect(reader.own).toBeUndefined()
	expect(laserUpdates(new Map(), [reader], "document", 2)).toEqual([])
	expect(presence.presenting).toBe(true)
})

test("writers retain their move and targeting; the relay owns account identity", () => {
	let writer = presentationPresence(presence, "writer", 1000)
	expect(writer).toMatchObject({
		presenting: true,
		movedAt: 1000,
		target: "display",
		x: 0.5,
	})
	expect(writer.own).toBeUndefined()
})

test("an oversized presentation clock cannot poison later moves", () => {
	let hostile = { ...presence, movedAt: Number.MAX_SAFE_INTEGER }
	expect(presentationPresence(hostile, "writer", 1000).movedAt).toBe(1000)
	expect(presentationLeader([hostile], "document", 1000)).toBeUndefined()
	let move = nextMove(1000, [hostile], Number.MAX_SAFE_INTEGER)
	expect(Number.isSafeInteger(move)).toBe(true)
	expect(move).toBeLessThanOrEqual(1000 + maximumPresentationSkew)
	expect(nextMove(1000, [{ ...presence, movedAt: 1001 }])).toBe(1002)
})

test("laser targeting selects own displays while reaching collaborators' audiences", () => {
	let pointer = { ...presence, own: false }
	expect(
		laserUpdates(new Map(), [pointer], "document", 2, "another-display"),
	).toHaveLength(1)
	expect(
		laserUpdates(
			new Map(),
			[{ ...pointer, own: true }],
			"document",
			2,
			"another-display",
		),
	).toEqual([])
	expect(
		laserUpdates(
			new Map(),
			[{ ...pointer, own: true }],
			"document",
			2,
			"display",
		),
	).toHaveLength(1)
})
