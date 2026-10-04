import { expect, test } from "bun:test"
import { TextVisibility } from "./visibility"

function id(clock: number, actor = "writer") {
	return String(clock).padStart(16, "0") + ":" + actor
}
function atom(clock: number, actor = "writer", offset = 0) {
	return id(clock, actor) + ":" + String(offset).padStart(8, "0")
}
function permutations<A>(values: A[]): A[][] {
	if (!values.length) return [[]]
	return values.flatMap((value, index) =>
		permutations(values.filter((_, other) => index !== other)).map(tail => [
			value,
			...tail,
		]),
	)
}

test("incremental cancellation preserves other deletion marks across every delivery order", () => {
	let facts = [
		(state: TextVisibility) => state.remove(id(2, "alice"), [atom(1)]),
		(state: TextVisibility) => state.remove(id(2, "bob"), [atom(1)]),
		(state: TextVisibility) => state.cancel(id(3, "undo"), id(2, "alice")),
		(state: TextVisibility) => state.cancel(id(4, "redo"), id(3, "undo")),
	]
	for (let order of permutations(facts)) {
		let state = new TextVisibility()
		for (let apply of order) {
			apply(state)
			apply(state)
		}
		expect(state.hidden(atom(1))).toBe(true)
		state.cancel(id(5), id(2, "bob"))
		expect(state.hidden(atom(1))).toBe(true)
		state.cancel(id(6), id(2, "alice"))
		expect(state.hidden(atom(1))).toBe(false)
	}
})

test("an insertion's ownership needs no extra snapshot table", () => {
	let state = new TextVisibility()
	state.cancel(id(2), id(1))
	expect(state.hidden(atom(1))).toBe(true)
	expect(state.hidden(atom(3))).toBe(false)
	state.cancel(id(3), id(2))
	expect(state.hidden(atom(1))).toBe(false)
})

test("snapshot restoration rebuilds derived counts and preserves deletion attribution", () => {
	let state = new TextVisibility()
	state.remove(id(2), [atom(1), atom(1)])
	state.cancel(id(3), id(2))
	let cold = new TextVisibility()
	cold.restore(JSON.parse(JSON.stringify(state.checkpoint())))
	expect(cold.hidden(atom(1))).toBe(false)
	cold.cancel(id(4), id(3))
	expect(cold.hidden(atom(1))).toBe(true)
	cold.cancel(id(5), id(2))
	expect(cold.hidden(atom(1))).toBe(false)
})

test("cyclic, equal-clock and forged duplicate cancellations fail without changing state", () => {
	let state = new TextVisibility()
	state.cancel(id(3), id(2))
	let before = state.checkpoint()
	expect(() => state.cancel(id(2), id(3))).toThrow("clock")
	expect(() => state.cancel(id(2, "bob"), id(2, "alice"))).toThrow("clock")
	expect(() => state.cancel(id(3), id(1))).toThrow("immutable")
	expect(state.checkpoint()).toEqual(before)
})

test("a cancellation arriving before its target removal cannot expose removed text", () => {
	let state = new TextVisibility()
	state.cancel(id(3), id(2))
	state.remove(id(2), [atom(1)])
	expect(state.hidden(atom(1))).toBe(false)
	state.cancel(id(4), id(3))
	expect(state.hidden(atom(1))).toBe(true)
})

test("malformed visibility snapshot cannot replace current state", () => {
	let state = new TextVisibility()
	state.remove(id(2), [atom(1)])
	let before = state.checkpoint()
	expect(() => state.restore({ ...before, cancels: [[id(1), id(2)]] })).toThrow(
		"clock",
	)
	expect(state.checkpoint()).toEqual(before)
})

test("a 20000-deep chain changes visibility iteratively without replaying text", () => {
	let state = new TextVisibility()
	for (let clock = 2; clock <= 20001; clock++)
		state.cancel(id(clock), id(clock - 1))
	expect(state.hidden(atom(1))).toBe(false)
	state.cancel(id(20002), id(20001))
	expect(state.hidden(atom(1))).toBe(true)
})

