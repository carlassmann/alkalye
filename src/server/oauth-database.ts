import { decodeStored } from "./failures"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlSchema from "effect/sql/SqlSchema"

export type OAuthDatabase = Effect.Success<ReturnType<typeof makeOAuthDatabase>>
let authorization = Schema.Struct({
	client: Schema.String,
	redirect: Schema.String,
	challenge: Schema.String,
	expires: Schema.Natural,
	resource: Schema.String,
	scope: Schema.String,
})
let requestSchema = Schema.Struct({
	...authorization.fields,
	id: Schema.String,
	state: Schema.String,
})
let codeSchema = Schema.Struct({
	...authorization.fields,
	code: Schema.String,
	token: Schema.String,
})
let refreshSchema = Schema.Struct({
	id: Schema.String,
	client: Schema.String,
	resource: Schema.String,
	token: Schema.String,
	access: Schema.String,
	scope: Schema.String,
	expires: Schema.Natural,
	family: Schema.String,
	used: Schema.Literals([0, 1]),
})
export function makeOAuthDatabase() {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		let findClient = SqlSchema.findOneOption({
			Request: Schema.String,
			Result: Schema.Struct({
				id: Schema.String,
				name: Schema.String,
				redirects: Schema.fromJsonString(Schema.Array(Schema.String)),
			}),
			execute: id => sql`SELECT * FROM oauth_clients WHERE id=${id}`,
		})
		let findRequest = SqlSchema.findOneOption({
			Request: Schema.Struct({ id: Schema.String, now: Schema.Natural }),
			Result: Schema.Struct({ ...requestSchema.fields, name: Schema.String }),
			execute: ({ id, now }) =>
				sql`SELECT oauth_requests.*,oauth_clients.name FROM oauth_requests JOIN oauth_clients ON oauth_requests.client=oauth_clients.id WHERE oauth_requests.id=${id} AND expires>${now}`,
		})
		let findCode = SqlSchema.findOneOption({
			Request: Schema.Struct({ code: Schema.String, now: Schema.Natural }),
			Result: codeSchema,
			execute: ({ code, now }) =>
				sql`SELECT * FROM oauth_codes WHERE code=${code} AND expires>${now}`,
		})
		let findRefresh = SqlSchema.findOneOption({
			Request: Schema.Struct({
				id: Schema.String,
				client: Schema.String,
				resource: Schema.String,
				now: Schema.Natural,
			}),
			Result: refreshSchema,
			execute: ({ id, client, resource, now }) =>
				sql`SELECT * FROM oauth_refresh WHERE id=${id} AND client=${client} AND resource=${resource} AND expires>${now}`,
		})
		let findFamily = SqlSchema.findOneOption({
			Request: Schema.String,
			Result: Schema.Struct({ family: Schema.String }),
			execute: id =>
				sql`SELECT family FROM oauth_refresh WHERE id=${id} OR access=${id}`,
		})
		return {
			transaction: sql.withTransaction,
			putClient,
			client,
			putRequest,
			request,
			claimRequest,
			putCode,
			code,
			claimCode,
			putRefresh,
			refresh,
			claimRefresh,
			family,
			revokeFamily,
			cleanup,
		}
		function cleanup() {
			return Effect.gen(function* () {
				let now = yield* Clock.currentTimeMillis
				yield* sql`DELETE FROM oauth_requests WHERE expires<=${now}`
				yield* sql`DELETE FROM oauth_codes WHERE expires<=${now}`
				yield* sql`DELETE FROM oauth_refresh WHERE expires<=${now}`
				let expired = sql`SELECT id FROM connection_expiry WHERE expires<=${now} AND NOT EXISTS (SELECT 1 FROM oauth_refresh WHERE access=connection_expiry.id AND used=0 AND expires>${now})`
				yield* sql`DELETE FROM connections WHERE token IN (${expired})`
				yield* sql`DELETE FROM connection_owners WHERE id IN (${expired})`
				yield* sql`DELETE FROM connection_expiry WHERE id IN (${expired})`
			}).pipe(sql.withTransaction)
		}
		function putClient(id: string, name: string, redirects: string[]) {
			return sql`INSERT OR REPLACE INTO oauth_clients VALUES (${id},${name},${JSON.stringify(redirects)})`.pipe(
				Effect.asVoid,
			)
		}
		function client(id: string) {
			return decodeStored(findClient(id)).pipe(
				Effect.map(Option.getOrUndefined),
			)
		}
		function putRequest(record: typeof requestSchema.Type) {
			return Schema.encodeEffect(requestSchema)(record).pipe(
				Effect.flatMap(
					record => sql`INSERT INTO oauth_requests ${sql.insert(record)}`,
				),
				Effect.asVoid,
			)
		}
		function request(id: string, now: number) {
			return decodeStored(findRequest({ id, now })).pipe(
				Effect.map(Option.getOrUndefined),
			)
		}
		function claimRequest(id: string, now: number) {
			return Effect.gen(function* () {
				let pending = yield* request(id, now)
				if (!pending) return undefined
				let claimed =
					yield* sql`DELETE FROM oauth_requests WHERE id=${id} AND expires>${now} RETURNING id`
				return claimed.length === 1 ? pending : undefined
			}).pipe(sql.withTransaction)
		}
		function putCode(record: typeof codeSchema.Type) {
			return Schema.encodeEffect(codeSchema)(record).pipe(
				Effect.flatMap(
					record => sql`INSERT INTO oauth_codes ${sql.insert(record)}`,
				),
				Effect.asVoid,
			)
		}
		function code(code: string, now: number) {
			return decodeStored(findCode({ code, now })).pipe(
				Effect.map(Option.getOrUndefined),
			)
		}
		function claimCode(code: string) {
			return changes(sql`DELETE FROM oauth_codes WHERE code=${code}`.raw)
		}
		function putRefresh(record: typeof refreshSchema.Type) {
			return Schema.encodeEffect(refreshSchema)(record).pipe(
				Effect.flatMap(
					record => sql`INSERT INTO oauth_refresh ${sql.insert(record)}`,
				),
				Effect.asVoid,
			)
		}
		function refresh(
			id: string,
			client: string,
			resource: string,
			now: number,
		) {
			return decodeStored(findRefresh({ id, client, resource, now })).pipe(
				Effect.map(Option.getOrUndefined),
			)
		}
		function claimRefresh(id: string) {
			return changes(
				sql`UPDATE oauth_refresh SET used=1 WHERE id=${id} AND used=0`.raw,
			)
		}
		function family(id: string) {
			return decodeStored(findFamily(id)).pipe(
				Effect.map(row => (Option.isSome(row) ? row.value.family : undefined)),
			)
		}
		function revokeFamily(family: string) {
			return Effect.gen(function* () {
				yield* sql`DELETE FROM connection_expiry WHERE id IN (SELECT access FROM oauth_refresh WHERE family=${family})`
				yield* sql`DELETE FROM connections WHERE token IN (SELECT access FROM oauth_refresh WHERE family=${family})`
				yield* sql`DELETE FROM connection_owners WHERE id IN (SELECT access FROM oauth_refresh WHERE family=${family})`
				yield* sql`DELETE FROM oauth_refresh WHERE family=${family}`
			}).pipe(sql.withTransaction)
		}
	})
}
function changes<E>(result: Effect.Effect<unknown, E>) {
	return decodeStored(
		result.pipe(
			Effect.flatMap(
				Schema.decodeUnknownEffect(Schema.Struct({ changes: Schema.Natural })),
			),
			Effect.map(row => row.changes),
		),
	)
}
