import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	assert,
	browser,
	evaluate,
	serverAddress,
	wait,
} from "./browser-driver"

if (Bun.argv.includes("--serve")) {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-preview-module-"))
	let bundle = await Bun.build({
		entrypoints: [join(import.meta.dir, "browser-preview-fixture.ts")],
		outdir: directory,
		target: "browser",
		minify: true,
	})
	if (!bundle.success) throw new Error("Preview fixture failed to build")
	let server = Bun.serve({
		port: 0,
		fetch(request) {
			let path = new URL(request.url).pathname
			if (path === "/fixture.js")
				return new Response(
					Bun.file(join(directory, "browser-preview-fixture.js")),
				)
			if (
				path.startsWith("/components/") &&
				/^[\w.-]+\.css$/.test(path.slice(12))
			)
				return new Response(
					Bun.file(join(import.meta.dir, "../src/client", path)),
					{ headers: { "content-type": "text/css" } },
				)
			return new Response(
				'<!doctype html><script type="module" src="/fixture.js"></script>',
				{ headers: { "content-type": "text/html" } },
			)
		},
	})
	console.log(server.url.href)
	for (let signal of ["SIGTERM", "SIGINT"])
		process.once(signal, async () => {
			server.stop(true)
			await rm(directory, { recursive: true, force: true })
			process.exit(0)
		})
} else {
	let server = Bun.spawn(["bun", import.meta.path, "--serve"], {
		stdout: "pipe",
		stderr: "inherit",
	})
	let session = "preview-module-" + Date.now()
	try {
		browser(session, "open", await serverAddress(server.stdout))
		wait(session, 'typeof window.runPreviewChecks === "function"')
		let checks = evaluate(session, "window.runPreviewChecks()")
		if (!Array.isArray(checks)) throw new Error("Preview checks missing")
		for (let message of checks) {
			if (typeof message !== "string") throw new Error("Invalid preview check")
			assert(true, message)
		}
	} finally {
		try {
			browser(session, "close")
		} catch {}
		server.kill()
		await server.exited
	}
}
