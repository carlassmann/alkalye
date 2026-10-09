import { emailAuthenticationLayer } from "../src/server/bun-databases"
import type * as Context from "effect/Context"
import { Database } from "bun:sqlite"
import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Fiber from "effect/Fiber"
import * as Deferred from "effect/Deferred"
import { TestClock } from "effect/testing"
import { Cipher } from "../src/platform/cipher"
import { Signatures } from "../src/platform/signatures"
import { EmailAuthentication } from "../src/server/email-authentication"
import { EmailDelivery } from "../src/server/email-delivery"
import { RelaySecrets } from "../src/server/settings"
import { EmailAuthenticationRejected } from "../src/shared/email-authentication"
import { encode } from "../src/shared/base64"

let directory = await mkdtemp(join(tmpdir(), "alkalye-email-"))
let recovery = Redacted.make(encode(new Uint8Array(32).fill(31)))
let otherRecovery = Redacted.make(encode(new Uint8Array(32).fill(32)))
let masterKey = encode(new Uint8Array(32).fill(33))
let identity = await Effect.runPromise(
	Signatures.use(signatures => signatures.account(recovery)).pipe(
		Effect.provide(Signatures.layer),
	),
)
let other = await Effect.runPromise(
	Signatures.use(signatures => signatures.account(otherRecovery)).pipe(
		Effect.provide(Signatures.layer),
	),
)
let origin = "https://alkalye.example"
let browser = Redacted.make("browser-secret-1")
let codes = new Map<string, Redacted.Redacted<string>>()
let deliveries: { email: string; id: string }[] = []
afterAll(() => rm(directory, { recursive: true, force: true }))
let delivery = {
	enabled: true,
	send(email: string, code: Redacted.Redacted<string>, id: string) {
		codes.set(id, code)
		deliveries.push({ email, id })
		return Effect.void
	},
}
function fixture<A, E>(
	name: string,
	work: Effect.Effect<A, E, EmailAuthentication | TestClock.TestClock>,
	transport: Context.Service.Shape<typeof EmailDelivery> = delivery,
) {
	return Effect.runPromise(
		work.pipe(
			Effect.provide(
				emailAuthenticationLayer(join(directory, name + ".sqlite")).pipe(
					Layer.provide(
						Layer.mergeAll(
							Cipher.live,
							Layer.succeed(RelaySecrets, { masterKey }),
							Layer.succeed(EmailDelivery, transport),
						),
					),
				),
			),
			Effect.provide(TestClock.layer()),
		),
	)
}
function code(id: string) {
	let value = codes.get(id)
	if (!value) throw new Error("Missing test code")
	return value
}
function link(address = "person@example.com") {
	return Effect.gen(function* () {
		let emails = yield* EmailAuthentication
		let challenge = yield* emails.requestLink(
			address,
			origin,
			identity.subject,
			recovery,
			browser,
		)
		return yield* emails.verifyLink(
			challenge.id,
			code(challenge.id),
			origin,
			identity.subject,
			browser,
		)
	})
}
function failed<A, E, R>(work: Effect.Effect<A, E, R>) {
	return work.pipe(
		Effect.result,
		Effect.tap(result =>
			Effect.sync(() => expect(result._tag).toBe("Failure")),
		),
	)
}

