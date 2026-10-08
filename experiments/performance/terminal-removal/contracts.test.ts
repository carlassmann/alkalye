import { expect, test } from "bun:test"
import { Replica } from "../../../src/shared/crdt"

function exactCheckpoint(replica: Replica) {
	let restored = new Replica("restored")
	restored.restore(replica.checkpoint())
	expect(replica.text("doc")).toBe(restored.text("doc"))
	expect(replica.visible("doc")).toEqual(restored.visible("doc"))
	return replica.text("doc")
}
function warmed(source: string) {
	let replica = new Replica("owner")
	replica.edit("doc", source)
	expect(replica.text("doc")).toBe(source)
	return replica
}
for (let source of [
	"Body",
	"Body😀",
	"---\ntitle: Shared\n---\nBody😀",
	"x".repeat(65536),
])
	test("terminal inverse preserves exact warm source " + source.length, () => {
		let owner = warmed(source)
		let append = owner.edit("doc", source + "🌻")
		if (!append) throw Error("Missing append")
		let peer = owner.fork("peer")
		peer.text("doc")
		let inverse = owner.inverse(append)
		peer.apply([inverse])
		expect(exactCheckpoint(owner)).toBe(source)
		expect(exactCheckpoint(peer)).toBe(source)
		owner.apply([inverse])
		expect(exactCheckpoint(owner)).toBe(source)
		let repeated = owner.inverse(inverse)
		peer.apply([repeated])
		expect(exactCheckpoint(owner)).toBe(source + "🌻")
		expect(exactCheckpoint(peer)).toBe(source + "🌻")
	})

test("peer append after the removed atom retains visible descendants", () => {
	let owner = warmed("Body")
	let append = owner.edit("doc", "BodyX")
	if (!append) throw Error("Missing append")
	let peer = owner.fork("peer")
	let peerEdit = peer.edit("doc", "BodyXY")
	if (!peerEdit) throw Error("Missing peer edit")
	owner.apply([peerEdit])
	owner.text("doc")
	let inverse = owner.inverse(append)
	peer.apply([inverse])
	expect(exactCheckpoint(owner)).toBe("BodyY")
	expect(exactCheckpoint(peer)).toBe("BodyY")
})
for (let source of [
	"---\ntitle: Shared\n---x",
	"---\ntitle: Shared\n---\nX",
	"---\ntitle: Shared\n---\n",
	"X",
])
	test(
		"structural terminal removal matches checkpoint rebuild " +
			JSON.stringify(source),
		() => {
			let owner = warmed(source)
			let last = owner.visible("doc").at(-1)
			if (!last) throw Error("Missing last atom")
			let operation = owner.create("doc", "text")
			operation.remove = [last.id]
			owner.apply([operation])
			exactCheckpoint(owner)
		},
	)

test("identity conflict preflight leaves all warm replicas unchanged", () => {
	let owner = warmed("BodyX")
	let peer = owner.fork("peer")
	peer.text("doc")
	let last = owner.visible("doc").at(-1)
	if (!last) throw Error("Missing terminal atom")
	let operation = owner.create("doc", "text")
	operation.remove = [last.id]
	peer.apply([{ ...operation, author: "conflicting" }])
	let before = owner.checkpoint()
	expect(() => Replica.applyTogether([owner, peer], [operation])).toThrow()
	expect(owner.checkpoint()).toEqual(before)
	expect(exactCheckpoint(owner)).toBe("BodyX")
})

for (let values of [
	["a", "b", "tail"],
	["ab", "c", ""],
])
	test(
		"legacy terminal atoms retain rebuilt source " + JSON.stringify(values),
		() => {
			let seed = warmed("abc")
			let snapshot = seed.checkpoint()
			snapshot.targets = snapshot.targets.map(target => ({
				...target,
				atoms: target.atoms.map((atom, index) => ({
					...atom,
					value: values[index] ?? atom.value,
				})),
			}))
			let owner = new Replica("legacy-owner")
			owner.restore(snapshot)
			let before = owner.text("doc")
			let last = owner.visible("doc").at(-1)
			if (!last) throw Error("Missing legacy terminal atom")
			let operation = owner.create("doc", "text")
			operation.remove = [last.id]
			owner.apply([operation])
			expect(exactCheckpoint(owner)).toBe(
				before.slice(0, before.length - last.value.length),
			)
		},
	)

test("malformed terminal-removal identity cannot change warm source", () => {
	let owner = warmed("BodyX")
	let last = owner.visible("doc").at(-1)
	if (!last) throw Error("Missing atom")
	let operation = owner.create("doc", "text")
	operation.id = "invalid"
	operation.remove = [last.id]
	let before = owner.checkpoint()
	expect(() => owner.apply([operation])).toThrow()
	expect(owner.checkpoint()).toEqual(before)
	expect(exactCheckpoint(owner)).toBe("BodyX")
})

test("cancelling accepted terminal removal restores the original visible suffix", () => {
	let owner = warmed("Body😀")
	let last = owner.visible("doc").at(-1)
	if (!last) throw Error("Missing atom")
	let operation = owner.create("doc", "text")
	operation.remove = [last.id]
	owner.apply([operation])
	expect(exactCheckpoint(owner)).toBe("Body")
	owner.cancel("doc", operation.id)
	expect(exactCheckpoint(owner)).toBe("Body😀")
})

for (let depth of [0, 1, 2])
	test(
		"prearrived cancellation chain preserves terminal visibility " + depth,
		() => {
			let owner = warmed("BodyX")
			let last = owner.visible("doc").at(-1)
			if (!last) throw Error("Missing atom")
			let removal = owner.create("doc", "text")
			removal.remove = [last.id]
			let cancellation = owner.create("doc", "cancel")
			cancellation.value = removal.id
			owner.apply([cancellation])
			let latest = cancellation
			for (let index = 0; index < depth; index++) {
				let next = owner.create("doc", "cancel")
				next.value = latest.id
				owner.apply([next])
				latest = next
			}
			owner.text("doc")
			owner.apply([removal])
			expect(exactCheckpoint(owner)).toBe(depth % 2 ? "Body" : "BodyX")
		},
	)

test("completing a concurrent root header preserves projected canonical source", () => {
	let hello = new Replica("zzhello")
	let header = new Replica("aaheader")
	let helloEdit = hello.edit("doc", "Hello")
	let headerEdit = header.edit("doc", "---\na: b\n---x")
	if (!helloEdit || !headerEdit) throw Error("Missing concurrent insert")
	let owner = new Replica("joined")
	owner.apply([helloEdit, headerEdit])
	let before = owner.text("doc")
	expect(before).toBe("Hello---\na: b\n---x")
	let last = owner.visible("doc").at(-1)
	if (!last) throw Error("Missing atom")
	let removal = owner.create("doc", "text")
	removal.remove = [last.id]
	owner.apply([removal])
	expect(exactCheckpoint(owner)).not.toBe(before.slice(0, -1))
})
