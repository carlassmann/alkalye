import * as Schema from "effect/Schema"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import {
	AuthenticationRequiredSchema,
	AuthenticationUnavailableSchema,
} from "./authentication"
import { AccountAuthentication } from "./account-api"

export let RecoveryKeySchema = Schema.String.check(
	Schema.isPattern(/^[\w-]{42}[AEIMQUYcgkosw048]$/),
)
export let EmailSchema = Schema.String.check(
	Schema.isMaxLength(254),
	Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
)
export let EmailChallengeSchema = Schema.Struct({
	id: Schema.String.check(Schema.isUUID(4)),
	expires: Schema.Natural,
})
export let EmailCodeSchema = Schema.String.check(Schema.isPattern(/^\d{8}$/))
export let EmailVerificationSchema = Schema.Struct({
	id: EmailChallengeSchema.fields.id,
	code: EmailCodeSchema,
})
export class EmailAuthenticationRejected extends Schema.TaggedError<EmailAuthenticationRejected>()(
	"EmailAuthenticationRejected",
	{ message: Schema.String },
) {}
let errors = [
	EmailAuthenticationRejected.pipe(HttpApiSchema.status(400)),
	AuthenticationRequiredSchema,
	AuthenticationUnavailableSchema,
]
export let emailAuthenticationGroup = HttpApiGroup.make(
	"emailAuthentication",
).add(
	HttpApiEndpoint.get("availability", "/api/accounts/email/availability", {
		success: Schema.Struct({ enabled: Schema.Boolean }),
		error: errors,
	}),
	HttpApiEndpoint.post("request", "/api/accounts/email/sign-in", {
		payload: Schema.Struct({ email: EmailSchema }),
		success: EmailChallengeSchema,
		error: errors,
	}),
	HttpApiEndpoint.post("verify", "/api/accounts/email/sign-in/verify", {
		payload: EmailVerificationSchema,
		success: Schema.Struct({ recovery: RecoveryKeySchema }),
		error: errors,
	}),
)
export let accountEmailGroup = HttpApiGroup.make("accountEmail")
	.add(
		HttpApiEndpoint.delete("unlink", "/api/accounts/email", { error: errors }),
		HttpApiEndpoint.get("status", "/api/accounts/email", {
			success: Schema.Struct({
				enabled: Schema.Boolean,
				email: Schema.NullOr(Schema.String),
			}),
			error: errors,
		}),
		HttpApiEndpoint.post("request", "/api/accounts/email", {
			payload: Schema.Struct({
				email: EmailSchema,
				recovery: RecoveryKeySchema,
			}),
			success: EmailChallengeSchema,
			error: errors,
		}),
		HttpApiEndpoint.post("verify", "/api/accounts/email/verify", {
			payload: EmailVerificationSchema,
			success: Schema.Struct({ email: Schema.String }),
			error: errors,
		}),
	)
	.middleware(AccountAuthentication)
