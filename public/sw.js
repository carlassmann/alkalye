let cacheName = "alkalye-BUILD_VERSION"
let shell = [
	"BUILD_STYLES",
	"BUILD_SCRIPTS",
	"/",
	"/app",
	"/index.html",
	"/app.html",
	"/app/native",
	"/changelog",
	"/support",
	"/privacy",
	"/terms",
	"/imprint",
	"/app.js",
	"/app.css",
	"/manifest.webmanifest",
	"/icons/alkalye-icon.png",
	"/fonts/geist-latin.woff2",
	"/fonts/geist-latin-ext.woff2",
	"/fonts/geist-mono-latin.woff2",
	"/fonts/geist-mono-latin-ext.woff2",
	"/docs/welcome.md",
	"/docs/tutor-alkalye.md",
	"/docs/tutor-markdown.md",
	"/docs/tutor-presentations.md",
]
self.addEventListener("install", event => {
	event.waitUntil(
		caches.open(cacheName).then(cache => cache.addAll([...new Set(shell)])),
	)
})
self.addEventListener("message", event => {
	if (event.data === "activate") self.skipWaiting()
})
self.addEventListener("activate", event => {
	event.waitUntil(
		caches
			.keys()
			.then(keys =>
				Promise.all(
					keys
						.filter(key => key.startsWith("alkalye-") && key !== cacheName)
						.map(key => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	)
})
self.addEventListener("fetch", event => {
	let url = new URL(event.request.url)
	if (
		url.origin !== location.origin ||
		event.request.method !== "GET" ||
		url.pathname.startsWith("/api/") ||
		url.pathname === "/mcp" ||
		url.pathname.startsWith("/oauth/") ||
		url.pathname === "/sync"
	)
		return
	// Every app address is the same shell; the client router reads the path.
	let app =
		event.request.mode === "navigate" &&
		(url.pathname === "/app" ||
			url.pathname.startsWith("/app/") ||
			url.pathname === "/invite")
	event.respondWith(
		caches.open(cacheName).then(async cache => {
			let cached = await cache.match(app ? "/app" : event.request)
			if (cached) return cached
			try {
				let response = await fetch(event.request)
				if (response.ok && !app)
					await cache.put(event.request, response.clone())
				return response
			} catch (error) {
				if (event.request.mode === "navigate")
					return (
						(await cache.match(app ? "/app" : "/index.html")) ||
						Response.error()
					)
				throw error
			}
		}),
	)
})
