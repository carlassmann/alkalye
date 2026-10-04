import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import { isSigningPublicKey } from "./signing-keys"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"

export let PublicKeySchema = Schema.String.check(
	Schema.makeFilter<string>(isSigningPublicKey, {
		message: "Expected a canonical signing public key",
	}),
)
export let SignatureSchema = Schema.String.check(
	Schema.isPattern(/^[\w-]{85}[AQgw]$/),
)
export let AuthenticationPurposeSchema = Schema.Literals(["cookie", "bearer"])
export type AuthenticationPurpose = typeof AuthenticationPurposeSchema.Type
export let ChallengeSchema = Schema.Struct({
	id: Schema.String.check(Schema.isUUID(4)),
	publicKey: PublicKeySchema,
	origin: Schema.String,
	purpose: AuthenticationPurposeSchema,
	nonce: Schema.String,
	expires: Schema.Natural,
})
export type Challenge = typeof ChallengeSchema.Type
export let AuthenticationProofSchema = Schema.Struct({
	id: Schema.String.check(Schema.isUUID(4)),
	publicKey: PublicKeySchema,
	signature: SignatureSchema,
})
export type AuthenticationProof = typeof AuthenticationProofSchema.Type
export let BrowserAuthenticationProofSchema = Schema.Struct({
	...AuthenticationProofSchema.fields,
	replace: Schema.optional(Schema.Boolean),
})
export class AccountChanged extends Schema.TaggedError<AccountChanged>()(
	"AccountChanged",
	{ message: Schema.String },
) {}
export let AccountChangedSchema = AccountChanged.pipe(HttpApiSchema.status(409))
export class AuthenticationRequired extends Schema.TaggedError<AuthenticationRequired>()(
	"AuthenticationRequired",
	{ message: Schema.String },
) {}
export class AuthenticationUnavailable extends Schema.TaggedError<AuthenticationUnavailable>()(
	"AuthenticationUnavailable",
	{ message: Schema.String },
) {}
export class RequestOrigin extends Context.Service<
	RequestOrigin,
	{ read: Effect.Effect<string>; bind: (origin: string) => Effect.Effect<void> }
>()("RequestOrigin") {}
export class RequestAccount extends Context.Service<
	RequestAccount,
	{ subject: string; session: string; expires: number }
>()("RequestAccount") {}
export let SessionSchema = Schema.Struct({
	subject: Schema.String,
	expires: Schema.Natural,
})
export let LoginSchema = Schema.Struct({
	subject: Schema.String,
	expires: Schema.Natural,
	token: Schema.String,
})
export let AuthenticationRequiredSchema = AuthenticationRequired.pipe(
	HttpApiSchema.status(401),
)
export let AuthenticationUnavailableSchema = AuthenticationUnavailable.pipe(
	HttpApiSchema.status(503),
)
export let sessionCookie = "alkalye-session"
export let accountHeader = "x-alkalye-account"

export function authenticationMessage(challenge: Challenge) {
	return JSON.stringify([
		"alkalye-authentication-v1",
		challenge.origin,
		challenge.purpose,
		challenge.publicKey,
		challenge.id,
		challenge.nonce,
		challenge.expires,
	])
}
