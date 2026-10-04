import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ApplicationError } from "../platform/errors"
import { Cipher } from "../platform/cipher"
import { PacketSchema } from "../shared/model"
import {
	AgentAccessSchema,
	AgentScopeSchema,
	agentWorkspace,
} from "../shared/agent-access"
import type { AgentAccess } from "../shared/agent-access"
import { Identity } from "../shared/workspace"
import { WorkspaceStore } from "./document-store"
import { decodeStored, isInfrastructureFailure } from "./failures"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import { AgentStore } from "./agent-store"
import { RelaySecrets } from "./settings"
export class AgentCredentials extends Context.Service<
	AgentCredentials,
	Effect.Success<ReturnType<typeof makeCredentials>>
>()("AgentCredentials") {
	static layer = Layer.effect(AgentCredentials, makeCredentials())
}
function makeCredentials() {
	return Effect.gen(function* () {
		let database = yield* AgentStore
		let documents = yield* WorkspaceStore
		let { hash, open, seal, secret } = yield* Cipher
		let secrets = yield* RelaySecrets
		let master = secrets.masterKey
		return {
			createAccount,
			listAccount: (subject: string) =>
				accountKey(subject).pipe(
					Effect.flatMap(capability =>
						database.agents.list({ room: "account:" + subject, capability }),
					),
				),
			disconnectAccount: (subject: string, id: string) =>
				accountKey(subject).pipe(
					Effect.flatMap(capability =>
						database.agents.disconnect("account:" + subject, capability, id),
					),
				),
			grant,
			protectToken,
			revealToken,
			revoke,
			expire,
			renew,
			authorize,
		}
		function accountKey(subject: string) {
			return hash(master + ":account:" + subject)
		}
		function createAccount(access: AgentAccess, name = "Agent") {
			return Effect.gen(function* () {
				let validated =
					yield* Schema.decodeUnknownEffect(AgentAccessSchema)(access)
				let library = yield* documents.library().pipe(
					Effect.provideService(Identity, {
						subject: validated.subject,
						actors: [],
					}),
				)
				let available = new Set([
					"personal-" + validated.subject,
					...library.workspaces.map(workspace => workspace.workspace),
					...library.documents.map(document => document.workspace),
				])
				if (
					validated.workspaces !== "all" &&
					validated.workspaces.some(workspace => !available.has(workspace))
				)
					return yield* new ApplicationError({
						operation: "mcp",
						cause: new Error("Cannot grant access to this workspace"),
					})
				let token = yield* secret()
				let id = yield* hash(token)
				let packet = yield* seal(master, id, validated, "mcp")
				yield* database.agents.create(
					id,
					packet,
					"account:" + validated.subject,
					yield* accountKey(validated.subject),
					name,
					yield* Clock.currentTimeMillis,
				)
				return token
			})
		}

		function protectToken(id: string, token: string) {
			return Effect.gen(function* () {
				return JSON.stringify(yield* seal(master, id, token, "oauth"))
			})
		}
		function revealToken(value: string) {
			return Effect.gen(function* () {
				let packet = yield* decodeStored(
					Schema.decodeUnknownEffect(Schema.fromJsonString(PacketSchema))(
						value,
					),
				)
				let token = yield* decodeStored(open(master, packet, "oauth"))
				return yield* decodeStored(
					Schema.decodeUnknownEffect(Schema.String)(token),
				)
			})
		}
		function revoke(token: string) {
			return hash(token).pipe(Effect.flatMap(id => database.agents.revoke(id)))
		}

		function expire(token: string, expires: number, resource: string) {
			return Effect.gen(function* () {
				yield* database.agents.expire(yield* hash(token), expires, resource)
			})
		}
		function renew(token: string) {
			return Effect.gen(function* () {
				let access = yield* grant(token, true)

				let library = yield* documents.library().pipe(
					Effect.provideService(Identity, {
						subject: access.subject,
						actors: [],
					}),
				)
				let available = new Set([
					"personal-" + access.subject,
					...library.workspaces.map(workspace => workspace.workspace),
					...library.documents.map(document => document.workspace),
				])
				let retained =
					access.workspaces === "all"
						? "all"
						: access.workspaces.filter(workspace => available.has(workspace))
				if (retained !== "all" && !retained.length)
					return yield* new ApplicationError({
						operation: "mcp",
						cause: new Error("Workspace access revoked"),
					})
				let workspaces =
					yield* Schema.decodeUnknownEffect(AgentScopeSchema)(retained)
				let owner = yield* database.agents.owner(yield* hash(token))
				let renewed = yield* createAccount(
					{ ...access, workspaces },
					owner?.name ?? "Agent",
				)
				if (owner)
					yield* database.agents.preserveCreated(
						yield* hash(renewed),
						owner.created,
					)
				yield* revoke(token)
				return renewed
			})
		}
		function grant(token: string, allowExpired = false) {
			return Effect.gen(function* () {
				let now = yield* Clock.currentTimeMillis
				let id = yield* hash(token),
					row = yield* database.agents.connection(id)
				if (!row)
					return yield* Effect.fail(
						new ApplicationError({
							operation: "mcp",
							cause: new Error("Invalid or revoked agent connection"),
						}),
					)
				let expiry = yield* database.agents.expiry(id)
				if (!allowExpired && expiry && expiry.expires <= now)
					return yield* Effect.fail(
						new ApplicationError({
							operation: "mcp",
							cause: new Error("Agent access expired"),
						}),
					)
				let value = yield* decodeStored(open(master, row, "mcp"))
				let account = Schema.decodeUnknownResult(AgentAccessSchema)(value)
				if (account._tag === "Success") return account.success
				return yield* new ApplicationError({
					operation: "mcp",
					cause: new Error("Reconnect using account permissions"),
				})
			})
		}
		function authorize(token: string, resource: string) {
			return Effect.gen(function* () {
				return yield* Effect.gen(function* () {
					let access = yield* grant(token)
					let available = yield* documents.library().pipe(
						Effect.provideService(Identity, {
							subject: access.subject,
							actors: [],
						}),
						Effect.map(
							library =>
								access.workspaces === "all" ||
								library.documents.some(document =>
									agentWorkspace(access, document.workspace),
								) ||
								library.workspaces.some(workspace =>
									agentWorkspace(access, workspace.workspace),
								),
						),
					)
					if (!available)
						return yield* new ApplicationError({
							operation: "mcp",
							cause: new Error("Workspace access revoked"),
						})
					let bound = yield* database.agents.expiry(yield* hash(token))
					if (bound && bound.resource !== resource)
						return yield* Effect.fail(
							new ApplicationError({
								operation: "mcp",
								cause: new Error("Wrong token resource"),
							}),
						)
				}).pipe(
					Effect.as(true),
					Effect.catchCause(cause =>
						isInfrastructureFailure(cause) || Cause.hasInterrupts(cause)
							? Effect.failCause(cause)
							: Effect.succeed(false),
					),
				)
			})
		}
	})
}
