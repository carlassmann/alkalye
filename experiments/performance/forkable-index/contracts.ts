import { expect } from "bun:test"
import type { Replica as Native } from "../../../src/shared/crdt"
import type { Operation } from "../../../src/shared/model"

type PublicReplica = Pick<
	Native,
	| "edit"
	| "text"
	| "restore"
	| "checkpoint"
	| "cancel"
	| "inverse"
	| "visible"
	| "revision"
	| "metadata"
	| "apply"
> & { fork(actor: string): PublicReplica }

function exercise(make: (actor: string) => PublicReplica) {
	let owner = make("owner")
	let source = "---\ntitle: Unicode 🌻\n---\n" + "a😀b".repeat(1024)
	owner.edit("document", source)
	let peer = owner.fork("peer")
	let firstView = owner.visible("document")
	let originalCheckpoint = peer.checkpoint()
	let operations: Operation[] = []
	for (let edit = 0; edit < 64; edit++) {
		let at = 32 + edit * 6
		let points = Array.from(source)
		points.splice(at, 0, "X")
		let next = points.join("")
		let operation = owner.edit("document", next)
		if (!operation) throw new Error("Missing middle insertion")
		operations.push(operation)
		source = next
	}
	expect(peer.checkpoint()).toEqual(originalCheckpoint)
	expect(firstView.map(atom => atom.value).join("")).toBe(peer.text("document"))
	let latePeer = owner.fork("late-peer")
	let branchSource = source + "Peer 🦋"
	let branch = latePeer.edit("document", branchSource)
	if (!branch) throw new Error("Missing branch append")
	expect(owner.text("document")).toBe(source)
	owner.apply([branch])
	latePeer.cancel("document", branch.id)
	expect(owner.text("document")).toBe(branchSource)
	expect(latePeer.text("document")).toBe(source)
	let original = operations[10]
	if (!original) throw new Error("Missing original edit")
	let inverse = owner.inverse(original)
	if (!inverse) throw new Error("Missing inverse")
	peer.apply(operations)
	peer.apply([branch, inverse])
	expect(peer.text("document")).toBe(owner.text("document"))
	let restored = make("restored")
	restored.restore(owner.checkpoint())
	expect(restored.text("document")).toBe(owner.text("document"))
	expect(restored.metadata("document").title).toBe("Unicode 🌻")
	let checkpoint = owner.checkpoint()
	return {
		restored: checkpoint.restored,
		targets: checkpoint.targets.map(target => ({
			id: target.id,
			atoms: target.atoms,
			fields: target.fields.map(field => ({
				id: field.id,
				field: field.field,
				value: field.value,
			})),
		})),
		source: owner.text("document"),
		revision: owner.revision("document"),
	}
}

export function verifyEquivalent(
	left: (actor: string) => PublicReplica,
	right: (actor: string) => PublicReplica,
) {
	expect(exercise(left)).toEqual(exercise(right))
}
