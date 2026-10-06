import { resolve, sep } from "node:path"

let directory = process.argv[2]
if (!directory)
	throw Error(
		"Usage: bun experiments/performance/serve-original.ts BUILD_DIRECTORY [PORT]",
	)
let root = resolve(directory)
let probe = await Bun.file(resolve(import.meta.dir, "browser-probe.js")).text()

Bun.serve({
	hostname: "127.0.0.1",
	port: Number(process.argv[3] ?? 4310),
	async fetch(request) {
		let url = new URL(request.url)
		let path = resolve(root, "." + decodeURIComponent(url.pathname))
		if (path === root) path = resolve(root, "index.html")
		if (!path.startsWith(root + sep))
			return new Response("Not found", { status: 404 })
		if (url.pathname === "/app" || url.pathname.startsWith("/app/"))
			path = resolve(root, "app/index.html")
		if (await Bun.file(path + "/index.html").exists()) path += "/index.html"
		let file = Bun.file(path)
		if (!(await file.exists()))
			return new Response("Not found", { status: 404 })
		let headers = new Headers({
			"Content-Type": file.type,
			"Cache-Control": "no-cache",
		})
		let body = file.type.startsWith("text/html")
			? new TextEncoder().encode(
					(await file.text()).replace(
						"<head>",
						`<head><script>${probe}</script>`,
					),
				)
			: new Uint8Array(await file.arrayBuffer())
		if (/\.(html|js|css|json|svg)$/.test(path)) {
			headers.set("Content-Encoding", "gzip")
			body = Bun.gzipSync(body)
		}
		return new Response(body, { headers })
	},
})
