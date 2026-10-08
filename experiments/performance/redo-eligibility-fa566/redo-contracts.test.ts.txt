import { expect, test } from "bun:test"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"
import { changeMetadata } from "../src/shared/document-metadata"

function scenario(body = "Body😀", header = false) {
	let owner = new Replica("owner")
	if (header) {
		newDocument(owner, "doc", "Original", body)
		changeMetadata(owner, "doc", { title: "Renamed title" })
	} else owner.edit("doc", body)
	let before = owner.text("doc")
	let insertion = owner.edit("doc", before + "🌻")
	if (!insertion) throw Error("Missing insertion")
	let undo = owner.cancel("doc", insertion.id)
	let redo = owner.create("doc", "cancel")
	redo.value = undo.id
	return { owner, before, insertion, undo, redo }
}
function equivalent(owner: Replica) {
	let restored = new Replica("reader")
	restored.restore(owner.checkpoint())
	expect(owner.text("doc")).toBe(restored.text("doc"))
	expect(owner.visible("doc")).toEqual(restored.visible("doc"))
	expect(owner.metadata("doc")).toEqual(restored.metadata("doc"))
}
for (let header of [false, true])
	for (let body of ["Body", "Body😀", "Body" + "z".repeat(65536)])
		test(
			"terminal redo with duplicate ACK and distinct views " +
				header +
				":" +
				body.length,
			() => {
				let { owner, before, undo, redo } = scenario(body, header)
				let afterUndo = owner.visible("doc")
				let generation = owner.generation
				Replica.applyTogether([owner], [undo])
				expect(owner.generation).toBe(generation + 1)
				expect(owner.visible("doc")).toBe(afterUndo)
				let peer = owner.fork("peer")
				Replica.applyTogether([owner, peer], [redo])
				expect(owner.text("doc")).toBe(before + "🌻")
				expect(owner.visible("doc")).not.toBe(afterUndo)
				equivalent(owner)
				equivalent(peer)
				Replica.applyTogether([owner, peer], [redo])
				equivalent(owner)
				equivalent(peer)
				let secondUndo = owner.cancel("doc", redo.id)
				peer.apply([secondUndo])
				expect(owner.text("doc")).toBe(before)
				equivalent(owner)
				equivalent(peer)
			},
		)
for (let interruption of [
	"metadata",
	"other-target",
	"peer-prefix",
	"restore",
	"restored-reader",
])
	test("terminal redo after intervening " + interruption, () => {
		let { owner, redo } = scenario("Body😀", true)
		if (interruption === "metadata") owner.set("doc", "pinned", "true")
		if (interruption === "other-target") owner.edit("other", "Peer")
		if (interruption === "peer-prefix")
			owner.edit("doc", "Prefix " + owner.text("doc"))
		if (interruption === "restore") owner.restore(owner.checkpoint())
		if (interruption === "restored-reader") {
			let restored = new Replica("reader")
			restored.restore(owner.checkpoint())
			restored.apply([...owner.operations.values()])
			owner = restored
		}
		owner.apply([redo])
		equivalent(owner)
	})
for (let depth of [0, 1, 2])
	test("prearrived redo cancellation chain " + depth, () => {
		let { owner, before, redo } = scenario("Body😀", true)
		let later = owner.create("doc", "cancel")
		later.value = redo.id
		let operations = [later]
		for (let index = 0; index < depth; index++) {
			let next = owner.create("doc", "cancel")
			next.value = operations.at(-1)?.id ?? ""
			operations.push(next)
		}
		owner.apply(operations.reverse())
		owner.apply([redo])
		expect(owner.text("doc")).toBe(before + (depth % 2 ? "🌻" : ""))
		equivalent(owner)
	})
test("malformed redo batch rejects atomically and retains valid redo", () => {
	let { owner, before, redo } = scenario("Body😀", true)
	let other = owner.create("doc", "cancel")
	other.value = "not-an-operation"
	expect(() =>
		Replica.applyTogether([owner, owner.fork("peer")], [redo, other]),
	).toThrow()
	expect(owner.text("doc")).toBe(before)
	owner.apply([redo])
	expect(owner.text("doc")).toBe(before + "🌻")
	equivalent(owner)
	expect(() => owner.apply([{ ...redo, value: other.id }])).toThrow()
	equivalent(owner)
})
test("wrong-target redo cannot alter original document", () => {
	let { owner, before, redo } = scenario()
	owner.apply([{ ...redo, target: "other" }])
	expect(owner.text("doc")).toBe(before)
	let replayed = new Replica("reader")
	replayed.apply([...owner.operations.values()])
	expect(owner.text("doc")).toBe(replayed.text("doc"))
	expect(owner.visible("doc")).toEqual(replayed.visible("doc"))
})
for (let inserted of ["x", "\n", "🌻"])
	test(
		"terminal redo cycles restore scalar " + JSON.stringify(inserted),
		() => {
			let owner = new Replica("cycles")
			owner.edit("doc", "Body😀")
			let insertion = owner.edit("doc", "Body😀" + inserted)
			if (!insertion) throw Error("Missing insertion")
			for (let count = 0; count < 3; count++) {
				let undo = owner.cancel("doc", insertion.id)
				expect(owner.text("doc")).toBe("Body😀")
				equivalent(owner)
				owner.apply([undo])
				let redo = owner.create("doc", "cancel")
				redo.value = undo.id
				Replica.applyTogether([owner, owner], [redo])
				expect(owner.text("doc")).toBe("Body😀" + inserted)
				equivalent(owner)
			}
		},
	)
test("mixed duplicate and new batch cannot retain an old terminal redo projection", () => {
	let { owner, undo, redo } = scenario()
	let peer = owner.fork("peer")
	let change = peer.edit("doc", "Prefix " + peer.text("doc"))
	if (!change) throw Error("Missing change")
	owner.apply([undo, change])
	owner.apply([redo])
	expect(owner.text("doc")).toBe("Prefix Body😀🌻")
	equivalent(owner)
})
test("fork divergence retains only each replica's own source", () => {
	let { owner, before, redo } = scenario()
	let peer = owner.fork("peer")
	peer.edit("doc", "Prefix " + peer.text("doc"))
	Replica.applyTogether([owner, peer], [redo])
	expect(owner.text("doc")).toBe(before + "🌻")
	expect(peer.text("doc")).toBe("Prefix " + before + "🌻")
	equivalent(owner)
	equivalent(peer)
})
test("lower-clock redo rejects before publication", () => {
	let { owner, before, undo, redo } = scenario()
	let invalid = {
		...redo,
		clock: undo.clock,
		id: undo.id.slice(0, 16) + ":different-actor",
		actor: "different-actor",
	}
	expect(() => owner.apply([invalid])).toThrow()
	expect(owner.text("doc")).toBe(before)
	owner.apply([redo])
	expect(owner.text("doc")).toBe(before + "🌻")
	equivalent(owner)
})
for (let source of ["Body\n--", "---\ntitle: T\n--", "---\ntitle: T\n---\n"])
	test(
		"structural terminal insertion redo matches rebuilt source " +
			JSON.stringify(source),
		() => {
			let owner = new Replica("fence")
			owner.edit("doc", source)
			let original = owner.text("doc")
			let insertion = owner.edit("doc", original + "-")
			if (!insertion) throw Error("Missing insertion")
			let undo = owner.cancel("doc", insertion.id)
			equivalent(owner)
			let redo = owner.create("doc", "cancel")
			redo.value = undo.id
			owner.apply([redo])
			equivalent(owner)
		},
	)
