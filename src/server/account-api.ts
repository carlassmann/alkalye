import { emailApiHandlers } from "./email-api"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
	accountAuthentication,
	authenticationAvailable,
} from "./account-authentication"
import { RequestOrigin, requestOrigin } from "./request-origin"
import * as Redacted from "effect/Redacted"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpMiddleware from "effect/http/HttpMiddleware"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpEffect from "effect/http/HttpEffect"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { cookieSecurity, secureCookieSecurity } from "../shared/account-api"
import * as Headers from "effect/http/Headers"
import { accountHeader } from "../shared/authentication"
import { DocumentObservability } from "../shared/document-observability"
import { RequestAccount } from "../shared/authentication"
import { DocumentApi } from "../shared/document-api"
import { documentApiHandlers } from "./document-api"
import { WorkspaceStore } from "./document-store"
import { Sessions } from "./sessions"
import { AgentCredentials } from "./agent-credentials"
import { AgentConnectionRejected } from "../shared/agent-access"
import { StoreUnavailable } from "../shared/document-api"
import { ApplicationError } from "../platform/errors"
import { AuthenticationRequired } from "../shared/authentication"
import { AgentStore } from "./agent-store"
import { RelaySettings } from "./settings"
import { Cipher } from "../platform/cipher"
import { OAuth } from "./oauth"
import { ClientMetadata } from "./client-metadata"

export class AccountApplication extends Context.Service<
	AccountApplication,
	Effect.Success<ReturnType<typeof makeAccountApplication>>
