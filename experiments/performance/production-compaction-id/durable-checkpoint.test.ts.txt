import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Exit from "effect/Exit"
import { Replica } from "../src/shared/crdt"
import { compactCheckpoint, parseCheckpoint } from "../src/shared/checkpoint"
import { newDocument, newComment } from "../src/shared/documents"
import { changeMetadata } from "../src/shared/document-metadata"
import { withFrontmatter } from "../src/shared/markdown"

for (let source of [
	"Body",
	"Body😀\n".repeat(8192),
	"\uD800 lone \uDC00",
	"[link](https://example.org) ==marker==\n".repeat(256),
])
	test(
		"durable capture equals existing compact output and reopens " +
			source.length,
		async () => {
			let owner = new Replica("owner")
			newDocument(owner, "doc", "Original", source)
			changeMetadata(owner, "doc", { title: "Renamed", tags: ["blue"] })
			let before = owner.text("doc")
			let inserted = owner.edit("doc", before + "🌻")
			if (!inserted) throw Error("Missing insertion")
			let undo = owner.cancel("doc", inserted.id)
			let redo = owner.create("doc", "cancel")
			redo.value = undo.id
			owner.apply([redo])
			let expected = compactCheckpoint(
				await Effect.runPromise(owner.checkpointEffect()),
			)
			let captured = await Effect.runPromise(owner.durableCheckpointEffect())
			expect(JSON.stringify(captured)).toBe(JSON.stringify(expected))
			let reader = new Replica("reader")
			reader.restoreCheckpoint(captured)
			expect(reader.text("doc")).toBe(owner.text("doc"))
			expect(reader.visible("doc")).toEqual(owner.visible("doc"))
			expect(reader.metadata("doc")).toEqual(owner.metadata("doc"))
			reader.edit("doc", reader.text("doc") + "Reader")
			let second = await Effect.runPromise(reader.durableCheckpointEffect())
			let again = new Replica("again")
			again.restoreCheckpoint(second)
			expect(again.text("doc")).toBe(reader.text("doc"))
		},
	)
test("owned captured arrays and atom values cannot mutate live header or discussion", async () => {
	let owner = new Replica("owner")
	newDocument(owner, "doc", "Header", "body")
	owner.apply(
		newComment(
			owner,
			"comment",
			"doc",
			"body",
			"Keep",
			"Reader",
			owner.text("doc").indexOf("body"),
		).filter(value => value !== null),
	)
	changeMetadata(owner, "doc", { title: "Changed", tags: ["red"] })
	owner.edit("doc", withFrontmatter(owner.text("doc"), { tags: undefined }))
	let before = JSON.stringify(owner.checkpoint())
	let captured = await Effect.runPromise(owner.durableCheckpointEffect())
	let structuralArrays = 0
	let deletedArrays = 0
	for (let target of captured.targets) {
		for (let atom of target.atoms) {
			expect(Object.isFrozen(atom)).toBe(false)
			Reflect.set(atom, "value", "mutated")
			if (atom.deleted) deletedArrays++
			for (let values of [atom.order, atom.observed, atom.deleted])
				if (values) {
					structuralArrays++
					expect(Object.isFrozen(values)).toBe(false)
					Reflect.set(values, String(values.length), "mutated")
				}
		}
		Reflect.set(target.atoms, "length", 0)
		Reflect.set(target.fields, "length", 0)
		Reflect.set(target.visibility.cancels, "length", 0)
	}
	expect(structuralArrays).toBeGreaterThan(0)
	expect(deletedArrays).toBeGreaterThan(0)
	Reflect.set(captured.targets, "length", 0)
	Reflect.set(captured.restored, String(captured.restored.length), [
		"0000000000000001:tamper:00000000",
		"0000000000000001:tamper:00000001",
	])
	expect(JSON.stringify(owner.checkpoint())).toBe(before)
	expect(owner.fields("comment").body).toBe("Keep")
})
test("concurrent writer, source fence and retained cancellations survive durable capture", async () => {
	let owner = new Replica("owner")
	newDocument(owner, "doc", "Header", "Body\n---x")
	let peer = owner.fork("peer")
	let changes = changeMetadata(peer, "doc", { title: "Peer title" })
	owner.apply(changes.filter(value => value !== null))
	let inserted = owner.edit("doc", owner.text("doc") + "x")
	if (!inserted) throw Error("Missing insertion")
	let undo = owner.cancel("doc", inserted.id)
	owner.apply([undo])
	let compact = await Effect.runPromise(owner.durableCheckpointEffect())
	expect(JSON.stringify(compact)).toBe(
		JSON.stringify(
			compactCheckpoint(await Effect.runPromise(owner.checkpointEffect())),
		),
	)
	let restored = new Replica("restored")
	restored.restore(parseCheckpoint(compact))
	expect(restored.text("doc")).toBe(owner.text("doc"))
	restored.apply([...owner.operations.values()])
	expect(restored.text("doc")).toBe(owner.text("doc"))
})
test("interrupted durable capture leaves live replica and later capture intact", async () => {
	let owner = new Replica("owner")
	owner.edit("doc", "x".repeat(65536))
	let before = owner.text("doc")
	let fiber = Effect.runFork(owner.durableCheckpointEffect())
	await new Promise<void>(resolve => setImmediate(resolve))
	await Effect.runPromise(Fiber.interrupt(fiber))
	expect(Exit.isFailure(await Effect.runPromise(Fiber.await(fiber)))).toBe(true)
	expect(owner.text("doc")).toBe(before)
	expect(
		JSON.stringify(await Effect.runPromise(owner.durableCheckpointEffect())),
	).toBe(
		JSON.stringify(
			compactCheckpoint(await Effect.runPromise(owner.checkpointEffect())),
		),
	)
})
test("generation changes reject the entire captured output", async () => {
	let owner = new Replica("owner")
	owner.edit("doc", "x".repeat(65536))
	owner.text("doc")
	let fiber = Effect.runFork(owner.durableCheckpointEffect())
	await new Promise<void>(resolve => setImmediate(resolve))
	owner.edit("doc", owner.text("doc") + "🌻")
	expect(Exit.isFailure(await Effect.runPromise(Fiber.await(fiber)))).toBe(true)
	let captured = await Effect.runPromise(owner.durableCheckpointEffect())
	expect(JSON.stringify(captured)).toBe(
		JSON.stringify(
			compactCheckpoint(await Effect.runPromise(owner.checkpointEffect())),
		),
	)
})
