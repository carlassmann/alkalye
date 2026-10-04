import type * as Context from "effect/Context"
import * as Input from "./input"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import { attempt, promise } from "../platform/effects"
import { ApplicationError } from "../platform/errors"
import type { Cipher } from "../platform/cipher"
import { isInfrastructureFailure } from "./failures"
import { clientMetadata, redirectUris } from "./client-metadata"
import type { OAuthDatabase } from "./oauth-database"
import type { AgentCredentials } from "./agent-credentials"
import { OAuthGrants } from "./oauth-grants"
import type { AgentAccess } from "../shared/agent-access"
export class OAuth {
	private grants: OAuthGrants
	constructor(
		private database: OAuthDatabase,
		private mcp: Context.Service.Shape<typeof AgentCredentials>,
		private cipher: Context.Service.Shape<typeof Cipher>,
		private publicOrigin?: string,
	) {
		this.grants = new OAuthGrants(database, mcp, cipher)
	}

	revoke(token: string) {
		return this.grants.revoke(token)
	}
	describeConsent(id: string) {
		let self = this
		return Effect.gen(function* () {
			let pending = yield* self.database.request(
				id,
				yield* Clock.currentTimeMillis,
			)
			if (!pending) return yield* consentExpired()
			return { name: pending.name, redirect: pending.redirect }
		})
	}
	approveAccount(id: string, access: AgentAccess, approve: boolean) {
		let self = this
		return Effect.gen(function* () {
			let now = yield* Clock.currentTimeMillis
			let pending = yield* self.database.claimRequest(id, now)
			if (!pending) return yield* consentExpired()
			let redirect = new URL(pending.redirect)
			if (approve) {
				let token = yield* self.mcp.createAccount(access, pending.name)
				let code = yield* self.cipher.secret()
				let protectedId = yield* self.cipher.hash(code)
				yield* self.mcp.expire(token, now + 60000, pending.resource)
				yield* self.database.putCode({
					code: protectedId,
					client: pending.client,
					redirect: pending.redirect,
					challenge: pending.challenge,
					token: yield* self.mcp.protectToken(protectedId, token),
					expires: now + 60000,
					resource: pending.resource,
					scope: pending.scope,
				})
				redirect.searchParams.set("code", code)
			} else redirect.searchParams.set("error", "access_denied")
			redirect.searchParams.set("state", pending.state)
			return { redirect: redirect.toString() }
		}).pipe(self.database.transaction)
	}

