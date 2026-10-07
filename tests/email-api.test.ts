import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Redacted from "effect/Redacted"
import { TestClock } from "effect/testing"
import * as Schema from "effect/Schema"
import { Signatures } from "../src/platform/signatures"
import { BunServer, serverLayer } from "../src/server/index"
import { ChallengeSchema } from "../src/shared/authentication"
import {
	EmailChallengeSchema,
	RecoveryKeySchema,
} from "../src/shared/email-authentication"
import { encode } from "../src/shared/base64"

let directory = await mkdtemp(join(tmpdir(), "alkalye-email-api-"))
let mailbox = join(directory, "mailbox")
let recovery = encode(new Uint8Array(32).fill(59))
let identity = await Effect.runPromise(
	Signatures.use(signatures =>
		signatures.account(Redacted.make(recovery)),
	).pipe(Effect.provide(Signatures.layer)),
)
let runtime = ManagedRuntime.make(
	serverLayer({ port: 0, data: directory, build: false }).pipe(
		Layer.provideMerge(TestClock.layer()),
		Layer.provide(
			Layer.succeed(
				ConfigProvider.ConfigProvider,
				ConfigProvider.fromUnknown({
					NODE_ENV: "test",
					ALKALYE_TEST_EMAIL_MAILBOX: mailbox,
				}),
			),
		),
	),
)
let server: Effect.Success<typeof BunServer>
let cookie = ""
beforeAll(async () => {
	server = await runtime.runPromise(BunServer)
})
afterAll(async () => {
	await runtime.dispose()
	await rm(directory, { recursive: true, force: true })
})
function request(
	path: string,
	body?: unknown,
	headers: Record<string, string> = {},
	method = "POST",
) {
	return fetch(new URL(path, server.server.url), {
		method,
		headers: {
			origin: server.server.url.origin,
			"content-type": "application/json",
			...headers,
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	})
}
function responseCookie(response: Response) {
	return response.headers.get("set-cookie")?.split(";")[0] ?? ""
}
async function login() {
	let response = await request("/api/accounts/challenge", {
		publicKey: identity.publicKey,
		purpose: "cookie",
	})
	let challenge = Schema.decodeUnknownSync(ChallengeSchema)(
		await response.json(),
	)
	let signature = await Effect.runPromise(
		identity.signAuthentication(challenge, {
			origin: challenge.origin,
			purpose: "cookie",
		}),
	)
	response = await request("/api/accounts/browser-session", {
		id: challenge.id,
		publicKey: identity.publicKey,
		signature,
	})
	expect(response.status).toBe(200)
	cookie = responseCookie(response)
}
async function issued(response: Response) {
	expect(response.status).toBe(200)
	expect(response.headers.get("cache-control")).toBe("no-store")
	let challenge = Schema.decodeUnknownSync(EmailChallengeSchema)(
		await response.json(),
	)
	let email = Schema.decodeUnknownSync(
		Schema.Struct({ code: Schema.String, email: Schema.String }),
	)(await Bun.file(join(mailbox, challenge.id + ".json")).json())
	return { ...challenge, code: email.code, cookie: responseCookie(response) }
}
test("browser email enrollment preserves account and one-time sign-in requires requesting browser", async () => {
	await login()
	let availability = await request(
		"/api/accounts/email/availability",
		undefined,
		{},
		"GET",
	)
	expect(await availability.json()).toEqual({ enabled: true })
	let challenge = await issued(
		await request(
			"/api/accounts/email",
			{ email: "browser@example.com", recovery },
			{ cookie },
		),
	)
	let verify = { id: challenge.id, code: challenge.code }
	expect(
		(await request("/api/accounts/email/verify", verify, { cookie })).status,
	).toBe(400)
	expect(
		(
			await request("/api/accounts/email/verify", verify, {
				cookie: cookie + "; " + challenge.cookie,
			})
		).status,
	).toBe(200)
	expect(
		(
			await request("/api/accounts/email/verify", verify, {
				cookie: cookie + "; " + challenge.cookie,
			})
		).status,
	).toBe(400)
	await runtime.runPromise(TestClock.adjust("61 seconds"))
	let signIn = await issued(
		await request("/api/accounts/email/sign-in", {
			email: "browser@example.com",
		}),
	)
	let body = { id: signIn.id, code: signIn.code }
	expect(
		(await request("/api/accounts/email/sign-in/verify", body, { cookie: "" }))
			.status,
	).toBe(400)
	let response = await request("/api/accounts/email/sign-in/verify", body, {
		cookie: signIn.cookie,
	})
	expect(response.status).toBe(200)
	expect(response.headers.get("cache-control")).toBe("no-store")
	expect(
		Schema.decodeUnknownSync(Schema.Struct({ recovery: RecoveryKeySchema }))(
			await response.json(),
		).recovery,
	).toBe(recovery)
	expect(
		(
			await request("/api/accounts/email/sign-in/verify", body, {
				cookie: signIn.cookie,
			})
		).status,
	).toBe(400)
})
test("email endpoints reject missing or wrong origin, bearer credentials and recovery belonging to another account", async () => {
	let otherRecovery = encode(new Uint8Array(32).fill(60))
	expect(
		(
			await request(
				"/api/accounts/email",
				{ email: "other@example.com", recovery: otherRecovery },
				{ cookie },
			)
		).status,
	).toBe(400)
	expect(
		(
			await request(
				"/api/accounts/email/sign-in",
				{ email: "csrf@example.com" },
				{ origin: "https://evil.example" },
			)
		).status,
	).toBe(403)
	let noOrigin = await fetch(
		new URL("/api/accounts/email/sign-in", server.server.url),
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "csrf@example.com" }),
		},
	)
	expect(noOrigin.status).toBe(401)
	expect(
		(
			await request(
				"/api/accounts/email/availability",
				undefined,
				{ authorization: "Bearer anything" },
				"GET",
			)
		).status,
	).toBe(401)
	expect(
		(
			await request(
				"/api/accounts/email",
				undefined,
				{ authorization: "Bearer anything" },
				"GET",
			)
		).status,
	).toBe(401)
})
test("unlink requires current browser account and stops further email sign-in", async () => {
	expect(
		(await request("/api/accounts/email", undefined, {}, "DELETE")).status,
	).toBe(401)
	expect(
		(await request("/api/accounts/email", undefined, { cookie }, "DELETE"))
			.status,
	).toBe(204)
	let response = await request(
		"/api/accounts/email",
		undefined,
		{ cookie },
		"GET",
	)
	expect(await response.json()).toEqual({ enabled: true, email: null })
})
