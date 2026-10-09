import type {
	LivePollServer,
	LiveSocket,
	LiveUpgradeServer,
} from "../server/document-live"

export interface LiveSocketHandlers {
	open(socket: LiveSocket): void
	message(socket: LiveSocket, message: string | Uint8Array): void
	close(socket: LiveSocket): void
}

// Regular acceptance keeps the scoped live protocol running in this object.
// Hibernation requires restoring authenticated peers, not just accepting sockets.
export function makeCloudflareLiveServer(
	handlers: LiveSocketHandlers,
): LiveUpgradeServer & LivePollServer {
	return {
		upgrade(request, options) {
			if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
				return false
			let pair = new WebSocketPair()
			let client = pair[0]
			let server = pair[1]
			let socket: LiveSocket = {
				data: options.data,
				send(message) {
					try {
						server.send(message)
					} catch {
						finish(1013, "Reconnect")
					}
				},
				close(code, reason) {
					finish(code, reason)
				},
			}
			let closed = false
			function leave() {
				if (closed) return
				closed = true
				handlers.close(socket)
			}
			function finish(code?: number, reason?: string) {
				leave()
				try {
					server.close(code, reason)
				} catch {}
			}
			server.accept()
			server.addEventListener("message", event => {
				if (closed) return
				handlers.message(
					socket,
					typeof event.data === "string"
						? event.data
						: new Uint8Array(event.data),
				)
			})
			server.addEventListener("close", () => finish())
			server.addEventListener("error", () => {
				finish(1011, "Live connection failed")
			})
			handlers.open(socket)
			return new Response(null, { status: 101, webSocket: client })
		},
		timeout() {},
	}
}
