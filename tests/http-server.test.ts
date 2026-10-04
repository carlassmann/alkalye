import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { webResponse } from "../src/platform/http-server"

test("native HTTP request resources live until a streamed body is cancelled", async () => {
	let released = 0
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let route = HttpRouter.add(
					"GET",
					"/stream",
					Effect.gen(function* () {
						yield* Effect.addFinalizer(() =>
							Effect.sync(() => {
								released++
							}),
						)
						return HttpServerResponse.stream(
							Stream.make(new TextEncoder().encode("ready")).pipe(
								Stream.concat(Stream.never),
							),
						)
					}),
				)
				let http = yield* HttpRouter.toHttpEffect(route)
				let response = yield* webResponse(http).pipe(
					Effect.provideService(
						HttpServerRequest.HttpServerRequest,
						HttpServerRequest.fromWeb(new Request("http://localhost/stream")),
					),
				)
				expect(released).toBe(0)
				let reader = response.body?.getReader()
				if (!reader) throw new Error("Missing streaming body")
				let chunk = yield* Effect.promise(() => reader.read())
				expect(new TextDecoder().decode(chunk.value)).toBe("ready")
				expect(released).toBe(0)
				yield* Effect.promise(() => reader.cancel())
				expect(released).toBe(1)
			}),
		),
	)
	expect(released).toBe(1)
})

test("HEAD releases request resources without transferring them to an omitted stream", async () => {
	let released = 0
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let route = HttpRouter.add(
					"GET",
					"/stream",
					Effect.gen(function* () {
						yield* Effect.addFinalizer(() =>
							Effect.sync(() => {
								released++
							}),
						)
						return HttpServerResponse.stream(Stream.never)
					}),
				)
				let http = yield* HttpRouter.toHttpEffect(route)
				let response = yield* webResponse(http).pipe(
					Effect.provideService(
						HttpServerRequest.HttpServerRequest,
						HttpServerRequest.fromWeb(
							new Request("http://localhost/stream", { method: "HEAD" }),
						),
					),
				)
				expect(response.body).toBeNull()
				expect(released).toBe(1)
			}),
		),
	)
	expect(released).toBe(1)
})
