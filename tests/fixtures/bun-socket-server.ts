import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Latch from "effect/Latch"
import * as Layer from "effect/Layer"
import * as NetAddress from "effect/net/NetAddress"
import * as Queue from "effect/Queue"
import * as Semaphore from "effect/Semaphore"
import * as Socket from "effect/socket/Socket"
import * as SocketServer from "effect/socket/SocketServer"

type Connection = {
	incoming: Queue.Queue<Uint8Array | string, Socket.SocketError>
	writable: Latch.Latch
	closed?: Socket.SocketError
}

export function socketServerLayer() {
	return Layer.effect(SocketServer.SocketServer)(
		Effect.gen(function* () {
			let connections =
				yield* Queue.bounded<Bun.ServerWebSocket<Connection>>(64)
			let server = yield* Effect.acquireRelease(
				Effect.try({
					try: () =>
						Bun.serve<Connection>({
							hostname: "127.0.0.1",
							port: 0,
							fetch(request, server) {
								let incoming = Effect.runSync(
									Queue.bounded<Uint8Array | string, Socket.SocketError>(128),
								)
								if (
									server.upgrade(request, {
										data: { incoming, writable: Latch.makeUnsafe(true) },
									})
								)
									return
								return new Response("WebSocket required", { status: 426 })
							},
							websocket: {
								maxPayloadLength: 1024 * 1024,
								backpressureLimit: 4 * 1024 * 1024,
								closeOnBackpressureLimit: true,
								open(socket) {
									if (!Queue.offerUnsafe(connections, socket))
										socket.close(1013, "Connection queue full")
								},
								message(socket, frame) {
									if (!Queue.offerUnsafe(socket.data.incoming, frame)) {
										failConnection(socket.data, 1009, "Receive queue full")
										socket.close(1009, "Receive queue full")
									}
								},
								close(socket, code, reason) {
									failConnection(socket.data, code, reason)
								},
								drain(socket) {
									socket.data.writable.openUnsafe()
								},
							},
						}),
					catch: cause =>
						new SocketServer.SocketServerError({
							reason: new SocketServer.SocketServerOpenError({ cause }),
						}),
				}),
				server =>
					Effect.sync(() => {
						server.stop(true)
						Queue.shutdownUnsafe(connections)
					}),
			)
			return SocketServer.SocketServer.of({
				address: NetAddress.socketAddressFromInputUnsafe({
					address: "127.0.0.1",
					port: server.port ?? 0,
				}),
				run: handler =>
					Effect.scoped(
						Effect.forever(
							Effect.gen(function* () {
								let connection = yield* Queue.take(connections)
								yield* makeSocket(connection).pipe(
									Effect.flatMap(handler),
									Effect.scoped,
									Effect.catchCause(Effect.logDebug),
									Effect.forkScoped,
								)
							}),
						),
					),
			})
		}),
	)
}

function makeSocket(connection: Bun.ServerWebSocket<Connection>) {
	return Effect.gen(function* () {
		let writes = yield* Semaphore.make(1)
		let write = (frame: Uint8Array | string | Socket.CloseEvent) =>
			Effect.gen(function* () {
				yield* connection.data.writable.await
				if (connection.data.closed)
					return yield* Effect.fail(connection.data.closed)
				if (Socket.isCloseEvent(frame)) {
					connection.close(frame.code, frame.reason)
					return
				}
				let sent = yield* Effect.try({
					try: () => connection.send(frame),
					catch: cause =>
						new Socket.SocketError({
							reason: new Socket.SocketWriteError({ cause }),
						}),
				})
				if (sent === 0)
					return yield* Effect.fail(
						new Socket.SocketError({
							reason: new Socket.SocketWriteError({ cause: "Frame dropped" }),
						}),
					)
				if (sent === -1) {
					connection.data.writable.closeUnsafe()
					yield* connection.data.writable.await
					if (connection.data.closed)
						return yield* Effect.fail(connection.data.closed)
				}
			})
		return Socket.make({
			reader: Effect.acquireRelease(
				Effect.succeed({
					pull: Queue.takeAll(connection.data.incoming),
					upgrade: Socket.SocketUpgradeError.unsupported,
				}),
				() =>
					Effect.sync(() => {
						failConnection(connection.data, 1000, "Scope closed")
						connection.close(1000, "Scope closed")
					}),
			),
			writer: Effect.succeed({
				write: frame => writes.withPermit(write(frame)),
				writeAll: frames =>
					writes.withPermit(Effect.forEach(frames, write, { discard: true })),
			}),
		})
	})
}

function failConnection(connection: Connection, code: number, reason: string) {
	if (!connection.closed)
		connection.closed = new Socket.SocketError({
			reason: new Socket.SocketCloseError({ code, closeReason: reason }),
		})
	Queue.failCauseUnsafe(connection.incoming, Cause.fail(connection.closed))
	connection.writable.openUnsafe()
}
