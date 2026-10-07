import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiSecurity from "effect/http-api/HttpApiSecurity"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import { DocumentApi } from "../shared/document-api"
import {
	AuthenticationRequired,
	AuthenticationUnavailable,
	RequestAccount,
} from "../shared/authentication"
import { EmailAuthenticationRejected } from "../shared/email-authentication"
import { encode } from "../shared/base64"
import { EmailAuthentication } from "./email-authentication"
import { requestOrigin } from "./request-origin"

let cookieName = "alkalye-email-challenge"
function challengeSecurity(origin: string) {
	return HttpApiSecurity.apiKey({
		in: "cookie",
		key: (origin.startsWith("https:") ? "__Host-" : "") + cookieName,
	})
}
export let emailApiHandlers = Layer.unwrap(
	Effect.gen(function* () {
		let emails = yield* EmailAuthentication
		let randomness = yield* Crypto.Crypto
		let authentication = HttpApiBuilder.group(
			DocumentApi,
			"emailAuthentication",
			handlers =>
				handlers
					.handle("availability", () =>
						browserOrigin().pipe(Effect.as({ enabled: emails.enabled })),
					)
					.handle("request", ({ payload }) =>
						Effect.gen(function* () {
							let origin = yield* browserOrigin()
							let binding = Redacted.make(
								encode(yield* available(randomness.randomBytes(32))),
							)
							let challenge = yield* available(
								emails.requestSignIn(payload.email, origin, binding),
							)
							yield* setBindingCookie(origin, binding, challenge.expires)
							return challenge
						}),
					)
					.handle("verify", ({ payload }) =>
						Effect.gen(function* () {
							let origin = yield* browserOrigin()
							let binding = yield* HttpApiBuilder.securityDecode(
								challengeSecurity(origin),
							)
							if (!Redacted.value(binding))
								return yield* Effect.fail(
									new EmailAuthenticationRejected({
										message: "Request a code in this browser first",
									}),
								)
							return yield* available(
								emails.verifySignIn(
									payload.id,
									Redacted.make(payload.code),
									origin,
									binding,
								),
							)
						}),
					),
		)
		let account = HttpApiBuilder.group(DocumentApi, "accountEmail", handlers =>
			handlers
				.handle("unlink", () =>
					Effect.gen(function* () {
						yield* browserOrigin()
						let account = yield* RequestAccount
						return yield* available(emails.unlink(account.subject))
					}),
				)
				.handle("status", () =>
					Effect.gen(function* () {
						yield* browserOrigin()
						let account = yield* RequestAccount
						return yield* available(emails.status(account.subject))
					}),
				)
				.handle("request", ({ payload }) =>
					Effect.gen(function* () {
						let origin = yield* browserOrigin()
						let account = yield* RequestAccount
						let binding = Redacted.make(
							encode(yield* available(randomness.randomBytes(32))),
						)
						let challenge = yield* available(
							emails.requestLink(
								payload.email,
								origin,
								account.subject,
								Redacted.make(payload.recovery),
								binding,
							),
						)
						yield* setBindingCookie(origin, binding, challenge.expires)
						return challenge
					}),
				)
				.handle("verify", ({ payload }) =>
					Effect.gen(function* () {
						let origin = yield* browserOrigin()
						let account = yield* RequestAccount
						let binding = yield* HttpApiBuilder.securityDecode(
							challengeSecurity(origin),
						)
						if (!Redacted.value(binding))
							return yield* Effect.fail(
								new EmailAuthenticationRejected({
									message: "Request a code in this browser first",
								}),
							)
						return yield* available(
							emails.verifyLink(
								payload.id,
								Redacted.make(payload.code),
								origin,
								account.subject,
								binding,
							),
						)
					}),
				),
		)
		return Layer.merge(authentication, account)
	}),
)
function browserOrigin() {
	return Effect.gen(function* () {
		let request = yield* HttpServerRequest.HttpServerRequest
		if (request.headers.authorization !== undefined)
			return yield* Effect.fail(
				new AuthenticationRequired({
					message: "Manage email sign-in in your browser",
				}),
			)
		return yield* requestOrigin(true)
	})
}
function setBindingCookie(
	origin: string,
	binding: Redacted.Redacted<string>,
	expires: number,
) {
	return HttpApiBuilder.securitySetCookie(challengeSecurity(origin), binding, {
		path: "/",
		httpOnly: true,
		sameSite: "strict",
		secure: origin.startsWith("https:"),
		expires: new Date(expires),
	})
}
function available<A, E, R>(work: Effect.Effect<A, E, R>) {
	return work.pipe(
		Effect.mapError(error =>
			error instanceof EmailAuthenticationRejected
				? error
				: new AuthenticationUnavailable({
						message: "Email sign-in is temporarily unavailable",
					}),
		),
	)
}
