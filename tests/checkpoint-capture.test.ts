import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { Replica } from "../src/shared/crdt"
import {
	compactCheckpoint,
	compactCheckpointEffect,
} from "../src/shared/checkpoint"

function sharedDocument() {
	let replica = new Replica("writer")
	let source = "---\ntitle: Captured document\n---\n" + "ABC😀\n".repeat(8192)
	let inserted = replica.edit("document", source)
	if (!inserted) throw new Error("Missing document fixture")
	let removed = replica.edit("document", source.replaceAll("B", "C"))
	if (!removed) throw new Error("Missing removal fixture")
	replica.cancel("document", removed.id)
	replica.set("comment", "document", "document")
	replica.set("comment", "type", "comment")
	replica.set("comment", "body", "Preserve this discussion")
	replica.set("asset", "document", "document")
	replica.set("asset", "type", "asset")
	replica.set("asset", "blob", "local-whiteboard")
	return { replica, source }
}

test("cooperative capture and compaction preserve the complete document and return owned snapshots", async () => {
	let { replica, source } = sharedDocument()
	let expected = replica.checkpoint()
	let foregroundRan = false
	let foreground = setImmediate(() => {
		foregroundRan = true
	})
	try {
		let captured = await Effect.runPromise(replica.checkpointEffect())
		expect(foregroundRan).toBe(true)
		expect(captured).toEqual(expected)
		let packed = await Effect.runPromise(compactCheckpointEffect(captured))
		expect(packed).toEqual(compactCheckpoint(expected))
		let cold = await Effect.runPromise(
			Replica.fromCheckpointEffect(JSON.parse(JSON.stringify(packed)), "cold"),
		)
		expect(cold.text("document")).toBe(source)
		expect(cold.fields("comment").body).toBe("Preserve this discussion")
		expect(cold.fields("asset").blob).toBe("local-whiteboard")
		let atom = captured.targets[0]?.atoms[0]
		if (!atom) throw new Error("Missing captured atom")
		atom.value = "Changed snapshot"
		let field = captured.targets.find(target => target.id === "comment")
			?.fields[0]
		if (!field) throw new Error("Missing captured comment field")
		field.value = "Changed snapshot"
		expect(replica.checkpoint()).toEqual(expected)
		expect(replica.text("document")).toBe(source)
	} finally {
		clearImmediate(foreground)
	}
}, 20_000)

test("concurrent writes reject a captured snapshot instead of publishing a mixed revision", async () => {
	let { replica } = sharedDocument()
	let fiber = Effect.runFork(replica.checkpointEffect())
	let foreground = setImmediate(() => {
		replica.set("comment", "body", "New discussion")
	})
	try {
		let result = await Effect.runPromise(Fiber.await(fiber))
		expect(Exit.isFailure(result)).toBe(true)
		let retried = await Effect.runPromise(replica.checkpointEffect())
		expect(retried).toEqual(replica.checkpoint())
		expect(
			retried.targets
				.find(target => target.id === "comment")
				?.fields.find(field => field.field === "body")?.value,
		).toBe("New discussion")
	} finally {
		clearImmediate(foreground)
	}
}, 20_000)

test("interrupted capture and compaction leave the document usable and publish no partial snapshot", async () => {
	let { replica, source } = sharedDocument()
	let capturing = Effect.runFork(replica.checkpointEffect())
	await Effect.runPromise(Fiber.interrupt(capturing))
	expect(Exit.isFailure(await Effect.runPromise(Fiber.await(capturing)))).toBe(
		true,
	)
	let checkpoint = replica.checkpoint()
	let before = JSON.stringify(checkpoint)
	let compacting = Effect.runFork(compactCheckpointEffect(checkpoint))
	await Effect.runPromise(Fiber.interrupt(compacting))
	expect(Exit.isFailure(await Effect.runPromise(Fiber.await(compacting)))).toBe(
		true,
	)
	expect(JSON.stringify(checkpoint)).toBe(before)
	let packed = await Effect.runPromise(
		compactCheckpointEffect(
			await Effect.runPromise(replica.checkpointEffect()),
		),
	)
	let cold = await Effect.runPromise(
		Replica.fromCheckpointEffect(packed, "retried"),
	)
	expect(cold.text("document")).toBe(source)
}, 20_000)

test("cooperative compact checkpoints retain lone surrogate atom identities", async () => {
	let replica = new Replica("surrogate-writer")
	replica.edit("document", "A\uD800")
	replica.edit("document", "A\uD800\uDC00")
	let captured = await Effect.runPromise(replica.checkpointEffect())
	let packed = await Effect.runPromise(compactCheckpointEffect(captured))
	expect(packed).toEqual(compactCheckpoint(replica.checkpoint()))
	let cold = await Effect.runPromise(
		Replica.fromCheckpointEffect(packed, "surrogate-reader"),
	)
	expect(cold.checkpoint()).toEqual(captured)
	expect(cold.text("document")).toBe("A\uD800\uDC00")
})
