import { expect } from "bun:test"
import { createConnection } from "node:net"
import type { Socket } from "node:net"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { Signatures } from "../src/platform/signatures"
import { ChallengeSchema } from "../src/shared/authentication"
import { encode } from "../src/shared/base64"

export interface LiveLogin {
	base: URL
	subject: string
	cookie: string
}
export interface LivePeerFixture {
	inbox: LiveMessage[]
	send: (message: unknown) => void
	until: (match: (message: LiveMessage) => boolean) => Promise<LiveMessage>
	close: () => void
}
export type LiveMessage = Record<string, unknown> & { type: string }

export async function cookieLogin(base: URL, seed: number): Promise<LiveLogin> {
	let identity = await Effect.runPromise(
		Signatures.use(signatures =>
			signatures.account(Redacted.make(encode(new Uint8Array(32).fill(seed)))),
		).pipe(Effect.provide(Signatures.layer)),
	)
	let issued = await post(base, "/api/accounts/challenge", {
		publicKey: identity.publicKey,
		purpose: "cookie",
	})
	let challenge = Schema.decodeUnknownSync(ChallengeSchema)(await issued.json())
	let signature = await Effect.runPromise(
		identity.signAuthentication(challenge, {
			origin: base.origin,
			purpose: "cookie",
		}),
	)
	let login = await post(base, "/api/accounts/browser-session", {
		id: challenge.id,
		publicKey: identity.publicKey,
		signature,
	})
	expect(login.status).toBe(200)
	let cookie = login.headers.get("set-cookie")?.split(";")[0] ?? ""
	return { base, subject: identity.subject, cookie }
}

export function livePoll(login: LiveLogin) {
	let session: string | undefined
	let inbox: LiveMessage[] = []
	return {
		session: () => session,
		inbox,
		request,
		async open() {
			let response = await request("/api/live/poll", {
				account: login.subject,
			})
			expect(response.status).toBe(200)
			let body: { session: string; messages: LiveMessage[] } =
				await response.json()
			session = body.session
			inbox.push(...body.messages)
			return session
		},
		async poll(signal?: AbortSignal) {
			let response = await request(
				"/api/live/poll",
				{ account: login.subject, session },
				signal,
			)
			if (response.status !== 200) return response.status
			let body: { messages: LiveMessage[] } = await response.json()
			inbox.push(...body.messages)
			return body.messages
		},
		async until(match: (message: LiveMessage) => boolean, timeout = 5000) {
			let deadline = Date.now() + timeout
			while (true) {
				let index = inbox.findIndex(match)
				let found = index >= 0 ? inbox.splice(index, 1)[0] : undefined
				if (found) return found
				if (Date.now() > deadline) throw new Error("No matching live message")
				let status = await this.poll()
				if (typeof status === "number")
					throw new Error("Live poll failed: " + status)
			}
		},
		async send(messages: unknown[]) {
			let response = await request("/api/live/send", {
				account: login.subject,
				session,
				messages,
			})
			return response.status
		},
		async close() {
			let response = await request("/api/live/close", {
				account: login.subject,
				session,
			})
			return response.status
		},
	}
	function request(path: string, body: unknown, signal?: AbortSignal) {
		return fetch(new URL(path, login.base), {
			method: "POST",
			headers: {
				origin: login.base.origin,
				cookie: login.cookie,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
			signal,
		})
	}
}

// Bun's WebSocket client cannot send cookies, so this speaks the protocol's
// few frames the live channel uses: short unmasked text from the server.
export function liveSocket(login: LiveLogin) {
	let { base, subject, cookie } = login
	return new Promise<LivePeerFixture & { next: () => Promise<unknown> }>(
		(resolve, reject) => {
			let buffer = Buffer.alloc(0)
			let upgraded = false
			let queued: LiveMessage[] = []
			let waiting: ((message: LiveMessage) => void)[] = []
			let socket: Socket = createConnection(
				{ host: base.hostname, port: Number(base.port) },
				() =>
					socket.write(
						[
							`GET /api/live?account=${encodeURIComponent(subject)} HTTP/1.1`,
							`Host: ${base.host}`,
							`Origin: ${base.origin}`,
							`Cookie: ${cookie}`,
							"Connection: Upgrade",
							"Upgrade: websocket",
							"Sec-WebSocket-Version: 13",
							"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
							"",
							"",
						].join("\r\n"),
					),
			)
			socket.on("error", reject)
			socket.on("data", (bytes: Buffer) => {
				buffer = Buffer.concat([buffer, bytes])
				if (!upgraded) {
					let end = buffer.indexOf("\r\n\r\n")
					if (end < 0) return
					let head = buffer.subarray(0, end).toString()
					if (!head.includes(" 101 ")) return reject(new Error(head))
					upgraded = true
					buffer = buffer.subarray(end + 4)
					resolve({
						inbox: queued,
						send,
						next,
						until,
						close: () => socket.destroy(),
					})
				}
				while (buffer.length >= 2) {
					let length = buffer.readUInt8(1) & 0x7f
					let offset = 2
					if (length === 126) {
						if (buffer.length < 4) return
						length = buffer.readUInt16BE(2)
						offset = 4
					}
					if (buffer.length < offset + length) return
					let payload = buffer.subarray(offset, offset + length).toString()
					let opcode = buffer.readUInt8(0) & 0x0f
					buffer = buffer.subarray(offset + length)
					if (opcode !== 1) continue
					let message: LiveMessage = JSON.parse(payload)
					let waiter = waiting.shift()
					if (waiter) waiter(message)
					else queued.push(message)
				}
			})
			function send(message: unknown) {
				let payload = Buffer.from(JSON.stringify(message))
				let header =
					payload.length < 126
						? Buffer.from([0x81, 0x80 | payload.length])
						: Buffer.from([
								0x81,
								0x80 | 126,
								payload.length >> 8,
								payload.length & 0xff,
							])
				// A zero mask leaves the payload unchanged.
				socket.write(
					Buffer.concat([header, Buffer.from([0, 0, 0, 0]), payload]),
				)
			}
			function next() {
				let message = queued.shift()
				if (message) return Promise.resolve(message)
				return new Promise<LiveMessage>((resolve, reject) => {
					let timeout = setTimeout(
						() => reject(new Error("No live message")),
						5000,
					)
					waiting.push(message => {
						clearTimeout(timeout)
						resolve(message)
					})
				})
			}
			async function until(match: (message: LiveMessage) => boolean) {
				while (true) {
					let message = await next()
					if (match(message)) return message
				}
			}
		},
	)
}

function post(base: URL, path: string, body: unknown) {
	return fetch(new URL(path, base), {
		method: "POST",
		headers: { origin: base.origin, "content-type": "application/json" },
		body: JSON.stringify(body),
	})
}
