import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Replica } from "../src/shared/crdt"
import { validateTextCausality } from "../src/shared/document-causality"
import type { Operation } from "../src/shared/model"

function validate(replica: Replica, changes: Operation[]) {
	return Effect.runPromise(
		validateTextCausality(replica, "document", changes).pipe(Effect.result),
	)
}
test("unknown insertion anchors and deletion identities fail without mutating accepted state", async () => {
	let replica = new Replica("writer")
	replica.edit("document", "Source")
	let original = replica.checkpoint()
	let inserted = replica.prepareEdit("document", "Source!")
	if (!inserted?.insert[0]) throw new Error("Missing insertion")
	inserted.insert[0].after = "missing-atom"
	let unknownAnchor = await validate(replica, [inserted])
	expect(unknownAnchor._tag).toBe("Failure")
	if (unknownAnchor._tag === "Failure") {
		expect(unknownAnchor.failure._tag).toBe("CausalDependencyMissing")
		if (unknownAnchor.failure._tag === "CausalDependencyMissing")
			expect(unknownAnchor.failure.atom).toBe("missing-atom")
	}
	let removed = replica.prepareEdit("document", "Sourc")
	if (!removed) throw new Error("Missing deletion")
	removed.remove = ["missing-atom"]
	let unknownDelete = await validate(replica, [removed])
	expect(unknownDelete._tag).toBe("Failure")
	if (unknownDelete._tag === "Failure")
		expect(unknownDelete.failure._tag).toBe("CausalDependencyMissing")
	expect(replica.checkpoint()).toEqual(original)
})
test("causality survives cold checkpoints and accepts tombstoned anchors and same-action insertions", async () => {
	let replica = new Replica("writer")
	replica.edit("document", "Original")
	let old = replica.visible("document")[0]
	if (!old) throw new Error("Missing original atom")
	replica.edit("document", "")
	let restored = new Replica("later")
	restored.restore(replica.checkpoint())
	expect(restored.hasAtom("document", old.id)).toBe(true)
	let change = restored.prepareEdit("document", "New")
	if (!change?.insert[0]) throw new Error("Missing replacement")
	change.insert[0].after = old.id
	expect((await validate(restored, [change]))._tag).toBe("Success")
})
test("a text atom belongs to its target even when the same action inserts text into another target", async () => {
	let replica = new Replica("writer")
	replica.edit("another", "Peer")
	let peer = replica.visible("another")[0]
	let change = replica.prepareEdit("document", "Own")
	if (!peer || !change?.insert[0]) throw new Error("Missing test atoms")
	change.insert[0].after = peer.id
	let result = await validate(replica, [change])
	expect(result._tag).toBe("Failure")
	let staged = new Replica("action")
	let first = staged.prepareEdit("another", "A")
	let second = staged.prepareEdit("document", "B")
	if (!first?.insert[0] || !second?.insert[0])
		throw new Error("Missing staged atoms")
	second.insert[0].after = first.insert[0].id
	expect((await validate(new Replica("empty"), [first, second]))._tag).toBe(
		"Failure",
	)
})
test("anchor cycles fail while frontmatter key order and deleted keys remain metadata", async () => {
	let replica = new Replica("writer")
	let change = replica.prepareEdit("document", "AB")
	let first = change?.insert[0],
		second = change?.insert[1]
	if (!change || !first || !second) throw new Error("Missing cycle atoms")
	first.after = second.id
	let cyclic = await validate(replica, [change])
	expect(cyclic._tag).toBe("Failure")
	if (cyclic._tag === "Failure")
		expect(cyclic.failure._tag).toBe("DocumentConflict")
	first.after = ""
	first.order = ["title", "tags"]
	first.deleted = ["path"]
	expect((await validate(replica, [change]))._tag).toBe("Success")
})
test("a large reverse-ordered insertion chain validates without recursive traversal", async () => {
	let replica = new Replica("writer")
	let change = replica.prepareEdit("document", "x".repeat(200_000))
	if (!change) throw new Error("Missing insertion chain")
	change.insert.reverse()
	expect((await validate(replica, [change]))._tag).toBe("Success")
})
