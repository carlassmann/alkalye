import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ServerWebSocket } from "bun"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { startServer } from "../src/server/index"
import { LiveServerMessageSchema } from "../src/shared/document-live"
import { assert, browser, evaluate, wait } from "./browser-driver"

if (process.argv.includes("--serve")) {
	let build = await Bun.build({
		entrypoints: ["tests/browser-live-presence-fixture.ts"],
		target: "browser",
	})
	if (!build.success || !build.outputs[0])
		throw new Error("Presence fixture build failed")
	let script = await build.outputs[0].text()
	let sockets = new Set<ServerWebSocket<undefined>>()
	let backend: Effect.Success<ReturnType<typeof startServer>>
	let server = Bun.serve<undefined>({
		port: 0,
		async fetch(request, server) {
			let url = new URL(request.url)
			if (url.pathname === "/")
				return new Response(
					'<script type="module" src="/fixture.js"></script>',
					{
						headers: { "content-type": "text/html" },
					},
				)
			if (url.pathname === "/fixture.js")
				return new Response(script, {
					headers: { "content-type": "text/javascript" },
				})
			if (url.pathname === "/api/live" && server.upgrade(request)) return
			if (url.pathname === "/control") {
				let message = Schema.decodeUnknownSync(LiveServerMessageSchema)(
					await request.json(),
				)
				for (let socket of sockets) socket.send(JSON.stringify(message))
				return new Response("ok")
			}
			if (url.pathname === "/disconnect") {
				for (let socket of sockets) socket.close()
				return new Response("ok")
			}
			let headers = new Headers(request.headers)
			headers.set("host", server.url.host)
			return fetch(new URL(url.pathname + url.search, backend.server.url), {
				method: request.method,
				headers,
				body:
					request.method === "GET" ? undefined : await request.arrayBuffer(),
			})
		},
		websocket: {
			open(socket) {
				sockets.add(socket)
				socket.send(
					JSON.stringify({ type: "connected", actor: "presence-actor" }),
				)
			},
			message() {},
			close(socket) {
				sockets.delete(socket)
			},
		},
	})
	let directory = await mkdtemp(join(tmpdir(), "alkalye-presence-"))
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
} else {
	let server = Bun.spawn(["bun", "tests/browser-live-presence.ts", "--serve"], {
		stdout: "pipe",
		stderr: "inherit",
	})
	let session = "presence-service-" + Date.now()
	try {
		let output = await server.stdout.getReader().read()
		if (!output.value) throw new Error("Missing presence fixture URL")
		let origin = new TextDecoder().decode(output.value).trim()
		browser(session, "open", origin)
		wait(session, "Boolean(window.presenceProbe || window.presenceFailure)")
		assert(
			!evaluate(session, "window.presenceFailure ?? null"),
			"real account and storage open presence service",
		)
		wait(
			session,
			"window.presenceProbe.connected() && window.presenceProbe.changes === 1",
		)
		async function send(message: unknown) {
			let before = Number(evaluate(session, "window.presenceProbe.messages"))
			let response = await fetch(new URL("/control", origin), {
				method: "POST",
				body: JSON.stringify(message),
				headers: { "content-type": "application/json" },
			})
			assert(response.ok, "typed message delivered over real WebSocket")
			wait(session, `window.presenceProbe.messages > ${before}`)
		}
		function changes() {
			return Number(evaluate(session, "window.presenceProbe.changes"))
		}
		function advance(milliseconds: number) {
			evaluate(session, `window.presenceProbe.advance(${milliseconds})`)
		}
		let count = changes()
		advance(3000)
		assert(changes() === count, "empty expiry sweep does not publish")
		let peer = {
			actor: "peer-actor",
			name: "Peer",
			document: "presence-doc",
			cursor: 0,
			slide: 0,
			x: 0,
			y: 0,
			time: 0,
		}
		await send({ type: "presence", presence: peer })
		wait(session, `window.presenceProbe.changes === ${++count}`)
		let firstTime = evaluate(session, "window.presenceProbe.peers()[0].time")
		advance(5000)
		assert(changes() === count, "unchanged peer sweep does not publish")
		await send({ type: "presence", presence: peer })
		wait(session, `window.presenceProbe.changes === ${++count}`)
		assert(
			evaluate(session, "window.presenceProbe.peers()[0].time") !== firstTime,
			"heartbeat renews local timestamp and publishes",
		)
		await send({
			type: "gone",
			document: "presence-doc",
			actor: "unknown-actor",
		})
		assert(changes() === count, "unknown departure does not publish")
		await send({ type: "gone", document: "other-doc", actor: "peer-actor" })
		assert(
			changes() === count &&
				evaluate(session, "window.presenceProbe.peers().length") === 1,
			"departure from another document preserves matching actor",
		)
		advance(9999)
		assert(changes() === count, "renewed peer survives sweeps before expiry")
		advance(1)
		wait(session, `window.presenceProbe.changes === ${++count}`)
		assert(
			evaluate(session, "window.presenceProbe.peers().length") === 0,
			"due sweep expires peer at exactly ten seconds",
		)
		await send({ type: "presence", presence: peer })
		wait(session, `window.presenceProbe.changes === ${++count}`)
		await send({ type: "gone", document: "presence-doc", actor: "peer-actor" })
		wait(session, `window.presenceProbe.changes === ${++count}`)
		assert(
			evaluate(session, "window.presenceProbe.peers().length") === 0,
			"actual departure clears presence",
		)
		evaluate(session, "window.presenceProbe.watch()")
		await send({ type: "presence", presence: peer })
		wait(session, `window.presenceProbe.changes === ${++count}`)
		evaluate(session, "window.presenceProbe.unwatch()")
		wait(session, `window.presenceProbe.changes === ${++count}`)
		assert(
			evaluate(session, "window.presenceProbe.peers().length") === 0,
			"last watch scope clears its peer",
		)
		evaluate(
			session,
			"window.presenceProbe.watch().then(() => window.presenceProbe.unwatch())",
		)
		assert(changes() === count, "empty last-watch cleanup does not publish")
		await send({ type: "presence", presence: peer })
		wait(session, `window.presenceProbe.changes === ${++count}`)
		await fetch(new URL("/disconnect", origin), { method: "POST" })
		wait(session, `window.presenceProbe.changes === ${++count}`)
		assert(
			evaluate(session, "window.presenceProbe.peers().length") === 0,
			"disconnect clears active peers",
		)
		wait(session, "window.presenceProbe.connected()")
		await fetch(new URL("/disconnect", origin), { method: "POST" })
		wait(session, "!window.presenceProbe.connected()")
		assert(changes() === count, "empty disconnect does not publish")
		evaluate(
			session,
			"window.presenceProbe.unwatch().then(() => window.presenceProbe.close())",
		)
	} finally {
		try {
			browser(session, "close")
		} catch {}
		server.kill("SIGTERM")
		await server.exited
	}
}
