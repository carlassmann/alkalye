import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scheduler from "effect/Scheduler"
import { Replica } from "../src/shared/crdt"
import { expandDeletions } from "../src/shared/model"
import {
	compactCheckpoint,
	parseCheckpointEffect,
} from "../src/shared/checkpoint"

function document() {
	let replica = new Replica("writer")
	let first = replica.edit(
		"document",
		`---\ntitle: Large document\n---\n${"A😀B\n".repeat(3000)}`,
	)
	if (!first) throw new Error("Missing document fixture")
	replica.apply([first])
	let removal = replica.edit(
		"document",
		replica.text("document").replaceAll("B", "C"),
	)
	if (!removal) throw new Error("Missing removal fixture")
	replica.apply([removal])
	let cancel = replica.cancel("document", removal.id)
	replica.apply([cancel])
	return replica
}

test("cooperative checkpoint hydration matches synchronous state and yields during schema, tombstone and atom loading", async () => {
	let original = document()
	for (let checkpoint of [
		original.checkpoint(),
		compactCheckpoint(original.checkpoint()),
	]) {
		let turns = 0
		let scheduler = new Scheduler.MixedScheduler("async", callback => {
			let handle = setImmediate(() => {
				turns++
				callback()
			})
			return () => clearImmediate(handle)
		})
		let cold = await Effect.runPromise(
			Replica.fromCheckpointEffect(checkpoint, "cold").pipe(
				Effect.provideService(Scheduler.Scheduler, scheduler),
			),
		)
		expect(turns).toBeGreaterThan(20)
		expect(cold.checkpoint()).toEqual(original.checkpoint())
		expect(cold.text("document")).toBe(original.text("document"))
		let held = original.visible("document")
		let fork = cold.fork("peer")
		let edit = fork.edit("document", fork.text("document") + "peer")
		if (!edit) throw new Error("Missing peer edit")
		fork.apply([edit])
		expect(fork.text("document")).toEndWith("peer")
		expect(cold.text("document")).toBe(original.text("document"))
		expect(original.visible("document")).toBe(held)
	}
}, 20_000)

test("interruption never publishes a partially hydrated document", async () => {
	let original = document()
	let snapshot = compactCheckpoint(original.checkpoint())
	let controller = new AbortController()
	let turns = 0
	let scheduler = new Scheduler.MixedScheduler("async", callback => {
		let handle = setImmediate(() => {
			if (++turns === 3) controller.abort()
			callback()
		})
		return () => clearImmediate(handle)
	})
	let result = await Effect.runPromiseExit(
		Replica.fromCheckpointEffect(snapshot, "interrupted").pipe(
			Effect.provideService(Scheduler.Scheduler, scheduler),
		),
		{ signal: controller.signal },
	)
	expect(Exit.isFailure(result)).toBe(true)
	expect(original.text("document")).toContain("A😀B")
	let reopened = await Effect.runPromise(
		Replica.fromCheckpointEffect(snapshot, "reopened"),
	)
	expect(reopened.checkpoint()).toEqual(original.checkpoint())
}, 20_000)

test("cooperative checkpoint decoding owns atom metadata before releasing a batch", async () => {
	let original = document()
	let snapshot = original.checkpoint()
	let first = snapshot.targets[0]?.atoms[0]
	if (!first) throw new Error("Missing atom fixture")
	first.order = ["untouched"]
	let turns = 0
	let scheduler = new Scheduler.MixedScheduler("async", callback => {
		let handle = setImmediate(() => {
			if (++turns === 1) {
				Reflect.set(first, "value", "changed after validation")
				Reflect.set(first.order ?? [], "0", "changed after validation")
			}
			callback()
		})
		return () => clearImmediate(handle)
	})
	let parsed = await Effect.runPromise(
		parseCheckpointEffect(snapshot).pipe(
			Effect.provideService(Scheduler.Scheduler, scheduler),
		),
	)
	expect(parsed.targets[0]?.atoms[0]?.value).not.toBe(
		"changed after validation",
	)
	expect(parsed.targets[0]?.atoms[0]?.order).toEqual(["untouched"])
}, 20_000)

test("cooperative snapshots retain deletion provenance when runs are unsorted and duplicate identities normalize", async () => {
	let original = document()
	let snapshot = original.checkpoint()
	let target = snapshot.targets[0]
	if (!target) throw new Error("Missing target fixture")
	let [removal] = target.visibility.removals
	if (!removal) throw new Error("Missing removal fixture")
	let identities = expandDeletions(removal[1]).reverse()
	let first = identities[0]
	if (!first) throw new Error("Missing deleted identity")
	target.visibility = {
		...target.visibility,
		removals: [[removal[0], [first, ...identities, first]]],
	}
	let cold = await Effect.runPromise(
		Replica.fromCheckpointEffect(snapshot, "unsorted"),
	)
	expect(cold.checkpoint()).toEqual(original.checkpoint())
	expect(cold.text("document")).toBe(original.text("document"))
}, 20_000)

test("legacy checkpoints hydrate cooperatively with permanent tombstones and enforce their migration floor", async () => {
	let replica = new Replica("legacy-writer")
	let initial = replica.edit("document", "ABC".repeat(3000))
	if (!initial) throw new Error("Missing legacy fixture")
	replica.apply([initial])
	let checkpoint = replica.checkpoint()
	let target = checkpoint.targets[0]
	if (!target) throw new Error("Missing legacy target")
	let snapshot = {
		format: "alkalye-state-v1",
		clock: checkpoint.clock,
		restored: checkpoint.restored,
		targets: [
			{
				...target,
				removed: target.atoms
					.filter(atom => atom.value === "B")
					.map(atom => atom.id),
			},
		],
	}
	let cold = await Effect.runPromise(
		Replica.fromCheckpointEffect(snapshot, "legacy-cold"),
	)
	expect(cold.text("document")).toBe("AC".repeat(3000))
	expect(cold.canCancel("document", initial.id)).toBe(false)
	let invalid = { ...snapshot, clock: 0 }
	let rejected = await Effect.runPromiseExit(
		Replica.fromCheckpointEffect(invalid, "invalid"),
	)
	expect(Exit.isFailure(rejected)).toBe(true)
}, 20_000)

test("small unsorted duplicate deletion runs hydrate to the same canonical facts", async () => {
	let original = document()
	let snapshot = original.checkpoint()
	let target = snapshot.targets[0]
	let removal = target?.visibility.removals[0]
	if (!target || !removal) throw new Error("Missing removal fixture")
	let [first, second] = expandDeletions(removal[1])
	if (!first || !second) throw new Error("Missing deleted atoms")
	target.visibility = {
		...target.visibility,
		removals: [[removal[0], [second, first, second]]],
	}
	let expected = new Replica("synchronous")
	expected.restoreCheckpoint(snapshot)
	let actual = await Effect.runPromise(
		Replica.fromCheckpointEffect(snapshot, "cooperative"),
	)
	expect(actual.checkpoint()).toEqual(expected.checkpoint())
	expect(actual.text("document")).toBe(expected.text("document"))
}, 20_000)
