/* global Headers, Response */
import { URL } from "node:url"
import Bun from "bun"
import process from "node:process"
import { resolve } from "node:path"
import { gzipSync } from "node:zlib"

let root = resolve(process.env.HEAVY_BUILD ?? "/tmp/alkalye-heavy/baseline")
let compressed = new Map()
Bun.serve({
	port: Number(process.env.PORT ?? 4317),
	async fetch(request) {
		let path = new URL(request.url).pathname
		let file = Bun.file(resolve(root, `.${path}`))
		if (!(await file.exists())) file = Bun.file(resolve(root, "app/index.html"))
		let headers = new Headers({
			"Content-Type": file.type,
			"Cache-Control": path.includes("/_astro/")
				? "public, max-age=31536000, immutable"
				: "no-cache",
		})
		if (path.endsWith(".js") || path.endsWith(".css")) {
			let data = compressed.get(path)
			if (!data) {
				data = gzipSync(await file.arrayBuffer())
				compressed.set(path, data)
			}
			headers.set("Content-Encoding", "gzip")
			return new Response(data, { headers })
		}
		return new Response(file, { headers })
	},
})
