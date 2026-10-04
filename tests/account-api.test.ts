import { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { Signatures } from "../src/platform/signatures"
import { startServer } from "../src/server/index"
import { AccountApi } from "../src/shared/account-api"
import {
	ChallengeSchema,
	LoginSchema,
	SessionSchema,
} from "../src/shared/authentication"
import type { Challenge } from "../src/shared/authentication"
import { encode } from "../src/shared/base64"

let directory = await mkdtemp(join(tmpdir(), "alkalye-account-api-"))
let instance: Effect.Success<ReturnType<typeof startServer>>
let identity = await Effect.runPromise(
	Signatures.use(signatures =>
		signatures.account(Redacted.make(encode(new Uint8Array(32).fill(71)))),
	).pipe(Effect.provide(Signatures.layer)),
)
let stranger = await Effect.runPromise(
	Signatures.use(signatures =>
		signatures.account(Redacted.make(encode(new Uint8Array(32).fill(72)))),
	).pipe(Effect.provide(Signatures.layer)),
)
beforeAll(async () => {
	instance = await Effect.runPromise(
		startServer({ port: 0, data: directory, build: false }),
	)
})
afterAll(async () => {
	await Effect.runPromise(instance.close())
	await rm(directory, { recursive: true, force: true })
})
function request(
	path: string,
	body?: unknown,
	headers?: HeadersInit,
	method = "POST",
) {
	return fetch(new URL(path, instance.server.url), {
		method,
		headers: { "content-type": "application/json", ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
}
async function challenge(
	purpose: "cookie" | "bearer",
	publicKey = identity.publicKey,
) {
	let response = await request(
		"/api/accounts/challenge",
		{ publicKey, purpose },
		{ origin: instance.server.url.origin },
	)
	expect(response.status).toBe(200)
	expect(response.headers.get("cache-control")).toBe("no-store")
	return Schema.decodeUnknownSync(ChallengeSchema)(await response.json())
}
async function proof(challenge: Challenge) {
	return {
		id: challenge.id,
		publicKey: identity.publicKey,
		signature: await Effect.runPromise(
			identity.signAuthentication(challenge, {
				origin: challenge.origin,
				purpose: challenge.purpose,
			}),
		),
	}
}
test("typed Effect client signs in to the real Bun server with an opaque bearer", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let client = yield* HttpApiClient.make(AccountApi, {
				baseUrl: instance.server.url,
			})
			let challenge = yield* client.authentication.challenge({
				payload: { publicKey: identity.publicKey, purpose: "bearer" },
			})
			let signature = yield* identity.signAuthentication(challenge, {
				origin: challenge.origin,
				purpose: challenge.purpose,
			})
			let login = yield* client.authentication.bearerLogin({
				payload: { id: challenge.id, publicKey: identity.publicKey, signature },
			})
			expect(login.subject).toBe(identity.subject)
			expect(login.token).toStartWith("alk_s_")
			let authenticated = yield* HttpApiClient.make(AccountApi, {
				baseUrl: instance.server.url,
				transformClient: client =>
					HttpClient.mapRequest(
						client,
						HttpClientRequest.bearerToken(Redacted.make(login.token)),
					),
			})
			expect(yield* authenticated.account.session()).toEqual({
				subject: login.subject,
				expires: login.expires,
			})
			yield* authenticated.account.logout()
			let rejected = yield* authenticated.account.session().pipe(Effect.result)
			expect(rejected._tag).toBe("Failure")
		}).pipe(Effect.provide(FetchHttpClient.layer)),
	)
})
test("browser receives only identity and an HttpOnly cookie, then cookie authenticates reads and logout", async () => {
	let issued = await challenge("cookie")
	let response = await request(
		"/api/accounts/browser-session",
		await proof(issued),
		{ origin: instance.server.url.origin },
	)
	expect(response.status).toBe(200)
	let session = await response.json()
	expect(session.subject).toBe(identity.subject)
	expect(session.expires).toBeGreaterThan(issued.expires)
	expect(Object.keys(session).sort()).toEqual(["expires", "subject"])
	let cookie = response.headers.get("set-cookie") ?? ""
	expect(cookie).toContain("HttpOnly")
	expect(cookie).toContain("SameSite=Strict")
	expect(cookie).toContain("Path=/")
	let current = await request(
		"/api/accounts/session",
		undefined,
		{ cookie },
		"GET",
	)
	expect(current.status).toBe(200)
	expect(
		Schema.decodeUnknownSync(SessionSchema)(await current.json()).subject,
	).toBe(identity.subject)
	let csrf = await request(
		"/api/accounts/session",
		undefined,
		{ cookie },
		"DELETE",
	)
	expect(csrf.status).toBe(401)
	let loggedOut = await request(
		"/api/accounts/session",
		undefined,
		{ cookie, origin: instance.server.url.origin },
		"DELETE",
	)
	expect(loggedOut.status).toBe(204)
	expect(loggedOut.headers.get("set-cookie")).toContain("Max-Age=0")
	expect(
		(await request("/api/accounts/session", undefined, { cookie }, "GET"))
			.status,
	).toBe(401)
})
test("a proof can be consumed once under concurrent requests", async () => {
	let signed = await proof(await challenge("bearer"))
	let responses = await Promise.all(
		Array.from({ length: 8 }, () =>
			request("/api/accounts/bearer-session", signed),
		),
	)
	expect(responses.map(response => response.status).sort()).toEqual([
		200, 401, 401, 401, 401, 401, 401, 401,
	])
})
test("proofs are bound to purpose and origin, not merely a signature", async () => {
	let bearer = await proof(await challenge("bearer"))
	expect(
		(
			await request("/api/accounts/browser-session", bearer, {
				origin: instance.server.url.origin,
			})
		).status,
	).toBe(401)
	expect((await request("/api/accounts/bearer-session", bearer)).status).toBe(
		200,
	)
	let cookie = await proof(await challenge("cookie"))
	expect((await request("/api/accounts/bearer-session", cookie)).status).toBe(
		401,
	)
	expect((await request("/api/accounts/browser-session", cookie)).status).toBe(
		401,
	)
	expect(
		(
			await request("/api/accounts/browser-session", cookie, {
				origin: "https://stranger.example",
			})
		).status,
	).toBe(403)
	expect(
		(
			await request("/api/accounts/browser-session", cookie, {
				origin: instance.server.url.origin,
			})
		).status,
	).toBe(200)
})
test("an invalid signer cannot consume another account's valid challenge", async () => {
	let issued = await challenge("bearer")
	let forged = {
		id: issued.id,
		publicKey: identity.publicKey,
		signature: await Effect.runPromise(
			stranger.signAuthentication(
				{ ...issued, publicKey: stranger.publicKey },
				{ origin: issued.origin, purpose: issued.purpose },
			),
		),
	}
	expect((await request("/api/accounts/bearer-session", forged)).status).toBe(
		401,
	)
	expect(
		(await request("/api/accounts/bearer-session", await proof(issued))).status,
	).toBe(200)
})
test("malformed keys, signatures and forged request hosts fail before authentication", async () => {
	for (let publicKey of [
		"",
		identity.publicKey + "=",
		identity.publicKey.slice(0, -1) + "B",
	])
		expect(
			(
				await request("/api/accounts/challenge", {
					publicKey,
					purpose: "bearer",
				})
			).status,
		).toBe(400)
	let issued = await challenge("bearer")
	let signed = await proof(issued)
	let badSignature = signed.signature.slice(0, -1) + "B"
	expect(
		(
			await request("/api/accounts/bearer-session", {
				...signed,
				signature: badSignature,
			})
		).status,
	).toBe(400)
	let forged = await request(
		"/api/accounts/challenge",
		{ publicKey: identity.publicKey, purpose: "bearer" },
		{ host: "evil.example" },
	)
	expect(forged.status).toBe(401)
})
test("anonymous and arbitrary tokens never establish account identity", async () => {
	for (let headers of [
		new Headers(),
		new Headers({ authorization: "Bearer nobody" }),
		new Headers({ cookie: "alkalye-session=nobody" }),
	])
		expect(
			(await request("/api/accounts/session", undefined, headers, "GET"))
				.status,
		).toBe(401)
	let response = await request(
		"/api/accounts/bearer-session",
		await proof(await challenge("bearer")),
	)
	let login = Schema.decodeUnknownSync(LoginSchema)(await response.json())
	expect(login.subject).toBe(identity.subject)
})

