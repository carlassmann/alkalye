import * as Duration from "effect/Duration"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as RcMap from "effect/RcMap"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Socket from "effect/socket/Socket"
import { LiveServerMessageSchema } from "../shared/document-live"
import type { LivePresence, LiveServerMessage } from "../shared/document-live"
import { BrowserAccount } from "./browser-account"

export class DocumentLive extends Context.Service<
	DocumentLive,
	Effect.Success<ReturnType<typeof makeLive>>
>()("alkalye/DocumentLive") {
	static layer = Layer.effect(DocumentLive, makeLive()).pipe(
		Layer.provide(Socket.layerWebSocketConstructorGlobal),
	)
}
function makeLive() {
	return Effect.gen(function* () {
		let account = yield* BrowserAccount
		let writer = yield* Ref.make<Socket.Writer | undefined>(undefined)
		let actor = yield* Ref.make("")
		let connected = yield* SubscriptionRef.make(false)
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
							yield* SubscriptionRef.update(
								presence,
								peers =>
									new Map(
										[...peers].filter(([, peer]) => peer.document !== document),
									),
							)
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
		yield* consume().pipe(
			Effect.retry({
				schedule: Schedule.exponential("200 millis").pipe(
					Schedule.modifyDelay(({ duration }) =>
						Effect.succeed(Duration.min(duration, Duration.seconds(10))),
					),
					Schedule.jittered,
				),
			}),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* Stream.fromSchedule(Schedule.spaced("3 seconds")).pipe(
			Stream.runForEach(() =>
				SubscriptionRef.update(
					presence,
					peers =>
						new Map(
							[...peers].filter(([, peer]) => Date.now() - peer.time < 10_000),
						),
				),
			),
			Effect.forkScoped({ startImmediately: true }),
		)
		return Object.freeze({
			watch: (document: string) => RcMap.get(documents, document),
			actor: () => Ref.getUnsafe(actor),
			connected: () => SubscriptionRef.getUnsafe(connected),
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
		function send(message: unknown) {
			return Effect.suspend(() => {
				let current = Ref.getUnsafe(writer)
				return current ? current.write(JSON.stringify(message)) : Effect.void
			})
		}
		function consume() {
			return Effect.scoped(
				Effect.gen(function* () {
					let status = account.state.current().status
					if (
						!navigator.onLine ||
						status === "signedOut" ||
						status === "accountChanged"
					)
						return yield* Effect.fail(new Error("Live connection is paused"))
					yield* account.connect
					let reader = yield* socket.reader
					let current = yield* socket.writer
					yield* Ref.set(writer, current)
					yield* Effect.addFinalizer(() =>
						Effect.gen(function* () {
							yield* Ref.set(writer, undefined)
							yield* SubscriptionRef.set(connected, false)
							yield* SubscriptionRef.set(presence, new Map())
						}),
					)
					for (let document of watched) yield* send({ type: "watch", document })
					while (true) {
						let frames = yield* reader.pull
						for (let frame of frames) {
							let text =
								typeof frame === "string"
									? frame
									: new TextDecoder().decode(frame)
							let decoded = Schema.decodeUnknownResult(
								Schema.fromJsonString(LiveServerMessageSchema),
							)(text)
							if (decoded._tag === "Failure") continue
							let message = decoded.success
							if (message.type === "connected") {
								yield* Ref.set(actor, message.actor)
								yield* SubscriptionRef.set(connected, true)
							} else if (message.type === "presence") {
								yield* SubscriptionRef.update(presence, peers =>
									new Map(peers).set(message.presence.actor, {
										...message.presence,
										time: Date.now(),
									}),
								)
							} else if (message.type === "gone") {
								yield* SubscriptionRef.update(presence, peers => {
									let next = new Map(peers)
									if (next.get(message.actor)?.document === message.document)
										next.delete(message.actor)
									return next
								})
							} else if (message.type === "unavailable") {
								unavailable.add(message.document)
								yield* SubscriptionRef.update(
									presence,
									peers =>
										new Map(
											[...peers].filter(
												([, peer]) => peer.document !== message.document,
											),
										),
								)
							} else if (message.type === "advanced") {
								for (let document of unavailable) {
									yield* send({ type: "watch", document })
									unavailable.delete(document)
								}
							}
							yield* PubSub.publish(events, message)
						}
					}
				}),
			)
		}
	})
}
