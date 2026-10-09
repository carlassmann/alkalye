import {
	assert,
	browser,
	evaluate,
	wait,
	serverAddress,
} from "./browser-driver"

let version = 1
let development = Bun.argv.includes("--development")
if (Bun.argv.includes("--serve")) {
	let built = await Bun.build({
		entrypoints: ["tests/browser-updates-fixture.ts"],
		target: "browser",
		define: {
			"process.env.NODE_ENV": JSON.stringify(
				development ? "development" : "production",
			),
		},
	})
	if (!built.success || !built.outputs[0])
		throw new Error("Update fixture build failed")
	let script = await built.outputs[0].text()
	let worker = await Bun.file("public/sw.js").text()
	let server = Bun.serve({
		port: 0,
		fetch(request) {
			let url = new URL(request.url)
			if (url.pathname === "/version") {
				version = Number(url.searchParams.get("value"))
				return new Response("ok")
			}
			if (url.pathname === "/sw.js")
				return new Response(
					worker
						.replace("BUILD_VERSION", "updates-" + version)
						.replace("BUILD_DEVELOPMENT", String(development))
						.replaceAll('"BUILD_STYLES"', '"/app.css"')
						.replaceAll('"BUILD_SCRIPTS"', '"/app.js"')
						.replaceAll('"BUILD_TLDRAW"', '"/fixture.svg"'),
					{
						headers: {
							"content-type": "application/javascript",
							"cache-control": "no-store",
						},
					},
				)
			if (url.pathname === "/app.js")
				return new Response(script, {
					headers: { "content-type": "application/javascript" },
				})
			if (
				url.pathname.startsWith("/app") ||
				url.pathname === "/" ||
				url.pathname.endsWith(".html")
			)
				return new Response(
					`<!doctype html><html lang="en"><body data-version="${version}"><textarea aria-label="Draft"></textarea><button data-release>Finish saving</button><button data-abort>Close watcher</button><button data-fail>Fail saving</button><script type="module" src="/app.js"></script></body></html>`,
					{ headers: { "content-type": "text/html" } },
				)
			return new Response("fixture")
		},
	})
	console.log(server.url.href)
} else {
	let child = Bun.spawn(
		[
			"bun",
			import.meta.path,
			"--serve",
			...(development ? ["--development"] : []),
		],
		{
			stdout: "pipe",
			stderr: "inherit",
		},
	)
	let session = "updates-" + Date.now()
	let origin = new URL(await serverAddress(child.stdout))
	try {
		browser(session, "open", new URL("/app", origin).href)
		wait(
			session,
			"document.body.dataset.ready && navigator.serviceWorker.controller",
		)
		assert(
			evaluate(session, "!document.body.dataset.offered"),
			"First installation does not offer a reload",
		)
		wait(session, 'document.body.dataset.offlineReady === "true"')
		browser(
			session,
			"tab",
			"new",
			"--label",
			"draft",
			new URL("/app/doc/draft", origin).href,
		)
		wait(
			session,
			"document.body.dataset.ready && navigator.serviceWorker.controller",
		)
		browser(session, "fill", "textarea", "Unsaved Unicode draft 🧑🏽‍💻")
		await fetch(new URL("/version?value=2", origin))
		evaluate(session, 'window.dispatchEvent(new Event("focus"))')
		wait(session, 'document.body.dataset.offered === "true"')
		assert(
			evaluate(
				session,
				'document.body.dataset.version === "1" && document.querySelector("textarea").value === "Unsaved Unicode draft 🧑🏽‍💻"',
			),
			"Update detection preserves the open unsaved draft",
		)
		browser(session, "tab", "t1")
		evaluate(session, 'window.dispatchEvent(new Event("online"))')
		wait(session, 'document.body.dataset.offered === "true"')
		browser(session, "click", "[data-update-apply]")
		wait(session, 'document.body.dataset.flushing === "true"')
		assert(
			evaluate(session, 'document.body.dataset.version === "1"'),
			"Manual update waits for saving",
		)
		browser(session, "click", "[data-release]")
		wait(
			session,
			'document.body.dataset.version === "2" && document.body.dataset.ready',
		)
		browser(session, "tab", "draft")
		assert(
			evaluate(
				session,
				'document.body.dataset.version === "1" && document.querySelector("textarea").value === "Unsaved Unicode draft 🧑🏽‍💻"',
			),
			"Activation in another tab never reloads the typing tab",
		)
		browser(session, "set", "offline", "on")
		browser(session, "click", "[data-update-apply]")
		browser(session, "click", "[data-release]")
		wait(
			session,
			'document.body.dataset.version === "2" && document.body.dataset.ready',
		)
		assert(
			evaluate(
				session,
				'document.querySelector("textarea").value === "Unsaved Unicode draft 🧑🏽‍💻"',
			),
			"A stale update offer reloads the activated shell offline after saving",
		)
		browser(session, "set", "offline", "off")
		await fetch(new URL("/version?value=3", origin))
		evaluate(session, 'window.dispatchEvent(new Event("online"))')
		wait(session, 'document.body.dataset.offered === "true"')
		browser(session, "click", "[data-update-apply]")
		browser(session, "click", "[data-fail]")
		wait(
			session,
			'document.body.dataset.saveFailed === "true" && !document.querySelector("[data-update-apply]").disabled',
		)
		assert(
			evaluate(session, 'document.body.dataset.version === "2"'),
			"A failed save preserves the open build and enables retry",
		)
		browser(session, "click", "[data-update-apply]")
		browser(session, "click", "[data-release]")
		wait(
			session,
			'document.body.dataset.version === "3" && document.body.dataset.ready',
		)
		await fetch(new URL("/version?value=4", origin))
		evaluate(session, 'window.dispatchEvent(new Event("online"))')
		wait(session, 'document.body.dataset.offered === "true"')
		browser(session, "click", "[data-update-apply]")
		browser(session, "click", "[data-abort]")
		browser(session, "click", "[data-release]")
		assert(
			evaluate(session, 'document.body.dataset.version === "3"'),
			"An aborted owner cannot apply a pending update after saving",
		)
		console.log("Update lifecycle PASS")
	} finally {
		try {
			browser(session, "close")
		} catch {}
		child.kill("SIGTERM")
		await child.exited
	}
}
