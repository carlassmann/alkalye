import type * as Context from "effect/Context"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import { ApplicationError } from "../platform/errors"
import type { Cipher } from "../platform/cipher"
import type { OAuthDatabase } from "./oauth-database"
import type { AgentCredentials } from "./agent-credentials"
export class OAuthGrants {
	constructor(
		private database: OAuthDatabase,
		private mcp: Context.Service.Shape<typeof AgentCredentials>,
		private cipher: Context.Service.Shape<typeof Cipher>,
	) {}

	issue(
		token: string,
		client: string,
		resource: string,
		scope: string,
		family?: string,
	) {
		let self = this
		return Effect.gen(function* () {
			let now = yield* Clock.currentTimeMillis
			let familyId = family ?? (yield* self.cipher.secret())
			yield* self.mcp.expire(token, now + 3600000, resource)
			let refresh: string | undefined
			if (scope.split(" ").includes("offline_access")) {
				refresh = yield* self.cipher.secret()
				let id = yield* self.cipher.hash(refresh)
				yield* self.database.putRefresh({
					id: id,
					client: client,
					resource: resource,
					token: yield* self.mcp.protectToken(id, token),
					access: yield* self.cipher.hash(token),
					scope: scope,
					expires: now + 30 * 86400000,
					family: familyId,
					used: 0,
				})
			}
			return {
				access_token: token,
				token_type: "Bearer",
				expires_in: 3600,
				scope,
				...(refresh ? { refresh_token: refresh } : {}),
			}
		})
	}
	rotate(refresh: string, client: string, resource: string) {
		let self = this
		return Effect.gen(function* () {
			let now = yield* Clock.currentTimeMillis
			let id = yield* self.cipher.hash(refresh)
			let issued = yield* Effect.gen(function* () {
				let record = yield* self.database.refresh(id, client, resource, now)
				if (!record)
					return yield* new ApplicationError({
						operation: "oauth-grants",
						cause: new Error("Invalid refresh token"),
					})
				let claimed = yield* self.database.claimRefresh(id)
				if (claimed !== 1) {
					yield* self.database.revokeFamily(record.family)
					return undefined
				}
				let token = yield* self.mcp.revealToken(record.token)
				let renewed = yield* self.mcp.renew(token)
				return yield* self.issue(
					renewed,
					client,
					resource,
					record.scope,
					record.family,
				)
			}).pipe(self.database.transaction)
			if (!issued)
				return yield* new ApplicationError({
					operation: "oauth-grants",
					cause: new Error("Refresh token already used"),
				})
			return issued
		})
	}

	revoke(token: string) {
		let self = this
		return Effect.gen(function* () {
			let id = yield* self.cipher.hash(token),
				row = yield* self.database.family(id)
			if (row) yield* self.revokeFamily(row)
			else yield* self.mcp.revoke(token)
		}).pipe(self.database.transaction)
	}
	private revokeFamily(family: string) {
		return this.database.revokeFamily(family)
	}
}
