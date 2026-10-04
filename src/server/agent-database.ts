import type { OAuthDatabase } from "./oauth-database"
import { decodeStored } from "./failures"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlSchema from "effect/sql/SqlSchema"
import { ApplicationError } from "../platform/errors"
import { PacketSchema, type Packet } from "../shared/model"

export type AgentDatabase = Effect.Success<ReturnType<typeof makeAgentDatabase>>

export function makeAgentDatabase(oauth: OAuthDatabase) {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		let ownerSchema = Schema.Struct({
			id: Schema.String,
			room: Schema.String,
			capability: Schema.String,
			name: Schema.String,
			created: Schema.Natural,
		})
		let findOwner = SqlSchema.findOneOption({
			Request: Schema.String,
			Result: ownerSchema,
			execute: id => sql`SELECT * FROM connection_owners WHERE id=${id}`,
		})
		let findList = SqlSchema.findAll({
			Request: Schema.Struct({
				room: Schema.String,
				capability: Schema.String,
				now: Schema.Natural,
			}),
			Result: Schema.Struct({
				id: Schema.String,
				name: Schema.String,
				created: Schema.Natural,
			}),
			execute: ({ room, capability, now }) =>
				sql`SELECT connection_owners.id,name,created FROM connection_owners JOIN connections ON connections.token=connection_owners.id WHERE room=${room} AND capability=${capability} AND (NOT EXISTS (SELECT 1 FROM connection_expiry WHERE id=connection_owners.id AND expires<=${now}) OR EXISTS (SELECT 1 FROM oauth_refresh WHERE access=connection_owners.id AND used=0 AND expires>${now})) ORDER BY created DESC`,
		})
		let findConnection = SqlSchema.findOneOption({
			Request: Schema.String,
			Result: Schema.Struct({ packet: Schema.fromJsonString(PacketSchema) }),
			execute: id => sql`SELECT packet FROM connections WHERE token=${id}`,
		})
		let findExpiry = SqlSchema.findOneOption({
			Request: Schema.String,
			Result: Schema.Struct({
				expires: Schema.Natural,
				resource: Schema.String,
			}),
			execute: id =>
				sql`SELECT expires,resource FROM connection_expiry WHERE id=${id}`,
		})
		return {
			create,
			list,
			disconnect,
			revoke,
			expire,
			owner,
			connection,
			expiry,
			preserveCreated,
		}
		function list(key: { room: string; capability: string }) {
			return Clock.currentTimeMillis.pipe(
				Effect.flatMap(now => decodeStored(findList({ ...key, now }))),
			)
		}
		function create(
			id: string,
			packet: Packet,
			room: string,
			capability: string,
			name: string,
			created: number,
		) {
			return Effect.gen(function* () {
				yield* Schema.encodeEffect(ownerSchema)({
					id,
					room,
					capability,
					name,
					created,
				})
				let encoded = yield* Schema.encodeEffect(
					Schema.fromJsonString(PacketSchema),
				)(packet)
				yield* sql`INSERT INTO connections VALUES (${id},${encoded})`
				yield* sql`INSERT INTO connection_owners VALUES (${id},${room},${capability},${name},${created})`
			}).pipe(sql.withTransaction)
		}
		function owner(id: string) {
			return decodeStored(findOwner(id)).pipe(Effect.map(Option.getOrUndefined))
		}
		function connection(id: string) {
			return decodeStored(findConnection(id)).pipe(
				Effect.map(row => (Option.isSome(row) ? row.value.packet : undefined)),
			)
		}
		function expiry(id: string) {
			return decodeStored(findExpiry(id)).pipe(
				Effect.map(Option.getOrUndefined),
			)
		}
		function disconnect(room: string, capability: string, id: string) {
			return Effect.gen(function* () {
				let record = yield* owner(id)
				if (!record || record.room !== room || record.capability !== capability)
					return yield* new ApplicationError({
						operation: "mcp",
						cause: new Error("Connection unavailable"),
					})
				let family = yield* oauth.family(id)
				if (family) yield* oauth.revokeFamily(family)
				else yield* revoke(id)
			}).pipe(sql.withTransaction)
		}
		function revoke(id: string) {
			return Effect.gen(function* () {
				yield* sql`DELETE FROM connection_expiry WHERE id=${id}`
				yield* sql`DELETE FROM connections WHERE token=${id}`
				yield* sql`DELETE FROM connection_owners WHERE id=${id}`
			}).pipe(sql.withTransaction)
		}
		function expire(id: string, expires: number, resource: string) {
			return Schema.encodeEffect(Schema.Natural)(expires).pipe(
				Effect.flatMap(
					expires =>
						sql`INSERT OR REPLACE INTO connection_expiry VALUES (${id},${expires},${resource})`,
				),
				Effect.asVoid,
			)
		}
		function preserveCreated(id: string, created: number) {
			return Schema.encodeEffect(Schema.Natural)(created).pipe(
				Effect.flatMap(
					created =>
						sql`UPDATE connection_owners SET created=${created} WHERE id=${id}`,
				),
				Effect.asVoid,
			)
		}
	})
}
