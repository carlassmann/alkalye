let cacheName = "alkalye-BUILD_VERSION"
let ownerCacheName = "alkalye-cache-owners"
let ownerPath = "/__alkalye_cache_owner__/"
let development = BUILD_DEVELOPMENT
let shell = [
	"BUILD_STYLES",
	"BUILD_SCRIPTS",
	"BUILD_TLDRAW",
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
		caches.open(cacheName).then(async cache => {
			await cache.addAll([...new Set(shell)])
			if (development) await self.skipWaiting()
		}),
	)
})
self.addEventListener("message", event => {
	if (event.data === "activate") self.skipWaiting()
})
self.addEventListener("activate", event => {
	event.waitUntil(pruneCaches().then(() => self.clients.claim()))
})

function cacheOwnership(action) {
	return self.navigator.locks
		? self.navigator.locks.request("alkalye-cache-ownership", action)
		: action()
}

async function storeClient(owners, client, version) {
	await owners.put(
		ownerPath + encodeURIComponent(client),
		new Response(version, {
			headers: { "x-recorded-at": String(Date.now()) },
		}),
	)
}

async function rememberClient(client, version) {
	if (!client) return
	await cacheOwnership(async () => {
		let owners = await caches.open(ownerCacheName)
		await storeClient(owners, client, version)
	})
}

function pruneCaches() {
	return cacheOwnership(async () => {
		let versions = (await caches.keys()).filter(
			key =>
				key.startsWith("alkalye-") &&
				key !== ownerCacheName &&
				key !== cacheName,
		)
		let clients = await self.clients.matchAll({
			type: "window",
			includeUncontrolled: true,
		})
		let owners = await caches.open(ownerCacheName)
		let retained = new Set([cacheName])
		let known = Boolean(self.navigator.locks)
		for (let client of clients) {
			let saved = await owners.match(ownerPath + encodeURIComponent(client.id))
			if (saved) retained.add(await saved.text())
			else if (!versions.length) await storeClient(owners, client.id, cacheName)
			else known = false
		}
		let live = new Set(clients.map(client => client.id))
		for (let request of await owners.keys()) {
			let client = decodeURIComponent(
				new URL(request.url).pathname.slice(ownerPath.length),
			)
			if (live.has(client)) continue
			let saved = await owners.match(request)
			// A navigation reserves its new client before matchAll can see it.
			if (
				saved &&
				Date.now() - Number(saved.headers.get("x-recorded-at")) < 60_000
			)
				retained.add(await saved.text())
			else await owners.delete(request)
		}
		// Legacy tabs have no ownership record. Keep their caches until they
		// close or navigate through this worker.
		if (known)
			await Promise.all(
				versions
					.filter(version => !retained.has(version))
					.map(version => caches.delete(version)),
			)
	})
}

async function previousAsset(request) {
	let path = new URL(request.url).pathname
	if (!/^\/chunks\/[^/]+-[a-z0-9]{8}\.(js|css)$/i.test(path)) return
	for (let version of await caches.keys()) {
		if (
			!version.startsWith("alkalye-") ||
			version === ownerCacheName ||
			version === cacheName
		)
			continue
		let previous = await (await caches.open(version)).match(request)
		if (previous) return previous
	}
}

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
	let owner =
		event.request.mode === "navigate"
			? rememberClient(event.resultingClientId, cacheName).catch(() => {})
			: Promise.resolve()
	event.respondWith(
		owner
			.then(() => caches.open(cacheName))
			.then(async cache => {
				let key = app ? "/app" : event.request
				let cached = await cache.match(key)
				if (development) {
					try {
						let response = await fetch(event.request, {
							cache: "no-store",
							signal: AbortSignal.timeout(3000),
						})
						if (response.ok) {
							event.waitUntil(cache.put(key, response.clone()).catch(() => {}))
						}
						if (!response.ok) {
							let previous = await previousAsset(event.request)
							if (previous) return previous
						}
						return response
					} catch (error) {
						if (cached) return cached
						let previous = await previousAsset(event.request)
						if (previous) return previous
						throw error
					}
				}
				if (cached) return cached
				let previous = await previousAsset(event.request)
				if (previous) return previous
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
