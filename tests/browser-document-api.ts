import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import { startServer } from "../src/server/index"
import { assert, browser, evaluate, wait } from "./browser-driver"

if (process.argv.includes("--serve")) {
	let build = await Bun.build({
		entrypoints: ["tests/browser-document-api-fixture.ts"],
		target: "browser",
	})
	if (!build.success || !build.outputs[0])
		throw new Error("Document browser fixture build failed")
	let script = await build.outputs[0].text()
	let backend: Effect.Success<ReturnType<typeof startServer>>
	let server = Bun.serve({
		port: 0,
		fetch: async request => {
			let url = new URL(request.url)
			if (url.pathname === "/")
				return new Response(
					'<!doctype html><title>Document API browser tests</title><script type="module" src="/fixture.js"></script>',
					{ headers: { "content-type": "text/html" } },
				)
			if (url.pathname === "/fixture.js")
				return new Response(script, {
					headers: { "content-type": "text/javascript" },
				})
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
	let directory = await mkdtemp(join(tmpdir(), "alkalye-document-browser-"))
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
	let server = Bun.spawn(["bun", "tests/browser-document-api.ts", "--serve"], {
		stdout: "pipe",
		stderr: "inherit",
	})
	let session = "document-api-" + Date.now()
	try {
		let output = await server.stdout.getReader().read()
		if (!output.value) throw new Error("Missing document fixture URL")
		let url = new TextDecoder().decode(output.value).trim()
		console.log(url)
		browser(session, "open", url)
		let deadline = Date.now() + 120000
		while (
			Date.now() < deadline &&
			!evaluate(session, "window.documentApiDone === true")
		) {
			let count = Number(
				evaluate(session, "window.documentApiResults?.length ?? 0"),
			)
			wait(
				session,
				`window.documentApiDone === true || (window.documentApiResults?.length ?? 0) > ${count}`,
			)
		}
		assert(
			evaluate(session, "window.documentApiDone === true"),
			"document scenarios finish within their progress budget",
		)
		let failure = evaluate(session, "window.documentApiFailure ?? null")
		if (failure)
			console.error(
				"Completed browser assertions",
				evaluate(session, "window.documentApiResults?.slice(-20)"),
			)
		assert(
			!failure,
			"real browser document API scenarios complete: " + (failure ?? ""),
		)
		let results = evaluate(session, "window.documentApiResults")
		if (!Array.isArray(results))
			throw new Error("Missing browser document results")
		for (let result of results) assert(true, String(result))
		assert(results.length === 321, "all document browser assertions ran")
		console.log(
			"MEASURE",
			JSON.stringify(evaluate(session, "window.documentApiMeasurements")),
		)
	} finally {
		browser(session, "close")
		server.kill("SIGTERM")
		await server.exited
	}
}