test("visibility matches an independent oracle across mixed insertions, removals and concurrent actors", () => {
	for (let seed = 1; seed <= 200; seed++) {
		let random = seed
		let nextRandom = () => {
			random = (Math.imul(random, 1664525) + 1013904223) >>> 0
			return random
		}
		let facts: {
			id: string
			cancel?: string
			insert: string[]
			remove: string[]
		}[] = []
		let atoms: string[] = []
		for (let clock = 1; clock <= 40; clock++) {
			let earlier = [...facts]
			let earlierAtoms = [...atoms]
			for (let actor of ["alice", "bob", "charlie"]) {
				let previous = earlier[nextRandom() % Math.max(1, earlier.length)]
				if (previous && nextRandom() % 3)
					facts.push({
						id: id(clock, actor),
						cancel: previous.id,
						insert: [],
						remove: [],
					})
				else {
					let inserted = [atom(clock, actor), atom(clock, actor, 1)]
					let removed =
						earlierAtoms[nextRandom() % Math.max(1, earlierAtoms.length)]
					facts.push({
						id: id(clock, actor),
						insert: inserted,
						remove: removed ? [removed] : [],
					})
					atoms.push(...inserted)
				}
			}
		}
		let cancelled = new Set<string>()
		let removed = new Set<string>()
		for (let fact of [...facts].reverse()) {
			if (cancelled.has(fact.id)) {
				for (let atom of fact.insert) removed.add(atom)
				continue
			}
			if (fact.cancel) cancelled.add(fact.cancel)
			for (let atom of fact.remove) removed.add(atom)
		}
		let order = [...facts]
		for (let position = order.length - 1; position > 0; position--) {
			let other = nextRandom() % (position + 1)
			let left = order[position],
				right = order[other]
			if (left && right) {
				order[position] = right
				order[other] = left
			}
		}
		let state = new TextVisibility()
		for (let fact of order) {
			if (fact.cancel) state.cancel(fact.id, fact.cancel)
			else state.remove(fact.id, fact.remove)
		}
		for (let fact of facts)
			expect(state.active(fact.id)).toBe(!cancelled.has(fact.id))
		for (let atom of atoms) expect(state.hidden(atom)).toBe(removed.has(atom))
		let restored = new TextVisibility()
		restored.restore(JSON.parse(JSON.stringify(state.checkpoint())))
		for (let atom of atoms)
			expect(restored.hidden(atom)).toBe(removed.has(atom))
		for (let fact of facts)
			expect(restored.active(fact.id)).toBe(state.active(fact.id))
	}
})

test("legacy deletion sets remain permanent and old operations cannot be partially undone", () => {
	let state = new TextVisibility({ removed: [atom(1)], clock: 10 })
	expect(state.canUndo(id(2))).toBe(false)
	state.cancel(id(11), id(2))
	expect(state.hidden(atom(1))).toBe(true)
	state.remove(id(11, "own"), [atom(2)])
	state.cancel(id(12), id(11, "own"))
	expect(state.hidden(atom(2))).toBe(false)
	let restored = new TextVisibility()
	restored.restore(JSON.parse(JSON.stringify(state.checkpoint())))
	expect(restored.hidden(atom(1))).toBe(true)
	expect(restored.canUndo(id(3))).toBe(false)
})

test("zero-clock removal provenance is rejected during snapshot restoration", () => {
	let state = new TextVisibility()
	let before = state.checkpoint()
	expect(() =>
		state.restore({ ...before, removals: [[id(0), [atom(1)]]] }),
	).toThrow("clock")
	expect(state.checkpoint()).toEqual(before)
})

