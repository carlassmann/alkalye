import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Replica } from "../src/shared/crdt"
import { parseCheckpoint } from "../src/shared/checkpoint"
import { planTextAdmission } from "../src/shared/text-admission"
import { compactOperation, parseOperation } from "../src/shared/model"

function plan<Input>(replica: Replica, operations: Input[]) {
	return Effect.runSync(planTextAdmission(replica, operations))
}
function checkpoint(replica: Replica) {
	return parseCheckpoint(JSON.parse(JSON.stringify(replica.checkpoint())))
}

test("admission leaves its replica untouched and a missing baseline outside the current snapshot", () => {
	let writer = new Replica("writer")
	writer.edit("document", "Original")
	let baseline = checkpoint(writer)
	let tail = writer.edit("document", "Original tail")
	if (!tail) throw new Error("Missing tail")
	let comment = writer.set("comment", "body", "Discussion")
	let reader = new Replica("reader")
	let before = reader.checkpoint()
	let first = plan(reader, [tail, comment])
	expect(reader.checkpoint()).toEqual(before)
	expect(first.ready).toEqual([comment])
	expect(first.deferred).toEqual([tail])
	expect(first.rejected).toEqual([])
	reader.apply(first.ready)
	let cold = new Replica("cold")
	cold.restore(checkpoint(reader))
	cold.restore(baseline)
	let promoted = plan(cold, first.deferred)
	expect(promoted.deferred).toEqual([])
	cold.apply(promoted.ready)
	expect(cold.text("document")).toBe(writer.text("document"))
	expect(cold.fields("comment").body).toBe("Discussion")
	checkpoint(cold)
})

test("changed copies cannot supply dependencies under an accepted operation identity", () => {
	let writer = new Replica("writer")
	let original = writer.edit("document", "A")
	if (!original?.insert[0]) throw new Error("Missing original")
	let reader = new Replica("reader")
	reader.restore(checkpoint(writer))
	let fork = structuredClone(original)
	if (!fork.insert[0]) throw new Error("Missing fork")
	fork.insert[0].value = "X"
	let independent = writer.set("comment", "body", "Preserved")
	let result = plan(reader, [fork, independent, original])
	expect(result.rejected.map(value => value.operation)).toEqual([fork])
	expect(result.ready).toEqual([independent, original])
	expect(result.deferred).toEqual([])
	reader.apply(result.ready)
	expect(reader.text("document")).toBe("A")
	expect(reader.fields("comment").body).toBe("Preserved")
	checkpoint(reader)
})

test("same-batch forks are isolated before graph nodes can collapse their identities", () => {
	let writer = new Replica("writer")
	let original = writer.edit("document", "A")
	if (!original?.insert[0]) throw new Error("Missing original")
	let fork = structuredClone(original)
	if (!fork.insert[0]) throw new Error("Missing fork")
	fork.insert[0].value = "X"
	let tail = writer.edit("document", "AB")
	if (!tail) throw new Error("Missing tail")
	let reader = new Replica("reader")
	let result = plan(reader, [original, fork, tail])
	expect(result.rejected.map(value => value.operation)).toEqual([fork])
	expect(result.deferred).toEqual([])
	reader.apply(result.ready)
	expect(reader.text("document")).toBe("AB")
	checkpoint(reader)
})

test("a cross-operation anchor cycle rejects only its members and defers their dependent suffix", () => {
	let first = new Replica("first").prepareEdit("document", "A")
	let second = new Replica("second").prepareEdit("document", "B")
	if (!first?.insert[0] || !second?.insert[0]) throw new Error("Missing cycle")
	first.insert[0].after = second.insert[0].id
	second.insert[0].after = first.insert[0].id
	let tail = new Replica("tail").prepareEdit("document", "C")
	if (!tail?.insert[0]) throw new Error("Missing suffix")
	tail.insert[0].after = first.insert[0].id
	let comment = new Replica("commenter").set("comment", "body", "Healthy")
	let reader = new Replica("reader")
	let result = plan(reader, [tail, first, comment, second])
	expect(result.rejected.map(value => value.operation)).toEqual([first, second])
	expect(result.deferred).toEqual([tail])
	expect(result.ready).toEqual([comment])
	reader.apply(result.ready)
	expect(reader.text("document")).toBe("")
	expect(reader.fields("comment").body).toBe("Healthy")
	checkpoint(reader)
})

