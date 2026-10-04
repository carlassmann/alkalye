import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { run } from "../src/platform/effects"
import {
	openCheckpoint,
	decodeCheckpoint,
	parseCheckpoint,
	sealCheckpoint,
} from "./legacy-checkpoint"
import { Replica } from "../src/shared/crdt"
import { partitionTextOperations } from "../src/shared/text-dependencies"
import { encode } from "../src/shared/base64"
import { accountRoom } from "./legacy-crypto"
import { commentRange, newComment, newDocument } from "../src/shared/documents"
import type { Operation } from "../src/shared/model"

function fixture() {
	let original = new Replica("original")
	newDocument(original, "doc", "A checkpoint", "alpha beta gamma")
	original.apply(
		newComment(
			original,
			"comment",
			"doc",
			"beta",
			"Keep this",
			"Reader",
			6,
		).filter((op): op is Operation => op !== null),
	)
	return original
}
test("malformed checkpoint headers remain typed failures", async () => {
	for (let value of [
		null,
		5,
		{},
		{ format: "unknown" },
		{ format: "alkalye-gzip-v1", body: 5 },
		{ format: "alkalye-gzip-v1", body: "%%%" },
	]) {
		let result = await run(Effect.result(decodeCheckpoint(value)))
		expect(Result.isFailure(result)).toBe(true)
	}
})
function shuffle<A>(values: A[], seed: number) {
	let result = [...values]
	for (let index = result.length - 1; index > 0; index--) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
		let chosen = seed % (index + 1),
			left = result[index],
			right = result[chosen]
		if (left !== undefined && right !== undefined) {
			result[index] = right
			result[chosen] = left
		}
	}
	return result
}
test("checkpoint and shuffled duplicate replay converge to the full event log", () => {
	let original = fixture(),
		checkpoint = parseCheckpoint(
			JSON.parse(JSON.stringify(original.checkpoint())),
		)
	let left = new Replica("left"),
		right = new Replica("right")
	left.restore(checkpoint)
	right.restore(checkpoint)
	left.edit("doc", "alpha LEFT beta gamma")
	right.edit("doc", "alpha beta RIGHT gamma")
	right.set("doc", "title", "Concurrent title")
	let tail = [...left.operations.values(), ...right.operations.values()]
	let full = new Replica("oracle")
	full.apply([...original.operations.values(), ...tail])
	for (let seed = 1; seed <= 60; seed++) {
		let restored = new Replica("restored")
		restored.restore(checkpoint)
		restored.apply(shuffle([...tail, ...tail], seed))
		expect(restored.text("doc")).toBe(full.text("doc"))
		expect(restored.fields("doc")).toEqual(full.fields("doc"))
		expect(restored.documents("room")).toEqual(full.documents("room"))
		expect(restored.revision("doc")).toBe(full.revision("doc"))
		expect(commentRange(restored, "doc", restored.fields("comment"))).toEqual(
			commentRange(full, "doc", full.fields("comment")),
		)
	}
})
test("checkpoint tombstones retain offline anchors and undo values", () => {
	let original = fixture(),
		baseline = [...original.operations.values()]
	let offline = new Replica("offline")
	offline.apply(baseline)
	offline.edit("doc", "alpha beta OFFLINE gamma")
	original.edit("doc", "alpha gamma")
	let restored = new Replica("restored")
	restored.restore(original.checkpoint())
	let full = new Replica("oracle")
	full.apply([...original.operations.values(), ...offline.operations.values()])
	restored.apply([...offline.operations.values()])
	expect(restored.text("doc")).toBe(full.text("doc"))
	let deletion = restored.edit("doc", "")
	if (!deletion) throw new Error("Expected deletion")
	let before = full.text("doc")
	restored.inverse(deletion)
	expect(restored.text("doc")).toBe(before)
})
test("random offline writers converge when checkpoints arrive after pending local edits", () => {
	let deferredCount = 0
	for (let seed = 1; seed <= 150; seed++) {
		let baseline = fixture()
		let writers = [
			new Replica("alice"),
			new Replica("bob"),
			new Replica("carol"),
		]
		for (let writer of writers) writer.apply([...baseline.operations.values()])
		let random = seed
		for (let step = 0; step < 45; step++) {
			random = (Math.imul(random, 1664525) + 1013904223) >>> 0
			let writer = writers[random % writers.length]
			if (!writer) throw new Error("Missing writer")
			let text = writer.text("doc")
			let position = (random >>> 8) % (text.length + 1)
			if (random % 4 === 0)
				writer.edit("doc", text.slice(0, position) + text.slice(position + 3))
			else
				writer.edit(
					"doc",
					text.slice(0, position) + "🦊" + step + text.slice(position),
				)
			if (step % 7 === 0) writer.set("doc", "title", writer.actor + step)
			if (step % 11 === 0)
				writer.apply(
					shuffle(
						writers.flatMap(value => [...value.operations.values()]),
						random,
					),
				)
		}
		let snapshotWriter = writers[seed % writers.length]
		if (!snapshotWriter) throw new Error("Missing snapshot writer")
		let events = writers.flatMap(value => [...value.operations.values()])
		let covered = new Set(snapshotWriter.operations.keys())
		let tail = events.filter(operation => !covered.has(operation.id))
		let oracle = new Replica("oracle")
		oracle.apply(events)
		let reopened = new Replica("reopened")
		reopened.apply(shuffle(tail, seed))
		let admitted = new Replica("admitted")
		let partition = Effect.runSync(
			partitionTextOperations(admitted, shuffle(tail, seed)),
		)
		deferredCount += partition.deferred.length
		admitted.apply(partition.ready)
		expect(() =>
			parseCheckpoint(JSON.parse(JSON.stringify(admitted.checkpoint()))),
		).not.toThrow()
		admitted.restore(snapshotWriter.checkpoint())
		let promoted = Effect.runSync(
			partitionTextOperations(admitted, partition.deferred),
		)
		expect(promoted.deferred).toEqual([])
		admitted.apply(promoted.ready)
		expect(admitted.revision("doc")).toBe(oracle.revision("doc"))
		expect(admitted.documents("room")).toEqual(oracle.documents("room"))
		reopened.restore(
			parseCheckpoint(JSON.parse(JSON.stringify(snapshotWriter.checkpoint()))),
		)
		reopened.apply(shuffle(tail, seed + 1))
		expect(reopened.text("doc")).toBe(oracle.text("doc"))
		expect(reopened.fields("doc")).toEqual(oracle.fields("doc"))
		expect(reopened.revision("doc")).toBe(oracle.revision("doc"))
		expect(reopened.documents("room")).toEqual(oracle.documents("room"))
	}
	expect(deferredCount).toBeGreaterThan(0)
}, 20_000)
test("history hydration restores every version while current state stays unchanged", () => {
	let original = fixture()
	for (let index = 0; index < 30; index++)
		original.edit("doc", "Version " + index)
	let restored = new Replica("restored")
	restored.restore(original.checkpoint())
	expect(() => restored.text("doc", 1)).toThrow("Load history")
	let revision = restored.revision("doc")
	restored.apply([...original.operations.values()])
	restored.historyLoaded = true
	for (let operation of original.operations.values()) {
		expect(restored.text("doc", operation.id)).toBe(
			original.text("doc", operation.id),
		)
		expect(restored.fields("doc", operation.id)).toEqual(
			original.fields("doc", operation.id),
		)
	}
	expect(restored.revision("doc")).toBe(revision)
})
test("a checkpoint opens thousands of metadata events as winning registers", () => {
	let original = fixture()
	for (let index = 0; index < 5000; index++)
		original.set("doc", "title", "Title " + index)
	let checkpoint = original.checkpoint(),
		restored = new Replica("restored")
	restored.restore(checkpoint)
	expect(restored.fields("doc").title).toBe("Title 4999")
	expect(restored.operations.size).toBeLessThan(20)
	expect(JSON.stringify(checkpoint).length).toBeLessThan(
		JSON.stringify([...original.operations.values()]).length / 30,
	)
})
test("checkpoint validation rejects ambiguous identities and invalid clocks", () => {
	let checkpoint = fixture().checkpoint()
	let target = checkpoint.targets.find(target => target.id === "doc")
	if (!target || !target.atoms[0] || !target.fields[0])
		throw new Error("Missing fixture")
	let firstAtom = target.atoms[0]
	expect(() => parseCheckpoint({ ...checkpoint, clock: -1 })).toThrow("clock")
	expect(() => parseCheckpoint({ ...checkpoint, clock: 1.5 })).toThrow("clock")
	expect(() =>
		parseCheckpoint({
			...checkpoint,
			targets: [...checkpoint.targets, target],
		}),
	).toThrow("Duplicate checkpoint target")
	expect(() =>
		parseCheckpoint({
			...checkpoint,
			targets: [{ ...target, atoms: [...target.atoms, target.atoms[0]] }],
		}),
	).toThrow("identity")
	expect(() =>
		parseCheckpoint({
			...checkpoint,
			targets: [
				{
					...target,
					atoms: [{ ...target.atoms[0], after: firstAtom.id }],
				},
			],
		}),
	).toThrow("identity")
	expect(() =>
		parseCheckpoint({
			...checkpoint,
			targets: [{ ...target, fields: [...target.fields, target.fields[0]] }],
		}),
	).toThrow("register")
})
test("compressed checkpoints authenticate their room and preserve materialized state", async () => {
	let room = await run(accountRoom("checkpoint-fixture")),
		original = fixture()
	let packet = await run(
		sealCheckpoint(room.key, "checkpoint:12", original.checkpoint(), room.id),
	)
	let restored = new Replica("restored")
	restored.restore(await run(openCheckpoint(room.key, packet, room.id)))
	expect(restored.revision("doc")).toBe(original.revision("doc"))
	await expect(
		run(openCheckpoint(room.key, packet, "foreign-room")),
	).rejects.toThrow()
})
test("checkpoint streams reject corrupt gzip, invalid state and oversized decompression as typed failures", async () => {
	let corrupted = await run(
		Effect.result(
			decodeCheckpoint({
				format: "alkalye-gzip-v1",
				body: encode(new TextEncoder().encode("not gzip")),
			}),
		),
	)
	expect(Result.isFailure(corrupted)).toBe(true)
	for (let source of ["not json", "null", "{}", "A".repeat(64_000_001)]) {
		let compressed = new Blob([source])
			.stream()
			.pipeThrough(new CompressionStream("gzip"))
		let bytes = new Uint8Array(await new Response(compressed).arrayBuffer())
		let result = await run(
			Effect.result(
				decodeCheckpoint({ format: "alkalye-gzip-v1", body: encode(bytes) }),
			),
		)
		expect(Result.isFailure(result)).toBe(true)
		if (source.length > 64_000_000 && Result.isFailure(result)) {
			expect(result.failure.operation).toBe("checkpoint.size")
			expect(result.failure.message).toBe("Checkpoint exceeds 64 MB")
		}
	}
})
