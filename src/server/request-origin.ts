import * as Deferred from "effect/Deferred"
import * as Layer from "effect/Layer"
import { RelaySettings } from "./settings"
import * as Effect from "effect/Effect"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import { AuthenticationRequired, RequestOrigin } from "../shared/authentication"

export { RequestOrigin } from "../shared/authentication"
export function requestOrigin(browser: boolean) {
	return Effect.gen(function* () {
		let expected = yield* (yield* RequestOrigin).read
		let request = yield* HttpServerRequest.HttpServerRequest
		let url = new URL(request.originalUrl)
		let origin = request.headers.origin
		if (
			url.host !== new URL(expected).host ||
			(origin && origin !== expected) ||
			(browser && request.method !== "GET" && origin !== expected)
		)
			return yield* Effect.fail(
				new AuthenticationRequired({ message: "Invalid request origin" }),
			)
		return expected
	})
}

export let requestOriginLayer = Layer.effect(
	RequestOrigin,
	Effect.gen(function* () {
		let settings = yield* RelaySettings
		let origin = yield* Deferred.make<string>()
		if (settings.publicOrigin)
			yield* Deferred.succeed(origin, settings.publicOrigin)
		return {
			read: Deferred.await(origin),
			bind: (value: string) =>
				Deferred.succeed(origin, value).pipe(Effect.asVoid),
		}
	}),
)
