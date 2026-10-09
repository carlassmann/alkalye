import type { DurableObjectStorage } from "@cloudflare/workers-types"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Schema from "effect/Schema"
import * as Scheduler from "effect/Scheduler"
import * as Semaphore from "effect/Semaphore"
import * as SqlClient from "effect/sql/SqlClient"
import type * as SqlConnection from "effect/sql/SqlConnection"
import * as SqlError from "effect/sql/SqlError"
import * as Statement from "effect/sql/Statement"
import * as Stream from "effect/Stream"

let bindingsSchema = Schema.Array(
	Schema.Union([
		Schema.String,
		Schema.Finite,
		Schema.Boolean,
		Schema.BigInt,
		Schema.Null,
		Schema.Uint8Array,
	]),
)
function decodeBindings(params: ReadonlyArray<unknown>) {
	return Schema.decodeUnknownEffect(bindingsSchema)(params).pipe(
		Effect.flatMap(bindings =>
			Effect.try({
				try: () =>
					bindings.map(value => {
						if (typeof value === "boolean") return value ? 1 : 0
						if (typeof value !== "bigint") return value
						let number = Number(value)
						if (!Number.isSafeInteger(number))
							throw new Error(
								"SQLite bigint binding exceeds exact numeric range",
							)
						return number
					}),
				catch: cause => failure("bind", cause),
			}),
		),
	)
}
let clientId = 0

export function cloudflareSqliteLayer(storage: DurableObjectStorage) {
	return Layer.effect(SqlClient.SqlClient, makeClient(storage)).pipe(
		Layer.provide(Reactivity.layer),
	)
}
function makeClient(storage: DurableObjectStorage) {
	return Effect.gen(function* () {
		let transaction = Context.Service<
			SqlClient.TransactionConnection,
			SqlClient.TransactionConnection.Service
		>(`alkalye/CloudflareSqlite/Transaction/${clientId++}`)
		let semaphore = yield* Semaphore.make(1)
		let transactionScheduler = new Scheduler.MixedScheduler("sync")
		let connection: SqlConnection.Connection = {
			execute,
			executeUnprepared: execute,
			executeRaw: (sql, params) => execute(sql, params, undefined),
			executeValues: values,
			executeValuesUnprepared: values,
			executeStream: (sql, params, transform) =>
				Stream.unwrap(
					execute(sql, params, transform).pipe(Effect.map(Stream.fromIterable)),
				),
		}
		let acquirer = Effect.acquireRelease(
			semaphore.take(1).pipe(Effect.as(connection)),
			() => semaphore.release(1),
		)
		let client = yield* SqlClient.make({
			acquirer,
			transactionAcquirer: acquirer,
			transactionService: transaction,
			compiler: Statement.makeCompilerSqlite(),
			spanAttributes: [["db.system.name", "sqlite"]],
		})
		let withTransaction: SqlClient.SqlClient["withTransaction"] = effect =>
			Effect.withFiber(fiber => {
				let current = Context.getOption(fiber.context, transaction)
				let depth = Option.isSome(current) ? current.value[1] + 1 : 0
				let body = effect.pipe(
					Effect.provideService(transaction, [connection, depth]),
					// Native transaction gates block timer-based automatic yields until commit.
					Effect.provideService(Scheduler.Scheduler, transactionScheduler),
				)
				let run = Effect.callback<
					Effect.Success<typeof effect>,
					Effect.Error<typeof effect> | SqlError.SqlError,
					Effect.Services<typeof effect>
				>(resume => {
					let cancelled = false
					let completion = storage.transaction(
						txn =>
							new Promise<void>(resolve => {
								if (cancelled) {
									txn.rollback()
									resolve()
									return
								}
								resume(
									body.pipe(
										Effect.onExit(exit => {
											if (Exit.isFailure(exit)) txn.rollback()
											resolve()
											return Effect.tryPromise({
												try: () => completion,
												catch: cause => failure("transaction", cause),
											})
										}),
									),
								)
							}),
					)
					completion.catch(cause =>
						resume(Effect.fail(failure("transaction", cause))),
					)
					return Effect.suspend(() => {
						cancelled = true
						return Effect.promise(() => completion)
					})
				})
				return Option.isSome(current) ? run : semaphore.withPermits(1)(run)
			})
		return Object.assign(client, { withTransaction })

		function values(sql: string, params: ReadonlyArray<unknown>) {
			return Effect.gen(function* () {
				let bindings = yield* decodeBindings(params).pipe(
					Effect.mapError(cause => failure("bind", cause)),
				)
				return yield* Effect.try({
					try: () =>
						Array.from(storage.sql.exec(sql, ...bindings).raw(), row =>
							row.map(value =>
								value instanceof ArrayBuffer ? new Uint8Array(value) : value,
							),
						),
					catch: cause => failure("execute", cause),
				})
			})
		}
		function execute(
			sql: string,
			params: ReadonlyArray<unknown>,
			transform:
				| (<A extends object>(rows: ReadonlyArray<A>) => ReadonlyArray<A>)
				| undefined,
		) {
			return Effect.gen(function* () {
				let bindings = yield* decodeBindings(params).pipe(
					Effect.mapError(cause => failure("bind", cause)),
				)
				let rows = yield* Effect.try({
					try: () =>
						Array.from(storage.sql.exec(sql, ...bindings), row =>
							Object.fromEntries(
								Object.entries(row).map(([key, value]) => [
									key,
									value instanceof ArrayBuffer ? new Uint8Array(value) : value,
								]),
							),
						),
					catch: cause => failure("execute", cause),
				})
				return transform ? transform(rows) : rows
			})
		}
	})
}
function failure(operation: string, cause: unknown) {
	return new SqlError.SqlError({
		reason: SqlError.classifySqliteError(cause, {
			operation,
			message: `Durable Object SQLite ${operation} failed`,
		}),
	})
}
