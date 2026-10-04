import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { Signatures } from "../src/platform/signatures"
import { ChallengeSchema } from "../src/shared/authentication"
import { encode } from "../src/shared/base64"
import { startServer } from "../src/server/index"

let origin = "https://alkalye.example"
let directory = await mkdtemp(join(tmpdir(), "alkalye-live-"))
let server: Effect.Success<ReturnType<typeof startServer>>
let cookie = ""
let subject = ""
beforeAll(async () => {
	server = await Effect.runPromise(
		startServer({
			port: 0,
			data: directory,
			publicOrigin: origin,
			build: false,
		}),
	)
	let identity = await Effect.runPromise(
		Signatures.use(signatures =>
			signatures.account(Redacted.make(encode(new Uint8Array(32).fill(93)))),
		).pipe(Effect.provide(Signatures.layer)),
	)
	subject = identity.subject
	let issued = await request("/api/accounts/challenge", {
		publicKey: identity.publicKey,
		purpose: "cookie",
	})
	let challenge = Schema.decodeUnknownSync(ChallengeSchema)(await issued.json())
	let signature = await Effect.runPromise(
		identity.signAuthentication(challenge, { origin, purpose: "cookie" }),
	)
	let login = await request("/api/accounts/browser-session", {
		id: challenge.id,
		publicKey: identity.publicKey,
		signature,
	})
	expect(login.status).toBe(200)
	cookie = login.headers.get("set-cookie")?.split(";")[0] ?? ""
	expect(cookie.startsWith("__Host-alkalye-session=")).toBe(true)
})
afterAll(async () => {
	await Effect.runPromise(server.close())
	await rm(directory, { recursive: true, force: true })
})
test("live upgrades use the secure cookie behind a TLS-terminating proxy", async () => {
	expect(await handshake(subject, cookie)).toContain("101 Switching Protocols")
})
test("live upgrades reject a wrong account and a plain cookie under a secure public origin", async () => {
	expect(await handshake("another-account", cookie)).toContain("409")
	expect(await handshake(subject, cookie.replace("__Host-", ""))).toContain(
		"401",
	)
})
test("live upgrades require the application's exact Origin", async () => {
	expect(
		await handshake(subject, cookie, "https://unrelated.example"),
	).toContain("403")
})
function request(path: string, body: unknown) {
	return fetch(new URL(path, server.server.url), {
		method: "POST",
		headers: {
			origin,
			host: new URL(origin).host,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	})
}
function handshake(
	account: string,
	credential: string,
	requestOrigin = origin,
) {
	return new Promise<string>((resolve, reject) => {
		let response = ""
		let socket = createConnection(
			{ host: "127.0.0.1", port: Number(server.server.url.port) },
			() => {
				socket.write(
					[
						`GET /api/live?account=${encodeURIComponent(account)} HTTP/1.1`,
						`Host: ${new URL(origin).host}`,
						`Origin: ${requestOrigin}`,
						`Cookie: ${credential}`,
						"Connection: Upgrade",
						"Upgrade: websocket",
						"Sec-WebSocket-Version: 13",
						"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
						"",
						"",
					].join("\r\n"),
				)
			},
		)
		let timeout = setTimeout(
			() => socket.destroy(new Error("Live upgrade timed out")),
			3000,
		)
		socket.on("error", reject)
		socket.on("close", () => clearTimeout(timeout))
		socket.on("data", bytes => {
			response += bytes.toString()
			if (!response.includes("\r\n\r\n")) return
			resolve(response.slice(0, response.indexOf("\r\n\r\n")))
			socket.destroy()
		})
	})
}