test("email links existing signing identity; recovery escrow is encrypted and survives process restart", async () => {
	await fixture(
		"restart",
		Effect.gen(function* () {
			expect((yield* link("Person@Example.com")).email).toBe(
				"person@example.com",
			)
			let emails = yield* EmailAuthentication
			expect(yield* emails.status(identity.subject)).toEqual({
				enabled: true,
				email: "person@example.com",
			})
		}),
	)
	let database = new Database(join(directory, "restart.sqlite"), {
		readonly: true,
	})
	let ciphertext = database
		.query<{ recovery: string }, []>("SELECT recovery FROM email_accounts")
		.get()?.recovery
	expect(ciphertext).not.toContain(Redacted.value(recovery))
	database.close()
	await fixture(
		"restart",
		Effect.gen(function* () {
			let emails = yield* EmailAuthentication
			yield* TestClock.adjust("61 seconds")
			let challenge = yield* emails.requestSignIn(
				"PERSON@example.com",
				origin,
				browser,
			)
			expect(
				(yield* emails.verifySignIn(
					challenge.id,
					code(challenge.id),
					origin,
					browser,
				)).recovery,
			).toBe(Redacted.value(recovery))
			yield* failed(
				emails.verifySignIn(challenge.id, code(challenge.id), origin, browser),
			)
		}),
	)
})
test("challenge is browser, origin, purpose and current signed account bound without consuming the valid attempt", () =>
	fixture(
		"contexts",
		Effect.gen(function* () {
			let emails = yield* EmailAuthentication
			let challenge = yield* emails.requestLink(
				"context@example.com",
				origin,
				identity.subject,
				recovery,
				browser,
			)
			yield* failed(
				emails.verifyLink(
					challenge.id,
					code(challenge.id),
					origin,
					other.subject,
					browser,
				),
			)
			yield* failed(
				emails.verifyLink(
					challenge.id,
					code(challenge.id),
					"https://evil.example",
					identity.subject,
					browser,
				),
			)
			yield* failed(
				emails.verifyLink(
					challenge.id,
					code(challenge.id),
					origin,
					identity.subject,
					Redacted.make("another-browser"),
				),
			)
			yield* failed(
				emails.verifySignIn(challenge.id, code(challenge.id), origin, browser),
			)
			expect(
				(yield* emails.verifyLink(
					challenge.id,
					code(challenge.id),
					origin,
					identity.subject,
					browser,
				)).email,
			).toBe("context@example.com")
			yield* failed(
				emails.requestLink(
					"attacker@example.com",
					origin,
					identity.subject,
					otherRecovery,
					browser,
				),
			)
		}),
	))
test("five failed guesses stay committed; challenges expire exactly at five minutes", () =>
	fixture(
		"expiry-attempts",
		Effect.gen(function* () {
			let emails = yield* EmailAuthentication
			let challenge = yield* emails.requestLink(
				"attempts@example.com",
				origin,
				identity.subject,
				recovery,
				browser,
			)
			let wrong = Redacted.make(
				Redacted.value(code(challenge.id)) === "00000000"
					? "99999999"
					: "00000000",
			)
			for (let index = 0; index < 5; index++)
				yield* failed(
					emails.verifyLink(
						challenge.id,
						wrong,
						origin,
						identity.subject,
						browser,
					),
				)
			yield* failed(
				emails.verifyLink(
					challenge.id,
					code(challenge.id),
					origin,
					identity.subject,
					browser,
				),
			)
			yield* TestClock.adjust("61 seconds")
			let expired = yield* emails.requestLink(
				"expiry@example.com",
				origin,
				identity.subject,
				recovery,
				browser,
			)
			yield* TestClock.adjust("5 minutes")
			yield* failed(
				emails.verifyLink(
					expired.id,
					code(expired.id),
					origin,
					identity.subject,
					browser,
				),
			)
		}),
	))
test("per-email cooldown and hourly guess budget cover all purposes and challenge IDs", () =>
	fixture(
		"limits",
		Effect.gen(function* () {
			let emails = yield* EmailAuthentication
			let first = yield* emails.requestLink(
				"limits@example.com",
				origin,
				identity.subject,
				recovery,
				browser,
			)
			yield* failed(emails.requestSignIn("LIMITS@example.com", origin, browser))
			for (let turn = 0; turn < 2; turn++) {
				let challenge =
					turn === 0
						? first
						: yield* emails.requestLink(
								"limits@example.com",
								origin,
								identity.subject,
								recovery,
								browser,
							)
				let wrong = Redacted.make(
					Redacted.value(code(challenge.id)) === "00000000"
						? "99999999"
						: "00000000",
				)
				for (let index = 0; index < 5; index++)
					yield* failed(
						emails.verifyLink(
							challenge.id,
							wrong,
							origin,
							identity.subject,
							browser,
						),
					)
				yield* TestClock.adjust("61 seconds")
			}
			let blocked = yield* emails.requestLink(
				"limits@example.com",
				origin,
				identity.subject,
				recovery,
				browser,
			)
			yield* failed(
				emails.verifyLink(
					blocked.id,
					code(blocked.id),
					origin,
					identity.subject,
					browser,
				),
			)
			yield* TestClock.adjust("61 minutes")
			let fresh = yield* emails.requestLink(
				"limits@example.com",
				origin,
				identity.subject,
				recovery,
				browser,
			)
			expect(
				(yield* emails.verifyLink(
					fresh.id,
					code(fresh.id),
					origin,
					identity.subject,
					browser,
				)).email,
			).toBe("limits@example.com")
		}),
	))
