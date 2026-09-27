import { serve, file } from "bun"
import { readFileSync } from "node:fs"
import process from "node:process"

let rootFile = process.argv[2] ?? "/tmp/sidebar-root"
serve({
	hostname: "127.0.0.1",
	port: 4391,
	async fetch(request) {
		let root = readFileSync(rootFile, "utf8").trim()
		let path = new globalThis.URL(request.url).pathname
		let asset = file(root + path)
		if (!(await asset.exists())) asset = file(root + path + "/index.html")
		if (!(await asset.exists()) && path.startsWith("/app"))
			asset = file(root + "/app/index.html")
		if (!(await asset.exists()))
			return new globalThis.Response("Not found", { status: 404 })
		return new globalThis.Response(asset, {
			headers: {
				"Cache-Control":
					path.endsWith(".js") || path.endsWith(".css")
						? "public, max-age=3600"
						: "no-cache",
			},
		})
	},
})
