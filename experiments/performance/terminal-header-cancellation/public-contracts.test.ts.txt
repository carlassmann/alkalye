import { expect, test } from "bun:test"
import { Replica } from "../src/shared/crdt"
import {
	changeMetadata,
	documentMetadata,
} from "../src/shared/document-metadata"
import { newDocument } from "../src/shared/documents"

function derived(body: string) {
	let owner = new Replica("header-owner")
	newDocument(owner, "doc", "Original", body)
	changeMetadata(owner, "doc", {
		title: "A longer renamed title",
		tags: ["blue", "red"],
	})
	changeMetadata(owner, "doc", { title: "Short", pinned: true })
	let source = owner.text("doc")
	expect(documentMetadata(source).title).toBe("Short")
	return { owner, source }
}
function rebuilt(owner: Replica) {
	let restored = new Replica("checkpoint-reader")
	restored.restore(owner.checkpoint())
	expect(owner.text("doc")).toBe(restored.text("doc"))
	expect(owner.visible("doc")).toEqual(restored.visible("doc"))
	expect(owner.metadata("doc")).toEqual(restored.metadata("doc"))
	return owner.text("doc")
}

for (let body of [
	"",
	"Body",
	"Body😀",
	"\nBody\n",
	"Body\n---x",
	"Body" + "z".repeat(65536),
])
	test(
		"derived header body cancellation, redelivery and redo preserve both views " +
			body.length,
		() => {
			let { owner, source } = derived(body)
			let inserted = owner.edit("doc", source + "🌻")
			if (!inserted) throw Error("Missing insertion")
			let peer = owner.fork("peer")
			peer.text("doc")
			let cancellation = owner.cancel("doc", inserted.id)
			peer.apply([cancellation])
			expect(rebuilt(owner)).toBe(source)
			expect(rebuilt(peer)).toBe(source)
			Replica.applyTogether([owner, peer], [cancellation])
			expect(rebuilt(owner)).toBe(source)
			let redo = owner.create("doc", "cancel")
			redo.value = cancellation.id
			Replica.applyTogether([owner, peer], [redo])
			expect(rebuilt(owner)).toBe(source + "🌻")
			expect(rebuilt(peer)).toBe(source + "🌻")
			let again = owner.cancel("doc", inserted.id)
			peer.apply([again])
			expect(rebuilt(owner)).toBe(source)
			expect(rebuilt(peer)).toBe(source)
		},
	)

test("concurrent header edits and peer body prefix survive terminal cancellation", () => {
	let { owner, source } = derived("Body😀")
	let peer = owner.fork("peer")
	let inserted = owner.edit("doc", source + "X")
	if (!inserted) throw Error("Missing insertion")
	let changed = changeMetadata(peer, "doc", {
		title: "Peer title",
		tags: ["green"],
	})
	owner.apply(changed.filter(operation => operation !== null))
	peer.apply([inserted])
	let peerSource = peer.text("doc")
	let offset = peerSource.indexOf("Body")
	let prefix = peer.edit(
		"doc",
		peerSource.slice(0, offset) + "Peer " + peerSource.slice(offset),
	)
	if (!prefix) throw Error("Missing prefix")
	owner.apply([prefix])
	let before = owner.text("doc")
	let cancellation = owner.cancel("doc", inserted.id)
	peer.apply([cancellation])
	expect(rebuilt(owner)).toBe(before.slice(0, -1))
	expect(rebuilt(peer)).toBe(before.slice(0, -1))
	expect(owner.metadata("doc").title).toBe("Peer title")
	expect(owner.metadata("doc").tags).toEqual(["green"])
})

for (let depth of [0, 1, 2])
	test(
		"prearrived cancellation chain preserves merged header body " + depth,
		() => {
			let { owner, source } = derived("Body")
			let inserted = owner.edit("doc", source + "X")
			if (!inserted) throw Error("Missing insertion")
			let cancellation = owner.create("doc", "cancel")
			cancellation.value = inserted.id
			let latest = owner.create("doc", "cancel")
			latest.value = cancellation.id
			owner.apply([latest])
			for (let index = 0; index < depth; index++) {
				let next = owner.create("doc", "cancel")
				next.value = latest.id
				owner.apply([next])
				latest = next
			}
			owner.text("doc")
			owner.apply([cancellation])
			expect(rebuilt(owner)).toBe(depth % 2 ? source : source + "X")
		},
	)

test("concurrent duplicate cancels and their undos preserve derived body", () => {
	let { owner, source } = derived("Body")
	let inserted = owner.edit("doc", source + "X")
	if (!inserted) throw Error("Missing insertion")
	let peer = owner.fork("peer")
	peer.text("doc")
	let first = owner.cancel("doc", inserted.id)
	let second = peer.cancel("doc", inserted.id)
	Replica.applyTogether([owner, peer], [first, second])
	expect(rebuilt(owner)).toBe(source)
	for (let original of [first, second]) {
		let undo = owner.create("doc", "cancel")
		undo.value = original.id
		Replica.applyTogether([owner, peer], [undo])
	}
	expect(rebuilt(owner)).toBe(source + "X")
	expect(rebuilt(peer)).toBe(source + "X")
})

test("visible peer descendant remains after cancelling its parent beside merged header", () => {
	let { owner, source } = derived("Body")
	let inserted = owner.edit("doc", source + "X")
	if (!inserted) throw Error("Missing insertion")
	let peer = owner.fork("peer")
	let descendant = peer.edit("doc", source + "XY")
	if (!descendant) throw Error("Missing descendant")
	owner.apply([descendant])
	owner.text("doc")
	let cancellation = owner.cancel("doc", inserted.id)
	peer.apply([cancellation])
	expect(rebuilt(owner)).toBe(source + "Y")
	expect(rebuilt(peer)).toBe(source + "Y")
})

test("atomic malformed cancellation cannot publish either derived cache", () => {
	let { owner, source } = derived("Body")
	let inserted = owner.edit("doc", source + "X")
	if (!inserted) throw Error("Missing insertion")
	let peer = owner.fork("peer")
	peer.text("doc")
	let operation = owner.create("doc", "cancel")
	operation.value = inserted.id
	let before = owner.checkpoint()
	expect(() =>
		Replica.applyTogether([owner, peer], [{ ...operation, clock: 0 }]),
	).toThrow()
	expect(owner.checkpoint()).toEqual(before)
	expect(rebuilt(owner)).toBe(source + "X")
	expect(rebuilt(peer)).toBe(source + "X")
})
