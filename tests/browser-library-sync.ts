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
import { buildAction, restoreSnapshot } from "../src/shared/document-actions"
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
	let failLibrary = false
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
			if (url.pathname === "/test/accepted" || url.pathname === "/test/peer") {
				let content =
					url.pathname === "/test/peer" ? await request.text() : undefined
				let accepted = await runtime.runPromise(
					Effect.gen(function* () {
						let store = yield* WorkspaceStore
						let snapshot = yield* store.snapshot("sync-proof")
						if (!snapshot) throw Error("Expected existing server document")
						let replica = yield* restoreSnapshot(snapshot, "sync-owner")
						if (content !== undefined) {
							let action = yield* buildAction(
								replica,
								"sync-proof",
								"Peer header",
								staged => [staged.edit("sync-proof", content)],
							)
							yield* store.commit(action)
							snapshot = yield* store.snapshot("sync-proof")
							if (!snapshot)
								throw Error(
									"Expected existing server document after peer commit",
								)
							replica = yield* restoreSnapshot(snapshot, "sync-owner")
						}
						return {
							content: replica.text("sync-proof"),
							position: snapshot.position,
							log: snapshot.log,
						}
					}).pipe(
						Effect.provideService(Identity, {
							subject: "sync-owner",
							actors: ["sync-owner"],
						}),
					),
				)
				return Response.json(accepted)
			}
			if (url.pathname === "/test/library-failure") {
				failLibrary = (await request.text()) === "true"
				return new Response("ok")
			}
			if (failLibrary && url.pathname === "/api/library")
				return new Response("Controlled library failure", { status: 503 })
			if (url.pathname === "/test/name") {
				let name = await request.text()
				await runtime.runPromise(
					WorkspaceStore.use(store =>
						store.rename("sync-space", name, "rename-" + ++requestNumber),
					).pipe(
						Effect.provideService(Identity, {
							subject: "sync-owner",
							actors: ["sync-owner"],
						}),
					),
				)
				return new Response("ok")
			}
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
		evaluate(session, "window.librarySync.startInput()")
		evaluate(session, "window.librarySync.reset()")
		evaluate(
			session,
			"window.snapshotExpected=" +
				JSON.stringify(
					'---\ntitle: "Snapshot quiet"\n---\nBody [link](https://example.com/) 😀',
				) +
				";window.librarySync.edit(window.snapshotExpected).then(()=>window.librarySync.sync())",
		)
		wait(
			session,
			"window.librarySync.status()==='synced'&&window.librarySync.pending()===0&&window.librarySync.source()===window.snapshotExpected",
		)
		assert(
			evaluate(session, "window.librarySync.counts.projectionWrites===0"),
			"accepted sync with active owner does not force checkpoint projection",
		)
		evaluate(session, "window.librarySync.stopInput()")
		wait(session, "window.librarySync.counts.projectionWrites>0")
		assert(
			evaluate(
				session,
				"window.librarySync.source()===window.snapshotExpected",
			),
			"quiet checkpoint retains source",
		)
		evaluate(
			session,
			"fetch('/test/accepted').then(response=>response.json()).then(value=>window.snapshotServer=value)",
		)
		assert(
			evaluate(
				session,
				"window.snapshotServer.content===window.snapshotExpected",
			),
			"independent real SQLite source matches accepted edit",
		)
		evaluate(session, "window.librarySync.snapshotCacheFault(true)")
		evaluate(
			session,
			"window.librarySync.edit(window.snapshotExpected+String.fromCharCode(10)+'Cache retry').then(()=>window.librarySync.sync())",
		)
		wait(session, "Boolean(window.librarySync.snapshotFailure())")
		assert(
			evaluate(
				session,
				"window.librarySync.source()===window.snapshotExpected+String.fromCharCode(10)+'Cache retry'&&window.librarySync.status()==='synced'",
			),
			"checkpoint failure does not undo durable synchronized edit",
		)
		evaluate(
			session,
			"window.snapshotExpected+=String.fromCharCode(10)+'Cache retry';window.librarySync.snapshotCacheFault(false)",
		)
		wait(session, "window.librarySync.snapshotFailure()===undefined")

		evaluate(
			session,
			"window.librarySync.rows().then(rows=>window.snapshotRows=rows)",
		)
		assert(
			evaluate(
				session,
				"window.snapshotRows.some(row=>row.summary.metadata.title==='Snapshot quiet'&&row.summary.excerpt.includes('Body'))",
			),
			"quiet real local catalogue updates frontmatter and excerpt",
		)
		evaluate(session, "window.librarySync.startInput()")
		evaluate(session, "window.librarySync.reset()")
		evaluate(
			session,
			"window.snapshotExpected=window.snapshotExpected.replace('Snapshot quiet','Manual metadata');window.librarySync.edit(window.snapshotExpected).then(()=>window.librarySync.retry())",
		)
		assert(
			evaluate(session, "window.librarySync.counts.projectionWrites>0"),
			"manual retry projects changed source under input",
		)
		evaluate(
			session,
			"window.librarySync.rows().then(rows=>window.manualRows=rows)",
		)
		assert(
			evaluate(
				session,
				"window.manualRows.some(row=>row.summary.metadata.title==='Manual metadata')",
			),
			"manual retry publishes changed metadata before input stops",
		)
		assert(
			evaluate(
				session,
				"window.librarySync.status()==='synced'&&window.librarySync.source()===window.snapshotExpected",
			),
			"manual retry remains forced and durable under input",
		)
		evaluate(session, "window.librarySync.stopInput()")
		evaluate(
			session,
			"navigator.serviceWorker.register('/fixture-sw.js').then(()=>navigator.serviceWorker.ready)",
		)
		wait(session, "Boolean(navigator.serviceWorker.controller)")
		let coldSource = evaluate(session, "window.snapshotExpected")
		if (typeof coldSource !== "string") throw Error("Exact source prerequisite")
		browser(session, "set", "offline", "true")
		evaluate(session, "window.librarySync.close()")
		browser(session, "reload")
		wait(session, "Boolean(window.librarySync || window.librarySyncFailure)")
		assert(
			evaluate(
				session,
				"window.librarySync.source()===" + JSON.stringify(coldSource),
			),
			"new offline page restores exact IndexedDB journal source",
		)
		evaluate(session, "window.snapshotExpected=" + JSON.stringify(coldSource))
		browser(session, "set", "offline", "false")
		evaluate(session, "window.librarySync.sync()")
		evaluate(
			session,
			"window.snapshotExpected=window.snapshotExpected.replace('Manual metadata','Peer metadata');fetch('/test/peer',{method:'POST',body:window.snapshotExpected}).then(response=>{if(!response.ok)throw Error('Peer commit failed')}).then(()=>window.librarySync.sync())",
		)
		wait(session, "window.librarySync.source()===window.snapshotExpected")
		wait(
			session,
			"window.librarySync.rows().then(rows=>rows.some(row=>row.summary.metadata.title==='Peer metadata'))",
		)
		assert(
			evaluate(
				session,
				"window.librarySync.source()===window.snapshotExpected",
			),
			"peer frontmatter and quiet catalogue remain exact",
		)
		evaluate(session, "window.librarySync.refresh()")
		assert(
			evaluate(
				session,
				"window.librarySync.catalogueTitle()==='Peer metadata'",
			),
			"public library catalogue publishes peer metadata",
		)
		browser(session, "set", "offline", "true")
		evaluate(
			session,
			"window.librarySync.reset();window.snapshotExpected=window.snapshotExpected.replace('Peer metadata','No owner metadata')+String.fromCharCode(10)+'No owner durable';window.librarySync.edit(window.snapshotExpected).then(()=>window.librarySync.releaseDocument())",
		)
		browser(session, "set", "offline", "false")
		wait(
			session,
			"fetch('/test/accepted').then(response=>response.json()).then(value=>{window.noOwnerAccepted=value;return value.content===window.snapshotExpected})",
		)
		wait(
			session,
			"window.librarySync.rows().then(rows=>rows.some(row=>row.summary.document==='sync-proof'&&!row.dirty&&row.summary.metadata.title==='No owner metadata'&&row.remotePosition===window.noOwnerAccepted.position))",
		)
		wait(session, "window.librarySync.counts.projectionWrites>0")
		let noOwnerSource = evaluate(session, "window.snapshotExpected")
		if (typeof noOwnerSource !== "string")
			throw Error("Exact no-owner source prerequisite")
		browser(session, "set", "offline", "true")
		evaluate(session, "window.librarySync.close()")
		browser(session, "reload")
		wait(session, "Boolean(window.librarySync || window.librarySyncFailure)")
		assert(
			evaluate(
				session,
				"window.librarySync.source()===" + JSON.stringify(noOwnerSource),
			),
			"no-owner accepted projection then new offline page restores exact IndexedDB journal",
		)
		evaluate(
			session,
			"window.snapshotExpected=" + JSON.stringify(noOwnerSource),
		)
		browser(session, "set", "offline", "false")
		evaluate(session, "window.librarySync.sync()")
		evaluate(session, "window.librarySync.reset()")
		evaluate(
			session,
			"window.librarySync.refresh().then(() => window.librarySync.refresh())",
		)
		assert(
			evaluate(session, "window.librarySync.counts.catalogueChanges === 0"),
			"unchanged authenticated refreshes preserve catalogue projection",
		)
		evaluate(session, "window.librarySync.cacheFault(true)")
		evaluate(session, "window.librarySync.refresh()")
		assert(
			evaluate(session, "Boolean(window.librarySync.state().cacheFailure)"),
			"controlled library cache failure publishes",
		)
		evaluate(session, "window.librarySync.cacheFault(false)")
		evaluate(session, "window.librarySync.refresh()")
		assert(
			evaluate(
				session,
				"window.librarySync.state().cacheFailure === undefined",
			),
			"explicit cache failure clear publishes",
		)
		await fetch(new URL("/test/library-failure", url), {
			method: "POST",
			body: "true",
		})
		evaluate(session, "window.librarySync.refresh()")
		assert(
			evaluate(
				session,
				"window.librarySync.state().refresh === 'failed' && Boolean(window.librarySync.state().message)",
			),
			"real HTTP library failure publishes",
		)
		await fetch(new URL("/test/library-failure", url), {
			method: "POST",
			body: "false",
		})
		evaluate(session, "window.librarySync.refresh()")
		assert(
			evaluate(
				session,
				"window.librarySync.state().refresh === 'idle' && window.librarySync.state().message === undefined",
			),
			"successful refresh explicitly clears failure",
		)
		await fetch(new URL("/test/name", url), {
			method: "POST",
			body: "Renamed synchronization workspace",
		})
		evaluate(session, "window.librarySync.refresh()")
		assert(
			evaluate(
				session,
				"window.librarySync.workspaceName() === 'Renamed synchronization workspace'",
			),
			"public workspace metadata update survives",
		)
		assert(
			evaluate(session, "window.librarySync.counts.catalogueChanges > 0"),
			"changed workspace publishes to the same catalogue observer",
		)
		assert(
			evaluate(session, "window.librarySync.roles().includes('writer')"),
			"writer catalogue admission survives",
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
