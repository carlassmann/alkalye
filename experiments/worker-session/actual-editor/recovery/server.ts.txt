import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Effect from "effect/Effect"
import { startServer } from "./src/server/index"
import { provisionFixture } from "./seed"

let built = await Bun.build({
	entrypoints: ["worker.ts", "browser-fixture.ts"],
	target: "browser",
	outdir: "assets",
})
if (!built.success)
	throw new AggregateError(built.logs, "Worker fixture build failed")
let backend: Effect.Success<ReturnType<typeof startServer>>
let blocked = false
let server = Bun.serve({
	port: 0,
	fetch: async (request): Promise<Response> => {
		let url = new URL(request.url)
		if (url.pathname === "/__tests/seed" && request.method === "POST")
			return provisionFixture(request, backend.server.url, server.url.origin)
		if (url.pathname === "/")
			return new Response(
				'<!doctype html><title>Actual worker editor proof</title><link rel="stylesheet" href="/editor.css"><link rel="stylesheet" href="/editor-viewport.css"><style>*{box-sizing:border-box}:root{--mono:monospace;--editor-size:18px;--editor-line-height:1.8;--foreground:#111;--background:#fff}body{margin:0}[data-editor].editor-wrap{display:block;height:800px}</style><script type="module" src="/browser-fixture.js"></script>',
				{ headers: { "content-type": "text/html" } },
			)
		if (url.pathname === "/__tests/network") {
			blocked = url.searchParams.get("blocked") === "1"
			return new Response("ok")
		}
		if (
			url.pathname === "/editor.css" ||
			url.pathname === "/editor-viewport.css"
		)
			return new Response(Bun.file("src/client/components" + url.pathname), {
				headers: { "content-type": "text/css" },
			})
		if (url.pathname === "/worker.js" || url.pathname === "/browser-fixture.js")
			return new Response(Bun.file("assets" + url.pathname), {
				headers: { "content-type": "text/javascript" },
			})
		if (blocked && url.pathname.startsWith("/api/"))
			return new Response("Offline fixture", { status: 503 })
		let headers = new Headers(request.headers)
		headers.set("host", server.url.host)
		return fetch(new URL(url.pathname + url.search, backend.server.url), {
			decompress: false,
			method: request.method,
			headers,
			body:
				request.method === "GET" || request.method === "HEAD"
					? undefined
					: await request.arrayBuffer(),
		})
	},
})
let directory = await mkdtemp(join(tmpdir(), "alkalye-worker-session-"))
backend = await Effect.runPromise(
	startServer({
		port: 0,
		data: directory,
		build: false,
		publicOrigin: server.url.origin,
	}),
)
let stopping = false
for (let signal of ["SIGINT", "SIGTERM"])
	process.once(signal, async () => {
		if (stopping) return
		stopping = true
		await server.stop(true)
		await Effect.runPromise(backend.close())
		await rm(directory, { recursive: true, force: true })
		process.exit(0)
	})
console.log(server.url.href)
