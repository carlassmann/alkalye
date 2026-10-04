import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Replica } from "../src/shared/crdt"
import { parseCheckpoint } from "../src/shared/checkpoint"
import { partitionTextOperations } from "../src/shared/text-dependencies"
import { validateTextCausality } from "../src/shared/document-causality"
import type { Operation } from "../src/shared/model"

function partition(replica: Replica, changes: Operation[]) {
	return Effect.runSync(partitionTextOperations(replica, changes))
}
function checkpoint(replica: Replica) {
	return parseCheckpoint(JSON.parse(JSON.stringify(replica.checkpoint())))
}
test("missing predecessors stay outside a valid snapshot and promote after cold restoration", () => {
	let writer = new Replica("writer")
	writer.edit("document", "Original")
	let baseline = checkpoint(writer)
	let tail = writer.edit("document", "Original tail")
	if (!tail) throw new Error("Missing tail")
	let register = writer.set("comment", "body", "Independent discussion")
	let cold = new Replica("cold")
	let first = partition(cold, [tail, register])
	expect(first.ready).toEqual([register])
	expect(first.deferred).toEqual([tail])
	cold.apply(first.ready)
	expect(checkpoint(cold).targets.map(target => target.id)).toEqual(["comment"])
	cold.restore(baseline)
	let promoted = partition(cold, first.deferred)
	expect(promoted.deferred).toEqual([])
	cold.apply(promoted.ready)
	expect(cold.text("document")).toBe("Original tail")
	expect(cold.fields("comment").body).toBe("Independent discussion")
	expect(cold.revision("document")).toBe(writer.revision("document"))
	checkpoint(cold)
})
test("deferral propagates through insertion, removal and cancellation dependencies", () => {
	let writer = new Replica("writer")
	writer.edit("document", "A")
	let baseline = checkpoint(writer)
	let insertion = writer.edit("document", "AB")
	let followup = writer.edit("document", "ABC")
	let deletion = writer.edit("document", "AC")
	if (!insertion || !followup || !deletion)
		throw new Error("Missing contributions")
	let undo = writer.cancel("document", deletion.id)
	let changes = [undo, deletion, followup, insertion]
	let empty = new Replica("empty")
	let deferred = partition(empty, changes)
	expect(deferred.ready).toEqual([])
	expect(deferred.deferred).toEqual(changes)
	expect(empty.checkpoint().targets).toEqual([])
	empty.restore(baseline)
	let promoted = partition(empty, deferred.deferred)
	expect(promoted.deferred).toEqual([])
	empty.apply(promoted.ready)
	expect(empty.text("document")).toBe("ABC")
	expect(empty.revision("document")).toBe(writer.revision("document"))
	checkpoint(empty)
})
test("closed insertion groups are accepted together without requiring operation order", () => {
	let first = new Replica("first").prepareEdit("document", "AB")
	let second = new Replica("second").prepareEdit("document", "CD")
	if (
		!first?.insert[0] ||
		!first.insert[1] ||
		!second?.insert[0] ||
		!second.insert[1]
	)
		throw new Error("Missing group")
	first.insert[1].after = second.insert[0].id
	second.insert[1].after = first.insert[0].id
	let replica = new Replica("reader")
	let result = partition(replica, [second, first])
	expect(result.deferred).toEqual([])
	expect(result.ready).toEqual([second, first])
	replica.apply(result.ready)
	expect(replica.text("document").length).toBe(4)
	checkpoint(replica)
})
test("foreign-target atoms cannot satisfy a dependency or its dependent suffix", () => {
	let peer = new Replica("peer")
	let source = peer.edit("another", "A")
	let own = peer.edit("document", "B")
	if (!source?.insert[0] || !own?.insert[0]) throw new Error("Missing source")
	own.insert[0].after = source.insert[0].id
	let next = peer.edit("document", "BC")
	if (!next) throw new Error("Missing followup")
	let replica = new Replica("reader")
	let result = partition(replica, [next, own, source])
	expect(result.ready).toEqual([source])
	expect(result.deferred).toEqual([next])
	expect(result.rejected.map(value => value.operation)).toEqual([own])
	expect(result.rejected[0]?.atom).toBe(source.insert[0].id)
	replica.apply(result.ready)
	checkpoint(replica)
})
test("an unknown removal defers while a tombstoned atom remains a valid dependency", () => {
	let writer = new Replica("writer")
	let original = writer.edit("document", "A")
	let deleted = writer.edit("document", "")
	if (!original || !deleted) throw new Error("Missing deletion")
	let empty = new Replica("empty")
	expect(partition(empty, [deleted]).deferred).toEqual([deleted])
	empty.restore(checkpoint(writer))
	expect(partition(empty, [deleted]).deferred).toEqual([])
	empty.apply([deleted])
	expect(empty.text("document")).toBe("")
	checkpoint(empty)
})
test("a cyclic anchor group fails as a typed conflict before independent registers change", () => {
	let writer = new Replica("writer")
	let text = writer.prepareEdit("document", "AB")
	let register = writer.set("comment", "body", "Never partly applied")
	if (!text?.insert[0] || !text.insert[1]) throw new Error("Missing cycle")
	text.insert[0].after = text.insert[1].id
	let empty = new Replica("empty")
	let result = Effect.runSync(
		validateTextCausality(empty, "document", [register, text]).pipe(
			Effect.result,
		),
	)
	expect(result._tag).toBe("Failure")
	if (result._tag === "Failure")
		expect(result.failure._tag).toBe("DocumentConflict")
	expect(empty.fields("comment")).toEqual({})
	expect(empty.checkpoint().targets).toEqual([])
})

