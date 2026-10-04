import * as HttpApi from "effect/http-api/HttpApi"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiSecurity from "effect/http-api/HttpApiSecurity"
import * as Schema from "effect/Schema"
import {
	AuthenticationProofSchema,
	BrowserAuthenticationProofSchema,
	AccountChangedSchema,
	AuthenticationPurposeSchema,
	AuthenticationRequiredSchema,
	AuthenticationUnavailableSchema,
	ChallengeSchema,
	LoginSchema,
	PublicKeySchema,
	RequestAccount,
	RequestOrigin,
	SessionSchema,
	sessionCookie,
} from "./authentication"

export let cookieSecurity = HttpApiSecurity.apiKey({
	in: "cookie",
	key: sessionCookie,
})
export let secureCookieSecurity = HttpApiSecurity.apiKey({
	in: "cookie",
	key: "__Host-" + sessionCookie,
})
export class AccountAuthentication extends HttpApiMiddleware.Service<
	AccountAuthentication,
	{ provides: RequestAccount; requires: RequestOrigin }
>()("AccountAuthentication", {
	error: [
		AuthenticationRequiredSchema,
		AuthenticationUnavailableSchema,
		AccountChangedSchema,
	],
}) {}
let errors = [
	AuthenticationRequiredSchema,
	AuthenticationUnavailableSchema,
	AccountChangedSchema,
]
export let AccountApi = HttpApi.make("AccountApi").add(
	HttpApiGroup.make("authentication").add(
		HttpApiEndpoint.post("challenge", "/api/accounts/challenge", {
			payload: Schema.Struct({
				publicKey: PublicKeySchema,
				purpose: AuthenticationPurposeSchema,
			}),
			success: ChallengeSchema,
			error: errors,
		}),
		HttpApiEndpoint.post("browserLogin", "/api/accounts/browser-session", {
			payload: BrowserAuthenticationProofSchema,
			success: SessionSchema,
			error: errors,
		}),
		HttpApiEndpoint.post("bearerLogin", "/api/accounts/bearer-session", {
			payload: AuthenticationProofSchema,
			success: LoginSchema,
			error: errors,
		}),
	),
	HttpApiGroup.make("account")
		.add(
			HttpApiEndpoint.get("session", "/api/accounts/session", {
				success: SessionSchema,
			}),
			HttpApiEndpoint.delete("logout", "/api/accounts/session"),
		)
		.middleware(AccountAuthentication),
)
