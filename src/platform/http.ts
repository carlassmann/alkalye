import * as Effect from "effect/Effect"
import * as HttpBody from "effect/http/HttpBody"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import type { HttpMethod } from "effect/http/HttpMethod"
import { NetworkError } from "./errors"

export let fetchResponse = Effect.fn("fetchResponse")(function* (
	input: string | URL,
	options?: { method?: HttpMethod; headers?: HeadersInit; body?: BodyInit },
) {
	let url = yield* Effect.try({
		try: () => new URL(input, globalThis.location?.href),
		catch: cause => new NetworkError({ operation: String(input), cause }),
	})
	let request = HttpClientRequest.make(options?.method ?? "GET")(url, {
		headers: options?.headers ? new Headers(options.headers) : undefined,
	})
	if (options?.body !== undefined)
		request = HttpClientRequest.setBody(request, HttpBody.raw(options.body))
	return yield* HttpClient.execute(request)
})
