import { assert, browser, evaluate, wait } from "./browser-driver"

if (process.argv.includes("--serve")) {
	let build = await Bun.build({
		entrypoints: ["tests/browser-storage-fixture.ts"],
		target: "browser",
	})
	if (!build.success || !build.outputs[0])
		throw new Error("Storage fixture build failed")
	let script = await build.outputs[0].text()
	let server = Bun.serve({
		port: 0,
		routes: {
			"/": new Response(
				'<!doctype html><title>Storage fault tests</title><script type="module" src="/fixture.js"></script>',
				{ headers: { "Content-Type": "text/html" } },
			),
			"/fixture.js": new Response(script, {
				headers: { "Content-Type": "text/javascript" },
			}),
		},
		fetch: () => new Response("Not found", { status: 404 }),
	})
	console.log(server.url.href)
} else {
	let server = Bun.spawn(["bun", "tests/browser-storage.ts", "--serve"], {
		stdout: "pipe",
		stderr: "inherit",
	})
	let session = "storage-faults-" + Date.now()
	try {
		let reader = server.stdout.getReader()
		let output = await reader.read()
		if (!output.value) throw new Error("No fixture server URL")
		let url = new TextDecoder().decode(output.value).trim()
		browser(session, "open", url)
		wait(session, "window.storageDone === true")
		let failure = evaluate(session, "window.storageFailure ?? null")
		assert(!failure, "real IndexedDB scenarios complete: " + (failure ?? ""))
		let results = evaluate(session, "window.storageResults")
		if (!Array.isArray(results)) throw new Error("Missing storage results")
		for (let result of results) assert(true, String(result))
		assert(results.length === 12, "all settings storage assertions ran")
	} finally {
		browser(session, "close")
		server.kill()
		await server.exited
	}
}
