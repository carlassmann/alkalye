import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

let root = resolve(import.meta.dir, "..")
let mode = Bun.argv[2]

async function run(args: string[]) {
	let child = Bun.spawn(args, {
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
	})
	function stop() {
		child.kill("SIGTERM")
	}
	process.once("SIGINT", stop)
	process.once("SIGTERM", stop)
	try {
		let exit = await child.exited
		if (exit !== 0) throw Error(`${args.join(" ")} exited ${exit}`)
	} finally {
		process.removeListener("SIGINT", stop)
		process.removeListener("SIGTERM", stop)
	}
}
async function build() {
	await run(["bun", "build.ts"])
	await run([
		"bun",
		"x",
		"--no-install",
		"wrangler",
		"deploy",
		"--dry-run",
		"--outdir",
		".cloudflare/build",
	])
}
async function types() {
	await mkdir(resolve(root, "src/cloudflare"), { recursive: true })
	await run([
		"bun",
		"x",
		"--no-install",
		"wrangler",
		"types",
		"src/cloudflare/worker-configuration.d.ts",
		"--env-interface",
		"CloudflareEnv",
		"--include-runtime=false",
	])
	await run([
		"bun",
		"x",
		"--no-install",
		"prettier",
		"--write",
		"src/cloudflare/worker-configuration.d.ts",
	])
	await run([
		"bun",
		"x",
		"--no-install",
		"tsc",
		"--noEmit",
		"-p",
		"tsconfig.cloudflare.json",
	])
}
switch (mode) {
	case "build":
		await build()
		break
	case "types":
		await types()
		break
	case "check":
		await types()
		await build()
		break
	case "dev":
		await run(["bun", "build.ts"])
		await run([
			"bun",
			"x",
			"--no-install",
			"wrangler",
			"dev",
			"--local",
			"--ip",
			"127.0.0.1",
			"--port",
			"8787",
		])
		break
	case "deploy":
		await build()
		await run([
			"bun",
			"x",
			"--no-install",
			"wrangler",
			"deploy",
			...Bun.argv.slice(3),
		])
		break
	default:
		throw Error("Expected build, dev, deploy, types or check")
}
