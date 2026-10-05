import type { Server, ServerWebSocket } from "bun"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Cookies from "effect/http/Cookies"
import { Cipher } from "../platform/cipher"
import { sessionCookie } from "../shared/authentication"
import { LiveClientMessageSchema } from "../shared/document-live"
import type { LivePresence, LiveServerMessage } from "../shared/document-live"
import { presentationPresence } from "./presentation-presence"
import { Identity } from "../shared/workspace"
import type { Connection } from "./application"
import { WorkspaceStore } from "./document-store"
import { Sessions } from "./sessions"

export interface LiveConnection {
	session: string
	subject: string
	actor: string
	documents: Set<string>
	presence: Map<string, LivePresence>
	lastPresence: number
}
export function makeDocumentLive() {
	return Effect.gen(function* () {
		let sessions = yield* Sessions
		let store = yield* WorkspaceStore
		let cipher = yield* Cipher
		let clients = new Set<ServerWebSocket<Connection>>()
		let changes = yield* store.changes
		yield* Stream.fromSubscription(changes).pipe(
			Stream.runForEach(subject =>
				Effect.forEach(
					clients,
					socket =>
						authorize(socket).pipe(
							Effect.flatMap(() =>
								Effect.gen(function* () {
									let live = socket.data.live
									if (!live) return
									if (subject !== undefined) {
										if (subject === live.subject)
											send(socket, { type: "preferences" })
										return
									}
									for (let document of live.documents) {
										let allowed = yield* canRead(live, document)
										if (!allowed) {
											live.documents.delete(document)
											live.presence.delete(document)
											send(socket, { type: "unavailable", document })
										}
									}
									send(socket, { type: "advanced" })
								}),
							),
							Effect.catchCause(() =>
								Effect.sync(() => socket.close(1008, "Sign in again")),
							),
						),
					{ concurrency: 8, discard: true },
				),
			),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				for (let socket of clients) socket.close(1001, "Server restarting")
				clients.clear()
			}),
		)
		return { upgrade, open, message, close }
		function upgrade(
			request: Request,
			server: Server<Connection>,
			origin: string,
		) {
			return Effect.gen(function* () {
				let url = new URL(request.url)
				let cookies = Cookies.parseHeader(request.headers.get("cookie") ?? "")
				let token =
					cookies[
						origin.startsWith("https:")
							? "__Host-" + sessionCookie
							: sessionCookie
					] ?? ""
				let account = yield* sessions.authenticate(
					Redacted.make(token),
					"cookie",
				)
				if (url.searchParams.get("account") !== account.subject)
					return new Response("Account changed", { status: 409 })
				let actor = yield* cipher.uuid()
				if (
					server.upgrade(request, {
						data: {
							live: {
								session: account.session,
								subject: account.subject,
								actor,
								documents: new Set(),
								presence: new Map(),
								lastPresence: 0,
							},
						},
					})
				)
					return
				return new Response("WebSocket required", { status: 426 })
			}).pipe(
				Effect.catchCause(() =>
					Effect.succeed(new Response("Sign in required", { status: 401 })),
				),
			)
		}
		function open(socket: ServerWebSocket<Connection>) {
			let live = socket.data.live
			if (!live) return
			clients.add(socket)
			send(socket, { type: "connected", actor: live.actor })
		}
		function message(
			socket: ServerWebSocket<Connection>,
			input: string | Buffer,
		) {
			return Effect.gen(function* () {
				if (input.length > 8192)
					return socket.close(1009, "Live message too large")
				let message = yield* Schema.decodeUnknownEffect(
					Schema.fromJsonString(LiveClientMessageSchema),
				)(String(input))
				let live = yield* authorize(socket)
				let document =
					message.type === "presence"
						? message.presence.document
						: message.document
				if (message.type === "unwatch") {
					live.documents.delete(document)
					live.presence.delete(document)
					yield* broadcast(socket, document, {
						type: "gone",
						document,
						actor: live.actor,
					})
					return
				}
				let role = yield* accessRole(live, document)
				if (!role) {
					send(socket, { type: "unavailable", document })
					return
				}
				if (message.type === "watch") {
					if (live.documents.size >= 32 && !live.documents.has(document))
						return socket.close(1008, "Too many open documents")
					live.documents.add(document)
					for (let peer of clients) {
						let presence = peer.data.live?.presence.get(document)
						if (peer !== socket && presence)
							send(socket, {
								type: "presence",
								presence: {
									...presence,
									own: peer.data.live?.subject === live.subject,
								},
							})
					}
					return
				}
				if (!live.documents.has(document)) return
				let now = yield* Clock.currentTimeMillis
				if (now - live.lastPresence < 40) return
				live.lastPresence = now
				let presence = {
					...presentationPresence(message.presence, role, now),
					actor: live.actor,
					time: now,
				}
				live.presence.set(document, presence)
				yield* broadcast(socket, document, { type: "presence", presence })
			}).pipe(
				Effect.catchCause(() =>
					Effect.sync(() => socket.close(1008, "Live access unavailable")),
				),
			)
		}
		function close(socket: ServerWebSocket<Connection>) {
			clients.delete(socket)
			let live = socket.data.live
			return live
				? Effect.forEach(
						live.documents,
						document =>
							broadcast(socket, document, {
								type: "gone",
								document,
								actor: live.actor,
							}),
						{ discard: true },
					)
				: Effect.void
		}
		function authorize(socket: ServerWebSocket<Connection>) {
			return Effect.gen(function* () {
				let live = socket.data.live
				if (!live) return yield* Effect.fail(new Error("Not a live connection"))
				let current = yield* sessions.current(live.session)
				if (current.subject !== live.subject)
					return yield* Effect.fail(new Error("Account changed"))
				return live
			})
		}
		function accessRole(live: LiveConnection, document: string) {
			return store.accessRole(document, live.subject).pipe(
				Effect.provideService(Identity, { subject: live.subject, actors: [] }),
				Effect.catchTag("ResourceUnavailable", () => Effect.succeed(undefined)),
			)
		}
		function canRead(live: LiveConnection, document: string) {
			return accessRole(live, document).pipe(
				Effect.map(role => role !== undefined),
			)
		}
		function broadcast(
			sender: ServerWebSocket<Connection>,
			document: string,
			message: LiveServerMessage,
		) {
			return Effect.forEach(
				clients,
				peer => {
					let live = peer.data.live
					if (peer === sender || !live?.documents.has(document))
						return Effect.void
					// Whether a peer shares the account is told per recipient, so
					// presence never reveals other accounts' identities.
					let delivered =
						message.type === "presence"
							? {
									...message,
									presence: {
										...message.presence,
										own: live.subject === sender.data.live?.subject,
									},
								}
							: message
					return authorize(peer).pipe(
						Effect.andThen(canRead(live, document)),
						Effect.tap(allowed =>
							Effect.sync(() => {
								if (allowed) send(peer, delivered)
							}),
						),
						Effect.catchCause(() =>
							Effect.sync(() => peer.close(1008, "Live access unavailable")),
						),
					)
				},
				{ concurrency: 8, discard: true },
			)
		}
		function send(
			socket: ServerWebSocket<Connection>,
			message: LiveServerMessage,
		) {
			if (socket.send(JSON.stringify(message)) === 0)
				socket.close(1013, "Reconnect")
		}
	})
}
