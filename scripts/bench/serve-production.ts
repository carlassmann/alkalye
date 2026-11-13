import { spawn } from "node:child_process"
import { createServer, request } from "node:http"
import { readFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { promisify } from "node:util"
import { brotliCompress, gzip, constants } from "node:zlib"

let root = resolve(process.env.BENCH_BUILD_ROOT ?? process.cwd())
let assets = resolve(root, "dist/client/_astro")
let port = Number(process.env.PORT)
let upstream = port + 10000
let brotli = promisify(brotliCompress)
let gz = promisify(gzip)
let child = spawn(
	"node",
	[
		"--env-file=" + resolve(root, ".env"),
		resolve(root, "dist/server/entry.mjs"),
	],
	{
		env: { ...process.env, PORT: String(upstream), HOST: "127.0.0.1" },
		stdio: "inherit",
	},
)
process.on("exit", () => child.kill())
process.on("SIGTERM", () => {
	child.kill()
	process.exit()
})
let cache = new Map<string, Promise<Buffer>>()
createServer(async (req, res) => {
	let path = new URL(req.url ?? "/", "http://localhost").pathname
	let file = resolve(assets, path.slice("/_astro/".length))
	let type = path.endsWith(".wasm")
		? "application/wasm"
		: path.endsWith(".js")
			? "text/javascript"
			: path.endsWith(".css")
				? "text/css"
				: null
	if (path.startsWith("/_astro/") && file.startsWith(assets + sep) && type) {
		try {
			let encoding =
				process.env.BENCH_COMPRESSION === "identity"
					? "identity"
					: req.headers["accept-encoding"]?.includes("br")
						? "br"
						: req.headers["accept-encoding"]?.includes("gzip")
							? "gzip"
							: "identity"
			let key = `${file}:${encoding}`
			let pending = cache.get(key)
			if (!pending) {
				pending = readFile(file).then(bytes =>
					encoding === "br"
						? brotli(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } })
						: encoding === "gzip"
							? gz(bytes)
							: bytes,
				)
				cache.set(key, pending)
			}
			let bytes = await pending
			res.writeHead(200, {
				"content-type": type,
				"content-length": bytes.length,
				"cache-control": "public, max-age=31536000, immutable",
				vary: "Accept-Encoding",
				...(encoding === "identity" ? {} : { "content-encoding": encoding }),
			})
			res.end(req.method === "HEAD" ? undefined : bytes)
			return
		} catch {
			res.writeHead(404)
			res.end()
			return
		}
	}
	let proxy = request(
		{
			hostname: "127.0.0.1",
			port: upstream,
			path: req.url,
			method: req.method,
			headers: req.headers,
		},
		response => {
			res.writeHead(response.statusCode ?? 502, response.headers)
			response.pipe(res)
		},
	)
	proxy.on("error", () => {
		if (res.destroyed) return
		if (res.headersSent) {
			res.destroy()
			return
		}
		res.writeHead(502)
		res.end()
	})
	res.on("close", () => {
		if (!res.writableEnded) proxy.destroy()
	})
	req.pipe(proxy)
}).listen(port, "0.0.0.0")
