import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlSchema from "effect/sql/SqlSchema"
import { sqliteLayer } from "../src/platform/sqlite"
let directory = await mkdtemp(join(tmpdir(), "alkalye-effect-sqlite-"))
afterAll(() => rm(directory, { recursive: true, force: true }))
function database<A, E>(
	name: string,
	task: Effect.Effect<A, E, SqlClient.SqlClient>,
) {
	return Effect.runPromise(
		task.pipe(Effect.provide(sqliteLayer(join(directory, name + ".sqlite")))),
	)
}
test("native SQLite compiles identifiers and binds Unicode, blobs and integers without interpolation", async () => {
	await database(
		"bindings",
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			expect(yield* sql`PRAGMA journal_mode`).toEqual([{ journal_mode: "wal" }])
			yield* sql`CREATE TABLE ${sql("notes")} (id INTEGER PRIMARY KEY, title TEXT, bytes BLOB, large INTEGER, optional TEXT)`
			let title = "héllo'); DROP TABLE notes; --"
			let blob = new Uint8Array([0, 255, 128])
			yield* sql`INSERT INTO notes VALUES (1, ${title}, ${blob}, ${9007199254740993n}, ${null})`
			let find = SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({
					title: Schema.String,
					bytes: Schema.Uint8Array,
					large: Schema.BigInt,
					optional: Schema.Null,
				}),
				execute: () => sql`SELECT title,bytes,large,optional FROM notes`,
			})
			expect(
				yield* find(undefined).pipe(
					Effect.provideService(SqlClient.SafeIntegers, true),
				),
			).toEqual([
				{ title, bytes: blob, large: 9007199254740993n, optional: null },
			])
			expect(yield* sql`SELECT title FROM notes`.values).toEqual([[title]])
			expect(
				yield* sql`SELECT title FROM notes`.stream.pipe(Stream.runCollect),
			).toEqual([{ title }])
		}),
	)
})
test("nested transactions roll back failed savepoints while preserving the outer work", async () => {
	await database(
		"savepoints",
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TABLE notes (id INTEGER PRIMARY KEY)`
			yield* Effect.gen(function* () {
				yield* sql`INSERT INTO notes VALUES (1)`
				let failed = yield* Effect.gen(function* () {
					yield* sql`INSERT INTO notes VALUES (2)`
					return yield* Effect.fail("cancel nested edit")
				}).pipe(sql.withTransaction, Effect.exit)
				expect(Exit.isFailure(failed)).toBe(true)
				yield* sql`INSERT INTO notes VALUES (3)`
			}).pipe(sql.withTransaction)
			expect(yield* sql`SELECT id FROM notes ORDER BY id`).toEqual([
				{ id: 1 },
				{ id: 3 },
			])
		}),
	)
})
test("interrupting a transaction rolls back and releases an unrelated waiting reader", async () => {
	await database(
		"interrupt",
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TABLE notes (id INTEGER PRIMARY KEY)`
			let written = yield* Deferred.make<void>()
			let transaction = yield* Effect.gen(function* () {
				yield* sql`INSERT INTO notes VALUES (1)`
				yield* Deferred.succeed(written, undefined)
				yield* Effect.never
			}).pipe(sql.withTransaction, Effect.forkChild)
			yield* Deferred.await(written)
			let reader = yield* sql`SELECT id FROM notes`.pipe(Effect.forkChild)
			let stream = yield* sql`SELECT id FROM notes`.stream.pipe(
				Stream.runCollect,
				Effect.forkChild,
			)
			yield* Effect.yieldNow
			expect(reader.pollUnsafe()).toBeUndefined()
			expect(stream.pollUnsafe()).toBeUndefined()
			yield* Fiber.interrupt(transaction)
			expect(yield* Fiber.join(reader)).toEqual([])
			expect(yield* Fiber.join(stream)).toEqual([])
			yield* sql`INSERT INTO notes VALUES (2)`
			expect(yield* sql`SELECT id FROM notes`).toEqual([{ id: 2 }])
		}),
	)
})
test("failed deferred constraints clean up the commit before the connection is reused", async () => {
	await database(
		"commit",
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TABLE parents (id INTEGER PRIMARY KEY)`
			yield* sql`CREATE TABLE children (id INTEGER PRIMARY KEY, parent INTEGER REFERENCES parents(id) DEFERRABLE INITIALLY DEFERRED)`
			let failed = yield* sql`INSERT INTO children VALUES (1,99)`.pipe(
				sql.withTransaction,
				Effect.exit,
			)
			expect(Exit.isFailure(failed)).toBe(true)
			expect(yield* sql`SELECT id FROM children`).toEqual([])
			yield* Effect.gen(function* () {
				yield* sql`INSERT INTO parents VALUES (99)`
				yield* sql`INSERT INTO children VALUES (2,99)`
			}).pipe(sql.withTransaction)
			expect(yield* sql`SELECT id FROM children`).toEqual([{ id: 2 }])
		}),
	)
})
test("database scope closure releases handles while committed data survives reopening", async () => {
	let closed = await database(
		"reopen",
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TABLE notes (id INTEGER PRIMARY KEY)`
			yield* sql`INSERT INTO notes VALUES (7)`
			return sql
		}),
	)
	let failed = await Effect.runPromiseExit(closed`SELECT id FROM notes`)
	expect(Exit.isFailure(failed)).toBe(true)
	await database(
		"reopen",
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			expect(yield* sql`SELECT id FROM notes`).toEqual([{ id: 7 }])
		}),
	)
})

