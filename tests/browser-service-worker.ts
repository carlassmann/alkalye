import {
	assert,
	browser,
	evaluate,
	wait,
	serverAddress,
} from "./browser-driver"

let workerSource = await Bun.file("public/sw.js").text()
let version = 1
let development = Bun.argv.includes("--development")
let session = "service-worker-" + Date.now()
let server = Bun.argv.includes("--serve")
	? Bun.serve({
			port: 0,
			fetch(request) {
				let url = new URL(request.url)
				let path = url.pathname
				if (path === "/api/test/version") {
					version = Number(url.searchParams.get("value"))
					return new Response("ok")
				}
				if (path === "/sw.js")
					return new Response(
						workerSource
							.replace("BUILD_VERSION", "test-" + version)
							.replace(
								"BUILD_DEVELOPMENT",
								String(Bun.argv.includes("--development")),
							)
							.replace(
								'"BUILD_STYLES"',
								'"/chunks/whiteboard-' + hash() + '.css"',
							)
							.replace(
								'"BUILD_SCRIPTS"',
								'"/chunks/whiteboard-' + hash() + '.js"',
							)
							.replace('"BUILD_TLDRAW"', '"/tldraw/fixture.svg"'),
						{
							headers: {
								"content-type": "application/javascript",
								"cache-control": "no-store",
							},
						},
					)
				if (path.startsWith("/chunks/")) {
					if (!path.includes(hash()))
						return new Response("Old build removed", { status: 404 })
					return new Response(
						path.endsWith(".css")
							? ".board { color: red }"
							: `export let version = ${version}`,
						{
							headers: {
								"content-type": path.endsWith(".css")
									? "text/css"
									: "application/javascript",
							},
						},
					)
				}
				if (
					path === "/app" ||
					path.startsWith("/app/") ||
					path === "/app.html" ||
					path === "/index.html" ||
					path === "/"
				)
					return new Response(
						`<!doctype html><title>Offline build ${version}</title><button id="lazy">Open whiteboard</button><output id="result"></output><script type="module">
				window.buildVersion = ${version};
				window.registration = await navigator.serviceWorker.register("/sw.js");
				document.querySelector("#lazy").onclick = async () => {
					try { let board = await import("/chunks/whiteboard-${hash()}.js"); document.querySelector("#result").textContent = "Loaded " + board.version; }
					catch (error) { document.querySelector("#result").textContent = "Failed: " + error.message; }
				};
			</script>`,
						{ headers: { "content-type": "text/html" } },
					)
				return new Response(
					path.endsWith(".js") ? `export let version = ${version}` : "fixture",
					{
						headers: {
							"content-type": path.endsWith(".js")
								? "application/javascript"
								: "text/plain",
						},
					},
				)
			},
		})
	: undefined
