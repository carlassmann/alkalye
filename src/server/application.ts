import * as HttpClient from "effect/http/HttpClient"
import type { Server, ServerWebSocket } from "bun"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FiberSet from "effect/FiberSet"
import * as Layer from "effect/Layer"
import { resolve, sep } from "node:path"
import { Cipher } from "../platform/cipher"
import { promise } from "../platform/effects"
import { isInfrastructureFailure } from "./failures"
import { startOAuthMaintenance } from "./oauth-maintenance"
import { AgentStore } from "./agent-store"
import { makeMcpHandler } from "./mcp-server"
import { makeDocuments } from "./agent-documents"
import { makeDocumentLive } from "./document-live"
import type { LiveConnection } from "./document-live"
import { AccountApplication } from "./account-api"
import { AgentCredentials } from "./agent-credentials"
import { OAuth } from "./oauth"
import { RelaySettings } from "./settings"
import { serveAsset } from "./static-files"

let contentSecurityPolicy =
	"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; media-src 'self' blob: data: https:; font-src 'self' data: https:; connect-src 'self' ws: wss:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
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
		let dist = settings.assets
		function handleRequest(request: Request, server: Server<Connection>) {
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
				let path =
					url.pathname === "/"
						? resolve(dist, "index.html")
						: resolve(dist, `.${decodeURIComponent(url.pathname)}`)
				if (!path.startsWith(dist + sep))
					return new Response("Not found", { status: 404 })
				if (
					[
						"/en",
						"/de",
						"/privacy",
						"/terms",
						"/imprint",
						"/support",
						"/changelog",
					].includes(url.pathname)
				)
					path += ".html"
				let headers = {
					"Cache-Control": url.pathname.startsWith("/chunks/")
						? "public, max-age=31536000, immutable"
						: "no-cache",
					"X-Content-Type-Options": "nosniff",
					"Content-Security-Policy": contentSecurityPolicy,
				}
				let asset = yield* serveAsset(request, path, headers)
				if (asset) return asset
				if (
					url.pathname === "/app" ||
					url.pathname.startsWith("/app/") ||
					url.pathname === "/invite"
				) {
					let app = yield* serveAsset(request, resolve(dist, "app.html"), {
						...headers,
						"Cache-Control": "no-cache",
					})
					if (app) return app
				}
				return new Response("Not found", { status: 404 })
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
				open(socket: ServerWebSocket<Connection>) {
					live.open(socket)
				},
				message(socket: ServerWebSocket<Connection>, data: string | Buffer) {
					runMessage(live.message(socket, data))
				},
				close(socket: ServerWebSocket<Connection>) {
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
