import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Replica } from "../src/shared/crdt"
import type { LegacyReplicaCheckpoint } from "../src/shared/checkpoint"

test("siblings and parent remain independent through sustained edits and repeated fork", async () => {
	let owner = new Replica("owner")
	let source = "Body 😀"
	if (!owner.edit("document", source)) throw Error("Missing seed")
	for (let index = 0; index < 260; index++) {
		source += "x"
		if (!owner.edit("document", source)) throw Error("Missing history edit")
	}
	let first = owner.fork("first")
	let second = owner.fork("second")
	let retained = owner.checkpoint()
	let firstEdit = first.edit("document", source + "First 🦋")
	let secondEdit = second.edit("document", "Second 🌻" + source)
	let ownerEdit = owner.edit("document", source + "Owner")
	if (!firstEdit || !secondEdit || !ownerEdit)
		throw Error("Missing branch edit")
	expect(first.text("document")).toBe(source + "First 🦋")
	expect(second.text("document")).toBe("Second 🌻" + source)
	expect(owner.text("document")).toBe(source + "Owner")
	for (let atom of firstEdit.insert) {
		expect(owner.atomTarget(atom.id)).toBeUndefined()
		expect(second.atomTarget(atom.id)).toBeUndefined()
	}
	for (let atom of ownerEdit.insert)
		expect(first.atomTarget(atom.id)).toBeUndefined()
	first.apply([secondEdit, ownerEdit])
	second.apply([firstEdit, ownerEdit])
	owner.apply([firstEdit, secondEdit])
	expect(first.text("document")).toBe(owner.text("document"))
	expect(second.text("document")).toBe(owner.text("document"))
	let cold = new Replica("cold")
	cold.restore(retained)
	expect(cold.text("document")).toBe(source)
	let another = await Effect.runPromise(
		Replica.fromCheckpointEffect(owner.checkpoint(), "another"),
	)
	expect(another.text("document")).toBe(owner.text("document"))
})

test("legacy arbitrary UTF16 atom identities survive fork and cold restore", () => {
	let snapshot: LegacyReplicaCheckpoint = {
		format: "alkalye-state-v1",
		clock: 1,
		restored: [],
		targets: [
			{
				id: "document",
				created: 1,
				updated: 1,
				fields: [],
				removed: [],
				atoms: [
					{ id: "legacy/first/🌻", after: "", value: "A" },
					{
						id: "odd:ordinal-not-decimal",
						after: "legacy/first/🌻",
						value: "😀",
					},
					{
						id: "\uD800-old-id",
						after: "odd:ordinal-not-decimal",
						value: "B\r\n",
					},
				],
			},
		],
	}
	let owner = new Replica("owner")
	owner.restore(snapshot)
	expect(owner.text("document")).toBe("A😀B\r\n")
	let peer = owner.fork("peer")
	for (let atom of snapshot.targets[0]?.atoms ?? []) {
		expect(owner.atomTarget(atom.id)).toBe("document")
		expect(peer.atomTarget(atom.id)).toBe("document")
	}
	let cold = new Replica("cold")
	cold.restore(peer.checkpoint())
	expect(cold.text("document")).toBe(owner.text("document"))
	let before = peer.checkpoint()
	let added = owner.edit("document", owner.text("document") + "Owner")
	if (!added) throw Error("Missing legacy append")
	expect(peer.checkpoint()).toEqual(before)
	for (let atom of added.insert)
		expect(peer.atomTarget(atom.id)).toBeUndefined()
})

test("forked concurrent insertions survive cold restore without changing their owner", () => {
	let owner = new Replica("owner")
	let source =
		"---\ntitle: Draft\n---\n\n" + "abcdefghijklmnop".repeat(512) + "😀 ending"
	if (!owner.edit("document", source)) throw Error("Missing seed")
	let before = owner.revision("document")
	let first = owner.fork("first")
	let second = owner.fork("second")
	let firstEdit = first.edit("document", source.replace("😀", "First 😀"))
	let secondEdit = second.edit("document", source.replace("😀", "Second 😀"))
	if (!firstEdit || !secondEdit) throw Error("Missing branch edit")
	for (let branch of [first, second]) {
		let cold = new Replica("cold")
		cold.restore(branch.checkpoint())
		expect(cold.text("document")).toBe(branch.text("document"))
		expect(cold.revision("document")).toBe(branch.revision("document"))
	}
	expect(owner.text("document")).toBe(source)
	expect(owner.revision("document")).toBe(before)
	first.apply([secondEdit])
	second.apply([firstEdit])
	expect(first.text("document")).toBe(second.text("document"))
	for (let branch of [first, second]) {
		let cold = new Replica("cold")
		cold.restore(branch.checkpoint())
		expect(cold.text("document")).toBe(branch.text("document"))
		expect(cold.revision("document")).toBe(branch.revision("document"))
	}
})

test("checkpoint atom order preserves source, revision and frontmatter", () => {
	let owner = new Replica("owner")
	let source =
		"---\ntitle: Draft\nmode: present\n---\n\n" +
		"abcdefghijklmnop".repeat(512) +
		"😀 ending"
	if (!owner.edit("document", source)) throw Error("Missing seed")
	let peer = owner.fork("peer")
	let first = owner.edit("document", source.replace("Draft", "Owner"))
	let second = peer.edit("document", source.replace("present", "write"))
	if (!first || !second) throw Error("Missing header edit")
	owner.apply([second])
	peer.apply([first])
	expect(owner.text("document")).toBe(peer.text("document"))
	let snapshot = owner.checkpoint()
	let reversed = structuredClone(snapshot)
	for (let target of reversed.targets) target.atoms.reverse()
	let cold = new Replica("cold")
	cold.restore(reversed)
	expect(cold.text("document")).toBe(owner.text("document"))
	expect(cold.revision("document")).toBe(owner.revision("document"))
	expect(cold.metadata("document")).toEqual(owner.metadata("document"))
})