	handle(request: Request) {
		let self = this
		return Effect.gen(function* () {
			let now = yield* Clock.currentTimeMillis
			let url = new URL(request.url),
				base = self.publicOrigin || url.origin
			if (url.pathname === "/.well-known/oauth-authorization-server")
				return Response.json({
					issuer: base,
					authorization_endpoint: `${base}/oauth/authorize`,
					token_endpoint: `${base}/oauth/token`,
					registration_endpoint: `${base}/oauth/register`,
					revocation_endpoint: `${base}/oauth/revoke`,
					response_types_supported: ["code"],
					grant_types_supported: ["authorization_code", "refresh_token"],
					client_id_metadata_document_supported: true,
					code_challenge_methods_supported: ["S256"],
					token_endpoint_auth_methods_supported: ["none"],
					scopes_supported: ["documents", "offline_access"],
				})
			if (
				url.pathname === "/.well-known/oauth-protected-resource" ||
				url.pathname === "/.well-known/oauth-protected-resource/mcp"
			)
				return Response.json({
					resource: `${base}/mcp`,
					authorization_servers: [base],
					scopes_supported: ["documents"],
					bearer_methods_supported: ["header"],
				})
			if (url.pathname === "/oauth/register" && request.method === "POST") {
				let body = yield* Input.object(
						yield* promise("OAuth.handle", () => request.json()),
					),
					redirects = yield* attempt("OAuth.redirects", () =>
						redirectUris(body.redirect_uris),
					)
				let id = yield* self.cipher.secret(),
					name =
						typeof body.client_name === "string" ? body.client_name : "Agent"
				yield* self.database.putClient(id, name, redirects)
				return Response.json(
					{
						client_id: id,
						client_name: name,
						redirect_uris: redirects,
						token_endpoint_auth_method: "none",
						grant_types: ["authorization_code", "refresh_token"],
						response_types: ["code"],
					},
					{ status: 201 },
				)
			}
			if (url.pathname === "/oauth/authorize") {
				let id = yield* Input.string(url.searchParams.get("client_id")),
					redirect = yield* Input.string(url.searchParams.get("redirect_uri")),
					challenge = yield* Input.string(
						url.searchParams.get("code_challenge"),
					),
					state = url.searchParams.get("state") ?? ""
				if (id.startsWith("https://")) {
					let metadata = yield* clientMetadata(id)
					yield* self.database.putClient(id, metadata.name, metadata.redirects)
				}
				let client = yield* self.database.client(id)
				if (!client || !client.redirects.includes(redirect))
					return yield* Effect.fail(
						new ApplicationError({
							operation: "oauth",
							cause: new Error("Unregistered redirect URI"),
						}),
					)
				if (
					url.searchParams.get("response_type") !== "code" ||
					url.searchParams.get("code_challenge_method") !== "S256" ||
					!/^[\w-]{43}$/.test(challenge)
				)
					return yield* Effect.fail(
						new ApplicationError({
							operation: "oauth",
							cause: new Error("Authorization code with S256 PKCE required"),
						}),
					)
				let resource = url.searchParams.get("resource"),
					scope = url.searchParams.get("scope") || "documents"
				if (resource !== `${base}/mcp`)
					return yield* Effect.fail(
						new ApplicationError({
							operation: "oauth",
							cause: new Error("Request this MCP resource explicitly"),
						}),
					)
				if (
					scope
						.split(" ")
						.some(value => value !== "documents" && value !== "offline_access")
				)
					return yield* Effect.fail(
						new ApplicationError({
							operation: "oauth",
							cause: new Error("Unsupported scope"),
						}),
					)
				let pending = yield* self.cipher.secret()
				yield* self.database.putRequest({
					id: pending,
					client: id,
					redirect: redirect,
					challenge: challenge,
					state: state,
					expires: now + 300000,
					resource: resource,
					scope: scope,
				})
				return Response.redirect(
					`${base}/app/settings?category=connections&oauth=${encodeURIComponent(pending)}`,
					302,
				)
			}
			if (url.pathname === "/oauth/token" && request.method === "POST") {
				let form = new URLSearchParams(
						yield* promise("OAuth.handle", () => request.text()),
					),
					code = form.get("code") ?? "",
					verifier = form.get("code_verifier") ?? ""
				if (form.get("grant_type") === "refresh_token")
					return yield* self.grants
						.rotate(
							form.get("refresh_token") ?? "",
							form.get("client_id") ?? "",
							form.get("resource") ?? "",
						)
						.pipe(
							Effect.map(value =>
								Response.json(value, {
									headers: { "Cache-Control": "no-store" },
								}),
							),
							Effect.catchCause(cause =>
								isInfrastructureFailure(cause) || Cause.hasInterrupts(cause)
									? Effect.failCause(cause)
									: Effect.succeed(
											Response.json(
												{ error: "invalid_grant" },
												{ status: 400 },
											),
										),
							),
						)
				if (
					form.get("grant_type") !== "authorization_code" ||
					!/^[\w.~+-]{43,128}$/.test(verifier)
				)
					return Response.json({ error: "invalid_grant" }, { status: 400 })
				let codeId = yield* self.cipher.hash(code)
				let challenge = yield* self.cipher.hash(verifier)
				return yield* Effect.gen(function* () {
					let now = yield* Clock.currentTimeMillis
					let record = yield* self.database.code(codeId, now)
					if (
						!record ||
						record.client !== form.get("client_id") ||
						record.redirect !== form.get("redirect_uri") ||
						record.resource !== form.get("resource") ||
						challenge !== record.challenge
					)
						return Response.json({ error: "invalid_grant" }, { status: 400 })
					let token = yield* self.mcp.revealToken(record.token)
					let usable = yield* self.mcp.grant(token).pipe(
						Effect.as(true),
						Effect.catchCause(cause =>
							isInfrastructureFailure(cause) || Cause.hasInterrupts(cause)
								? Effect.failCause(cause)
								: Effect.succeed(false),
						),
					)
					if (!usable)
						return Response.json({ error: "invalid_grant" }, { status: 400 })
					if ((yield* self.database.claimCode(codeId)) !== 1)
						return Response.json({ error: "invalid_grant" }, { status: 400 })
					return Response.json(
						yield* self.grants.issue(
							token,
							record.client,
							record.resource,
							record.scope,
						),
						{ headers: { "Cache-Control": "no-store" } },
					)
				}).pipe(self.database.transaction)
			}
			if (url.pathname === "/oauth/revoke" && request.method === "POST") {
				let form = new URLSearchParams(
					yield* promise("OAuth.handle", () => request.text()),
				)
				yield* self.grants.revoke(form.get("token") ?? "")
				return Response.json({})
			}
			return null
		})
	}
}
function consentExpired() {
	return Effect.fail(
		new ApplicationError({
			operation: "oauth",
			cause: new Error("Authorization expired; reconnect the agent"),
		}),
	)
}
