import { assert, browser, evaluate, wait } from "./browser-driver"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as NetAddress from "effect/net/NetAddress"
import * as Scope from "effect/Scope"
import * as SocketServer from "effect/socket/SocketServer"
import { nativeEventLogRelayLayer } from "./fixtures/native-eventlog-relay"

if (process.argv.includes("--serve")) {
	let scope = await Effect.runPromise(Scope.make())
	let relay = await Effect.runPromise(
		Layer.build(nativeEventLogRelayLayer()).pipe(
			Effect.provideService(Scope.Scope, scope),
		),
	)
	let remote = NetAddress.formatUrlUnsafe(
		Context.get(relay, SocketServer.SocketServer).address,
		"ws",
	)
	let build = await Bun.build({
		entrypoints: ["tests/browser-native-eventlog-fixture.ts"],
		target: "browser",
	})
	if (!build.success || !build.outputs[0])
		throw new Error("Native journal fixture build failed")
	let script = await build.outputs[0].text()
	let server = Bun.serve({
		port: 0,
		routes: {
			"/": new Response(
				'<!doctype html><title>Native journal experiment</title><script type="module" src="/fixture.js"></script>',
				{ headers: { "Content-Type": "text/html" } },
			),
			"/fixture.js": new Response(script, {
				headers: { "Content-Type": "text/javascript" },
			}),
		},
		fetch: () => new Response("Not found", { status: 404 }),
	})
	console.log(server.url.href + "?remote=" + encodeURIComponent(remote))
	process.once("SIGTERM", () => {
		server.stop(true)
		Effect.runPromise(Scope.close(scope, Exit.void)).then(() => process.exit(0))
	})
} else {
	let server = Bun.spawn(
		["bun", "tests/browser-native-eventlog.ts", "--serve"],
		{
			stdout: "pipe",
			stderr: "inherit",
		},
	)
	let session = "native-journal-" + Date.now()
	try {
		let output = await server.stdout.getReader().read()
		if (!output.value) throw new Error("No native journal fixture URL")
		let url = new TextDecoder().decode(output.value).trim()
		browser(session, "open", url)
		wait(session, 'document.body.dataset.done === "true"')
		let failure = evaluate(session, "document.body.dataset.failure ?? null")
		if (failure)
			console.error(evaluate(session, "document.body.dataset.results"))
		assert(!failure, "native journal experiment completes: " + (failure ?? ""))
		let results = evaluate(
			session,
			'JSON.parse(document.body.dataset.results ?? "null")',
		)
		if (!Array.isArray(results))
			throw new Error("Missing native journal results")
		for (let result of results) assert(true, String(result))

		assert(results.length === 86, "all native browser journal assertions ran")
	} finally {
		browser(session, "close")
		server.kill()
		await server.exited
	}
}
