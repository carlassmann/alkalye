import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { chmod, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { promise } from "../platform/effects"
import { EmailAuthenticationRejected } from "../shared/email-authentication"
import { EmailDelivery } from "./email-delivery"

export let bunEmailDeliveryLayer = Layer.unwrap(
	Effect.gen(function* () {
		let mailbox = yield* Config.option(
			Config.String("ALKALYE_TEST_EMAIL_MAILBOX"),
		)
		if (Option.isNone(mailbox)) return EmailDelivery.layer
		let environment = yield* Config.String("NODE_ENV").pipe(
			Config.withDefault("development"),
		)
		if (environment === "production")
			return yield* new EmailAuthenticationRejected({
				message: "Test email mailbox cannot run in production",
			})
		let directory = mailbox.value
		return Layer.succeed(EmailDelivery, {
			enabled: true,
			send(email, code, id) {
				return Effect.gen(function* () {
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
				}).pipe(
					Effect.mapError(
						() =>
							new EmailAuthenticationRejected({
								message: "Email is temporarily unavailable; try again shortly",
							}),
					),
				)
			},
		})
	}),
)
