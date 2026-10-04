import * as Effect from "effect/Effect"
import { Storage } from "../src/client/storage"

let results: string[] = []
Object.assign(window, { storageResults: results })
function check(condition: unknown, message: string) {
	if (!condition) throw new Error(message)
	results.push(message)
}
let test = Effect.scoped(
	Effect.gen(function* () {
		let storage = yield* Effect.acquireRelease(Storage.open(), storage =>
			Effect.sync(() => storage.close()),
		)
		let other = yield* Effect.acquireRelease(Storage.open(), storage =>
			Effect.sync(() => storage.close()),
		)
		check(
			(yield* storage.get("missing")) === undefined,
			"missing values remain undefined",
		)
		yield* storage.set("value", "first")
		check(
			(yield* other.get("value")) === "first",
			"settings persist across independent connections",
		)
		let initialized = yield* Effect.all(
			[
				storage.getOrCreate("identity", "one"),
				other.getOrCreate("identity", "two"),
			],
			{ concurrency: 2 },
		)
		check(
			initialized[0] === initialized[1],
			"concurrent initialization preserves one identity",
		)
		yield* storage.set("counter", 0)
		yield* Effect.all(
			[
				storage.modify("counter", value => Number(value) + 1),
				other.modify("counter", value => Number(value) + 1),
			],
			{ concurrency: 2 },
		)
		check(
			(yield* storage.get("counter")) === 2,
			"concurrent atomic updates retain both changes",
		)
		let damaged = yield* storage
			.modify("value", () => {
				throw new Error("Refused change")
			})
			.pipe(Effect.result)
		check(
			damaged._tag === "Failure",
			"failed updates report typed storage failures",
		)
		check(
			(yield* other.get("value")) === "first",
			"failed updates preserve committed data",
		)
		let failedBatch = yield* storage
			.setMany([
				["value", "replacement"],
				["invalid", () => {}],
			])
			.pipe(Effect.result)
		check(failedBatch._tag === "Failure", "uncloneable batches fail explicitly")
		check(
			(yield* storage.get("value")) === "first",
			"a failed batch rolls back every write",
		)
		yield* storage.setMany([
			["prefix:one", "one"],
			["prefix:two", "two"],
		])
		check(
			(yield* storage.getPrefix("prefix:")).length === 2,
			"prefix reads select their own values",
		)
		let values = yield* storage.getMany(["prefix:two", "prefix:one", "missing"])
		check(
			values.get("prefix:one") === "one" && values.get("prefix:two") === "two",
			"batch reads retain key associations",
		)
		yield* storage.delete("prefix:one")
		check(
			(yield* other.get("prefix:one")) === undefined,
			"deletion is visible to another connection",
		)
		storage.close()
		let closed = yield* storage.get("value").pipe(Effect.result)
		check(closed._tag === "Failure", "closed databases report typed failures")
	}),
)
Effect.runPromise(test)
	.catch(error => Object.assign(window, { storageFailure: String(error) }))
	.finally(() => Object.assign(window, { storageDone: true }))
