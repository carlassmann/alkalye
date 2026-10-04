import { Database, type SQLQueryBindings } from "bun:sqlite"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/sql/SqlClient"
import type * as SqlConnection from "effect/sql/SqlConnection"
import * as SqlError from "effect/sql/SqlError"
import * as Statement from "effect/sql/Statement"

let bindingSchema = Schema.Array(
	Schema.Union([
		Schema.String,
		Schema.Finite,
		Schema.BigInt,
		Schema.Boolean,
		Schema.Null,
		Schema.Uint8Array,
	]),
)
let decodeBindings = Schema.decodeUnknownEffect(bindingSchema)
export function sqliteLayer(
	filename: string,
	options: {
		busyTimeout?: number
		readonly?: boolean
		journalMode?: "wal" | "delete"
		transactionMode?: "immediate" | "deferred"
	} = {},
) {
	return Layer.effect(
		SqlClient.SqlClient,
		makeSqlite(
			filename,
			options.busyTimeout ?? 5000,
			options.journalMode ?? "wal",
			options.transactionMode ?? (options.readonly ? "deferred" : "immediate"),
			options.readonly ?? false,
		),
	).pipe(Layer.provide(Reactivity.layer))
}
function makeSqlite(
	filename: string,
	busyTimeout: number,
	journalMode: "wal" | "delete",
	transactionMode: "immediate" | "deferred",
	readonly: boolean,
) {
	return Effect.gen(function* () {
		let database = yield* Effect.acquireRelease(
			native(
				"open",
				() =>
					new Database(filename, { create: !readonly, readonly, strict: true }),
			),
			database =>
				native("close", () => database.close(true)).pipe(Effect.orDie),
		)
		yield* native("configure", () =>
			database.run(
				`PRAGMA busy_timeout=${busyTimeout}; ${readonly ? "" : `PRAGMA journal_mode=${journalMode};`} PRAGMA foreign_keys=ON`,
			),
		)
		let semaphore = yield* Semaphore.make(1)
		let connection: SqlConnection.Connection = {
			execute,
			executeUnprepared: execute,
			executeRaw: (sql, params) =>
				prepare(sql, params, (statement, bindings) =>
					statement.run(...bindings),
				),
			executeStream: (sql, params, transform) =>
				Stream.unwrap(
					execute(sql, params, transform).pipe(Effect.map(Stream.fromIterable)),
				),
			executeValues: values,
			executeValuesUnprepared: values,
		}
		let acquisitions = SqlClient.makeSqliteAcquirers({
			connection: Effect.succeed(connection),
			semaphore,
			isTransaction: () => database.inTransaction,
		})
		return yield* SqlClient.make({
			...acquisitions,
			// Hold the lease through execution so a concurrent transaction cannot capture this statement.
			acquirer: acquisitions.transactionAcquirer,
			compiler: Statement.makeCompilerSqlite(),
			beginTransaction:
				transactionMode === "immediate" ? "BEGIN IMMEDIATE" : "BEGIN",
			releaseSavepoint: name => `RELEASE SAVEPOINT ${name}`,
			spanAttributes: [["db.system.name", "sqlite"]],
		})
		function execute(
			sql: string,
			params: ReadonlyArray<unknown>,
			transform:
				| (<A extends object>(rows: ReadonlyArray<A>) => ReadonlyArray<A>)
				| undefined,
		) {
			return prepare(sql, params, (statement, bindings) => {
				let rows = statement.all(...bindings)
				return transform ? transform(rows) : rows
			})
		}
		function values(sql: string, params: ReadonlyArray<unknown>) {
			return prepare(sql, params, (statement, bindings) =>
				statement.values(...bindings),
			)
		}
		function prepare<A>(
			sql: string,
			params: ReadonlyArray<unknown>,
			read: (
				statement: import("bun:sqlite").Statement<
					SqlConnection.Row,
					SQLQueryBindings[]
				>,
				bindings: SQLQueryBindings[],
			) => A,
		) {
			return Effect.gen(function* () {
				let bindings = yield* decodeBindings(params).pipe(
					Effect.mapError(cause => failure("bind", cause)),
				)
				let safeIntegers = yield* SqlClient.SafeIntegers
				return yield* native("execute", () => {
					let statement = database.prepare<
						SqlConnection.Row,
						SQLQueryBindings[]
					>(sql)
					try {
						if (
							"safeIntegers" in statement &&
							typeof statement.safeIntegers === "function"
						)
							statement.safeIntegers(safeIntegers)
						else if (safeIntegers)
							throw new Error(
								"This Bun runtime does not support safe SQLite integers",
							)
						return read(statement, [...bindings])
					} finally {
						statement.finalize()
					}
				})
			})
		}
	})
}
function native<A>(operation: string, work: () => A) {
	return Effect.try({ try: work, catch: cause => failure(operation, cause) })
}
function failure(operation: string, cause: unknown) {
	return new SqlError.SqlError({
		reason: SqlError.classifySqliteError(cause, {
			operation,
			message: `SQLite ${operation} failed`,
		}),
	})
}
