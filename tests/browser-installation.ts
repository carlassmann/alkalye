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
	let directory = await mkdtemp(join(tmpdir(), "alkalye-installation-module-"))
	let bundle = await Bun.build({
		entrypoints: [join(import.meta.dir, "browser-installation-fixture.ts")],
		outdir: directory,
		target: "browser",
		minify: true,
	})
	if (!bundle.success) throw new Error("Installation fixture failed to build")
	let server = Bun.serve({
		port: 0,
		fetch(request) {
			let path = new URL(request.url).pathname
			if (path === "/fixture.js")
				return new Response(
					Bun.file(join(directory, "browser-installation-fixture.js")),
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
	let session = "installation-module-" + Date.now()
	try {
		browser(session, "open", await serverAddress(server.stdout))
		wait(session, 'typeof window.runInstallationChecks === "function"')
		let checks = evaluate(session, "window.runInstallationChecks()")
		if (!Array.isArray(checks)) throw new Error("Installation checks missing")
		for (let message of checks) {
			if (typeof message !== "string")
				throw new Error("Invalid installation check")
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

if (!Bun.argv.includes("--serve")) {
	let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
		stdout: "pipe",
		stderr: "inherit",
	})
	let session = "installation-app-" + Date.now()
	try {
		let origin = await serverAddress(server.stdout)
		browser(session, "open", new URL("/app/settings?category=app", origin).href)
		wait(
			session,
			"Boolean(document.querySelector('[data-settings=install-instructions]'))",
		)
		browser(session, "click", "[data-settings=install-instructions]")
		wait(session, "document.querySelector('#dialog').open")
		evaluate(
			session,
			`(()=>{window.installCalls=0;let event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=()=>{window.installCalls++;window.installActivation=navigator.userActivation.isActive;return Promise.resolve()};event.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(event);return event.defaultPrevented})()`,
		)
		wait(
			session,
			"Boolean(document.querySelector('#dialog [data-install-app]'))",
		)
		browser(session, "click", "#dialog [data-install-app]")
		wait(
			session,
			"window.installCalls===1 && !document.querySelector('#dialog [data-install-app]')",
		)
		assert(
			evaluate(
				session,
				"window.installActivation && document.querySelector('#dialog').open",
			),
			"Settings late prompt invokes with trusted activation; dismissal keeps instructions",
		)
		evaluate(
			session,
			"(()=>{window.dispatchEvent(new Event('appinstalled'));return true})()",
		)
		wait(
			session,
			"!document.querySelector('#dialog').open && !document.querySelector('[data-settings=install-instructions]')",
		)
		assert(true, "Real Settings reacts to appinstalled without navigation")
	} finally {
		try {
			browser(session, "close")
		} catch {}
		server.kill()
		await server.exited
	}
}
