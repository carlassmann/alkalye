import { expect, test } from "bun:test"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Redacted from "effect/Redacted"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { EmailDelivery } from "../src/server/email-delivery"

let configuration = {
	NODE_ENV: "test",
	RESEND_API_KEY: "re_test_fixture",
	EMAIL_FROM: "Alkalye <login@example.com>",
}
function nativeFetch(
	work: (
		input: Parameters<typeof fetch>[0],
		options?: Parameters<typeof fetch>[1],
	) => Promise<Response>,
): typeof fetch {
	return Object.assign(work, { preconnect: fetch.preconnect })
}
function fixture<A, E>(
	work: Effect.Effect<A, E, EmailDelivery>,
	transport: typeof fetch,
	config: Record<string, string> = configuration,
) {
	return Effect.runPromise(
		work.pipe(
			Effect.provide(EmailDelivery.layer),
			Effect.provideService(
				ConfigProvider.ConfigProvider,
				ConfigProvider.fromUnknown(config),
			),
			Effect.provideService(FetchHttpClient.Fetch, transport),
		),
	)
}
test("Resend adapter uses authorized idempotent request and consumes validated response without leaking errors", async () => {
	let request: Request | undefined
	let response = new Response(JSON.stringify({ id: "email-1" }))
	await fixture(
		EmailDelivery.use(delivery =>
			delivery.send(
				"person@example.com",
				Redacted.make("12345678"),
				"challenge-1",
			),
		),
		nativeFetch(async (input, options) => {
			request = new Request(input, options)
			return response
		}),
	)
	expect(request?.url).toBe("https://api.resend.com/emails")
	expect(request?.headers.get("authorization")).toBe("Bearer re_test_fixture")
	expect(request?.headers.get("idempotency-key")).toBe("challenge-1")
	expect(response.bodyUsed).toBe(true)
	for (let result of [
		new Response(JSON.stringify({ secret: "provider-secret-details" }), {
			status: 503,
		}),
		new Response("not-json"),
		new Response(JSON.stringify({ missing: "id" })),
	]) {
		let error = await fixture(
			EmailDelivery.use(delivery =>
				delivery.send(
					"person@example.com",
					Redacted.make("12345678"),
					"challenge-2",
				),
			).pipe(Effect.result),
			nativeFetch(async () => result),
		)
		expect(error._tag).toBe("Failure")
		if (error._tag === "Failure") {
			expect(error.failure.message).toBe(
				"Email is temporarily unavailable; try again shortly",
			)
			expect(JSON.stringify(error.failure)).not.toContain(
				"provider-secret-details",
			)
		}
		expect(result.bodyUsed).toBe(true)
	}
})
test("interrupting delivery aborts provider transport and closes the Effect scope", async () => {
	let started = await Effect.runPromise(Deferred.make<void>())
	let aborted = false
	await fixture(
		Effect.scoped(
			Effect.gen(function* () {
				let delivery = yield* EmailDelivery
				let fiber = yield* Effect.forkScoped(
					delivery.send(
						"person@example.com",
						Redacted.make("12345678"),
						"challenge-interrupt",
					),
				)
				yield* Deferred.await(started)
				yield* Fiber.interrupt(fiber)
			}),
		),
		nativeFetch(
			(_input, options) =>
				new Promise((_resolve, reject) => {
					options?.signal?.addEventListener(
						"abort",
						() => {
							aborted = true
							reject(new Error("Transport aborted"))
						},
						{ once: true },
					)
					Deferred.doneUnsafe(started, Effect.void)
				}),
		),
	)
	expect(aborted).toBe(true)
})
test("unconfigured server disables email; test mailbox cannot be enabled in production", async () => {
	let touched = false
	let fetch = nativeFetch(async () => {
		touched = true
		return new Response("{}")
	})
	await fixture(
		EmailDelivery.use(delivery =>
			Effect.sync(() => expect(delivery.enabled).toBe(false)),
		),
		fetch,
		{ NODE_ENV: "test" },
	)
	expect(touched).toBe(false)
	let result = await fixture(
		EmailDelivery.pipe(Effect.asVoid, Effect.result),
		fetch,
		{
			NODE_ENV: "production",
			ALKALYE_TEST_EMAIL_MAILBOX: "/tmp/must-not-write",
		},
	).catch(error => error)
	expect(JSON.stringify(result)).toContain(
		"Test email mailbox cannot run in production",
	)
})
