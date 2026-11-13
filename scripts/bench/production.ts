import { execFileSync } from "node:child_process"
import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

// Keep infrastructure changes outside the immutable Classic app source.
let root = process.cwd()
let classic = "/tmp/alkalye-bench-classic"
let serving = "/tmp/alkalye-bench-production"
function run(command: string, args: string[], cwd: string) {
	execFileSync(command, args, { cwd, stdio: "inherit" })
}
await mkdir(serving, { recursive: true })
try {
	await readFile(resolve(classic, "package.json"))
} catch {
	run("git", ["worktree", "add", "--detach", classic, "8379d4e"], root)
}
let pkg = JSON.parse(await readFile(resolve(classic, "package.json"), "utf8"))
pkg.devDependencies["@astrojs/node"] = "9.5.5"
await writeFile(
	resolve(classic, "package.json"),
	JSON.stringify(pkg, null, "\t"),
)
let config = execFileSync("git", ["show", "8379d4e:astro.config.ts"], {
	cwd: root,
	encoding: "utf8",
})
await writeFile(
	resolve(classic, "astro.config.ts"),
	config
		.replace(
			'import vercel from "@astrojs/vercel"',
			'import node from "@astrojs/node"',
		)
		.replace("adapter: vercel(),", 'adapter: node({ mode: "standalone" }),'),
)
await cp(resolve(root, ".env"), resolve(classic, ".env"))
run("bun", ["install"], classic)
run("git", ["init", "-q", "--initial-branch=main"], serving)
await writeFile(
	resolve(serving, "classic-server.mjs"),
	`
import { createServer, request } from "node:http"
import { spawn } from "node:child_process"
let port = Number(process.env.PORT)
let upstream = port + 10000
let child = spawn("node", ["--env-file=.env", "dist/server/entry.mjs"], {
 cwd: ${JSON.stringify(classic)}, env: { ...process.env, PORT: String(upstream), HOST: "127.0.0.1" }, stdio: "inherit"
})
process.on("exit", () => child.kill())
process.on("SIGTERM", () => { child.kill(); process.exit() })
createServer((req, res) => {
 let path = req.url.startsWith("/app/") && !req.url.includes(".") ? "/app" : req.url
 let proxy = request({ hostname: "127.0.0.1", port: upstream, path, method: req.method, headers: req.headers }, response => {
  res.writeHead(response.statusCode, response.headers); response.pipe(res)
 })
 proxy.on("error", () => { res.writeHead(502); res.end() })
 req.pipe(proxy)
}).listen(port, "0.0.0.0")
`,
)
await writeFile(
	resolve(serving, "work.config.js"),
	`
export default {
 project: "alkalye-bench",
 commands: {
  classic: { run: 'node ${serving}/classic-server.mjs', route: true },
  sync: { run: 'cd ${classic} && ulimit -c 0; NODE_OPTIONS=--max-old-space-size=32768 bunx jazz-run@0.20.19 sync --port "$PORT" --host "$HOST"', route: true },
  v2: { run: 'cd ${serving} && ALKALYE_LOCAL_PREVIEW=1 WORK_WEB_URL=https://v2-main-alkalye-bench.cshed.carlassmann.com JAZZ_PUBLIC_URL=https://v2-main-alkalye-bench.cshed.carlassmann.com/jazz HOST=0.0.0.0 node --env-file=${root}/.env ${root}/dist/server/entry.mjs', route: true }
 }
}
`,
)
run("work", ["setup", "--tailscale"], serving)
run("work", ["run", "sync", "--tailscale"], serving)
execFileSync("bun", ["x", "astro", "build"], {
	cwd: classic,
	stdio: "inherit",
	env: {
		...process.env,
		PUBLIC_JAZZ_SYNC_SERVER:
			"wss://sync-main-alkalye-bench.cshed.carlassmann.com",
	},
})
execFileSync("bun", ["x", "astro", "build"], {
	cwd: root,
	stdio: "inherit",
	env: { ...process.env, ALKALYE_LOCAL_PREVIEW: "1" },
})
run("work", ["run", "classic", "--tailscale"], serving)
run("work", ["run", "v2", "--tailscale"], serving)
run("work", ["urls"], serving)
