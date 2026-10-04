import * as Context from "effect/Context"
import type * as Duration from "effect/Duration"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { withBrowserLock } from "../platform/browser-lock"
import { StorageError } from "../platform/errors"
import { Signatures } from "../platform/signatures"
import { webCryptoLayer } from "../platform/web-crypto"
import { encode } from "../shared/base64"
import {
	AccountChanged,
	AuthenticationRequired,
	accountHeader,
} from "../shared/authentication"
import { DocumentApi } from "../shared/document-api"
import { BrowserStorage } from "./storage"

export type BrowserAccountState =
	| {
			readonly status: "offline" | "signingIn" | "accountChanged" | "signedOut"
	  }
	| { readonly status: "signedIn"; readonly expires: number }
	| { readonly status: "failed"; readonly message: string }

export class BrowserAccount extends Context.Service<
	BrowserAccount,
	Effect.Success<ReturnType<typeof makeBrowserAccount>>
>()("alkalye/BrowserAccount") {
	static layer(origin: string) {
		return Layer.effect(BrowserAccount, makeBrowserAccount(origin)).pipe(
			Layer.provide(Layer.merge(Signatures.layer, webCryptoLayer)),
		)
	}
}

function makeBrowserAccount(server: string) {
	return Effect.gen(function* () {
		let origin = new URL(server).origin
		let storage = yield* BrowserStorage
		let randomness = yield* Crypto.Crypto
		let signatures = yield* Signatures
		let candidate = encode(yield* randomness.randomBytes(32))
		let stored = yield* storage.getOrCreate("recovery", candidate)
		if (
			typeof stored !== "string" ||
			!/^[\w-]{42}[AEIMQUYcgkosw048]$/.test(stored)
		)
			return yield* Effect.fail(
				new StorageError({
					operation: "recovery",
					cause: "Stored recovery key is damaged; preserved on this device",
				}),
			)
		let recovery = Redacted.make(stored)
		let identity = yield* signatures.account(recovery)
		let signedOutKey = "browser-signed-out:" + origin
		let signedOut = yield* storage.get(signedOutKey)
		let api = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: origin,
			transformClient: client =>
				HttpClient.mapRequest(
					client,
					HttpClientRequest.setHeader(accountHeader, identity.subject),
				),
		})
		let state = yield* SubscriptionRef.make<BrowserAccountState>(
			Object.freeze({ status: signedOut ? "signedOut" : "offline" }),
		)
		let connect = serialized(
			Effect.suspend(() =>
				SubscriptionRef.getUnsafe(state).status === "signedOut"
					? Effect.fail(
							new AuthenticationRequired({ message: "You signed out" }),
						)
					: api.account.session(),
			).pipe(
				Effect.catchIf(
					error =>
						error instanceof AuthenticationRequired &&
						SubscriptionRef.getUnsafe(state).status !== "signedOut",
					() => login(false),
				),
			),
		)
		return Object.freeze({
			origin,
			subject: identity.subject,
			recovery,
			api,
			state: Object.freeze({
				current: () => SubscriptionRef.getUnsafe(state),
				changes: SubscriptionRef.changes(state),
			}),
			connect,
			switchAccount: serialized(login(true), true),
			restore: (key: string) =>
				withAccountLock(
					Effect.gen(function* () {
						yield* checkProfile(true)
						if (!/^[\w-]{42}[AEIMQUYcgkosw048]$/.test(key))
							return yield* new StorageError({
								operation: "restore account",
								cause: "Enter a valid recovery key",
							})
						let restored = yield* signatures.account(Redacted.make(key))
						let challenge = yield* api.authentication.challenge({
							payload: { publicKey: restored.publicKey, purpose: "cookie" },
						})
						let signature = yield* restored.signAuthentication(challenge, {
							origin,
							purpose: "cookie",
						})
						yield* Effect.gen(function* () {
							yield* api.authentication
								.browserLogin({
									payload: {
										id: challenge.id,
										publicKey: restored.publicKey,
										signature,
										replace: true,
									},
								})
								.pipe(Effect.timeout("15 seconds"))
							let values: [string, unknown][] = [
								["recovery", key],
								[signedOutKey, undefined],
							]
							if (key !== stored)
								values.push(["recovery-previous:" + identity.subject, stored])
							yield* storage.setMany(values)
						}).pipe(Effect.uninterruptible)
						yield* publish({ status: "accountChanged" })
					}),
				).pipe(Effect.timeout("20 seconds")),
			request: <A, E>(
				work: Effect.Effect<A, E>,
				budget: Duration.Input = "20 seconds",
			) =>
				Effect.gen(function* () {
					yield* checkProfile()
					return yield* work.pipe(
						Effect.timeout(budget),
						Effect.catchIf(
							error => error instanceof AuthenticationRequired,
							() =>
								connect.pipe(Effect.andThen(work.pipe(Effect.timeout(budget)))),
						),
						Effect.tapError(error =>
							error instanceof AccountChanged
								? publish({ status: "accountChanged" })
								: Effect.void,
						),
					)
				}),
			logout: withAccountLock(
				Effect.gen(function* () {
					yield* checkProfile(true)
					yield* storage.set(signedOutKey, identity.subject)
					yield* publish({ status: "signedOut" })
					return yield* api.account.logout().pipe(Effect.timeout("15 seconds"))
				}),
			),
		})
		function withAccountLock<A, E>(work: Effect.Effect<A, E>) {
			return Effect.gen(function* () {
				if (!navigator.locks)
					return yield* Effect.fail(
						new StorageError({
							operation: "sign in",
							cause: "Web Locks are required",
						}),
					)
				return yield* withBrowserLock(
					"alkalye-browser-session-v1",
					work,
					navigator.locks,
				)
			})
		}
		function serialized<E>(
			work: Effect.Effect<{ subject: string; expires: number }, E>,
			explicit = false,
		) {
			return withAccountLock(
				Effect.gen(function* () {
					yield* checkProfile(explicit)
					let previous = SubscriptionRef.getUnsafe(state)
					return yield* work.pipe(
						Effect.timeout("15 seconds"),
						Effect.onInterrupt(() => publish(previous)),
						Effect.tap(session =>
							session.subject === identity.subject
								? Effect.void
								: Effect.fail(
										new AccountChanged({
											message: "The account changed; sign in again",
										}),
									),
						),
						Effect.tap(() =>
							explicit ? storage.set(signedOutKey, undefined) : Effect.void,
						),
						Effect.tap(session =>
							publish({ status: "signedIn", expires: session.expires }),
						),
						Effect.tapError(() =>
							previous.status === "signedOut" ? publish(previous) : Effect.void,
						),
					)
				}),
			).pipe(
				Effect.tapError(error =>
					SubscriptionRef.getUnsafe(state).status === "signedOut"
						? Effect.void
						: publish(
								error instanceof AccountChanged
									? { status: "accountChanged" }
									: {
											status: "failed",
											message:
												error instanceof Error ? error.message : String(error),
										},
							),
				),
			)
		}
		function checkProfile(allowSignedOut = false) {
			return Effect.gen(function* () {
				if ((yield* storage.get("recovery")) !== stored) {
					yield* publish({ status: "accountChanged" })
					return yield* Effect.fail(
						new AccountChanged({
							message: "The account changed; reopen your workspace",
						}),
					)
				}
				let signedOut = yield* storage.get(signedOutKey)
				if (!allowSignedOut && signedOut) {
					yield* publish({ status: "signedOut" })
					return yield* Effect.fail(
						new AuthenticationRequired({ message: "You signed out" }),
					)
				}
				if (
					!signedOut &&
					SubscriptionRef.getUnsafe(state).status === "signedOut"
				)
					yield* publish({ status: "offline" })
			})
		}
		function login(replace: boolean) {
			return Effect.gen(function* () {
				yield* publish({ status: "signingIn" })
				let challenge = yield* api.authentication.challenge({
					payload: { publicKey: identity.publicKey, purpose: "cookie" },
				})
				let signature = yield* identity.signAuthentication(challenge, {
					origin,
					purpose: "cookie",
				})
				return yield* api.authentication.browserLogin({
					payload: {
						id: challenge.id,
						publicKey: identity.publicKey,
						signature,
						replace,
					},
				})
			})
		}
		function publish(value: BrowserAccountState) {
			return SubscriptionRef.set(state, Object.freeze(value))
		}
	})
}