test("paged offline cancellation and redo tails converge after their missing snapshot arrives", () => {
	let deferredCount = 0,
		cancellations = 0
	for (let seed = 1; seed <= 50; seed++) {
		let baseline = new Replica("baseline")
		baseline.edit("document", "ABC")
		let writers = [new Replica("alice"), new Replica("bob")]
		for (let writer of writers) writer.restore(checkpoint(baseline))
		let random = seed
		for (let step = 0; step < 30; step++) {
			random = (Math.imul(random, 1664525) + 1013904223) >>> 0
			let writer = writers[random % writers.length]
			if (!writer) throw new Error("Missing writer")
			let source = writer.text("document")
			let position = (random >>> 8) % (source.length + 1)
			let next =
				step % 4 === 0
					? source.slice(0, position) + source.slice(position + 2)
					: source.slice(0, position) + String(step) + source.slice(position)
			let change = writer.edit("document", next)
			if (change && step % 5 === 0) {
				let undo = writer.cancel("document", change.id)
				cancellations++
				if (step % 10 === 0) {
					writer.cancel("document", undo.id)
					cancellations++
				}
			}
			if (step % 7 === 0)
				writer.apply(writers.flatMap(value => [...value.operations.values()]))
		}
		let snapshotWriter = writers[0]
		if (!snapshotWriter) throw new Error("Missing snapshot writer")
		let events = [
			...new Map(writers.flatMap(writer => [...writer.operations])).values(),
		]
		let tail = events
			.filter(operation => !snapshotWriter.operations.has(operation.id))
			.reverse()
		let oracle = new Replica("oracle")
		oracle.restore(checkpoint(baseline))
		oracle.apply(events)
		let admitted = new Replica("admitted")
		let pending: Operation[] = []
		for (let offset = 0; offset < tail.length; offset += 3) {
			let result = partition(admitted, [
				...pending,
				...tail.slice(offset, offset + 3),
			])
			admitted.apply(result.ready)
			pending = result.deferred
			deferredCount += pending.length
			checkpoint(admitted)
		}
		admitted.restore(checkpoint(snapshotWriter))
		let promoted = partition(admitted, pending)
		expect(promoted.deferred).toEqual([])
		admitted.apply(promoted.ready)
		expect({ seed, revision: admitted.revision("document") }).toEqual({
			seed,
			revision: oracle.revision("document"),
		})
		expect(admitted.text("document")).toBe(oracle.text("document"))
		checkpoint(admitted)
	}
	expect(deferredCount).toBeGreaterThan(0)
	expect(cancellations).toBeGreaterThan(0)
}, 20_000)