test("small-order public keys cannot request or prove an account", async () => {
	let publicKey = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	let signature = "AQ" + "A".repeat(84)
	expect(
		(await request("/api/accounts/challenge", { publicKey, purpose: "bearer" }))
			.status,
	).toBe(400)
	let forged = await request("/api/accounts/bearer-session", {
		id: "3c485d6c-bdf7-4f46-96d6-6415d5b109aa",
		publicKey,
		signature,
	})
	expect(forged.status).toBe(400)
	let verified = await Effect.runPromise(
		Signatures.use(signatures =>
			signatures.verify(publicKey, "any proof", signature),
		).pipe(Effect.provide(Signatures.layer)),
	)
	expect(verified).toBe(false)
})
test("cookie authentication storage failures remain 503 and cannot fall back to anonymous 401", async () => {
	let issued = await challenge("cookie")
	let signedIn = await request(
		"/api/accounts/browser-session",
		await proof(issued),
		{ origin: instance.server.url.origin },
	)
	let cookie = signedIn.headers.get("set-cookie") ?? ""
	let database = new Database(join(directory, "accounts.sqlite"))
	try {
		database.run(
			"ALTER TABLE authentication_sessions RENAME TO unavailable_sessions",
		)
		let response = await request(
			"/api/accounts/session",
			undefined,
			{ cookie },
			"GET",
		)
		expect(response.status).toBe(503)
		expect(await response.json()).toEqual({
			_tag: "AuthenticationUnavailable",
			message: "Sign in is temporarily unavailable",
		})
		expect(response.headers.get("cache-control")).toBe("no-store")
	} finally {
		database.run(
			"ALTER TABLE unavailable_sessions RENAME TO authentication_sessions",
		)
		database.close()
	}
	expect(
		(await request("/api/accounts/session", undefined, { cookie }, "GET"))
			.status,
	).toBe(200)
})
test("HTTPS public origin uses a host-only secure cookie through the HTTP reverse-proxy hop", async () => {
	let data = await mkdtemp(join(tmpdir(), "alkalye-https-account-"))
	let server = await Effect.runPromise(
		startServer({
			port: 0,
			data,
			build: false,
			publicOrigin: "https://app.example",
		}),
	)
	async function proxy(path: string, body?: unknown, cookie?: string) {
		return fetch(new URL(path, server.server.url), {
			method: body ? "POST" : "GET",
			headers: {
				"content-type": "application/json",
				host: "app.example",
				origin: "https://app.example",
				...(cookie ? { cookie } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		})
	}
	try {
		let issued = Schema.decodeUnknownSync(ChallengeSchema)(
			await (
				await proxy("/api/accounts/challenge", {
					publicKey: identity.publicKey,
					purpose: "cookie",
				})
			).json(),
		)
		let signature = await Effect.runPromise(
			identity.signAuthentication(issued, {
				origin: "https://app.example",
				purpose: "cookie",
			}),
		)
		let login = await proxy("/api/accounts/browser-session", {
			id: issued.id,
			publicKey: identity.publicKey,
			signature,
		})
		expect(login.status).toBe(200)
		let cookie = login.headers.get("set-cookie") ?? ""
		expect(cookie).toStartWith("__Host-alkalye-session=")
		expect(cookie).toContain("Secure")
		expect(cookie).toContain("HttpOnly")
		expect(cookie).not.toContain("Domain=")
		expect(
			(await proxy("/api/accounts/session", undefined, cookie)).status,
		).toBe(200)
		expect(
			(
				await proxy(
					"/api/accounts/session",
					undefined,
					cookie.replace("__Host-", ""),
				)
			).status,
		).toBe(401)
	} finally {
		await Effect.runPromise(server.close())
		await rm(data, { recursive: true, force: true })
	}
})

test("automatic browser login cannot replace another live account cookie; explicit replacement is transactional", async () => {
	let issued = await challenge("cookie")
	let first = await request(
		"/api/accounts/browser-session",
		await proof(issued),
		{ origin: instance.server.url.origin },
	)
	expect(first.status).toBe(200)
	let cookie = first.headers.get("set-cookie") ?? ""
	let another = await challenge("cookie", stranger.publicKey)
	let signature = await Effect.runPromise(
		stranger.signAuthentication(another, {
			origin: another.origin,
			purpose: "cookie",
		}),
	)
	let signed = { id: another.id, publicKey: stranger.publicKey, signature }
	let refused = await request("/api/accounts/browser-session", signed, {
		origin: instance.server.url.origin,
		cookie,
	})
	expect(refused.status).toBe(409)
	expect((await refused.json())._tag).toBe("AccountChanged")
	expect(refused.headers.get("set-cookie")).toBeNull()
	let current = await request(
		"/api/accounts/session",
		undefined,
		{ cookie },
		"GET",
	)
	expect((await current.json()).subject).toBe(identity.subject)
	let replaced = await request(
		"/api/accounts/browser-session",
		{ ...signed, replace: true },
		{ origin: instance.server.url.origin, cookie },
	)
	expect(replaced.status).toBe(200)
	expect((await replaced.json()).subject).toBe(stranger.subject)
	expect(
		(await request("/api/accounts/session", undefined, { cookie }, "GET"))
			.status,
	).toBe(401)
	let nextCookie = replaced.headers.get("set-cookie") ?? ""
	expect(
		(
			await request(
				"/api/accounts/session",
				undefined,
				{ cookie: nextCookie },
				"GET",
			)
		).status,
	).toBe(200)
	expect(
		(
			await request(
				"/api/accounts/browser-session",
				{ ...signed, replace: true },
				{ origin: instance.server.url.origin, cookie: nextCookie },
			)
		).status,
	).toBe(401)
})
