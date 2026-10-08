import { expect, test } from "bun:test"
import { Replica } from "../../../src/shared/crdt"

function branches() {
	let owner = new Replica("owner")
	owner.edit("doc", "---\ntitle: Notes\n---\nHello 😀")
	owner.set("doc", "note", "Saved")
	return { owner, peer: owner.fork("peer"), last: owner.fork("last") }
}

test("atomic batch facts remain independent of caller, exposed histories and later forks", () => {
	let { owner, peer, last } = branches()
	let next = owner.text("doc") + " Branch 🦋"
	let operation = owner.prepareEdit("doc", next)
	if (!operation) throw Error("Missing operation")
	Replica.applyTogether([owner, peer, last], [operation])
	let author = operation.author
	let before = owner.checkpoint()
	operation.author = "Caller mutation"
	operation.target = "another-document"
	let incomingAtom = operation.insert[0]
	if (!incomingAtom) throw Error("Missing incoming atom")
	incomingAtom.value = "Poison"
	let exposed = peer.operations.get(operation.id)
	let visible = peer.visible("doc")[0]
	if (!exposed || !visible) throw Error("Missing exposed state")
	Reflect.set(exposed, "author", "History mutation")
	Reflect.set(exposed.remove, "0", "Unknown removal")
	Reflect.set(visible, "value", "Visible mutation")
	let detached = last.checkpoint()
	let atom = detached.targets[0]?.atoms[0]
	if (!atom) throw Error("Missing detached atom")
	atom.value = "Snapshot mutation"
	let late = peer.fork("late")
	for (let replica of [owner, peer, last, late]) {
		expect(replica.operations.get(operation.id)?.author).toBe(author)
		expect(replica.text("doc")).toBe(next)
		expect(replica.checkpoint()).toEqual(before)
		expect(replica.fields("doc").note).toBe("Saved")
	}
	let cancellation = late.cancel("doc", operation.id)
	expect(owner.text("doc")).toBe(next)
	Replica.applyTogether([owner, peer, last], [cancellation])
	expect(owner.text("doc")).toBe(late.text("doc"))
})

test("no-member atomic application preserves its existing no-op contract", () => {
	let replica = new Replica("owner")
	let operation = replica.create("doc", "text")
	operation.clock = Number.NaN
	expect(() => Replica.applyTogether([], [operation])).not.toThrow()
	expect(() => Replica.applyTogether([replica], [operation])).toThrow()
	expect(replica.text("doc")).toBe("")
})

test("last-replica identity conflict rejects every batch member before publication", () => {
	let { owner, peer, last } = branches()
	let operation = owner.prepareEdit("doc", owner.text("doc") + " proposed")
	if (!operation) throw Error("Missing operation")
	last.apply([{ ...operation, author: "conflicting author" }])
	let checkpoints = [owner, peer, last].map(replica => replica.checkpoint())
	expect(() =>
		Replica.applyTogether([owner, peer, last], [operation]),
	).toThrow()
	for (let [index, replica] of [owner, peer, last].entries()) {
		let expected = checkpoints[index]
		if (!expected) throw Error("Missing baseline")
		expect(replica.checkpoint()).toEqual(expected)
	}
})

test("duplicate batch members retain prepared Unicode edits and replay idempotence", () => {
	let { owner, peer, last } = branches()
	let next = owner.text("doc") + "\r\n🦋 suffix"
	let operation = owner.prepareEdit("doc", next)
	if (!operation) throw Error("Missing operation")
	Replica.applyTogether([owner, peer, owner, last], [operation])
	let snapshots = [owner, peer, last].map(replica => replica.checkpoint())
	Replica.applyTogether([owner, peer, last], [operation])
	for (let [index, replica] of [owner, peer, last].entries()) {
		expect(replica.text("doc")).toBe(next)
		let expected = snapshots[index]
		if (!expected) throw Error("Missing baseline")
		expect(replica.checkpoint()).toEqual(expected)
	}
	let cancellation = peer.cancel("doc", operation.id)
	Replica.applyTogether([owner, peer, last], [cancellation])
	for (let replica of [owner, peer, last])
		expect(replica.text("doc")).toBe(branches().owner.text("doc"))
})
