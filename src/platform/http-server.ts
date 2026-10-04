import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HttpEffect from "effect/http/HttpEffect"
import * as HttpServerResponse from "effect/http/HttpServerResponse"

export function webResponse<E, R>(
	http: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) {
	return Effect.gen(function* () {
		let reply = yield* Deferred.make<Response>()
		yield* HttpEffect.toHandled(http, (request, response) =>
			Effect.gen(function* () {
				let context = yield* Effect.context<never>()
				let withoutBody = request.method === "HEAD"
				let body = HttpServerResponse.omitsBody(response, withoutBody)
					? response
					: HttpEffect.scopeTransferToStream(response)
				yield* Deferred.succeed(
					reply,
					HttpServerResponse.toWeb(body, { withoutBody, context }),
				)
			}),
		)
		return yield* Deferred.await(reply)
	})
}
