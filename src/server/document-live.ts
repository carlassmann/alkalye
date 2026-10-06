import type { Server, ServerWebSocket } from "bun"
import type * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FiberSet from "effect/FiberSet"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Redacted from "effect/Redacted"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as Cookies from "effect/http/Cookies"
import { Cipher } from "../platform/cipher"
import { promise } from "../platform/effects"
import { sessionCookie } from "../shared/authentication"
import {
	LiveClientMessageSchema,
	LiveCloseRequestSchema,
	LivePollRequestSchema,
	LiveSendRequestSchema,
} from "../shared/document-live"
import type {
	LiveClientMessage,
	LivePresence,
	LiveServerMessage,
} from "../shared/document-live"
import { presentationPresence } from "./presentation-presence"
import { Identity } from "../shared/workspace"
import type { Connection } from "./application"
import { WorkspaceStore } from "./document-store"
import { Sessions } from "./sessions"
import { RelaySettings } from "./settings"

export interface LiveConnection {
	session: string
	subject: string
	actor: string
	name: string
	documents: Set<string>
	presence: Map<string, LivePresence>
	lastPresence: Map<string, number>
}
// One participant in live sync, whether it speaks WebSocket or long polling,
// so access checks, presence and notifications are written once.
interface LivePeer {
	live: LiveConnection
	gate: Semaphore.Semaphore
	send: (message: LiveServerMessage) => void
	close: (code: number, reason: string) => void
}
interface PollSession {
	id: string
	peer: LivePeer
	queue: Queue.Queue<LiveServerMessage, Cause.Done>
	seen: number
	waiter: Deferred.Deferred<void> | undefined
}
class LiveRejected extends Data.TaggedError("LiveRejected")<{
	readonly status: number
	readonly message: string
}> {}

let maximumDocuments = 32
let pollQueueLimit = 256
let pollBodyLimit = 32_768
let pollSessionLimit = 2048
let pollSessionsPerLogin = 32

