import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiSecurity from "effect/http-api/HttpApiSecurity"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import {
	AccountAuthentication,
	cookieSecurity,
	secureCookieSecurity,
} from "../shared/account-api"
import {
	AuthenticationRequired,
	AccountChanged,
	AuthenticationUnavailable,
	RequestAccount,
	accountHeader,
} from "../shared/authentication"
import { Sessions } from "./sessions"
import { requestOrigin } from "./request-origin"

export let accountAuthentication = Layer.effect(
	AccountAuthentication,
	Effect.gen(function* () {
		let sessions = yield* Sessions
		return httpEffect =>
			Effect.gen(function* () {
				let request = yield* HttpServerRequest.HttpServerRequest
				let bearer = request.headers.authorization !== undefined
				let origin = yield* requestOrigin(!bearer)
				// Choosing one credential preserves infrastructure failures instead of falling back to an anonymous scheme.
				let credential = yield* HttpApiBuilder.securityDecode(
					bearer
						? HttpApiSecurity.bearer
						: origin.startsWith("https:")
							? secureCookieSecurity
							: cookieSecurity,
				)
				let account = yield* authenticationAvailable(
					sessions.authenticate(credential, bearer ? "bearer" : "cookie"),
				)
				let expected = request.headers[accountHeader]
				if (expected !== undefined && expected !== account.subject)
					return yield* Effect.fail(
						new AccountChanged({
							message: "The account changed; sign in again",
						}),
					)
				return yield* Effect.provideService(httpEffect, RequestAccount, account)
			})
	}),
)
export function authenticationAvailable<A, E, R>(
	effect: Effect.Effect<A, E, R>,
) {
	return effect.pipe(
		Effect.tapError(error =>
			error instanceof AuthenticationRequired ||
			error instanceof AccountChanged ||
			error instanceof AuthenticationUnavailable
				? Effect.void
				: Effect.logError("Account storage failed"),
		),
		Effect.mapError(error =>
			error instanceof AuthenticationRequired ||
			error instanceof AccountChanged ||
			error instanceof AuthenticationUnavailable
				? error
				: new AuthenticationUnavailable({
						message: "Sign in is temporarily unavailable",
					}),
		),
	)
}