>()("AccountApplication") {
	static layer = Layer.effect(
		AccountApplication,
		makeAccountApplication(),
	).pipe(Layer.provideMerge(HttpServer.layerServices))
}
function makeAccountApplication() {
	return Effect.gen(function* () {
		let sessions = yield* Sessions
		let documents = yield* WorkspaceStore
		let credentials = yield* AgentCredentials
		let database = yield* AgentStore
		let cipher = yield* Cipher
		let settings = yield* RelaySettings
		let oauth = new OAuth(
			database.oauth,
			credentials,
			cipher,
			yield* ClientMetadata,
			settings.publicOrigin,
		)

		let login = HttpApiBuilder.group(DocumentApi, "authentication", handlers =>
			handlers
				.handle("challenge", ({ payload }) =>
					Effect.gen(function* () {
						let origin = yield* requestOrigin(payload.purpose === "cookie")
						return yield* authenticationAvailable(
							sessions.challenge(payload.publicKey, origin, payload.purpose),
						)
					}),
				)
				.handle("browserLogin", ({ payload }) =>
					Effect.gen(function* () {
						let origin = yield* requestOrigin(true)
						let cookie = yield* HttpApiBuilder.securityDecode(
							origin.startsWith("https:")
								? secureCookieSecurity
								: cookieSecurity,
						)
						let session = yield* authenticationAvailable(
							sessions.login(payload, origin, "cookie", {
								currentCookie: cookie,
								replace: payload.replace,
							}),
						)
						yield* HttpApiBuilder.securitySetCookie(
							origin.startsWith("https:")
								? secureCookieSecurity
								: cookieSecurity,
							session.token,
							{
								path: "/",
								httpOnly: true,
								secure: origin.startsWith("https:"),
								sameSite: "strict",
								expires: new Date(session.expires),
							},
						)
						return { subject: session.subject, expires: session.expires }
					}),
				)
				.handle("bearerLogin", ({ payload }) =>
					Effect.gen(function* () {
						let origin = yield* requestOrigin(false)
						let session = yield* authenticationAvailable(
							sessions.login(payload, origin, "bearer"),
						)
						return { ...session, token: Redacted.value(session.token) }
					}),
				),
		)
		let account = HttpApiBuilder.group(DocumentApi, "account", handlers =>
			handlers
				.handle("session", () =>
					Effect.gen(function* () {
						let account = yield* RequestAccount
						return { subject: account.subject, expires: account.expires }
					}),
				)
				.handle("logout", () =>
					Effect.gen(function* () {
						let account = yield* RequestAccount
						let origin = yield* requestOrigin(false)
						yield* authenticationAvailable(sessions.revoke(account.session))
						yield* HttpApiBuilder.securitySetCookie(
							origin.startsWith("https:")
								? secureCookieSecurity
								: cookieSecurity,
							"",
							{
								path: "/",
								maxAge: 0,
								sameSite: "strict",
								secure: origin.startsWith("https:"),
							},
						)
					}),
				),
		)
		let agents = HttpApiBuilder.group(DocumentApi, "agents", handlers =>
			handlers
				.handle("describeConsent", ({ query }) =>
					Effect.gen(function* () {
						yield* browserConsent()
						return yield* agentAvailable(oauth.describeConsent(query.request))
					}),
				)
				.handle("consent", ({ payload }) =>
					Effect.gen(function* () {
						yield* browserConsent()
						let account = yield* RequestAccount
						return yield* agentAvailable(
							oauth.approveAccount(
								payload.request,
								{
									kind: "account",
									subject: account.subject,
									workspaces: payload.workspaces,
									ceiling: payload.ceiling,
								},
								payload.approve,
							),
						)
					}),
				)
				.handle("list", () =>
					Effect.gen(function* () {
						let account = yield* RequestAccount
						return yield* agentAvailable(
							credentials.listAccount(account.subject),
						)
					}),
				)
				.handle("create", ({ payload }) =>
					Effect.gen(function* () {
						let account = yield* RequestAccount
						return {
							token: yield* agentAvailable(
								credentials.createAccount(
									{
										kind: "account",
										subject: account.subject,
										workspaces: payload.workspaces,
										ceiling: payload.ceiling,
									},
									payload.name,
								),
							),
						}
					}),
				)
				.handle("revoke", ({ params }) =>
					Effect.gen(function* () {
						let account = yield* RequestAccount
						yield* agentAvailable(
							credentials.disconnectAccount(account.subject, params.id),
						)
					}),
				),
		)
		let routes = HttpApiBuilder.layer(DocumentApi).pipe(
			Layer.provide(
				Layer.mergeAll(
					login,
					emailApiHandlers,
					account,
					agents,
					documentApiHandlers.pipe(
						Layer.provide(Layer.succeed(WorkspaceStore, documents)),
					),
				),
			),
			Layer.provide(
				accountAuthentication.pipe(
					Layer.provide(Layer.succeed(Sessions, sessions)),
				),
			),
		)
		let context = yield* Effect.context<
			| RequestOrigin
			| DocumentObservability
			| Layer.Success<typeof HttpServer.layerServices>
		>()
		context = Context.add(context, Headers.CurrentRedactedNames, [
			"authorization",
			"cookie",
			"set-cookie",
			"x-api-key",
			accountHeader,
		])
		let app = yield* HttpRouter.toHttpEffect(
			routes.pipe(Layer.provide(Layer.succeedContext(context))),
		).pipe(
			Effect.provideService(HttpRouter.RouterConfig, { maxParamLength: 200 }),
		)
		let compressed = Effect.gen(function* () {
			let request = yield* HttpServerRequest.HttpServerRequest
			return yield* request.method === "GET" &&
			new URL(request.originalUrl).pathname.endsWith("/snapshot")
				? HttpMiddleware.compression({ algorithms: ["gzip"] })(app)
				: app
		})
		let handler = HttpEffect.toWebHandlerWith<
			| RequestOrigin
			| DocumentObservability
			| Layer.Success<typeof HttpServer.layerServices>,
			Effect.Services<typeof compressed>
		>(context)(
			Effect.gen(function* () {
				let request = yield* HttpServerRequest.HttpServerRequest
				let response = HttpServerResponse.setHeaders(yield* compressed, {
					"cache-control": "no-store",
					"x-content-type-options": "nosniff",
				})
				return new URL(request.originalUrl).pathname.includes("/blobs/")
					? HttpServerResponse.setHeaders(response, {
							"content-disposition": "attachment",
							"content-security-policy": "sandbox",
						})
					: response
			}),
		)
		return { handle: handler }
	})
}
function agentAvailable<A, E>(work: Effect.Effect<A, E>) {
	return work.pipe(
		Effect.mapError(error =>
			error instanceof ApplicationError
				? new AgentConnectionRejected({ message: error.message })
				: new StoreUnavailable({
						message: "Agent connections are temporarily unavailable",
					}),
		),
	)
}
function browserConsent() {
	return Effect.gen(function* () {
		let request = yield* HttpServerRequest.HttpServerRequest
		if (request.headers.authorization !== undefined)
			return yield* new AuthenticationRequired({
				message: "Approve agent access in your browser",
			})
		yield* requestOrigin(true)
	})
}
