import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Redacted from "effect/Redacted"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { chmod, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { EmailAuthenticationRejected } from "../shared/email-authentication"
import { promise } from "../platform/effects"

export class EmailDelivery extends Context.Service<
	EmailDelivery,
	{
		readonly enabled: boolean
		readonly send: (
			email: string,
			code: Redacted.Redacted<string>,
			id: string,
		) => Effect.Effect<void, EmailAuthenticationRejected>
	}
>()("alkalye/EmailDelivery") {
	static layer = Layer.effect(
		EmailDelivery,
		Effect.gen(function* () {
			let token = yield* Config.option(Config.Redacted("RESEND_API_KEY"))
			let sender = yield* Config.String("EMAIL_FROM").pipe(
				Config.withDefault(""),
			)
			let mailbox = yield* Config.option(
				Config.String("ALKALYE_TEST_EMAIL_MAILBOX"),
			)
			let environment = yield* Config.String("NODE_ENV").pipe(
				Config.withDefault("development"),
			)
			let client = yield* HttpClient.HttpClient
			if (Option.isSome(mailbox) && environment === "production")
				return yield* Effect.fail(
					new EmailAuthenticationRejected({
						message: "Test email mailbox cannot run in production",
					}),
				)
			let enabled =
				Option.isSome(mailbox) || (Option.isSome(token) && sender.length > 0)
			return {
				enabled,
				send(email: string, code: Redacted.Redacted<string>, id: string) {
					return Effect.gen(function* () {
						if (Option.isSome(mailbox)) {
							let directory = mailbox.value
							yield* promise("test mailbox", () =>
								mkdir(directory, { recursive: true, mode: 0o700 }),
							)
							let path = join(directory, id + ".json")
							yield* promise("test email", () =>
								Bun.write(
									path,
									JSON.stringify({ email, code: Redacted.value(code), id }),
								),
							)
							yield* promise("test email permissions", () => chmod(path, 0o600))
							return
						}
						if (!Option.isSome(token) || !sender) return yield* unavailable()
						let request = HttpClientRequest.post(
							"https://api.resend.com/emails",
						).pipe(
							HttpClientRequest.bearerToken(token.value),
							HttpClientRequest.setHeader("Idempotency-Key", id),
						)
						request = yield* HttpClientRequest.bodyJson(request, {
							from: sender,
							to: [email],
							subject: "Your Alkalye sign-in code",
							text: `Your Alkalye code is ${Redacted.value(code)}. It expires in 5 minutes. Never share it. If you did not request this code, ignore this email. To sign in, this email must first be linked from your existing device in Settings.`,
						})
						let response = yield* client
							.execute(request)
							.pipe(Effect.timeout("10 seconds"))
						let body = yield* response.json
						if (response.status < 200 || response.status >= 300)
							return yield* unavailable()
						yield* Schema.decodeUnknownEffect(
							Schema.Struct({ id: Schema.NonEmptyString }),
						)(body)
					}).pipe(
						Effect.scoped,
						Effect.mapError(
							() =>
								new EmailAuthenticationRejected({
									message:
										"Email is temporarily unavailable; try again shortly",
								}),
						),
					)
				},
			}
		}),
	).pipe(Layer.provide(FetchHttpClient.layer))
}
function unavailable() {
	return Effect.fail(
		new EmailAuthenticationRejected({
			message: "Email sign-in is unavailable",
		}),
	)
}