export function makeDocumentLive() {
	return Effect.gen(function* () {
		let sessions = yield* Sessions
		let store = yield* WorkspaceStore
		let cipher = yield* Cipher
		let pollWait = (yield* RelaySettings).livePollWait
		// A session is abandoned once its client misses two poll cycles.
		let pollAbandoned = 2 * pollWait + 5_000
		let run = yield* FiberSet.makeRuntime()
		let peers = new Set<LivePeer>()
		let sockets = new WeakMap<ServerWebSocket<Connection>, LivePeer>()
		let socketPeers = new Set<LivePeer>()
		let heartbeatSent = yield* Clock.currentTimeMillis
		let polls = new Map<string, PollSession>()
		let changes = yield* store.changes
		yield* Stream.fromSubscription(changes).pipe(
			Stream.runForEach(notice =>
				Effect.forEach(
					[...peers].filter(
						peer =>
							notice.subjects.has(peer.live.subject) ||
							(notice.kind === "document" &&
								peer.live.documents.has(notice.document)) ||
							(notice.kind === "workspace" &&
								[...notice.documents].some(document =>
									peer.live.documents.has(document),
								)),
					),
					peer =>
						authorize(peer).pipe(
							Effect.flatMap(live =>
								Effect.gen(function* () {
									if (notice.kind === "preferences") {
										if (notice.subject === live.subject) {
											live.name = yield* profileName(live.subject)
											for (let [document, previous] of live.presence) {
												let presence = { ...previous, name: live.name }
												live.presence.set(document, presence)
												yield* broadcast(peer, document, {
													type: "presence",
													presence,
												})
											}
											peer.send({ type: "preferences" })
										} else peer.send({ type: "advanced" })
										return
									}
									for (let document of live.documents) {
										if (
											notice.kind === "document" &&
											notice.document !== document
										)
											continue
										let role = yield* accessRole(live, document)
										let previous = live.presence.get(document)
										if (!role) {
											live.documents.delete(document)
											live.presence.delete(document)
											live.lastPresence.delete(document)
											peer.send({ type: "unavailable", document })
											yield* broadcast(peer, document, {
												type: "gone",
												document,
												actor: live.actor,
											})
										} else if (previous) {
											let presence = presentationPresence(
												previous,
												role,
												previous.time,
											)
											if (
												JSON.stringify(presence) !== JSON.stringify(previous)
											) {
												live.presence.set(document, presence)
												yield* broadcast(peer, document, {
													type: "presence",
													presence,
												})
											}
										}
									}
									peer.send({ type: "advanced" })
								}),
							),
							Effect.catchCause(() =>
								Effect.sync(() => peer.close(1008, "Sign in again")),
							),
						),
					{ concurrency: 8, discard: true },
				),
			),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* Stream.fromSchedule(Schedule.spaced(Math.min(pollWait, 5_000))).pipe(
			Stream.runForEach(() =>
				Effect.gen(function* () {
					let now = yield* Clock.currentTimeMillis
					if (now - heartbeatSent >= 5_000) {
						heartbeatSent = now
						for (let peer of socketPeers) peer.send({ type: "heartbeat" })
					}
					for (let poll of polls.values())
						if (!poll.waiter && now - poll.seen > pollAbandoned)
							poll.peer.close(1001, "Live session abandoned")
				}),
			),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				for (let peer of peers) peer.close(1001, "Server restarting")
				peers.clear()
				socketPeers.clear()
			}),
		)
		return {
			upgrade,
			open,
			message,
			close,
			poll,
			polling: () => polls.size,
		}

		function upgrade(
			request: Request,
			server: Server<Connection>,
			origin: string,
		) {
			return Effect.gen(function* () {
				let account = yield* authenticate(
					request,
					origin,
					new URL(request.url).searchParams.get("account"),
				)
				let live = yield* connection(account)
				if (server.upgrade(request, { data: { live } })) return
				return new Response("WebSocket required", { status: 426 })
			}).pipe(Effect.catchTag("LiveRejected", rejection))
		}
		function open(socket: ServerWebSocket<Connection>) {
			let peer: LivePeer = {
				live: socket.data.live,
				gate: Semaphore.makeUnsafe(1),
				send: message => {
					if (socket.send(JSON.stringify(message)) === 0)
						socket.close(1013, "Reconnect")
				},
				close: (code, reason) => socket.close(code, reason),
			}
			sockets.set(socket, peer)
			socketPeers.add(peer)
			join(peer)
		}
		function message(
			socket: ServerWebSocket<Connection>,
			input: string | Buffer,
		) {
			let peer = sockets.get(socket)
			if (!peer) return Effect.void
			let sender = peer
			return sender.gate.withPermit(
				Effect.gen(function* () {
					if (input.length > 8192)
						return sender.close(1009, "Live message too large")
					let message = yield* Schema.decodeUnknownEffect(
						Schema.fromJsonString(LiveClientMessageSchema),
					)(String(input))
					yield* receive(sender, message)
				}).pipe(
					Effect.catchCause(() =>
						Effect.sync(() => sender.close(1008, "Live access unavailable")),
					),
				),
			)
		}
		function close(socket: ServerWebSocket<Connection>) {
			let peer = sockets.get(socket)
			if (!peer) return Effect.void
			sockets.delete(socket)
			socketPeers.delete(peer)
			return peer.gate.withPermit(leave(peer))
		}

		// Long polling carries the same messages over plain HTTP for networks
		// that block WebSockets: poll receives, send transmits, close leaves.
		function poll(
			request: Request,
			server: Server<Connection>,
			origin: string,
		) {
			return Effect.gen(function* () {
				let path = new URL(request.url).pathname
				if (request.method !== "POST")
					return yield* new LiveRejected({
						status: 405,
						message: "Use POST",
					})
				let text = yield* body(request)
				if (path === "/api/live/poll") {
					let input = yield* decode(LivePollRequestSchema, text)
					let account = yield* authenticate(request, origin, input.account)
					let session =
						input.session === undefined
							? yield* openPoll(account)
							: yield* resume(input.session, account)
					server.timeout(request, Math.ceil((pollWait + 15_000) / 1000))
					let messages = yield* take(session)
					return Response.json(
						{ session: session.id, messages },
						{ headers: { "Cache-Control": "no-store" } },
					)
				}
				if (path === "/api/live/send") {
					let input = yield* decode(LiveSendRequestSchema, text)
					let account = yield* authenticate(request, origin, input.account)
					let session = yield* resume(input.session, account)
					session.seen = yield* Clock.currentTimeMillis
					let peer = session.peer
					yield* peer.gate
						.withPermit(
							Effect.forEach(input.messages, item => receive(peer, item), {
								discard: true,
							}),
						)
						.pipe(
							Effect.catchCause(() =>
								Effect.sync(() =>
									peer.close(1008, "Live access unavailable"),
								).pipe(
									Effect.andThen(
										new LiveRejected({
											status: 410,
											message: "Live session expired",
										}),
									),
								),
							),
						)
					if (!peers.has(peer))
						return yield* new LiveRejected({
							status: 410,
							message: "Live session expired",
						})
					return new Response(null, { status: 204 })
				}
				if (path === "/api/live/close") {
					let input = yield* decode(LiveCloseRequestSchema, text)
					let account = yield* authenticate(request, origin, input.account)
					let session = polls.get(input.session)
					if (session?.peer.live.session === account.session)
						session.peer.close(1000, "Closed")
					return new Response(null, { status: 204 })
				}
				return yield* new LiveRejected({ status: 404, message: "Not found" })
			}).pipe(Effect.catchTag("LiveRejected", rejection))
		}
		function openPoll(account: { session: string; subject: string }) {
			return Effect.gen(function* () {
				let own = [...polls.values()].filter(
					poll => poll.peer.live.session === account.session,
				)
				if (own.length >= pollSessionsPerLogin)
					return yield* new LiveRejected({
						status: 429,
						message: "Too many live sessions",
					})
				if (polls.size >= pollSessionLimit)
					return yield* new LiveRejected({
						status: 503,
						message: "Live sync is busy",
					})
				let live = yield* connection(account)
				let id = yield* cipher.uuid()
				let queue = yield* Queue.dropping<LiveServerMessage, Cause.Done>(
					pollQueueLimit,
				)
				let seen = yield* Clock.currentTimeMillis
				let session: PollSession = {
					id,
					queue,
					seen,
					waiter: undefined,
					peer: {
						live,
						gate: Semaphore.makeUnsafe(1),
						// A client that cannot keep up resynchronizes on a fresh
						// session rather than silently missing notifications.
						send: message => {
							if (!Queue.offerUnsafe(queue, message))
								session.peer.close(1013, "Reconnect")
						},
						close: () => {
							if (polls.get(id) !== session) return
							polls.delete(id)
							Queue.endUnsafe(queue)
							run(session.peer.gate.withPermit(leave(session.peer)))
						},
					},
				}
				polls.set(id, session)
				join(session.peer)
				return session
			})
		}
		function resume(id: string, account: { session: string }) {
			let session = polls.get(id)
			return session && session.peer.live.session === account.session
				? Effect.succeed(session)
				: Effect.fail(
						new LiveRejected({ status: 410, message: "Live session expired" }),
					)
		}
		function take(session: PollSession) {
			return Effect.gen(function* () {
				if (session.waiter) yield* Deferred.succeed(session.waiter, undefined)
				let superseded = yield* Deferred.make<void>()
				session.waiter = superseded
				let taken = yield* Queue.takeAll(session.queue).pipe(
					Effect.timeoutOption(pollWait),
					Effect.raceFirst(
						Deferred.await(superseded).pipe(Effect.as(Option.none())),
					),
					Effect.ensuring(
						Effect.gen(function* () {
							if (session.waiter === superseded) session.waiter = undefined
							session.seen = yield* Clock.currentTimeMillis
						}),
					),
					Effect.catchTag("Done", () =>
						Effect.fail(
							new LiveRejected({
								status: 410,
								message: "Live session expired",
							}),
						),
					),
				)
				yield* authorize(session.peer).pipe(
					Effect.mapError(() => {
						session.peer.close(1008, "Sign in again")
						return new LiveRejected({
							status: 401,
							message: "Sign in required",
						})
					}),
				)
				let messages = Option.getOrElse(taken, () => [])
				// Presence waited in the queue; access may have been revoked since.
				let documents = new Set(
					messages.flatMap(item =>
						item.type === "presence" ? [item.presence.document] : [],
					),
				)
				let readable = new Set<string>()
				for (let document of documents)
					if (yield* canRead(session.peer.live, document))
						readable.add(document)
				let delivered: LiveServerMessage[] = []
				for (let message of messages) {
					if (message.type !== "presence") {
						delivered.push(message)
						continue
					}
					if (!readable.has(message.presence.document)) continue
					let source = [...peers].find(
						peer => peer.live.actor === message.presence.actor,
					)
					if (!source) continue
					let presence = yield* currentPresence(source, message.presence)
					if (presence)
						delivered.push({
							type: "presence",
							presence: {
								...presence,
								own: source.live.subject === session.peer.live.subject,
							},
						})
				}
				return delivered
			})
		}

		function authenticate(
			request: Request,
			origin: string,
			expected: string | null,
		) {
			return Effect.gen(function* () {
				let cookies = Cookies.parseHeader(request.headers.get("cookie") ?? "")
				let token =
					cookies[
						origin.startsWith("https:")
							? "__Host-" + sessionCookie
							: sessionCookie
					] ?? ""
				let account = yield* sessions
					.authenticate(Redacted.make(token), "cookie")
					.pipe(
						Effect.mapError(
							() =>
								new LiveRejected({ status: 401, message: "Sign in required" }),
						),
					)
				if (expected !== account.subject)
					return yield* new LiveRejected({
						status: 409,
						message: "Account changed",
					})
				return account
			})
		}
		function connection(account: { session: string; subject: string }) {
			return Effect.gen(function* () {
				let live: LiveConnection = {
					session: account.session,
					subject: account.subject,
					actor: yield* cipher.uuid(),
					name: yield* profileName(account.subject),
					documents: new Set(),
					presence: new Map(),
					lastPresence: new Map(),
				}
				return live
			}).pipe(
				Effect.mapError(
					() =>
						new LiveRejected({
							status: 503,
							message: "Live sync is unavailable",
						}),
				),
			)
		}
		function join(peer: LivePeer) {
			peers.add(peer)
			peer.send({ type: "connected", actor: peer.live.actor })
		}
		function leave(peer: LivePeer) {
			if (!peers.delete(peer)) return Effect.void
			let live = peer.live
			return Effect.forEach(
				live.documents,
				document =>
					broadcast(peer, document, {
						type: "gone",
						document,
						actor: live.actor,
					}),
				{ discard: true },
			)
		}
		function receive(peer: LivePeer, message: LiveClientMessage) {
			return Effect.gen(function* () {
				if (!peers.has(peer)) return
				let live = yield* authorize(peer)
				let document =
					message.type === "presence"
						? message.presence.document
						: message.document
				if (message.type === "unwatch") {
					live.documents.delete(document)
					live.presence.delete(document)
					live.lastPresence.delete(document)
					yield* broadcast(peer, document, {
						type: "gone",
						document,
						actor: live.actor,
					})
					return
				}
				let role = yield* accessRole(live, document)
				if (!role) {
					peer.send({ type: "unavailable", document })
					return
				}
				if (message.type === "watch") {
					if (
						live.documents.size >= maximumDocuments &&
						!live.documents.has(document)
					)
						return peer.close(1008, "Too many open documents")
					live.documents.add(document)
					for (let other of peers) {
						let stored = other.live.presence.get(document)
						if (other === peer || !stored) continue
						let presence = yield* currentPresence(other, stored)
						if (presence)
							peer.send({
								type: "presence",
								presence: {
									...presence,
									own: other.live.subject === live.subject,
								},
							})
					}
					return
				}
				if (!live.documents.has(document)) return
				let now = yield* Clock.currentTimeMillis
				if (now - (live.lastPresence.get(document) ?? 0) < 40) return
				live.lastPresence.set(document, now)
				let presence = {
					...presentationPresence(message.presence, role, now),
					actor: live.actor,
					name: live.name,
					time: now,
				}
				live.presence.set(document, presence)
				yield* broadcast(peer, document, { type: "presence", presence })
			})
		}
		function currentPresence(peer: LivePeer, stored: LivePresence) {
			return Effect.gen(function* () {
				yield* authorize(peer)
				let role = yield* accessRole(peer.live, stored.document)
				let now = yield* Clock.currentTimeMillis
				if (!role || now - stored.time >= 10_000) return undefined
				return presentationPresence(stored, role, now)
			}).pipe(Effect.orElseSucceed(() => undefined))
		}
		function profileName(subject: string) {
			return store.preferences().pipe(
				Effect.provideService(Identity, { subject, actors: [] }),
				Effect.map(profile => profile.name),
			)
		}
		function authorize(peer: LivePeer) {
			return Effect.gen(function* () {
				let live = peer.live
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
			sender: LivePeer,
			document: string,
			message: LiveServerMessage,
		) {
			return Effect.forEach(
				peers,
				peer => {
					let live = peer.live
					if (peer === sender || !live.documents.has(document))
						return Effect.void
					// Whether a peer shares the account is told per recipient, so
					// presence never reveals other accounts' identities.
					let delivered =
						message.type === "presence"
							? {
									...message,
									presence: {
										...message.presence,
										own: live.subject === sender.live.subject,
									},
								}
							: message
					return authorize(peer).pipe(
						Effect.andThen(canRead(live, document)),
						Effect.tap(allowed =>
							Effect.sync(() => {
								if (allowed) peer.send(delivered)
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
	})
}
function body(request: Request) {
	return Effect.gen(function* () {
		if (Number(request.headers.get("content-length")) > pollBodyLimit)
			return yield* new LiveRejected({ status: 413, message: "Too large" })
		let text = yield* promise("live.body", () => request.text()).pipe(
			Effect.mapError(
				() => new LiveRejected({ status: 400, message: "Invalid request" }),
			),
		)
		if (text.length > pollBodyLimit)
			return yield* new LiveRejected({ status: 413, message: "Too large" })
		return text
	})
}
function decode<S extends Schema.Top & { readonly DecodingServices: never }>(
	schema: S,
	text: string,
) {
	return Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(
		Effect.mapError(
			() => new LiveRejected({ status: 400, message: "Invalid request" }),
		),
	)
}
function rejection(error: LiveRejected) {
	return Effect.succeed(
		new Response(error.message, {
			status: error.status,
			headers: { "Cache-Control": "no-store" },
		}),
	)
}