test("merging a cold snapshot retains live facts and rejects conflicts atomically", () => {
	let live = new TextVisibility()
	live.remove(id(2, "alice"), [atom(1)])
	let remote = new TextVisibility()
	remote.remove(id(2, "bob"), [atom(1)])
	remote.cancel(id(3), id(2, "bob"))
	live.restore(remote.checkpoint())
	expect(live.hidden(atom(1))).toBe(true)
	live.cancel(id(4), id(2, "alice"))
	expect(live.hidden(atom(1))).toBe(false)
	let before = live.checkpoint()
	expect(() =>
		live.restore({
			...remote.checkpoint(),
			removals: [[id(2, "alice"), [atom(9)]]],
		}),
	).toThrow("immutable")
	expect(live.checkpoint()).toEqual(before)
	live.restore(before)
	expect(live.checkpoint()).toEqual(before)
})

test("a malformed suffix rejects the entire visibility batch", () => {
	let state = new TextVisibility()
	state.remove(id(2), [atom(1)])
	let before = state.checkpoint()
	expect(() =>
		state.apply([
			{ kind: "cancel", id: id(3), target: id(2) },
			{ kind: "remove", id: id(2), atoms: [atom(9)] },
		]),
	).toThrow("immutable")
	expect(state.checkpoint()).toEqual(before)
	expect(state.hidden(atom(1))).toBe(true)
	expect(() =>
		state.apply([
			{ kind: "cancel", id: id(3), target: id(2) },
			{ kind: "remove", id: id(3), atoms: [atom(1)] },
		]),
	).toThrow("immutable")
	expect(state.checkpoint()).toEqual(before)
})

test("migration floors converge even when they arrive after cancellation facts", () => {
	let legacy = new TextVisibility({
		removed: [atom(1, "legacy")],
		clock: 2,
	}).checkpoint()
	let facts = [
		(state: TextVisibility) => state.remove(id(2), [atom(1)]),
		(state: TextVisibility) => state.cancel(id(3), id(2)),
		(state: TextVisibility) => state.restore(legacy),
	]
	let expected: ReturnType<TextVisibility["checkpoint"]> | undefined
	for (let order of permutations(facts)) {
		let state = new TextVisibility()
		for (let apply of order) apply(state)
		expect(state.hidden(atom(1))).toBe(true)
		expect(state.hidden(atom(1, "legacy"))).toBe(true)
		expect(state.canUndo(id(2))).toBe(false)
		expect(state.active(id(2))).toBe(true)
		expected ??= state.checkpoint()
		expect(state.checkpoint()).toEqual(expected)
	}
})

test("canonical snapshots and retries treat deletion membership as a set", () => {
	let first = new TextVisibility(),
		second = new TextVisibility()
	first.remove(id(2), [atom(1), atom(1, "writer", 1)])
	first.cancel(id(4), id(2))
	first.cancel(id(3), id(1))
	second.cancel(id(3), id(1))
	second.cancel(id(4), id(2))
	second.remove(id(2), [atom(1, "writer", 1), atom(1), atom(1)])
	expect(first.checkpoint()).toEqual(second.checkpoint())
	first.remove(id(2), [atom(1, "writer", 1), atom(1)])
	expect(first.checkpoint()).toEqual(second.checkpoint())
	let detached = first.checkpoint()
	Reflect.set(detached.cancels[0] ?? {}, "1", id(8))
	expect(first.checkpoint()).toEqual(second.checkpoint())
})

test("malformed atom ownership and empty removal identities cannot enter snapshots", () => {
	let state = new TextVisibility()
	let before = state.checkpoint()
	for (let invalid of [
		"atom",
		atom(0),
		"9999999999999999:writer:00000000",
		id(1) + ":0",
	])
		expect(() =>
			state.restore({ ...before, removals: [[id(2), [invalid]]] }),
		).toThrow()
	expect(() => state.restore({ ...before, removals: [[id(2), []]] })).toThrow()
	expect(state.checkpoint()).toEqual(before)
})

test("legacy deletion ownership cannot exceed its declared migration floor", () => {
	let state = new TextVisibility()
	let before = state.checkpoint()
	expect(() => new TextVisibility({ removed: [atom(2)], clock: 1 })).toThrow(
		"migration floor",
	)
	expect(() =>
		state.restore({ ...before, legacyRemoved: [atom(2)], floor: 1 }),
	).toThrow("migration floor")
	expect(state.checkpoint()).toEqual(before)
})