test("foreign atoms retained by a cold snapshot are rejected rather than indefinitely deferred", () => {
	let writer = new Replica("writer")
	let foreign = writer.edit("another", "A")
	if (!foreign?.insert[0]) throw new Error("Missing foreign atom")
	let reader = new Replica("reader")
	reader.restore(checkpoint(writer))
	let malformed = writer.prepareEdit("document", "B")
	if (!malformed?.insert[0]) throw new Error("Missing malformed text")
	malformed.insert[0].after = foreign.insert[0].id
	let result = plan(reader, [malformed])
	expect(result.ready).toEqual([])
	expect(result.deferred).toEqual([])
	expect(result.rejected.map(value => value.operation)).toEqual([malformed])
	expect(reader.text("another")).toBe("A")
	checkpoint(reader)
})

test("missing removals and their cancellation stay deferred until their accepted baseline arrives", () => {
	let writer = new Replica("writer")
	writer.edit("document", "A")
	let baseline = checkpoint(writer)
	let removal = writer.edit("document", "")
	if (!removal) throw new Error("Missing removal")
	let cancellation = writer.cancel("document", removal.id)
	let reader = new Replica("reader")
	let result = plan(reader, [cancellation, removal])
	expect(result.ready).toEqual([])
	expect(result.deferred).toEqual([cancellation, removal])
	expect(result.rejected).toEqual([])
	reader.restore(baseline)
	let promoted = plan(reader, result.deferred)
	reader.apply(promoted.ready)
	expect(promoted.deferred).toEqual([])
	expect(reader.text("document")).toBe("A")
	expect(reader.revision("document")).toBe(writer.revision("document"))
	checkpoint(reader)
})

test("compact wire runs expose cycles through their interior atoms and preserve original packet associations", () => {
	let first = new Replica("first").prepareEdit("document", "AB")
	let second = new Replica("second").prepareEdit("document", "C")
	if (!first?.insert[0] || !first.insert[1] || !second?.insert[0])
		throw new Error("Missing compact cycle")
	first.insert[0].after = second.insert[0].id
	second.insert[0].after = first.insert[1].id
	let compact = compactOperation(first)
	expect(compact.insert).toHaveLength(1)
	expect(compact.insert[0]?.value).toBe("AB")
	let reader = new Replica("reader")
	let before = reader.checkpoint()
	let packets = structuredClone([compact, second])
	let result = plan(reader, [compact, second])
	expect(result.ready).toEqual([])
	expect(result.deferred).toEqual([])
	expect(result.rejected).toHaveLength(2)
	expect(result.rejected[0]?.operation).toBe(compact)
	expect(result.rejected[1]?.operation).toBe(second)
	expect([compact, second]).toEqual(packets)
	expect(reader.checkpoint()).toEqual(before)
	checkpoint(reader)
})

test("compact and expanded copies share one identity and ready results retain their input references", () => {
	let writer = new Replica("writer")
	let original = writer.edit("document", "AB")
	if (!original) throw new Error("Missing original")
	let compact = compactOperation(original)
	let reader = new Replica("reader")
	let result = plan(reader, [compact, original])
	expect(result.rejected).toEqual([])
	expect(result.deferred).toEqual([])
	expect(result.ready[0]).toBe(compact)
	expect(result.ready[1]).toBe(original)
	reader.apply(result.ready.map(parseOperation))
	expect(reader.text("document")).toBe("AB")
	checkpoint(reader)
})

test("every packet copy of a cyclic identity remains accounted for in the rejection partition", () => {
	let first = new Replica("first").prepareEdit("document", "AB")
	let second = new Replica("second").prepareEdit("document", "C")
	if (!first?.insert[0] || !first.insert[1] || !second?.insert[0])
		throw new Error("Missing duplicate cycle")
	first.insert[0].after = second.insert[0].id
	second.insert[0].after = first.insert[1].id
	let compact = compactOperation(first)
	let packets = [compact, first, second]
	let before = structuredClone(packets)
	let reader = new Replica("reader")
	let state = reader.checkpoint()
	let result = plan(reader, packets)
	expect(result.ready).toEqual([])
	expect(result.deferred).toEqual([])
	expect(result.rejected).toHaveLength(packets.length)
	for (let packet of packets)
		expect(
			result.rejected.filter(value => value.operation === packet),
		).toHaveLength(1)
	expect(packets).toEqual(before)
	expect(reader.checkpoint()).toEqual(state)
})
