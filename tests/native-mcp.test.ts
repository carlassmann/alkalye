import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as McpServer from "effect/ai/McpServer"
import * as McpProtocol from "effect/ai/McpProtocol"
import * as Tool from "effect/ai/Tool"
import * as Toolkit from "effect/ai/Toolkit"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import { webResponse } from "../src/platform/http-server"
import { object } from "../src/shared/model"

let Echo = Tool.make("echo", {
	description: "Verify request context isolation",
	parameters: Schema.Struct({ value: Schema.String }),
	success: Schema.Struct({
		value: Schema.String,
		authorization: Schema.String,
	}),
})
	.addDependency(HttpServerRequest.HttpServerRequest)
	.annotate(Tool.Strict, true)
let Tools = Toolkit.make(Echo)
let handlers = Tools.toLayer({
	echo: ({ value }) =>
		Effect.gen(function* () {
			let request = yield* HttpServerRequest.HttpServerRequest
			yield* Effect.yieldNow
			return { value, authorization: request.headers.authorization ?? "" }
		}),
})
let native = Layer.merge(
	McpServer.layerHttp({
		name: "probe",
		version: "1",
		path: "/mcp",
		protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25],
	}),
	McpServer.toolkit(Tools),
).pipe(Layer.provide(handlers))

function modern(
	method: string,
	token: string,
	args: Record<string, unknown> = {},
) {
	let params = {
		...args,
		_meta: {
			"io.modelcontextprotocol/protocolVersion": "2026-07-28",
			"io.modelcontextprotocol/clientCapabilities": {},
		},
	}
	let headers = new Headers({
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
		Authorization: `Bearer ${token}`,
		"MCP-Protocol-Version": "2026-07-28",
		"Mcp-Method": method,
	})
	if (typeof args.name === "string") headers.set("Mcp-Name", args.name)
	return new Request("http://localhost/mcp", {
		method: "POST",
		headers,
		body: JSON.stringify({ jsonrpc: "2.0", id: token, method, params }),
	})
}

test("native Effect MCP serves discovery and keeps concurrent bearer contexts separate", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let http = yield* HttpRouter.toHttpEffect(native)
				function invoke(request: Request) {
					return webResponse(http).pipe(
						Effect.provideService(
							HttpServerRequest.HttpServerRequest,
							HttpServerRequest.fromWeb(request),
						),
					)
				}
				let discovery = yield* invoke(modern("server/discover", "discovery"))
				expect(discovery.status).toBe(200)
				let discover = object(
					object(yield* Effect.promise(() => discovery.json())).result,
				)
				expect(discover.supportedVersions).toEqual(["2026-07-28", "2025-11-25"])
				let responses = yield* Effect.forEach(
					["first", "second"],
					token =>
						Effect.gen(function* () {
							let response = yield* invoke(
								modern("tools/call", token, {
									name: "echo",
									arguments: { value: token },
								}),
							)
							expect(response.status).toBe(200)
							return object(
								object(yield* Effect.promise(() => response.json())).result,
							).structuredContent
						}),
					{ concurrency: 2 },
				)
				expect(responses).toEqual([
					{ value: "first", authorization: "Bearer first" },
					{ value: "second", authorization: "Bearer second" },
				])
			}),
		),
	)
})