if (server) {
	console.log(server.url.href)
} else {
	let child = Bun.spawn(
		[
			"bun",
			import.meta.path,
			"--serve",
			...(Bun.argv.includes("--development") ? ["--development"] : []),
		],
		{
			stdout: "pipe",
			stderr: "inherit",
		},
	)
	let origin = new URL(await serverAddress(child.stdout))
	try {
		browser(session, "open", new URL("/app", origin).href)
		wait(
			session,
			'navigator.serviceWorker.controller && window.registration?.active?.state === "activated"',
		)
		browser(
			session,
			"tab",
			"new",
			"--label",
			"old-tab",
			new URL("/app/doc/cached", origin).href,
		)
		wait(
			session,
			"navigator.serviceWorker.controller && window.buildVersion === 1",
		)
		await evaluate(
			session,
			'caches.open("another-app").then(cache => cache.put("/keep", new Response("keep")))',
		)
		if (Bun.argv.includes("--legacy-owners"))
			evaluate(session, 'caches.delete("alkalye-cache-owners")')
		evaluate(
			session,
			"window.previousController = navigator.serviceWorker.controller",
		)
		await fetch(new URL("/api/test/version?value=2", origin))
		evaluate(session, "window.registration.update()")
		if (development) {
			wait(
				session,
				"navigator.serviceWorker.controller !== window.previousController",
			)
			browser(session, "tab", "t1")
			browser(session, "reload")
		} else {
			wait(session, 'window.registration.waiting?.state === "installed"')
			assert(
				evaluate(session, "window.buildVersion === 1"),
				"Production update waits without interrupting an open page",
			)
			browser(session, "tab", "t1")
			evaluate(
				session,
				'navigator.serviceWorker.getRegistration().then(registration => { navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), {once:true}); registration.waiting.postMessage("activate") })',
			)
		}
		wait(
			session,
			"window.buildVersion === 2 && navigator.serviceWorker.controller !== null",
		)
		browser(session, "tab", "old-tab")
		assert(
			evaluate(session, "window.buildVersion === 1"),
			"Another tab keeps its open build when an update is applied elsewhere",
		)
		browser(session, "set", "offline", "on")
		browser(session, "click", "#lazy")
		wait(session, 'document.querySelector("#result").textContent !== ""')
		assert(
			evaluate(
				session,
				'document.querySelector("#result").textContent === "Loaded 1"',
			),
			"An older open tab can load a previously unused whiteboard chunk after an offline upgrade",
		)
		assert(
			evaluate(
				session,
				'fetch("/chunks/whiteboard-aaaaaaaa.css").then(response => response.text()).then(css => css.includes(".board"))',
			),
			"An older lazy island also retains its hashed stylesheet offline",
		)
		assert(
			evaluate(
				session,
				'fetch("/app.js").then(response => response.text()).then(script => script.includes("version = 2"))',
			),
			"Unversioned scripts always come from the current build",
		)
		assert(
			evaluate(session, 'caches.has("another-app")'),
			"Activation preserves caches belonging to other applications",
		)
		browser(session, "reload")
		wait(session, "window.buildVersion === 2")
		assert(
			true,
			"Cold offline navigation loads the current shell rather than an old cached shell",
		)
		browser(session, "set", "offline", "off")
		browser(
			session,
			"tab",
			"new",
			"--label",
			"docs",
			new URL("/support", origin).href,
		)
		wait(session, "navigator.serviceWorker.controller !== null")
		browser(session, "tab", "close", "old-tab")
		browser(session, "tab", "t1")
		evaluate(
			session,
			'caches.open("alkalye-cache-owners").then(async owners => { for (let request of await owners.keys()) { let saved = await owners.match(request); await owners.put(request, new Response(await saved.text(), {headers:{"x-recorded-at":"0"}})); } })',
		)
		evaluate(
			session,
			"window.previousController = navigator.serviceWorker.controller",
		)
		evaluate(
			session,
			'caches.open("alkalye-cache-owners").then(owners => owners.put("/__alkalye_cache_owner__/reserved-navigation", new Response("alkalye-test-1", {headers:{"x-recorded-at":String(Date.now())}})))',
		)
		await fetch(new URL("/api/test/version?value=3", origin))
		evaluate(session, "window.registration.update()")
		if (development) {
			wait(
				session,
				"navigator.serviceWorker.controller !== window.previousController",
			)
			browser(session, "reload")
		} else {
			wait(session, 'window.registration.waiting?.state === "installed"')
			evaluate(
				session,
				'navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), {once:true}); window.registration.waiting.postMessage("activate")',
			)
		}
		wait(session, "window.buildVersion === 3")
		assert(
			evaluate(session, 'caches.has("alkalye-test-1")'),
			"A recently reserved navigation retains its old build before matchAll reports the client",
		)
		evaluate(
			session,
			'caches.open("alkalye-cache-owners").then(async owners => { let request = "/__alkalye_cache_owner__/reserved-navigation"; await owners.put(request, new Response("alkalye-test-1", {headers:{"x-recorded-at":"0"}})); })',
		)
		evaluate(
			session,
			"window.previousController = navigator.serviceWorker.controller",
		)
		await fetch(new URL("/api/test/version?value=4", origin))
		evaluate(session, "window.registration.update()")
		if (development) {
			wait(
				session,
				"navigator.serviceWorker.controller !== window.previousController",
			)
			browser(session, "reload")
		} else {
			wait(session, 'window.registration.waiting?.state === "installed"')
			evaluate(
				session,
				'navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), {once:true}); window.registration.waiting.postMessage("activate")',
			)
		}
		wait(session, "window.buildVersion === 4")
		wait(session, 'caches.has("alkalye-test-1").then(exists => !exists)')
		assert(
			true,
			"A later activation removes the old build once no live tab owns it",
		)
	} finally {
		try {
			browser(session, "close")
		} catch {}
		child.kill("SIGTERM")
		await child.exited
	}
}
function hash() {
	return version === 1
		? "aaaaaaaa"
		: version === 2
			? "bbbbbbbb"
			: version === 3
				? "cccccccc"
				: "dddddddd"
}
