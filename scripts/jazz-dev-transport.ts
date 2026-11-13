import type { Plugin } from "vite"

export { jazzDevTransport }

function jazzDevTransport(): Plugin {
	return {
		name: "jazz-dev-transport",
		apply: "serve",
		configureServer(server) {
			// Vite leaves non-HMR upgrades unanswered. Reject Jazz's so its HTTP
			// stream fallback starts immediately instead of after the 10s deadline.
			server.httpServer?.on("upgrade", (request, socket) => {
				let pathname = request.url?.split("?")[0]
				if (!pathname?.match(/^\/jazz\/apps\/[^/]+\/ws\/?$/)) return
				socket.end(
					"HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
				)
			})
		},
	}
}