test("raw executions return Bun change metadata and malformed bindings fail before writing", async () => {
	await database(
		"raw",
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT)`
			expect(yield* sql`INSERT INTO notes VALUES (1,${"saved"})`.raw).toEqual({
				changes: 1,
				lastInsertRowid: 1,
			})
			let invalid = yield* sql
				.unsafe("INSERT INTO notes VALUES (2,?)", [new Date()])
				.pipe(Effect.exit)
			expect(Exit.isFailure(invalid)).toBe(true)
			expect(yield* sql`SELECT id,title FROM notes`).toEqual([
				{ id: 1, title: "saved" },
			])
		}),
	)
})

test("a managed runtime releases its connection after a failed transaction", async () => {
	let runtime = ManagedRuntime.make(
		sqliteLayer(join(directory, "managed.sqlite")),
	)
	let sql = await runtime.runPromise(SqlClient.SqlClient)
	try {
		await runtime.runPromise(sql`CREATE TABLE notes (id INTEGER PRIMARY KEY)`)
		let failed = await runtime.runPromiseExit(
			Effect.gen(function* () {
				yield* sql`INSERT INTO notes VALUES (1)`
				yield* sql`INSERT INTO notes VALUES (1)`
			}).pipe(sql.withTransaction),
		)
		expect(Exit.isFailure(failed)).toBe(true)
	} finally {
		await runtime.dispose()
	}
	expect(
		Exit.isFailure(await Effect.runPromiseExit(sql`SELECT id FROM notes`)),
	).toBe(true)
	await database(
		"managed",
		Effect.gen(function* () {
			let reopened = yield* SqlClient.SqlClient
			expect(yield* reopened`SELECT id FROM notes`).toEqual([])
		}),
	)
})

test("read-only connections allow snapshot transactions and reject writes without creating files", async () => {
	await database(
		"readonly",
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TABLE notes (id INTEGER PRIMARY KEY)`
			yield* sql`INSERT INTO notes VALUES (1)`
		}),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let sql = yield* SqlClient.SqlClient
			expect(
				yield* sql`SELECT id FROM notes`.pipe(sql.withTransaction),
			).toEqual([{ id: 1 }])
			expect(
				Exit.isFailure(
					yield* sql`INSERT INTO notes VALUES (2)`.pipe(Effect.exit),
				),
			).toBe(true)
			expect(yield* sql`SELECT id FROM notes`).toEqual([{ id: 1 }])
		}).pipe(
			Effect.provide(
				sqliteLayer(join(directory, "readonly.sqlite"), { readonly: true }),
			),
		),
	)
	let missing = await Effect.runPromiseExit(
		SqlClient.SqlClient.pipe(
			Effect.provide(
				sqliteLayer(join(directory, "missing.sqlite"), { readonly: true }),
			),
		),
	)
	expect(Exit.isFailure(missing)).toBe(true)
})
