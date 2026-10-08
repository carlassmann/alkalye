import { expect, test } from "bun:test"
import { Replica } from "../src/shared/crdt"

function rebuilt(replica: Replica) {
	let restored = new Replica("restored")
	restored.restore(replica.checkpoint())
	expect(replica.text("doc")).toBe(restored.text("doc"))
	expect(replica.visible("doc")).toEqual(restored.visible("doc"))
	return replica.text("doc")
}
function warm(source: string) {
	let owner = new Replica("owner")
	owner.edit("doc", source)
	expect(owner.text("doc")).toBe(source)
	return owner
}
for (let source of [
	"",
	"Body",
	"Body😀",
	"---\ntitle: Shared\n---\nBody",
	"x".repeat(65536),
])
	test("cancel redo cancel preserves exact suffix " + source.length, () => {
		let owner = warm(source)
		let insertion = owner.edit("doc", source + "🌻")
		if (!insertion) throw Error("Missing append")
		let peer = owner.fork("peer")
		peer.text("doc")
		let cancellation = owner.cancel("doc", insertion.id)
		peer.apply([cancellation])
		expect(rebuilt(owner)).toBe(source)
		expect(rebuilt(peer)).toBe(source)
		owner.apply([cancellation])
		expect(rebuilt(owner)).toBe(source)
		let redo = owner.create("doc", "cancel")
		redo.value = cancellation.id
		owner.apply([redo])
		peer.apply([redo])
		expect(rebuilt(owner)).toBe(source + "🌻")
		expect(rebuilt(peer)).toBe(source + "🌻")
		let again = owner.cancel("doc", insertion.id)
		peer.apply([again])
		expect(rebuilt(owner)).toBe(source)
		expect(rebuilt(peer)).toBe(source)
	})
for (let depth of [0, 1, 2])
	test("prearrived cancel-of-cancel chain retains visibility " + depth, () => {
		let owner = warm("Body")
		let insertion = owner.edit("doc", "BodyX")
		if (!insertion) throw Error("Missing append")
		let cancellation = owner.create("doc", "cancel")
		cancellation.value = insertion.id
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
		expect(rebuilt(owner)).toBe(depth % 2 ? "Body" : "BodyX")
	})
test("concurrent duplicate cancellation stays inactive until both are undone", () => {
	let owner = warm("Body")
	let insertion = owner.edit("doc", "BodyX")
	if (!insertion) throw Error("Missing append")
	let peer = owner.fork("peer")
	let first = owner.cancel("doc", insertion.id)
	let second = peer.cancel("doc", insertion.id)
	Replica.applyTogether([owner, peer], [first, second])
	expect(rebuilt(owner)).toBe("Body")
	expect(rebuilt(peer)).toBe("Body")
	for (let original of [first, second]) {
		let cancellation = owner.create("doc", "cancel")
		cancellation.value = original.id
		Replica.applyTogether([owner, peer], [cancellation])
	}
	expect(rebuilt(owner)).toBe("BodyX")
	expect(rebuilt(peer)).toBe("BodyX")
})
test("peer visible descendants survive cancellation of their terminal parent", () => {
	let owner = warm("Body")
	let insertion = owner.edit("doc", "BodyX")
	if (!insertion) throw Error("Missing append")
	let peer = owner.fork("peer")
	let next = peer.edit("doc", "BodyXY")
	if (!next) throw Error("Missing peer append")
	owner.apply([next])
	owner.text("doc")
	let cancellation = owner.cancel("doc", insertion.id)
	peer.apply([cancellation])
	expect(rebuilt(owner)).toBe("BodyY")
	expect(rebuilt(peer)).toBe("BodyY")
})
test("compacted original insertion uses retained provenance fallback", () => {
	let owner = warm("Body")
	let insertion = owner.edit("doc", "BodyX")
	if (!insertion) throw Error("Missing append")
	let restored = new Replica("restored")
	restored.restore(owner.checkpoint())
	restored.text("doc")
	let cancellation = restored.cancel("doc", insertion.id)
	owner.apply([cancellation])
	expect(rebuilt(restored)).toBe("Body")
	expect(rebuilt(owner)).toBe("Body")
})
test("conflicting cancellation cannot publish any warm replica cache", () => {
	let owner = warm("Body")
	let insertion = owner.edit("doc", "BodyX")
	if (!insertion) throw Error("Missing append")
	let peer = owner.fork("peer")
	let cancellation = owner.create("doc", "cancel")
	cancellation.value = insertion.id
	peer.apply([{ ...cancellation, author: "conflict" }])
	let before = owner.checkpoint()
	expect(() => Replica.applyTogether([owner, peer], [cancellation])).toThrow()
	expect(owner.checkpoint()).toEqual(before)
	expect(rebuilt(owner)).toBe("BodyX")
})
test("malformed cancellation leaves warm source untouched", () => {
	let owner = warm("Body")
	let insertion = owner.edit("doc", "BodyX")
	if (!insertion) throw Error("Missing append")
	let cancellation = owner.create("doc", "cancel")
	cancellation.value = insertion.id
	cancellation.clock = 0
	let before = owner.checkpoint()
	expect(() => owner.apply([cancellation])).toThrow()
	expect(owner.checkpoint()).toEqual(before)
	expect(rebuilt(owner)).toBe("BodyX")
})
test("unapplied prepared edit cannot change cancellation semantics", () => {
	let owner = warm("Body")
	let insertion = owner.edit("doc", "BodyX")
	if (!insertion) throw Error("Missing append")
	owner.prepareEdit("doc", "Other")
	owner.cancel("doc", insertion.id)
	expect(rebuilt(owner)).toBe("Body")
})
test("cancellation that completes a concurrent root fence rebuilds source projection", () => {
	let hello = new Replica("zzhello")
	let helloEdit = hello.edit("doc", "Hello")
	let header = new Replica("aaheader")
	let headerEdit = header.create("doc", "text")
	let after = ""
	for (let value of "---\na: b\n---") {
		let id =
			headerEdit.id + ":" + String(headerEdit.insert.length).padStart(8, "0")
		headerEdit.insert.push({ id, after, value })
		after = id
	}
	header.apply([headerEdit])
	let tail = header.create("doc", "text")
	tail.insert = [{ id: tail.id + ":00000000", after, value: "x" }]
	header.apply([tail])
	if (!helloEdit) throw Error("Missing hello")
	let owner = new Replica("joined")
	owner.apply([helloEdit, headerEdit, tail])
	let before = owner.text("doc")
	expect(before).toBe("Hello---\na: b\n---x")
	owner.cancel("doc", tail.id)
	expect(rebuilt(owner)).not.toBe(before.slice(0, -1))
})

test("migration floor rejects terminal cancellation without changing cached source", () => {
	let owner = warm("Body")
	let insertion = owner.edit("doc", "BodyX")
	if (!insertion) throw Error("Missing append")
	let snapshot = owner.checkpoint()
	let restored = new Replica("legacy")
	restored.restore({
		format: "alkalye-state-v1",
		clock: snapshot.clock,
		restored: snapshot.restored,
		targets: snapshot.targets.map(target => ({
			id: target.id,
			created: target.created,
			updated: target.updated,
			atoms: target.atoms,
			fields: target.fields,
			removed: [],
		})),
	})
	restored.text("doc")
	let before = restored.checkpoint()
	expect(() => restored.cancel("doc", insertion.id)).toThrow()
	expect(restored.checkpoint()).toEqual(before)
	expect(rebuilt(restored)).toBe("BodyX")
})
