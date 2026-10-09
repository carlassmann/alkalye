import type {
	DurableObjectState,
	DurableObjectNamespace,
} from "@cloudflare/workers-types"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Schema from "effect/Schema"
import * as SqlSchema from "effect/sql/SqlSchema"
import * as SqlClient from "effect/sql/SqlClient"
import { cloudflareSqliteLayer } from "../src/platform/cloudflare-sqlite"

export class SqliteProbe {
	constructor(private context: DurableObjectState) {}
	async fetch() {
		let result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let sql = yield* SqlClient.SqlClient
					yield* sql`CREATE TABLE IF NOT EXISTS probe (name TEXT PRIMARY KEY)`
					yield* sql`DELETE FROM probe`
					yield* sql`CREATE TABLE IF NOT EXISTS binary_probe (id INTEGER PRIMARY KEY, bytes BLOB NOT NULL)`
					yield* sql`INSERT OR REPLACE INTO binary_probe VALUES (${1}, ${new Uint8Array([1, 2, 255])})`
					let binary = yield* SqlSchema.findOne({
						Request: Schema.Void,
						Result: Schema.Struct({ bytes: Schema.Uint8Array }),
						execute: () => sql`SELECT bytes FROM binary_probe WHERE id=1`,
					})(undefined)
					let boolean = yield* sql`SELECT ${true} AS value`
					let failed = yield* sql
						.withTransaction(
							Effect.gen(function* () {
								yield* sql`INSERT INTO probe VALUES ('rollback')`
								yield* Effect.yieldNow
								return yield* Effect.fail("expected")
							}),
						)
						.pipe(Effect.result)
					let nested = yield* sql
						.withTransaction(
							Effect.gen(function* () {
								yield* sql`INSERT INTO probe VALUES ('outer')`
								yield* sql
									.withTransaction(
										Effect.gen(function* () {
											yield* sql`INSERT INTO probe VALUES ('inner')`
											yield* Effect.yieldNow
											return yield* Effect.fail("inner")
										}),
									)
									.pipe(Effect.result)
								return yield* sql`SELECT name FROM probe ORDER BY name`
							}),
						)
						.pipe(Effect.result)
					let entered = yield* Deferred.make<void>()
					let blocked = yield* Effect.forkChild(
						sql.withTransaction(
							Effect.gen(function* () {
								yield* sql`INSERT INTO probe VALUES ('interrupted')`
								yield* Deferred.succeed(entered, undefined)
								yield* Effect.never
							}),
						),
					)
					yield* Deferred.await(entered)
					let interrupted = yield* Fiber.interrupt(blocked)
					let writeEntered = yield* Deferred.make<void>()
					let releaseWrite = yield* Deferred.make<void>()
					let readStarted = yield* Deferred.make<void>()
					let readComplete = yield* Deferred.make<void>()
					let writer = yield* Effect.forkChild(
						sql.withTransaction(
							Effect.gen(function* () {
								yield* sql`INSERT INTO probe VALUES ('isolated')`
								yield* Deferred.succeed(writeEntered, undefined)
								yield* Deferred.await(releaseWrite)
							}),
						),
					)
					yield* Deferred.await(writeEntered)
					let reader = yield* Effect.forkChild(
						Effect.gen(function* () {
							yield* Deferred.succeed(readStarted, undefined)
							let rows = yield* sql`SELECT name FROM probe ORDER BY name`
							yield* Deferred.succeed(readComplete, undefined)
							return rows
						}),
					)
					yield* Deferred.await(readStarted)
					yield* Effect.yieldNow
					let readWhileHeld = yield* Deferred.poll(readComplete)
					yield* Deferred.succeed(releaseWrite, undefined)
					yield* Fiber.join(writer)
					let isolatedRead = yield* Fiber.join(reader)
					let rows = yield* sql`SELECT name FROM probe ORDER BY name`
					return {
						binary: [...binary.bytes],
						boolean,
						failed,
						nested,
						interrupted,
						readWhileHeld,
						isolatedRead,
						rows,
					}
				}),
			).pipe(Effect.provide(cloudflareSqliteLayer(this.context.storage))),
		)
		return Response.json(result)
	}
}
export let handler = {
	fetch(request: Request, env: { PROBE: DurableObjectNamespace }) {
		if (new URL(request.url).pathname === "/health")
			return Response.json({ ready: true })
		return env.PROBE.get(env.PROBE.idFromName("sqlite")).fetch(
			"https://probe.test/",
		)
	},
}

export { handler as default }
