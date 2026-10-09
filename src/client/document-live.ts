import * as Duration from "effect/Duration"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Clock from "effect/Clock"
import * as RcMap from "effect/RcMap"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as Socket from "effect/socket/Socket"
import {
	LivePollResponseSchema,
	LiveServerMessageSchema,
	livePollWait,
} from "../shared/document-live"
import type {
	LiveClientMessage,
	LivePresence,
	LiveServerMessage,
} from "../shared/document-live"
import { BrowserAccount } from "./browser-account"

export type LiveTransport = "socket" | "poll"
class LiveUpgrade extends Data.TaggedError("LiveUpgrade") {}

let healthySocket = 15_000
let socketFailuresBeforePolling = 3
let socketRetryWhilePolling = 90_000
let pollSendSpacing = 100

let reconnectSchedule = Schedule.exponential("200 millis").pipe(
	Schedule.modifyDelay(({ duration }) =>
		Effect.succeed(Duration.min(duration, Duration.seconds(10))),
	),
	Schedule.jittered,
)

export class DocumentLive extends Context.Service<
	DocumentLive,
	Effect.Success<ReturnType<typeof makeLive>>
>()("alkalye/DocumentLive") {
	static layer = Layer.effect(DocumentLive, makeLive()).pipe(
		Layer.provide(
			Layer.merge(
				Socket.layerWebSocketConstructorGlobal,
				FetchHttpClient.layer,
			),
		),
	)
}
function makeLive() {
	return Effect.gen(function* () {
		let account = yield* BrowserAccount
		let http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
		let writer = yield* Ref.make<
			((message: LiveClientMessage) => Effect.Effect<void, unknown>) | undefined
		>(undefined)
		let actor = yield* Ref.make("")
		let connected = yield* SubscriptionRef.make(false)
		let transport = yield* SubscriptionRef.make<LiveTransport>("socket")
		let presence = yield* SubscriptionRef.make<
			ReadonlyMap<string, LivePresence>
		>(new Map())
		let events = yield* PubSub.sliding<LiveServerMessage>(64)
		yield* Effect.addFinalizer(() => PubSub.shutdown(events))
		let watched = new Set<string>()
		let unavailable = new Set<string>()
		let documents = yield* RcMap.make({
			lookup: (document: string) =>
				Effect.gen(function* () {
					watched.add(document)
					yield* Effect.addFinalizer(() =>
						Effect.gen(function* () {
							watched.delete(document)
							unavailable.delete(document)
							yield* send({ type: "unwatch", document }).pipe(Effect.ignore)
							yield* removePresence(peer => peer.document === document)
						}),
					)
					yield* send({ type: "watch", document }).pipe(Effect.ignore)
				}),
			idleTimeToLive: 0,
		})
		let url = new URL("/api/live", account.origin)
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
		url.searchParams.set("account", account.subject)
		let socket = yield* Socket.makeWebSocket(url.href, {
			openTimeout: "10 seconds",
		})
		yield* maintain().pipe(Effect.forkScoped({ startImmediately: true }))
		yield* Stream.fromSchedule(Schedule.spaced("3 seconds")).pipe(
			Stream.runForEach(() =>
				Effect.gen(function* () {
					let now = yield* Clock.currentTimeMillis
					yield* removePresence(peer => !(now - peer.time < 10_000))
				}),
			),
			Effect.forkScoped({ startImmediately: true }),
		)
		return Object.freeze({
			watch: (document: string) => RcMap.get(documents, document),
			actor: () => Ref.getUnsafe(actor),
			connected: () => SubscriptionRef.getUnsafe(connected),
			transport: () => SubscriptionRef.getUnsafe(transport),
			changes: Stream.fromPubSub(events),
			presence: Object.freeze({
				current: (document: string) =>
					[...SubscriptionRef.getUnsafe(presence).values()].filter(
						peer =>
							peer.document === document && Date.now() - peer.time < 10_000,
					),
				changes: SubscriptionRef.changes(presence),
			}),
			announce: (value: LivePresence) =>
				send({ type: "presence", presence: value }),
		})
		function removePresence(remove: (peer: LivePresence) => boolean) {
			return SubscriptionRef.updateSome(presence, peers => {
				let next: Map<string, LivePresence> | undefined
				for (let [actor, peer] of peers) {
					if (!remove(peer)) continue
					next ??= new Map(peers)
					next.delete(actor)
				}
				return next ? Option.some(next) : Option.none()
			})
		}
		function send(message: LiveClientMessage) {
			return Effect.suspend(() => {
				let current = Ref.getUnsafe(writer)
				return current ? current(message) : Effect.void
			})
		}

		// Prefers WebSockets. Networks that repeatedly break them fall back to
		// long polling, which keeps probing for a working socket.
		function maintain() {
			return Effect.gen(function* () {
				let failures = 0
				let socketBackoff = yield* Schedule.toStepWithSleep(reconnectSchedule)
				let pollBackoff = yield* Schedule.toStepWithSleep(reconnectSchedule)
				let pausedBackoff = yield* Schedule.toStepWithSleep(reconnectSchedule)
				let socketTried = 0
				while (true) {
					let status = account.state.current().status
					if (
						!navigator.onLine ||
						status === "signedOut" ||
						status === "accountChanged"
					) {
						yield* Effect.raceFirst(
							pausedBackoff(undefined),
							Stream.fromEventListener(window, "online").pipe(
								Stream.take(1),
								Stream.runDrain,
							),
						)
						continue
					}
					pausedBackoff = yield* Schedule.toStepWithSleep(reconnectSchedule)
					let now = yield* Clock.currentTimeMillis
					let polling =
						SubscriptionRef.getUnsafe(transport) === "poll" &&
						now - socketTried < socketRetryWhilePolling
					let started = now
					if (!polling) {
						socketTried = started
						let opened = { at: 0, alive: 0, stalled: false }
						yield* Effect.exit(session(socketLink(opened)))
						if (
							opened.at &&
							!opened.stalled &&
							opened.alive - opened.at >= healthySocket
						) {
							failures = 0
							socketBackoff = yield* Schedule.toStepWithSleep(reconnectSchedule)
							continue
						}
						failures++
						if (failures >= socketFailuresBeforePolling) {
							yield* SubscriptionRef.set(transport, "poll")
							continue
						}
						yield* socketBackoff(undefined)
						continue
					}
					let exit = yield* Effect.exit(session(pollLink()))
					if (
						Exit.isFailure(exit) &&
						exit.cause.reasons.some(
							reason =>
								reason._tag === "Fail" && reason.error instanceof LiveUpgrade,
						)
					) {
						failures = 0
						pollBackoff = yield* Schedule.toStepWithSleep(reconnectSchedule)
						socketTried = 0
						continue
					}
					if ((yield* Clock.currentTimeMillis) - started >= healthySocket)
						pollBackoff = yield* Schedule.toStepWithSleep(reconnectSchedule)
					yield* pollBackoff(undefined)
				}
			})
		}
		function session<E>(link: Effect.Effect<unknown, E, Scope.Scope>) {
			return Effect.scoped(
				Effect.gen(function* () {
					yield* Effect.addFinalizer(() =>
						Effect.gen(function* () {
							yield* Ref.set(writer, undefined)
							yield* SubscriptionRef.set(connected, false)
							yield* SubscriptionRef.updateSome(presence, peers =>
								peers.size ? Option.some(new Map()) : Option.none(),
							)
						}),
					)
					yield* account.connect
					return yield* link
				}),
			)
		}
		function socketLink(opened: {
			at: number
			alive: number
			stalled: boolean
		}) {
			return Effect.gen(function* () {
				let reader = yield* socket.reader
				let current = yield* socket.writer
				yield* Ref.set(writer, message =>
					current.write(JSON.stringify(message)),
				)
				for (let document of watched) yield* send({ type: "watch", document })
				while (true) {
					// A proxy can keep a socket open after it stops delivering frames.
					let frames = yield* reader.pull.pipe(
						Effect.timeout(opened.at ? "30 seconds" : "10 seconds"),
						Effect.tapErrorTag("TimeoutError", () =>
							Effect.sync(() => {
								opened.stalled = true
							}),
						),
					)
					for (let frame of frames) {
						let message = decodeFrame(frame)
						if (!message) continue
						opened.alive = yield* Clock.currentTimeMillis
						if (message.type === "heartbeat") continue
						if (message.type === "connected") {
							opened.at = yield* Clock.currentTimeMillis
							yield* SubscriptionRef.set(transport, "socket")
						}
						yield* receive(message)
					}
				}
			})
		}
		function pollLink() {
			return Effect.gen(function* () {
				let opened = yield* poll(undefined)
				let id = opened.session
				yield* Effect.addFinalizer(() =>
					post("/api/live/close", {
						account: account.subject,
						session: id,
					}).pipe(
						Effect.timeout("3 seconds"),
						Effect.ignore,
						Effect.forkDetach,
					),
				)
				let control: LiveClientMessage[] = []
				let latest = new Map<string, LiveClientMessage>()
				let wake = yield* Queue.sliding<void>(1)
				yield* Effect.addFinalizer(() => Queue.shutdown(wake))
				yield* Ref.set(writer, message =>
					Effect.suspend(() => {
						// Only the newest cursor per document matters, so presence
						// coalesces while control messages keep their order.
						if (message.type === "presence")
							latest.set(message.presence.document, message)
						else control.push(message)
						return Queue.offer(wake, undefined)
					}),
				)
				for (let document of watched) yield* send({ type: "watch", document })
				for (let message of opened.messages) yield* receive(message)
				let transmit = Effect.gen(function* () {
					while (true) {
						yield* Queue.take(wake)
						let batch = [...control.splice(0), ...latest.values()]
						latest.clear()
						for (let start = 0; start < batch.length; start += 32)
							yield* post("/api/live/send", {
								account: account.subject,
								session: id,
								messages: batch.slice(start, start + 32),
							})
						yield* Effect.sleep(Duration.millis(pollSendSpacing))
					}
				})
				let listen = Effect.gen(function* () {
					while (true) {
						let response = yield* poll(id)
						for (let message of response.messages) yield* receive(message)
					}
				})
				let probe = Effect.sleep(socketRetryWhilePolling).pipe(
					Effect.andThen(
						Effect.repeat(socketWorks(), {
							until: works => works,
							schedule: Schedule.spaced(socketRetryWhilePolling).pipe(
								Schedule.jittered,
							),
						}),
					),
					Effect.andThen(Effect.fail(new LiveUpgrade())),
				)
				// Every loop runs until failure; the first failure ends the session.
				return yield* Effect.all([transmit, listen, probe], {
					concurrency: "unbounded",
				})
			})
		}
		function poll(id: string | undefined) {
			return post("/api/live/poll", {
				account: account.subject,
				session: id,
			}).pipe(
				Effect.flatMap(
					HttpClientResponse.schemaBodyJson(LivePollResponseSchema),
				),
				Effect.timeout(Duration.millis(livePollWait + 10_000)),
			)
		}
		function post(path: string, body: unknown) {
			return http.execute(
				HttpClientRequest.post(new URL(path, account.origin)).pipe(
					HttpClientRequest.bodyJsonUnsafe(body),
				),
			)
		}
		function socketWorks() {
			return Effect.scoped(
				Effect.gen(function* () {
					let reader = yield* socket.reader
					while (true)
						for (let frame of yield* reader.pull)
							if (decodeFrame(frame)?.type === "connected") return true
				}),
			).pipe(
				Effect.timeout("10 seconds"),
				Effect.orElseSucceed(() => false),
			)
		}
		function decodeFrame(frame: string | Uint8Array) {
			let text =
				typeof frame === "string" ? frame : new TextDecoder().decode(frame)
			let decoded = Schema.decodeUnknownResult(
				Schema.fromJsonString(LiveServerMessageSchema),
			)(text)
			return decoded._tag === "Success" ? decoded.success : undefined
		}
		function receive(message: LiveServerMessage) {
			return Effect.gen(function* () {
				if (message.type === "connected") {
					yield* Ref.set(actor, message.actor)
					yield* SubscriptionRef.set(connected, true)
				} else if (message.type === "presence") {
					let now = yield* Clock.currentTimeMillis
					yield* SubscriptionRef.update(presence, peers =>
						new Map(peers).set(message.presence.actor, {
							...message.presence,
							time: now,
						}),
					)
				} else if (message.type === "gone") {
					yield* SubscriptionRef.updateSome(presence, peers => {
						if (peers.get(message.actor)?.document !== message.document)
							return Option.none()
						let next = new Map(peers)
						next.delete(message.actor)
						return Option.some(next)
					})
				} else if (message.type === "unavailable") {
					unavailable.add(message.document)
					yield* removePresence(peer => peer.document === message.document)
				} else if (message.type === "advanced") {
					for (let document of unavailable) {
						yield* send({ type: "watch", document })
						unavailable.delete(document)
					}
				}
				yield* PubSub.publish(events, message)
			})
		}
	})
}
