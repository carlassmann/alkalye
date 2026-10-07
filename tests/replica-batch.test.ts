import { expect, test } from "bun:test"
import { Replica } from "../src/shared/crdt"

function replicas(source = "---\ntitle: Shared notes\n---\nHello 😀") {
	let owner = new Replica("owner", "Owner")
	owner.edit("document", source)
	return { owner, peer: owner.fork("peer"), last: owner.fork("last"), source }
}

test("an atomic replica batch validates the last replica before publishing any changes", () => {
	let { owner, peer, last, source } = replicas()
	let operation = owner.prepareEdit("document", source + " 🌻")
	if (!operation) throw new Error("Missing prepared edit")
	last.apply([{ ...operation, author: "Conflicting identity" }])
	let before = [owner, peer, last].map(replica => ({
		checkpoint: replica.checkpoint(),
		generation: replica.generation,
		source: replica.text("document"),
	}))
	expect(() =>
		Replica.applyTogether([owner, peer, last], [operation]),
	).toThrow()
	for (let [index, replica] of [owner, peer, last].entries()) {
		let snapshot = before[index]
		if (!snapshot) throw new Error("Missing replica snapshot")
		expect(replica.checkpoint()).toEqual(snapshot.checkpoint)
		expect(replica.generation).toBe(snapshot.generation)
		expect(replica.text("document")).toBe(snapshot.source)
	}
	Replica.applyTogether([owner, peer, owner], [operation])
	expect(owner.generation).toBe((before[0]?.generation ?? 0) + 1)
	expect(owner.text("document")).toBe(source + " 🌻")
	expect(peer.text("document")).toBe(owner.text("document"))
	expect(
		owner
			.visible("document")
			.map(atom => atom.value)
			.join(""),
	).toBe(source + " 🌻")
	operation.author = "Mutated after publication"
	expect(owner.checkpoint()).toEqual(peer.checkpoint())
	expect(() => owner.validate([operation])).toThrow()
	expect(() => peer.validate([operation])).toThrow()
})

test("atomic replica batches merge concurrent text and metadata and preserve causal undo", () => {
	let { owner, peer, last, source } = replicas()
	let ownerEdit = owner.prepareEdit("document", "Owner 🦋\n" + source)
	let peerEdit = peer.prepareEdit("document", source + "\nPeer 🌻")
	if (!ownerEdit || !peerEdit) throw new Error("Missing concurrent edits")
	Replica.applyTogether([owner, peer, last], [ownerEdit, peerEdit])
	let title = peer.set("document", "title", "Concurrent title")
	Replica.applyTogether([owner, peer, last], [title, peerEdit])
	for (let replica of [owner, peer, last]) {
		expect(replica.text("document")).toContain("Owner 🦋")
		expect(replica.text("document")).toContain("Peer 🌻")
		expect(replica.metadata("document").title).toBe("Concurrent title")
	}
	let undo = owner.cancel("document", ownerEdit.id)
	if (!undo) throw new Error("Missing undo")
	Replica.applyTogether([owner, peer, last], [undo])
	for (let replica of [owner, peer, last]) {
		expect(replica.text("document")).not.toContain("Owner 🦋")
		expect(replica.text("document")).toContain("Peer 🌻")
		expect(replica.checkpoint()).toEqual(owner.checkpoint())
	}
})

test("atomic removal and cancellation batches keep forked visibility histories independent", () => {
	let owner = new Replica("owner")
	owner.edit("document", "ABC 😀 DEF")
	owner.edit("document", "ABC 😀")
	let peer = owner.fork("peer")
	let last = owner.fork("last")
	let operation = owner.prepareEdit("document", "A 😀")
	if (!operation) throw new Error("Missing removal")
	Replica.applyTogether([owner, peer, last], [operation])
	for (let replica of [owner, peer, last])
		expect(replica.text("document")).toBe("A 😀")
	let undo = owner.cancel("document", operation.id)
	if (!undo) throw new Error("Missing undo")
	expect(peer.text("document")).toBe("A 😀")
	expect(last.text("document")).toBe("A 😀")
	Replica.applyTogether([owner, peer, last], [undo])
	for (let replica of [owner, peer, last])
		expect(replica.text("document")).toBe("ABC 😀")
})
