import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Migrator from "effect/sql/Migrator"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlSchema from "effect/sql/SqlSchema"
import { sqliteLayer } from "../platform/sqlite"
import { makeAgentDatabase } from "./agent-database"
import { makeOAuthDatabase } from "./oauth-database"
export class AgentStore extends Context.Service<
	AgentStore,
	Effect.Success<ReturnType<typeof makeStore>>
>()("alkalye/AgentStore") {
	static layer(filename: string) {
		return Layer.effect(AgentStore, makeStore()).pipe(
			Layer.provide(sqliteLayer(filename)),
		)
	}
}
function makeStore() {
	return Effect.gen(function* () {
		yield* Migrator.make({})({
			table: "agent_sql_migrations",
			loader: Migrator.fromRecord({
				"001_agent_storage": agentSchema,
				"002_expiry_indexes": expiryIndexes,
			}),
		})
		let oauth = yield* makeOAuthDatabase()
		let agents = yield* makeAgentDatabase(oauth)
		return { oauth, agents }
	})
}
let agentSchema = Effect.gen(function* () {
	let sql = yield* SqlClient.SqlClient
	yield* sql`CREATE TABLE IF NOT EXISTS connection_owners (id TEXT PRIMARY KEY, room TEXT NOT NULL, capability TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL)`
	yield* sql`CREATE TABLE IF NOT EXISTS connection_expiry (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, resource TEXT NOT NULL)`
	yield* sql`CREATE TABLE IF NOT EXISTS connections (token TEXT PRIMARY KEY, packet TEXT NOT NULL)`
	yield* sql`CREATE TABLE IF NOT EXISTS oauth_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirects TEXT NOT NULL)`
	yield* sql`CREATE TABLE IF NOT EXISTS oauth_requests (id TEXT PRIMARY KEY, client TEXT NOT NULL, redirect TEXT NOT NULL, challenge TEXT NOT NULL, state TEXT NOT NULL, expires INTEGER NOT NULL)`
	yield* sql`CREATE TABLE IF NOT EXISTS oauth_codes (code TEXT PRIMARY KEY, client TEXT NOT NULL, redirect TEXT NOT NULL, challenge TEXT NOT NULL, token TEXT NOT NULL, expires INTEGER NOT NULL)`
	yield* sql`CREATE TABLE IF NOT EXISTS oauth_refresh (id TEXT PRIMARY KEY, client TEXT NOT NULL, resource TEXT NOT NULL, token TEXT NOT NULL, access TEXT NOT NULL, scope TEXT NOT NULL, expires INTEGER NOT NULL, family TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0)`
	let columns = SqlSchema.findAll({
		Request: Schema.String,
		Result: Schema.Struct({ name: Schema.String }),
		execute: table => sql`PRAGMA table_info(${sql(table)})`,
	})
	for (let table of ["oauth_requests", "oauth_codes"]) {
		let existing = new Set((yield* columns(table)).map(column => column.name))
		if (!existing.has("resource"))
			yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN resource TEXT NOT NULL DEFAULT ''`
		if (!existing.has("scope"))
			yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN scope TEXT NOT NULL DEFAULT 'documents'`
	}
})

let expiryIndexes = Effect.gen(function* () {
	let sql = yield* SqlClient.SqlClient
	yield* sql`CREATE INDEX IF NOT EXISTS oauth_refresh_access ON oauth_refresh(access,used,expires)`
	yield* sql`CREATE INDEX IF NOT EXISTS oauth_refresh_family ON oauth_refresh(family)`
	yield* sql`CREATE INDEX IF NOT EXISTS oauth_refresh_expiry ON oauth_refresh(expires)`
	yield* sql`CREATE INDEX IF NOT EXISTS oauth_requests_expiry ON oauth_requests(expires)`
	yield* sql`CREATE INDEX IF NOT EXISTS oauth_codes_expiry ON oauth_codes(expires)`
	yield* sql`CREATE INDEX IF NOT EXISTS connection_expiry_time ON connection_expiry(expires)`
})
