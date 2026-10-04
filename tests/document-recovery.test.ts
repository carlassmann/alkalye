import { expect, test } from "bun:test"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as Option from "effect/Option"
import * as SqlError from "effect/sql/SqlError"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import { TestClock } from "effect/testing"
import { makeDocumentRecovery } from "../src/client/document-recovery"
import {
	documentFailure,
	LocalDocumentFailure,
} from "../src/client/document-failures"

function storageError(message = "Temporary storage failure") {
	return new EventJournal.EventJournalError({
		method: "read",
		cause: new EventJournal.EventJournalError({
			method: "transaction",
			cause: new DOMException(message, "UnknownError"),
		}),
	})
}

test("storage failures preserve the actionable cause through nested journal wrappers", () => {
	let failure = documentFailure("save", storageError("Device storage is full"))
	expect(failure.message).toBe("Device storage is full")
	expect(failure).toBeInstanceOf(LocalDocumentFailure)
	if (failure instanceof LocalDocumentFailure)
		expect(failure.retryable).toBe(true)
	let unnamed = documentFailure(
		"save",
		new DOMException("", "QuotaExceededError"),
	)
	expect(unnamed.message).toBe("QuotaExceededError")
})

test("idle save recovery drains a failed append without another foreground request", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let calls = 0
				let recovery = yield* makeDocumentRecovery({
					save: Effect.suspend(() =>
						++calls === 1 ? Effect.fail(storageError()) : Effect.void,
					),
					projection: Effect.void,
					snapshot: Effect.void,
					notification: Effect.void,
				})
				yield* recovery.attempt("save").pipe(Effect.result)
				expect(recovery.failures.current().save).toBeInstanceOf(
					LocalDocumentFailure,
				)
				yield* TestClock.adjust("100 millis")
				expect(calls).toBe(2)
				expect(recovery.failures.current().save).toBeUndefined()
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("an attempt waiting for its gate clears a failure that preceded its actual work", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let gate = yield* Semaphore.make(1)
				let entered = yield* Deferred.make<void>()
				let release = yield* Deferred.make<void>()
				let recovery = yield* makeDocumentRecovery(
					{
						save: Effect.void,
						projection: Effect.void,
						snapshot: Effect.void,
						notification: Effect.void,
					},
					{ projection: gate },
				)
				let holder = yield* gate
					.withPermit(
						Deferred.succeed(entered, undefined).pipe(
							Effect.andThen(Deferred.await(release)),
						),
					)
					.pipe(Effect.forkScoped)
				yield* Deferred.await(entered)
				let waiting = yield* recovery
					.attempt("projection")
					.pipe(Effect.forkScoped({ startImmediately: true }))
				yield* recovery
					.attempt("projection", Effect.fail(storageError()))
					.pipe(Effect.result)
				yield* Deferred.succeed(release, undefined)
				yield* Fiber.join(holder)
				let result = yield* Fiber.join(waiting).pipe(Effect.result)
				expect(result._tag).toBe("Success")
				expect(recovery.failures.current().projection).toBeUndefined()
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("recovery keeps save, projection, snapshot and notification failures independent", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let recovery = yield* makeDocumentRecovery({
					save: Effect.void,
					projection: Effect.void,
					snapshot: Effect.fail(storageError("Snapshot quota")),
					notification: Effect.fail(
						new DOMException("Closed channel", "InvalidStateError"),
					),
				})
				let save = documentFailure("save", storageError("Unsaved text"))
				yield* recovery.saveFailure(save)
				yield* recovery.attempt("snapshot").pipe(Effect.result)
				yield* recovery.attempt("notification").pipe(Effect.result)
				yield* recovery.attempt("projection")
				let failures = recovery.failures.current()
				expect(failures.save).toBe(save)
				expect(failures.snapshot).toBeInstanceOf(LocalDocumentFailure)
				expect(failures.notification).toBeInstanceOf(LocalDocumentFailure)
				expect(failures.projection).toBeUndefined()
				expect(Object.isFrozen(failures)).toBe(true)
				expect(Object.isFrozen(failures.snapshot)).toBe(true)
				expect(() =>
					Object.assign(failures.snapshot ?? {}, { retryable: false }),
				).toThrow()
				yield* recovery.saveFailure()
				expect(recovery.failures.current().snapshot).toBe(failures.snapshot)
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("nested transient journal failures heal automatically with backoff and no self-signaling", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let calls = 0
				let recovery = yield* makeDocumentRecovery({
					save: Effect.void,
					projection: Effect.suspend(() =>
						++calls < 3 ? Effect.fail(storageError()) : Effect.void,
					),
					snapshot: Effect.void,
					notification: Effect.void,
				})
				yield* recovery.attempt("projection").pipe(Effect.result)
				expect(calls).toBe(1)
				yield* TestClock.adjust("100 millis")
				expect(calls).toBe(2)
				yield* TestClock.adjust("200 millis")
				expect(calls).toBe(3)
				expect(recovery.failures.current().projection).toBeUndefined()
				yield* TestClock.adjust("1 minute")
				expect(calls).toBe(3)
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("schema damage remains terminal instead of becoming an infrastructure retry loop", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let calls = 0
				let damaged = Schema.decodeUnknownEffect(
					Schema.Struct({ title: Schema.String }),
				)({ title: 13 }).pipe(
					Effect.mapError(
						cause =>
							new EventJournal.EventJournalError({ method: "decode", cause }),
					),
					Effect.tapError(() =>
						Effect.sync(() => {
							calls++
						}),
					),
				)
				let recovery = yield* makeDocumentRecovery({
					save: Effect.void,
					projection: damaged,
					snapshot: Effect.void,
					notification: Effect.void,
				})
				yield* recovery.attempt("projection").pipe(Effect.result)
				yield* TestClock.adjust("1 minute")
				expect(calls).toBe(1)
				let failure = recovery.failures.current().projection
				expect(failure).toBeInstanceOf(LocalDocumentFailure)
				if (failure instanceof LocalDocumentFailure)
					expect(failure.retryable).toBe(false)
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("a foreground failure during recovery cannot be hidden by the older successful attempt", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let entered = yield* Deferred.make<void>()
				let release = yield* Deferred.make<void>()
				let calls = 0
				let recovery = yield* makeDocumentRecovery({
					save: Effect.void,
					projection: Effect.suspend(() => {
						calls++
						if (calls === 1) return Effect.fail(storageError("First failure"))
						if (calls === 2)
							return Deferred.succeed(entered, undefined).pipe(
								Effect.andThen(Deferred.await(release)),
							)
						return Effect.void
					}),
					snapshot: Effect.void,
					notification: Effect.void,
				})
				yield* recovery.attempt("projection").pipe(Effect.result)
				yield* TestClock.adjust("100 millis")
				yield* Deferred.await(entered)
				yield* recovery
					.attempt("projection", Effect.fail(storageError("Newer failure")))
					.pipe(Effect.result)
				yield* Deferred.succeed(release, undefined)
				yield* TestClock.adjust("200 millis")
				expect(calls).toBe(3)
				expect(recovery.failures.current().projection).toBeUndefined()
				yield* TestClock.adjust("1 minute")
				expect(calls).toBe(3)
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("closing the recovery scope cancels backoff and stops subsequent attempts", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let scope = yield* Scope.make()
				let calls = 0
				let recovery = yield* makeDocumentRecovery({
					save: Effect.void,
					projection: Effect.suspend(() => {
						calls++
						return Effect.fail(storageError())
					}),
					snapshot: Effect.void,
					notification: Effect.void,
				}).pipe(Effect.provideService(Scope.Scope, scope))
				yield* recovery.attempt("projection").pipe(Effect.result)
				yield* TestClock.adjust("100 millis")
				expect(calls).toBe(2)
				yield* Scope.close(scope, Exit.void)
				yield* TestClock.adjust("1 minute")
				expect(calls).toBe(2)
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("deferring a snapshot preserves its existing failure until a real copy succeeds", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let recovery = yield* makeDocumentRecovery({
					save: Effect.void,
					projection: Effect.void,
					snapshot: Effect.void,
					notification: Effect.void,
				})
				yield* recovery
					.attempt(
						"snapshot",
						Effect.fail(storageError("Snapshot unavailable")),
					)
					.pipe(Effect.result)
				let failure = recovery.failures.current().snapshot
				yield* recovery
					.attempt("snapshot", Effect.succeed(Option.none()))
					.pipe(Effect.result)
				expect(recovery.failures.current().snapshot).toBe(failure)
				yield* recovery.attempt(
					"snapshot",
					Effect.succeed(Option.some(undefined)),
				)
				expect(recovery.failures.current().snapshot).toBeUndefined()
			}),
		).pipe(Effect.provide(TestClock.layer())),
	)
})

test("SQLite lock timeouts are actionable retryable document failures", () => {
	let error = new SqlError.SqlError({
		reason: SqlError.classifySqliteError(
			{ code: "SQLITE_BUSY", errno: 5 },
			{ operation: "append", message: "Database is busy" },
		),
	})
	let failure = documentFailure("save", error)
	expect(failure).toBeInstanceOf(LocalDocumentFailure)
	expect(failure.message).toBe("Database is busy")
	if (failure instanceof LocalDocumentFailure)
		expect(failure.retryable).toBe(true)
})
