import * as Semaphore from "effect/Semaphore"
import * as Ref from "effect/Ref"
import * as Data from "effect/Data"
import * as FiberMap from "effect/FiberMap"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import * as Queue from "effect/Queue"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"
import * as Sse from "effect/encoding/Sse"
import * as McpSchema from "effect/ai/McpSchema"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"

let requestSchema = Schema.Struct({
	jsonrpc: Schema.Literal("2.0"),
	method: Schema.String,
	id: Schema.optionalKey(McpSchema.RequestId),
	params: Schema.optionalKey(Schema.JsonObject),
})
let responseSchema = Schema.Union([
	Schema.Struct({
		jsonrpc: Schema.Literal("2.0"),
		id: Schema.NullOr(McpSchema.RequestId),
		result: Schema.Json,
	}),
	Schema.Struct({
		jsonrpc: Schema.Literal("2.0"),
		id: Schema.NullOr(McpSchema.RequestId),
		error: Schema.JsonObject,
	}),
])
let envelopeSchema = Schema.Union([requestSchema, responseSchema])
let frameSchema = Schema.Union([envelopeSchema, Schema.Array(envelopeSchema)])
export function proxyMcp(origin: string) {
	return Effect.scoped(
		Effect.gen(function* () {
			let tasks = yield* FiberMap.make<
				string | number | symbol,
				void,
				unknown
			>()
			let ordered = yield* Queue.unbounded<{
				start: Deferred.Deferred<void>
				fiber: Fiber.Fiber<void, unknown>
			}>()
			yield* Effect.gen(function* () {
				let next = yield* Queue.take(ordered)
				yield* Deferred.succeed(next.start, undefined)
				yield* Fiber.await(next.fiber)
			}).pipe(Effect.forever, Effect.forkScoped)
			let token = yield* Config.Redacted("ALKALYE_MCP_TOKEN")
			let stdio = yield* Stdio.Stdio
			let http = yield* HttpClient.HttpClient
			let session = yield* Ref.make<
				{ id: string; version: string } | undefined
			>(undefined)
			let initialization = yield* Ref.make<string | undefined>(undefined)
			let initializedNotification = yield* Ref.make<string | undefined>(
				undefined,
			)
			let recovery = yield* Semaphore.make(1)
			yield* Effect.raceFirst(
				stdio.stdin.pipe(
					Stream.decodeText(),
					Stream.splitLines,
					Stream.filter(line => Boolean(line.trim())),
					Stream.runForEach(forward),
					Effect.andThen(FiberMap.awaitEmpty(tasks)),
				),
				FiberMap.join(tasks),
			)
			function forward(line: string) {
				return Effect.gen(function* () {
					let decoded = yield* Schema.decodeUnknownEffect(
						Schema.fromJsonString(frameSchema),
					)(line).pipe(Effect.result)
					if (decoded._tag === "Failure") {
						let syntax = yield* Schema.decodeUnknownEffect(
							Schema.fromJsonString(Schema.Json),
						)(line).pipe(Effect.result)
						return yield* Console.log(
							JSON.stringify({
								jsonrpc: "2.0",
								id: null,
								error: {
									code:
										syntax._tag === "Failure"
											? McpSchema.PARSE_ERROR_CODE
											: McpSchema.INVALID_REQUEST_ERROR_CODE,
									message:
										syntax._tag === "Failure"
											? "Parse error"
											: "Invalid request",
								},
							}),
						)
					}
					let message = Schema.decodeUnknownOption(requestSchema)(
						decoded.success,
					)
					if (
						message._tag === "Some" &&
						message.value.method === "notifications/cancelled"
					) {
						let cancellation = Schema.decodeUnknownOption(
							McpSchema.CancelledNotification.payloadSchema,
						)(message.value.params)
						if (cancellation._tag === "Some")
							yield* FiberMap.remove(tasks, cancellation.value.requestId)
						yield* FiberMap.run(tasks, Symbol(), send(line, decoded.success))
						return
					}
					let id = message._tag === "Some" ? message.value.id : undefined
					if (id !== undefined && (yield* FiberMap.has(tasks, id))) {
						return yield* Console.log(
							JSON.stringify({
								jsonrpc: "2.0",
								id,
								error: {
									code: McpSchema.INVALID_REQUEST_ERROR_CODE,
									message: "Duplicate in-flight request ID",
								},
							}),
						)
					}
					if (
						(message._tag === "None" &&
							Schema.is(responseSchema)(decoded.success)) ||
						(message._tag === "Some" && message.value.method === "ping")
					) {
						yield* FiberMap.run(
							tasks,
							id ?? Symbol(),
							send(line, decoded.success),
						)
						return
					}
					let start = yield* Deferred.make<void>()
					let fiber = yield* FiberMap.run(
						tasks,
						id ?? Symbol(),
						Deferred.await(start).pipe(
							Effect.andThen(send(line, decoded.success)),
						),
					)
					yield* Queue.offer(ordered, { start, fiber })
				})
			}
			function recoverSession(expired: string) {
				return recovery.withPermit(
					Effect.gen(function* () {
						let current = yield* Ref.get(session)
						if (current && current.id !== expired) return
						let original = yield* Ref.get(initialization)
						if (!original)
							return yield* failure(
								"MCP session expired; initialize again",
								404,
							)
						let response = yield* post(original)
						if (response.status !== 200)
							return yield* failure(
								"MCP initialization failed",
								response.status,
							)
						let result = yield* Schema.decodeUnknownEffect(
							Schema.Struct({
								jsonrpc: Schema.Literal("2.0"),
								id: McpSchema.RequestId,
								result: McpSchema.Initialize.successSchema,
							}),
						)(yield* response.json)
						let id = response.headers["mcp-session-id"]
						if (!id)
							return yield* failure(
								"MCP initialization returned no session",
								500,
							)
						let refreshed = { id, version: result.result.protocolVersion }
						let notification = yield* Ref.get(initializedNotification)
						if (notification) {
							let accepted = yield* post(notification, refreshed)
							if (accepted.status !== 202)
								return yield* failure(
									"MCP initialization notification failed",
									accepted.status,
								)
						}
						yield* Ref.set(session, refreshed)
					}),
				)
			}
			function post(body: string, legacy?: { id: string; version: string }) {
				return http.execute(
					HttpClientRequest.post(
						new URL("mcp", origin.endsWith("/") ? origin : origin + "/"),
					).pipe(
						HttpClientRequest.setHeaders({
							Authorization: `Bearer ${Redacted.value(token)}`,
							Accept: "application/json, text/event-stream",
							...(legacy
								? {
										"Mcp-Session-Id": legacy.id,
										"MCP-Protocol-Version": legacy.version,
									}
								: {}),
						}),
						HttpClientRequest.bodyText(body, "application/json"),
					),
				)
			}

			function send(line: string, frame: typeof frameSchema.Type) {
				let delivered = new Set<McpSchema.RequestId>()
				return transmit(true).pipe(
					Effect.catch(error => {
						if (error instanceof McpTransportError && error.fatal)
							return Effect.fail(error)
						return Effect.forEach(
							requestIds(frame).filter(id => !delivered.has(id)),
							id =>
								Console.log(
									JSON.stringify({
										jsonrpc: "2.0",
										id,
										error: {
											code: McpSchema.INTERNAL_ERROR_CODE,
											message:
												error instanceof McpTransportError
													? error.message
													: "MCP transport failed",
										},
									}),
								),
							{ discard: true },
						)
					}),
				)
				function transmit(retry: boolean): Effect.Effect<void, unknown> {
					return Effect.gen(function* () {
						let state = yield* Ref.get(session)
						let protocolHeaders = metadataHeaders(frame)
						let incoming = Schema.decodeUnknownOption(requestSchema)(frame)
						let initializing =
							incoming._tag === "Some" && incoming.value.method === "initialize"
						if (
							!state &&
							!initializing &&
							!protocolHeaders["MCP-Protocol-Version"] &&
							incoming._tag === "Some" &&
							incoming.value.id !== undefined &&
							(yield* Ref.get(initialization))
						) {
							yield* recoverSession("")
							state = yield* Ref.get(session)
						}
						let request = HttpClientRequest.post(
							new URL("mcp", origin.endsWith("/") ? origin : origin + "/"),
						).pipe(
							HttpClientRequest.setHeaders({
								Authorization: `Bearer ${Redacted.value(token)}`,
								Accept: "application/json, text/event-stream",
								...(state &&
								!initializing &&
								!protocolHeaders["MCP-Protocol-Version"]
									? {
											"Mcp-Session-Id": state.id,
											"MCP-Protocol-Version": state.version,
										}
									: {}),
								...protocolHeaders,
							}),
							HttpClientRequest.bodyText(line, "application/json"),
						)
						let response = yield* http.execute(request)
						if (response.status === 404 && request.headers["mcp-session-id"]) {
							if (incoming._tag === "Some" && incoming.value.id === undefined)
								return
							if (
								retry &&
								incoming._tag === "Some" &&
								incoming.value.id !== undefined
							) {
								yield* recoverSession(request.headers["mcp-session-id"])
								return yield* transmit(false)
							}
							yield* Ref.update(session, current =>
								current?.id === request.headers["mcp-session-id"]
									? undefined
									: current,
							)
							return yield* failure(
								"MCP session expired; initialize again",
								404,
							)
						}
						if (response.status === 401 || response.status === 403)
							return yield* failure(
								`MCP HTTP ${response.status}`,
								response.status,
							)
						if (response.status === 202) {
							if (
								incoming._tag === "Some" &&
								incoming.value.method === "notifications/initialized"
							)
								yield* Ref.set(initializedNotification, line)
							return
						}
						if (
							response.headers["content-type"]?.includes("text/event-stream")
						) {
							yield* response.stream.pipe(
								Stream.decodeText(),
								Stream.pipeThroughChannel(Sse.decode()),
								Stream.filter(event => Boolean(event.data)),
								Stream.runForEach(event =>
									deliver(
										event.data,
										response.status,
										response.headers["mcp-session-id"],
									),
								),
							)
						} else
							yield* deliver(
								yield* response.text,
								response.status,
								response.headers["mcp-session-id"],
							)
					})
				}

				function deliver(body: string, status: number, sessionId?: string) {
					return printResponse(body, status).pipe(
						Effect.tap(json => {
							let initializing =
								Schema.decodeUnknownOption(requestSchema)(frame)
							let reply = Schema.decodeUnknownOption(responseSchema)(json)
							if (
								sessionId &&
								initializing._tag === "Some" &&
								initializing.value.method === "initialize" &&
								reply._tag === "Some" &&
								"result" in reply.value
							) {
								let initialized = Schema.decodeUnknownOption(
									McpSchema.Initialize.successSchema,
								)(reply.value.result)
								if (initialized._tag === "Some")
									return Ref.set(initialization, line).pipe(
										Effect.andThen(
											Ref.set(session, {
												id: sessionId,
												version: initialized.value.protocolVersion,
											}),
										),
									)
							}
							return Effect.void
						}),
						Effect.tap(json =>
							Effect.sync(() => {
								for (let entry of Array.isArray(json) ? json : [json]) {
									let reply = Schema.decodeUnknownOption(responseSchema)(entry)
									if (reply._tag === "Some" && reply.value.id !== null)
										delivered.add(reply.value.id)
								}
							}),
						),
					)
				}
			}
		}),
	)
}
function metadataHeaders(
	frame: typeof frameSchema.Type,
): Record<string, string> {
	let request = Schema.decodeUnknownOption(requestSchema)(frame)
	if (request._tag === "None") return {}
	return requestHeaders(request.value)
}
function requestHeaders(
	message: typeof requestSchema.Type,
): Record<string, string> {
	let metadata = message.params?._meta
	if (!Schema.is(Schema.JsonObject)(metadata)) return {}
	let version = metadata["io.modelcontextprotocol/protocolVersion"]
	if (typeof version !== "string") return {}
	let headers: Record<string, string> = {
		"MCP-Protocol-Version": version,
		"Mcp-Method": message.method,
	}
	let name = message.params?.name
	if (typeof name === "string")
		headers["Mcp-Name"] =
			/^[\x20-\x7e]+$/.test(name) &&
			name.trim() === name &&
			!name.startsWith("=?base64?")
				? name
				: "=?base64?" + Buffer.from(name).toString("base64") + "?="
	return headers
}
function failure(message: string, status: number) {
	return new McpTransportError({
		message,
		fatal: status === 401 || status === 403,
	})
}

function printResponse(body: string, status: number) {
	return Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
		body,
	).pipe(
		Effect.flatMap(json =>
			Schema.decodeUnknownEffect(frameSchema)(json).pipe(Effect.as(json)),
		),
		Effect.mapError(() =>
			failure(`MCP HTTP ${status}: invalid response`, status),
		),
		Effect.flatMap(json =>
			Console.log(JSON.stringify(json)).pipe(Effect.as(json)),
		),
	)
}

class McpTransportError extends Data.TaggedError("McpTransportError")<{
	readonly message: string
	readonly fatal: boolean
}> {}

function requestIds(frame: typeof frameSchema.Type) {
	let ids: McpSchema.RequestId[] = []
	for (let entry of Array.isArray(frame) ? frame : [frame]) {
		let request = Schema.decodeUnknownOption(requestSchema)(entry)
		if (request._tag === "Some" && request.value.id !== undefined)
			ids.push(request.value.id)
	}
	return ids
}
