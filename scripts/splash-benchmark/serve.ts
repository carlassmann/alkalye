import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { extname } from "node:path"

let root = process.env.SPLASH_BUILD ?? "/tmp/alkalye-splash-baseline"
let contentTypes: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".webmanifest": "application/manifest+json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
}
createServer(async (request, response) => {
	let path = new URL(request.url ?? "/", "http://localhost").pathname
	if (path.startsWith("/app")) path = "/app/index.html"
	if (path.endsWith("/")) path += "index.html"
	try {
		if ((await stat(root + path)).isDirectory()) path += "/index.html"
		let body = await readFile(root + path)
		response.writeHead(200, {
			"Content-Type": contentTypes[extname(path)] ?? "application/octet-stream",
			"Cache-Control": path.includes("/_astro/")
				? "public, max-age=31536000, immutable"
				: "no-cache",
			"Service-Worker-Allowed": "/",
		})
		response.end(body)
	} catch {
		response.writeHead(404)
		response.end("Not found")
	}
}).listen(Number(process.env.PORT ?? 4329), process.env.HOST ?? "127.0.0.1")
