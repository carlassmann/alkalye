import { expect, test } from "bun:test"
import * as Schema from "effect/Schema"
import { textSplices } from "../../src/shared/text-splices"
import { SourceReplica, SourceSnapshotSchema } from "./replica"
import { frontmatter } from "../../src/shared/markdown"

function fork(source: SourceReplica, actor: string) {
	let peer = new SourceReplica(actor)
	peer.restore(
		Schema.decodeUnknownSync(SourceSnapshotSchema)(
			JSON.parse(JSON.stringify(source.snapshot())),
		),
	)
	return peer
}
function exchange(a: SourceReplica, b: SourceReplica) {
	a.restore(b.snapshot())
	b.restore(a.snapshot())
	expect(a.text()).toBe(b.text())
}

test("source atoms reject conflicting identities before mutating the replica", () => {
	let source = new SourceReplica("a")
	let change = source.edit("AB")
	let atom = change?.insert[0]
	if (!change || !atom) throw new Error("Missing source edit")
	let before = source.snapshot()
	expect(() =>
		source.apply({
			id: "forged",
			clock: 999,
			insert: [
				{ id: "new", after: "", value: "X" },
				{ ...atom, value: "Z" },
			],
			remove: [atom.id],
		}),
	).toThrow("identity is immutable")
	expect(source.snapshot()).toEqual(before)
	expect(() =>
		source.apply({
			...change,
			insert: [{ ...atom, after: "elsewhere" }],
		}),
	).toThrow("identity is immutable")
	expect(source.text()).toBe("AB")
})

test("changes and snapshots cannot mutate live source atoms or slot ancestry", () => {
	let source = new SourceReplica("a")
	let initial = source.edit("T", undefined, "title")
	if (!initial) throw new Error("Missing source edit")
	let atom = initial.insert[0]
	if (!atom) throw new Error("Missing source atom")
	Object.assign(atom, { value: "Z" })
	expect(source.text()).toBe("T")
	source.edit("A", undefined, "title")
	let snapshot = source.snapshot()
	for (let atom of snapshot.atoms) Object.assign(atom, { value: "X" })
	for (let slot of snapshot.slots)
		Object.assign(slot.supersedes, { 0: "unknown" })
	expect(source.text()).toBe("A")
	let pristine = source.snapshot()
	expect(pristine.atoms.some(atom => atom.value === "T")).toBe(true)
	expect(pristine.slots.at(-1)?.supersedes).toEqual([initial.id])
})
test("multiple distant splices retain unchanged source atoms", () => {
	let source = new SourceReplica("base")
	let original = "---\ntitle: T\nsummary: Preserve\ntags: [one]\n---\nBody"
	source.edit(original)
	let ids = source
		.visible()
		.slice(original.indexOf("summary"), original.indexOf("tags"))
		.map(atom => atom.id)
	source.edit(
		original
			.replace("title: T", "title: New")
			.replace("tags: [one]", "tags: [two]"),
	)
	expect(
		source
			.visible()
			.filter(atom => ids.includes(atom.id))
			.map(atom => atom.id),
	).toEqual(ids)
})
test("header comments, EOF formatting and incomplete keys cannot overwrite untouched peer values", () => {
	for (let [original, local] of [
		["---\n# c\ntitle: T\n---\nBody", "---\n# d\ntitle: T\n---\nBody"],
		["---\ntitle: T\n---", "---\ntitle: T\n---\n"],
		["---\ntitle: T\n---\nBody", "---\ntitle: T\nx\n---\nBody"],
	]) {
		if (original === undefined || local === undefined)
			throw new Error("Missing case")
		let base = new SourceReplica("base")
		base.edit(original)
		let a = fork(base, "a"),
			z = fork(base, "z")
		a.edit(original.replace("title: T", "title: Peer"))
		z.edit(local)
		exchange(a, z)
		expect(a.text()).toContain("title: Peer")
	}
})
test("separators, duplicate keys, CRLF and arbitrary YAML survive local edits byte for byte", () => {
	for (let original of [
		"---\ntitle: T\ntitle: U\n---\nBody",
		"\uFEFF---\r\nm: {x: 1,\r\ny: 2}\r\n---\r\nBody",
		"---\ntitle: &n T\nalias: *n\n---\nBody",
	]) {
		let source = new SourceReplica("a")
		source.edit(original)
		let next = original.replace("Body", "Changed 👋")
		source.edit(next)
		expect(source.text()).toBe(next)
	}
})
test("stale composition preserves unseen peer text and unchanged header entries", () => {
	let source = new SourceReplica("a")
	let original = "---\n# c\ntitle: T\n---\nBody"
	source.edit(original)
	let base = source.visible(),
		peer = fork(source, "b")
	peer.edit(original.replace("title: T", "title: Peer") + "!")
	source.restore(peer.snapshot())
	source.edit(original.replace("# c", "# d"), base)
	expect(source.text()).toBe("---\n# d\ntitle: Peer\n---\nBody!")
})
test("selective undo leaves an unrelated peer source edit and redo restores the local edit", () => {
	let source = new SourceReplica("a")
	let original = "---\n# c\ntitle: T\n---\nBody"
	source.edit(original)
	let peer = fork(source, "b")
	let local = source.edit(original.replace("# c", "# d"))
	if (!local) throw new Error("Missing edit")
	peer.edit(original.replace("title: T", "title: Peer"))
	exchange(source, peer)
	let undo = source.inverse(local)
	expect(source.text()).toBe("---\n# c\ntitle: Peer\n---\nBody")
	source.inverse(undo)
	expect(source.text()).toBe("---\n# d\ntitle: Peer\n---\nBody")
})
test("diff splices reconstruct every short input pair and minimize edit count", () => {
	let inputs = [""]
	for (let depth = 0; depth < 4; depth++)
		for (let prefix of [...inputs].filter(value => value.length === depth))
			for (let character of ["a", "b"]) inputs.push(prefix + character)
	for (let before of inputs)
		for (let after of inputs) {
			let result = Array.from(before),
				splices = textSplices(result, Array.from(after))
			for (let splice of [...splices].reverse())
				result.splice(splice.start, splice.remove, ...splice.insert)
			expect(result.join("")).toBe(after)
			let cost = splices.reduce(
				(total, splice) => total + splice.remove + splice.insert.length,
				0,
			)
			expect(cost).toBe(distance(before, after))
		}
})
function distance(before: string, after: string) {
	let costs = Array.from({ length: after.length + 1 }, (_, index) => index)
	for (let i = 1; i <= before.length; i++) {
		let previous = costs[0] ?? 0
		costs[0] = i
		for (let j = 1; j <= after.length; j++) {
			let old = costs[j] ?? 0
			costs[j] =
				before[i - 1] === after[j - 1]
					? previous
					: Math.min((costs[j - 1] ?? 0) + 1, old + 1)
			previous = old
		}
	}
	return costs.at(-1) ?? 0
}
test("identical concurrent boolean commands expose plain text merge's metadata limitation", () => {
	let base = new SourceReplica("base"),
		original = "---\npinned: false\n---\nBody"
	base.edit(original)
	let a = fork(base, "a"),
		b = fork(base, "b")
	a.edit(original.replace("false", "true"))
	b.edit(original.replace("false", "true"))
	exchange(a, b)
	expect(frontmatter(a.text()).data.pinned).not.toBe(true)
	console.log("COUNTEREXAMPLE", JSON.stringify(a.text()))
})

