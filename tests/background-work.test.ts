import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import * as Semaphore from "effect/Semaphore"
import { TestClock } from "effect/testing"
import {
	BackgroundWork,
	makeBackgroundWork,
} from "../src/platform/background-work"
import { documentStatsEffect } from "../src/shared/document-stats"
import { makeDocumentRecovery } from "../src/shared/document-recovery"

test("interaction suspends optional work before its document lock while durable edits remain runnable", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let work = yield* makeBackgroundWork()
				let document = yield* Semaphore.make(1)
				let completed: string[] = []
				work.interact()
				let snapshot = yield* Effect.forkChild(
					work.beforeDerived.pipe(
						Effect.andThen(
							document.withPermit(
								Effect.sync(() => completed.push("snapshot")),
							),
						),
					),
					{ startImmediately: true },
				)
				yield* document.withPermit(Effect.sync(() => completed.push("journal")))
				yield* TestClock.adjust("99 millis")
				expect(completed).toEqual(["journal"])
				yield* TestClock.adjust("1 millis")
				yield* Fiber.join(snapshot)
				expect(completed).toEqual(["journal", "snapshot"])
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("continuous input cannot starve optional work and checkpoints yield a bounded input window", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let work = yield* makeBackgroundWork()
				let completed = false
				work.interact()
				let task = yield* Effect.forkChild(
					work.beforeDerived.pipe(
						Effect.andThen(
							Effect.sync(() => {
								completed = true
							}),
						),
					),
					{ startImmediately: true },
				)
				for (let index = 0; index < 6; index++) {
					yield* TestClock.adjust("80 millis")
					work.interact()
					expect(completed).toBe(false)
				}
				yield* TestClock.adjust("20 millis")
				yield* Fiber.join(task)
				expect(completed).toBe(true)
				completed = false
				let chunk = yield* Effect.forkChild(
					work.betweenChunks.pipe(
						Effect.andThen(
							Effect.sync(() => {
								completed = true
							}),
						),
					),
					{ startImmediately: true },
				)
				yield* TestClock.adjust("15 millis")
				expect(completed).toBe(false)
				yield* TestClock.adjust("1 millis")
				yield* Fiber.join(chunk)
				expect(completed).toBe(true)
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("lifecycle release bypasses interaction and closing the owner releases waits and debounce resources", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let owner = yield* Scope.make()
				let work = yield* makeBackgroundWork().pipe(
					Effect.provideService(Scope.Scope, owner),
				)
				work.interact()
				let task = yield* Effect.forkChild(work.beforeDerived, {
					startImmediately: true,
				})
				work.release()
				yield* Fiber.join(task)
				work.interact()
				let pending = yield* Effect.forkChild(work.beforeDerived, {
					startImmediately: true,
				})
				yield* Scope.close(owner, Exit.void)
				yield* Fiber.join(pending)
				work.interact()
				yield* work.beforeDerived
				yield* TestClock.adjust("10 seconds")
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("deferred recovery snapshots cannot hold the snapshot lock against an explicit lifecycle flush", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let work = yield* makeBackgroundWork()
				let lock = yield* Semaphore.make(1)
				let completed: string[] = []
				let snapshot = Effect.sync(() => completed.push("snapshot"))
				let recovery = yield* makeDocumentRecovery(
					{
						save: Effect.sync(() => completed.push("journal")),
						projection: Effect.void,
						snapshot,
						notification: Effect.void,
					},
					{ snapshot: lock },
					{ snapshot: work.beforeSnapshot },
				)
				work.interact()
				let deferred = yield* Effect.forkChild(recovery.run("snapshot"), {
					startImmediately: true,
				})
				yield* recovery.attempt("save")
				yield* recovery.attempt("snapshot", lock.withPermit(snapshot))
				expect(completed).toEqual(["journal", "snapshot"])
				work.release()
				yield* Fiber.join(deferred)
				expect(completed).toEqual(["journal", "snapshot", "snapshot"])
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("large document statistics suspend between chunks and resume with complete counts", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let work = yield* makeBackgroundWork()
				let completed = false
				work.interact()
				let counts = yield* Effect.forkChild(
					documentStatsEffect("One two.\n".repeat(25000)).pipe(
						Effect.provideService(BackgroundWork, work),
						Effect.tap(() =>
							Effect.sync(() => {
								completed = true
							}),
						),
					),
					{ startImmediately: true },
				)
				yield* Effect.yieldNow
				expect(completed).toBe(false)
				work.release()
				expect(yield* Fiber.join(counts)).toEqual({
					words: 50000,
					sentences: 25000,
					tasks: 0,
					completedTasks: 0,
				})
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("periodic snapshots get a bounded opportunity during uninterrupted interaction", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let work = yield* makeBackgroundWork()
				let completed = false
				work.interact()
				let snapshot = yield* Effect.forkChild(
					work.beforeSnapshot.pipe(
						Effect.andThen(
							Effect.sync(() => {
								completed = true
							}),
						),
					),
					{ startImmediately: true },
				)
				for (let index = 0; index < 124; index++) {
					yield* TestClock.adjust("80 millis")
					work.interact()
					expect(completed).toBe(false)
				}
				yield* TestClock.adjust("80 millis")
				yield* Fiber.join(snapshot)
				expect(completed).toBe(true)
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})
