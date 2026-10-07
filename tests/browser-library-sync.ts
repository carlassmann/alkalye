import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import type * as Context from "effect/Context"
import { BunServer, serverLayer } from "../src/server/index"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { WorkspaceStore } from "../src/server/document-store"
import { Identity } from "../src/shared/workspace"
import { Replica } from "../src/shared/crdt"
import { buildAction } from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"
import { assert, browser, evaluate, wait } from "./browser-driver"

if (process.argv.includes("--serve")) {
	let build = await Bun.build({
		entrypoints: ["tests/browser-library-sync-fixture.ts"],
		target: "browser",
	})
	if (!build.success || !build.outputs[0])
		throw new Error("Library synchronization fixture build failed")
	let script = await build.outputs[0].text()
	let backend: Context.Service.Shape<typeof BunServer>
	let runtime: ReturnType<typeof makeRuntime>
	let member = ""
	let requestNumber = 0
	let holdPulls = false
	let waiting = new Set<() => void>()
	let observed = new Set<() => void>()
	function makeRuntime(data: string, publicOrigin: string) {
		return ManagedRuntime.make(
			serverLayer({ port: 0, data, build: false, publicOrigin }),
		)
	}
	let server = Bun.serve({
		port: 0,
		fetch: async request => {
			let url = new URL(request.url)
			if (url.pathname === "/")
				return new Response(
					'<!doctype html><title>Library synchronization proof</title><script type="module" src="/fixture.js"></script>',
					{ headers: { "content-type": "text/html" } },
				)
			if (url.pathname === "/fixture-sw.js")
				return new Response(
					`self.addEventListener("install", event => event.waitUntil(caches.open("sync-proof").then(cache => cache.addAll(["/", "/fixture.js"])).then(() => self.skipWaiting()))); self.addEventListener("activate", event => event.waitUntil(self.clients.claim())); self.addEventListener("fetch", event => {let url = new URL(event.request.url); if(url.pathname === "/" || url.pathname === "/fixture.js") event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));});`,
					{ headers: { "content-type": "text/javascript" } },
				)
			if (url.pathname === "/fixture.js")
				return new Response(script, {
					headers: { "content-type": "text/javascript" },
				})
			if (url.pathname === "/test/hold") {
				holdPulls = (await request.text()) === "true"
				if (!holdPulls) for (let release of waiting) release()
				return new Response("ok")
			}
			if (url.pathname === "/test/held") {
				if (!waiting.size)
					await new Promise<void>(resolve => observed.add(resolve))
				return new Response("held")
			}
			if (
				holdPulls &&
				request.method === "GET" &&
				(url.pathname.endsWith("/snapshot") ||
					url.pathname.endsWith("/history"))
			) {
				await new Promise<void>(resolve => {
					function release() {
						waiting.delete(release)
						request.signal.removeEventListener("abort", release)
						resolve()
					}
					waiting.add(release)
					request.signal.addEventListener("abort", release, { once: true })
					for (let notify of observed) notify()
					observed.clear()
				})
				if (request.signal.aborted) return new Response(null, { status: 499 })
			}
			if (url.pathname === "/test/shared" || url.pathname === "/test/access") {
				let payload = await request.text()
				await runtime.runPromise(
					Effect.gen(function* () {
						let store = yield* WorkspaceStore
						if (url.pathname === "/test/shared") {
							member = payload
							yield* store.create(
								"sync-space",
								"Synchronization proof",
								"create",
							)
							yield* store.membership("sync-space", member, "writer", "grant")
							let action = yield* buildAction(
								new Replica("sync-owner"),
								"sync-proof",
								"Create",
								replica =>
									newDocument(
										replica,
										"sync-proof",
										"Untitled",
										"# Synchronization proof",
									),
							)
							yield* store.createDocument("sync-space", action)
						} else {
							let role: "writer" | "reader" =
								payload === "writer" ? "writer" : "reader"
							yield* store.membership(
								"sync-space",
								member,
								role,
								"membership-" + ++requestNumber,
							)
						}
					}).pipe(
						Effect.provideService(Identity, {
							subject: "sync-owner",
							actors: ["sync-owner"],
						}),
					),
				)
				return new Response("ok")
			}
			let headers = new Headers(request.headers)
			headers.set("host", server.url.host)
			return fetch(new URL(url.pathname + url.search, backend.server.url), {
				decompress: false,
				signal: request.signal,
				method: request.method,
				headers,
				body:
					request.method === "GET" || request.method === "HEAD"
						? undefined
						: await request.arrayBuffer(),
			})
		},
	})
	let directory = await mkdtemp(join(tmpdir(), "alkalye-library-sync-"))
	runtime = makeRuntime(directory, server.url.origin)
	backend = await runtime.runPromise(BunServer)

	let stopping = false
	for (let signal of ["SIGINT", "SIGTERM"])
		process.once(signal, async () => {
			if (stopping) return
			stopping = true
			await server.stop(true)
			await runtime.dispose()
			await rm(directory, { recursive: true, force: true })
			process.exit(0)
		})
	console.log(server.url.href)
} else {
	let server = Bun.spawn(["bun", "tests/browser-library-sync.ts", "--serve"], {
		stdout: "pipe",
		stderr: "inherit",
	})
	let session = "library-sync-" + Date.now()
	try {
		let output = await server.stdout.getReader().read()
		if (!output.value) throw new Error("Missing synchronization fixture URL")
		let url = new TextDecoder().decode(output.value).trim()
		console.log(url)
		browser(session, "open", url)
		wait(session, "Boolean(window.librarySync || window.librarySyncFailure)")
		assert(
			!evaluate(session, "window.librarySyncFailure ?? null"),
			"library opens through real IndexedDB and authenticated HTTP",
		)
		evaluate(
			session,
			"navigator.serviceWorker.register('/fixture-sw.js').then(() => navigator.serviceWorker.ready)",
		)
		wait(session, "Boolean(navigator.serviceWorker.controller)")
		browser(session, "set", "offline", "true")
		evaluate(session, "window.librarySync.reset()")
		evaluate(
			session,
			"window.librarySync.edit(" +
				JSON.stringify("# Synchronization proof\nOffline durable edit") +
				")",
		)
		assert(
			evaluate(
				session,
				"window.librarySync.source().endsWith('Offline durable edit')",
			),
			"offline edit is immediately visible",
		)
		browser(session, "reload")
		wait(session, "Boolean(window.librarySync || window.librarySyncFailure)")
		assert(
			!evaluate(session, "window.librarySyncFailure ?? null"),
			"offline reload opens durable journal",
		)
		assert(
			evaluate(
				session,
				"window.librarySync.source().endsWith('Offline durable edit')",
			),
			"offline journal survives reload",
		)
		evaluate(session, "window.librarySync.reset()")
		browser(session, "set", "offline", "false")
		evaluate(session, "window.librarySync.reconnect()")
		wait(session, "window.librarySync.status() === 'synced'")
		console.log(
			"RECONNECT",
			JSON.stringify(evaluate(session, "window.librarySync.counts")),
		)
		evaluate(session, "window.librarySync.sync()")
		assert(
			evaluate(
				session,
				"window.librarySync.source().endsWith('Offline durable edit')",
			),
			"reconnect preserves offline edits",
		)
		console.log(
			"AFTER EXPLICIT SYNC",
			JSON.stringify(evaluate(session, "window.librarySync.counts")),
		)
		browser(session, "set", "offline", "true")
		evaluate(
			session,
			"window.librarySync.edit('# Synchronization proof: denied edit')",
		)
		await fetch(new URL("/test/access", url), {
			method: "POST",
			body: "reader",
		})
		browser(session, "set", "offline", "false")
		evaluate(session, "window.librarySync.sync()")
		wait(session, "window.librarySync.status() === 'unavailable'")
		assert(
			evaluate(session, "window.librarySync.pending() > 0"),
			"permission rejection preserves durable pending edits",
		)
		assert(
			evaluate(session, "window.librarySync.source().includes('denied edit')"),
			"permission rejection preserves local source",
		)
		browser(session, "set", "offline", "true")
		evaluate(session, "window.librarySync.close()")
		browser(session, "reload")
		wait(session, "Boolean(window.librarySync || window.librarySyncFailure)")
		assert(
			!evaluate(session, "window.librarySyncFailure ?? null"),
			"scope release leaves journal reopenable",
		)
		assert(
			evaluate(
				session,
				"window.librarySync.pending() > 0 && window.librarySync.source().includes('denied edit')",
			),
			"rejected journal survives scope release and offline reload",
		)
		await fetch(new URL("/test/access", url), {
			method: "POST",
			body: "writer",
		})
		browser(session, "set", "offline", "false")
		evaluate(session, "window.librarySync.retry()")
		wait(
			session,
			"window.librarySync.status() === 'synced' && window.librarySync.pending() === 0",
		)
		assert(
			evaluate(session, "window.librarySync.source().includes('denied edit')"),
			"explicit retry commits preserved edits after access restoration",
		)
		await fetch(new URL("/test/hold", url), { method: "POST", body: "true" })
		evaluate(session, "window.librarySync.startSync()")
		await fetch(new URL("/test/held", url), {
			signal: AbortSignal.timeout(5000),
		})
		evaluate(
			session,
			"window.librarySync.edit('# Synchronization proof: edit during pull')",
		)
		assert(
			evaluate(session, "window.librarySync.pending() > 0"),
			"edit during blocked pull is durably queued",
		)
		evaluate(session, "window.librarySync.close()")
		await fetch(new URL("/test/hold", url), { method: "POST", body: "false" })
		browser(session, "reload")
		wait(session, "Boolean(window.librarySync || window.librarySyncFailure)")
		assert(
			!evaluate(session, "window.librarySyncFailure ?? null"),
			"interrupted sync scope releases transport and reopens",
		)
		evaluate(session, "window.librarySync.retry()")
		wait(
			session,
			"window.librarySync.status() === 'synced' && window.librarySync.pending() === 0",
		)
		assert(
			evaluate(
				session,
				"window.librarySync.source().includes('edit during pull')",
			),
			"edit racing a pull survives interruption and retry",
		)
		evaluate(session, "window.librarySync.close()")
	} finally {
		browser(session, "close")
		server.kill("SIGTERM")
		await server.exited
	}
}