test("three source writers converge across delayed edits and snapshot-only reopening", () => {
	for (let seed = 1; seed <= 100; seed++) {
		let random = seed
		function pick(limit: number) {
			random = (Math.imul(random, 1664525) + 1013904223) >>> 0
			return random % limit
		}
		let base = new SourceReplica("base")
		base.edit("---\ntitle: T\n---\nBody 👋")
		let writers = [fork(base, "a"), fork(base, "b"), fork(base, "c")]
		for (let step = 0; step < 24; step++) {
			let writer = writers[pick(writers.length)]
			if (!writer) throw new Error("Missing writer")
			let characters = Array.from(writer.text()),
				position = pick(characters.length + 1)
			if (pick(3) === 0) characters.splice(position, 2)
			else characters.splice(position, 0, String(step), "🦊")
			writer.edit(characters.join(""))
			if (pick(3) === 0)
				for (let other of writers)
					if (other !== writer && pick(2) === 0)
						other.restore(writer.snapshot())
		}
		let snapshots = writers.map(writer => writer.snapshot())
		for (let writer of writers)
			for (let snapshot of [...snapshots].reverse()) writer.restore(snapshot)
		let first = writers[0]
		if (!first) throw new Error("Missing writer")
		let expected = first.text()
		expect(writers.every(writer => writer.text() === expected)).toBe(true)
		let reopened = new SourceReplica("reopened")
		reopened.restore(
			Schema.decodeUnknownSync(SourceSnapshotSchema)(
				JSON.parse(JSON.stringify(first.snapshot())),
			),
		)
		expect(reopened.text()).toBe(expected)
	}
})

test("selective undo must not resurrect a character independently deleted by a peer", () => {
	let source = new SourceReplica("a")
	source.edit("ABC")
	let peer = fork(source, "b")
	let local = source.edit("AC")
	if (!local) throw new Error("Missing deletion")
	peer.edit("AC")
	exchange(source, peer)
	source.inverse(local)
	expect(source.text()).toBe("AC")
})

test("undo and redo are replicated intent changes, including independently deleted characters", () => {
	let source = new SourceReplica("a")
	source.edit("ABC")
	let peer = fork(source, "b")
	let a = source.edit("AC"),
		b = peer.edit("AC")
	if (!a || !b) throw new Error("Missing deletion")
	exchange(source, peer)
	let undoA = source.inverse(a)
	exchange(source, peer)
	expect(peer.text()).toBe("AC")
	let undoB = peer.inverse(b)
	exchange(source, peer)
	expect(source.text()).toBe("ABC")
	source.inverse(undoA)
	exchange(source, peer)
	expect(source.text()).toBe("AC")
	peer.inverse(undoB)
	exchange(source, peer)
	expect(source.text()).toBe("AC")
})

test("independent undo of the same source change restores its original atoms once", () => {
	let source = new SourceReplica("a")
	source.edit("ABC")
	let deletion = source.edit("AC")
	if (!deletion) throw new Error("Missing deletion")
	let peer = fork(source, "b"),
		originalIds = source.snapshot().atoms.map(atom => atom.id)
	source.inverse(deletion)
	peer.inverse(deletion)
	exchange(source, peer)
	expect(source.text()).toBe("ABC")
	expect(source.visible().map(atom => atom.id)).toEqual(originalIds)
})
