import * as HttpClient from "effect/http/HttpClient"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FiberSet from "effect/FiberSet"
import * as Layer from "effect/Layer"
import { Cipher } from "../platform/cipher"
import { promise } from "../platform/effects"
import { isInfrastructureFailure } from "./failures"
import { startOAuthMaintenance } from "./oauth-maintenance"
import { AgentStore } from "./agent-store"
import { makeMcpHandler } from "./mcp-server"
import { makeDocuments } from "./agent-documents"
import { makeDocumentLive } from "./document-live"
import type {
	LiveConnection,
	LiveSocket,
	LiveUpgradeServer,
	LivePollServer,
} from "./document-live"
import { AccountApplication } from "./account-api"
import { AgentCredentials } from "./agent-credentials"
import { OAuth } from "./oauth"
import { RelaySettings } from "./settings"
import { StaticAssets } from "./static-assets"

export interface Connection {
	live: LiveConnection
}
export class Application extends Context.Service<
	Application,
	Effect.Success<ReturnType<typeof makeApplication>>
>()("Application") {
	static layer = Layer.effect(Application, makeApplication())
}
function makeApplication() {
	return Effect.gen(function* () {
		let accounts = yield* AccountApplication
		let live = yield* makeDocumentLive()
		let database = yield* AgentStore
		let cipher = yield* Cipher
		let settings = yield* RelaySettings
		let runMessage = yield* FiberSet.makeRuntime<HttpClient.HttpClient>()
		let mcp = yield* AgentCredentials
		let documents = yield* makeDocuments()
		let handleMcp = yield* makeMcpHandler(mcp, documents, settings.publicOrigin)
		let oauth = new OAuth(database.oauth, mcp, cipher, settings.publicOrigin)
		yield* startOAuthMaintenance(database.oauth.cleanup())
		let assets = yield* StaticAssets
		function handleRequest(
			request: Request,
			server: LiveUpgradeServer & LivePollServer,
		) {
			return Effect.gen(function* () {
				let url = new URL(request.url)
				let origin = request.headers.get("Origin")
				if (origin && origin !== (settings.publicOrigin || url.origin))
					return Response.json({ error: "Invalid origin" }, { status: 403 })
				if (
					url.pathname === "/api/live" ||
					url.pathname.startsWith("/api/live/")
				) {
					if (origin !== (settings.publicOrigin || url.origin))
						return new Response("Invalid origin", { status: 403 })
					return yield* (
						url.pathname === "/api/live" ? live.upgrade : live.poll
					)(request, server, settings.publicOrigin || url.origin)
				}
				if (
					url.pathname.startsWith("/api/accounts/") ||
					url.pathname === "/api/library" ||
					url.pathname.startsWith("/api/documents") ||
					url.pathname.startsWith("/api/workspaces") ||
					url.pathname.startsWith("/api/invitations")
				)
					return yield* promise("accounts.request", signal =>
						accounts.handle(new Request(request, { signal })),
					)
				if (
					url.pathname === "/sync" ||
					url.pathname.startsWith("/api/rooms/") ||
					url.pathname === "/api/oauth/consent"
				)
					return Response.json(
						{
							error:
								"The room protocol has been retired; use the account/document API",
						},
						{ status: 410 },
					)
				let oauthResponse = yield* oauth.handle(request)
				if (oauthResponse) return oauthResponse
				if (url.pathname === "/mcp") return yield* handleMcp(request)
				if (url.pathname === "/api/health")
					return Response.json({
						ok: true,
						runtimeDependencies: 1,
						effect: "4.0.0",
						architecture: "documents",
					})
				return yield* assets.serve(request)
			}).pipe(
				Effect.catchCause(cause =>
					Cause.hasInterrupts(cause)
						? Effect.failCause(cause)
						: Effect.succeed(
								Response.json(
									{ error: errorMessage(cause) },
									{ status: isInfrastructureFailure(cause) ? 500 : 400 },
								),
							),
				),
			)
		}
		return {
			database,
			cipher,
			mcp,
			documents,
			liveSessions: live.polling,
			handleRequest,
			websocket: {
				maxPayloadLength: 8192,
				backpressureLimit: 16000000,
				closeOnBackpressureLimit: true,
				open(socket: LiveSocket) {
					live.open(socket)
				},
				message(socket: LiveSocket, data: string | Uint8Array) {
					runMessage(live.message(socket, data))
				},
				close(socket: LiveSocket) {
					runMessage(live.close(socket))
				},
			},
		}
	})
}
function errorMessage(cause: Cause.Cause<unknown>) {
	if (isInfrastructureFailure(cause)) return "Server storage is unavailable"
	let error = Cause.squash(cause)
	return error instanceof Error ? error.message : "Request failed"
}
