import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import * as RcMap from "effect/RcMap"
import * as McpServer from "effect/ai/McpServer"
import * as McpProtocol from "effect/ai/McpProtocol"
import * as Headers from "effect/http/Headers"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import { webResponse } from "../platform/http-server"
import { isInfrastructureFailure } from "./failures"
import { agentToolsLayer } from "./mcp-tools"
import { AgentDocuments } from "./agent-documents"
import type { AgentCredentials } from "./agent-credentials"

export function makeMcpHandler(
	mcp: Context.Service.Shape<typeof AgentCredentials>,
	documents: Context.Service.Shape<typeof AgentDocuments>,
	publicOrigin?: string,
) {
	return Effect.gen(function* () {
		let generations = yield* RcMap.make({
			idleTimeToLive: "1 hour",
			lookup: (_generation: number) =>
				HttpRouter.toHttpEffect(
					Layer.fresh(
						Layer.merge(
							McpServer.layerHttp({
								name: "alkalye",
								version: "0.1.0",
								path: "/mcp",
								protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25],
								instructions:
									"Read a document before editing. Pass spaceId from list or read results to target one workspace without loading unrelated spaces. Supply expectedRevision when updating or renaming. Workspace permissions apply to every tool.",
							}),
							agentToolsLayer().pipe(
								Layer.provide(Layer.succeed(AgentDocuments, documents)),
							),
						),
					),
				).pipe(
					Effect.updateContext((context: Context.Context<Scope.Scope>) =>
						Context.omit(HttpServerRequest.HttpServerRequest)(context),
					),
				),
		})
		return function handleMcp(request: Request) {
			return Effect.gen(function* () {
				let origin = request.headers.get("Origin")
				if (origin && origin !== (publicOrigin || new URL(request.url).origin))
					return new Response(null, { status: 403 })
				let token =
					request.headers.get("Authorization")?.replace(/^Bearer /i, "") ?? ""
				let resource = new URL("/mcp", publicOrigin || request.url).href
				if (!(yield* mcp.authorize(token, resource)))
					return Response.json(
						{ error: "Connect an agent from Settings" },
						{
							status: 401,
							headers: {
								"WWW-Authenticate": `Bearer resource_metadata="${publicOrigin || new URL(request.url).origin}/.well-known/oauth-protected-resource/mcp"`,
							},
						},
					)
				let nativeRequest = HttpServerRequest.fromWeb(request)
				// Origin was checked against the actual Bun listener before entering Effect's static route layer.
				nativeRequest = nativeRequest.modify({
					headers: Headers.remove(nativeRequest.headers, "origin"),
				})
				let http = Effect.gen(function* () {
					let now = yield* Clock.currentTimeMillis
					let generation = Math.floor(now / 3600000)
					let current = yield* RcMap.get(generations, generation).pipe(
						Effect.tapCause(cause =>
							Cause.hasInterrupts(cause)
								? Effect.void
								: RcMap.invalidate(generations, generation),
						),
					)
					return yield* current
				})
				return yield* webResponse(http).pipe(
					Effect.provideService(
						HttpServerRequest.HttpServerRequest,
						nativeRequest,
					),
				)
			}).pipe(
				Effect.catchCause(cause =>
					Cause.hasInterrupts(cause)
						? Effect.failCause(cause)
						: Effect.succeed(
								Response.json(
									{
										jsonrpc: "2.0",
										id: null,
										error: {
											code: -32603,
											message:
												isInfrastructureFailure(cause) && !Cause.hasDies(cause)
													? "Server storage is unavailable"
													: "Server request failed",
										},
									},
									{ status: 500 },
								),
							),
				),
			)
		}
	})
}
