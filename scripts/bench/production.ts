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
	resolve(serving, "work.config.js"),
	`
export default {
 project: "alkalye-bench",
 commands: {
  classic: { run: 'HOST=0.0.0.0 BENCH_HISTORY_FALLBACK=1 BENCH_BUILD_ROOT=${classic} bun ${root}/scripts/bench/serve-production.ts', route: true },
  sync: { run: 'cd ${classic} && ulimit -c 0; NODE_OPTIONS=--max-old-space-size=32768 bunx jazz-run@0.20.19 sync --port "$PORT" --host "$HOST"', route: true },
  v2: { run: 'cd ${serving} && ALKALYE_LOCAL_PREVIEW=1 WORK_WEB_URL=https://v2-main-alkalye-bench.cshed.carlassmann.com JAZZ_PUBLIC_URL=https://v2-main-alkalye-bench.cshed.carlassmann.com/jazz HOST=0.0.0.0 BENCH_BUILD_ROOT=${root} bun ${root}/scripts/bench/serve-production.ts', route: true }
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
