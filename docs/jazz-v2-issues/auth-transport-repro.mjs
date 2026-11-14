import process from "node:process"
import { Readable } from "node:stream"
import { createServer } from "vite"
import { schema as s } from "jazz-tools"
import { acceptDeviceAccounts, createJazz, sqlite } from "jazz-tools/backend"

let app = s.defineApp(
	{ notes: s.table({ text: s.string() }, {}) },
	{ migrations: "none" },
)
let port = Number(process.env.PORT ?? 4123)
let origin = process.env.WORK_WEB_URL ?? `http://localhost:${port}`
let jazz = createJazz({
	app,
	permissions: s.definePermissions(app, ({ policy }) => {
		policy.notes.allowRead.never()
		policy.notes.allowInsert.never()
		policy.notes.allowUpdate.never()
		policy.notes.allowDelete.never()
	}),
	authenticate: acceptDeviceAccounts,
	publicUrl: `${origin}/jazz`,
	store: sqlite({ path: ".jazz-repro" }),
})
let vite = await createServer({
	configFile: false,
	optimizeDeps: { exclude: ["jazz-tools", "jazz-wasm"] },
	server: { port, host: process.env.HOST ?? "127.0.0.1", allowedHosts: true },
	plugins: [
		{
			name: "jazz-repro",
			configureServer(server) {
				server.middlewares.use(async (request, response, next) => {
					if (!request.url?.startsWith("/jazz/")) return next()
					let method = request.method ?? "GET"
					let headers = new globalThis.Headers()
					for (let [name, value] of Object.entries(request.headers)) {
						if (typeof value === "string") headers.set(name, value)
					}
					let result = await jazz.handle(
						new globalThis.Request(new globalThis.URL(request.url, origin), {
							method,
							headers,
							...(method === "GET" || method === "HEAD"
								? {}
								: { body: Readable.toWeb(request), duplex: "half" }),
						}),
					)
					response.writeHead(result.status, Object.fromEntries(result.headers))
					if (result.body) Readable.fromWeb(result.body).pipe(response)
					else response.end()
				})
				if (process.env.REJECT_UPGRADES === "1") {
					server.httpServer.on("upgrade", (request, socket) => {
						if (!request.url?.startsWith("/jazz/")) return
						socket.end(
							"HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
						)
					})
				}
			},
		},
	],
})
await vite.listen()
vite.printUrls()