test("concurrent consume yields one success; another account cannot claim an existing email", () =>
	fixture(
		"race",
		Effect.gen(function* () {
			let emails = yield* EmailAuthentication
			let challenge = yield* emails.requestLink(
				"race@example.com",
				origin,
				identity.subject,
				recovery,
				browser,
			)
			let results = yield* Effect.all(
				[
					emails
						.verifyLink(
							challenge.id,
							code(challenge.id),
							origin,
							identity.subject,
							browser,
						)
						.pipe(Effect.result),
					emails
						.verifyLink(
							challenge.id,
							code(challenge.id),
							origin,
							identity.subject,
							browser,
						)
						.pipe(Effect.result),
				],
				{ concurrency: "unbounded" },
			)
			expect(results.filter(result => result._tag === "Success")).toHaveLength(
				1,
			)
			yield* TestClock.adjust("61 seconds")
			let stolen = yield* emails.requestLink(
				"race@example.com",
				origin,
				other.subject,
				otherRecovery,
				browser,
			)
			yield* failed(
				emails.verifyLink(
					stolen.id,
					code(stolen.id),
					origin,
					other.subject,
					browser,
				),
			)
			expect((yield* emails.status(identity.subject)).email).toBe(
				"race@example.com",
			)
			expect((yield* emails.status(other.subject)).email).toBeNull()
		}),
	))
test("unknown emails receive the same request response and delivery; codes cannot restore an account", () =>
	fixture(
		"unknown",
		Effect.gen(function* () {
			let emails = yield* EmailAuthentication
			let challenge = yield* emails.requestSignIn(
				"unknown@example.com",
				origin,
				browser,
			)
			expect(challenge.expires).toBe(300000)
			expect(deliveries.at(-1)?.email).toBe("unknown@example.com")
			yield* failed(
				emails.verifySignIn(challenge.id, code(challenge.id), origin, browser),
			)
		}),
	))
test("provider failure and interruption invalidate pending codes and retain abuse limits", async () => {
	await fixture(
		"provider-failure",
		Effect.gen(function* () {
			let emails = yield* EmailAuthentication
			yield* failed(emails.requestSignIn("failed@example.com", origin, browser))
			yield* failed(emails.requestSignIn("failed@example.com", origin, browser))
		}),
		{
			enabled: true,
			send: () =>
				Effect.fail(
					new EmailAuthenticationRejected({ message: "Unavailable" }),
				),
		},
	)
	let database = new Database(join(directory, "provider-failure.sqlite"), {
		readonly: true,
	})
	expect(
		database
			.query<{ count: number }, []>(
				"SELECT count(*) AS count FROM email_challenges",
			)
			.get()?.count,
	).toBe(0)
	database.close()
	let started = await Effect.runPromise(Deferred.make<void>())
	await fixture(
		"provider-interrupt",
		Effect.gen(function* () {
			let emails = yield* EmailAuthentication
			let fiber = yield* Effect.forkChild(
				emails.requestSignIn("interrupted@example.com", origin, browser),
			)
			yield* Deferred.await(started)
			yield* Fiber.interrupt(fiber)
		}),
		{
			enabled: true,
			send: () =>
				Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
		},
	)
	database = new Database(join(directory, "provider-interrupt.sqlite"), {
		readonly: true,
	})
	expect(
		database
			.query<{ count: number }, []>(
				"SELECT count(*) AS count FROM email_challenges",
			)
			.get()?.count,
	).toBe(0)
	database.close()
})

test("unlink removes escrow and invalidates pending sign-in without changing signing identity", () =>
	fixture(
		"unlink",
		Effect.gen(function* () {
			let emails = yield* EmailAuthentication
			yield* link("unlink@example.com")
			yield* TestClock.adjust("61 seconds")
			let challenge = yield* emails.requestSignIn(
				"unlink@example.com",
				origin,
				browser,
			)
			let pending = yield* emails.requestLink(
				"pending-unlink@example.com",
				origin,
				identity.subject,
				recovery,
				browser,
			)
			yield* emails.unlink(identity.subject)
			yield* failed(
				emails.verifyLink(
					pending.id,
					code(pending.id),
					origin,
					identity.subject,
					browser,
				),
			)
			expect((yield* emails.status(identity.subject)).email).toBeNull()
			yield* failed(
				emails.verifySignIn(challenge.id, code(challenge.id), origin, browser),
			)
		}),
	))
