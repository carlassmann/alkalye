import { expect } from "bun:test"
import type { Replica } from "../../../src/shared/crdt"

type PublicReplica = Pick<
	Replica,
	| "edit"
	| "text"
	| "visible"
	| "checkpoint"
	| "prepareReplacements"
	| "apply"
	| "cancel"
	| "restore"
> & { fork(actor: string): PublicReplica }

function exerciseBatches(make: (actor: string) => PublicReplica) {
	let source = "TOKEN 😀\n".repeat(2048)
	let owner = make("owner")
	owner.edit("doc", source)
	let peer = owner.fork("peer")
	let untouched = peer.fork("untouched")
	let heldView = untouched.visible("doc")
	let heldCheckpoint = untouched.checkpoint()
	let replacements = [...source.matchAll(/TOKEN/g)].map(match => ({
		start: match.index,
		remove: 5,
		text: "X🌻",
	}))
	let action = owner.prepareReplacements("doc", replacements)
	if (!action) throw Error("Missing replacement batch")
	owner.apply([action])
	expect(owner.text("doc")).toBe(source.replaceAll("TOKEN", "X🌻"))
	expect(peer.text("doc")).toBe(source)
	expect(heldView.map(atom => atom.value).join("")).toBe(source)
	peer.apply([action])
	expect(peer.text("doc")).toBe(owner.text("doc"))
	let forkAfterBatch = owner.fork("late")
	let late = forkAfterBatch.edit("doc", owner.text("doc") + "Later 🦋")
	if (!late) throw Error("Missing late edit")
	expect(owner.text("doc")).not.toContain("Later")
	owner.apply([late])
	let undo = forkAfterBatch.cancel("doc", action.id)
	expect(owner.text("doc")).toContain("X🌻")
	expect(forkAfterBatch.text("doc")).toBe(source + "Later 🦋")
	owner.apply([undo])
	peer.apply([late, undo])
	expect(peer.text("doc")).toBe(owner.text("doc"))
	expect(untouched.checkpoint()).toEqual(heldCheckpoint)
	let restored = make("restored")
	restored.restore(owner.checkpoint())
	expect(restored.text("doc")).toBe(owner.text("doc"))
	return owner
		.checkpoint()
		.targets.map(target => ({ id: target.id, atoms: target.atoms }))
}

export function verifyTransientBatches(
	left: (actor: string) => PublicReplica,
	right: (actor: string) => PublicReplica,
) {
	expect(exerciseBatches(left)).toEqual(exerciseBatches(right))
}
