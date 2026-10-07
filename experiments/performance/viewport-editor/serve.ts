import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import { startServer } from "../../../src/server/index"

let root = import.meta.dir
let directory = process.argv[2] ?? "/tmp/alkalye-viewport-prototype"
let assets = join(directory, "assets")
await mkdir(assets, { recursive: true })
let entrypoints = [root + "/app.ts"]
if (await Bun.file(root + "/session-worker.ts").exists())
	entrypoints.push(root + "/session-worker.ts")
let build = await Bun.build({
	entrypoints,
	outdir: assets,
	target: "browser",
	splitting: true,
	minify: true,
})
if (!build.success) throw new AggregateError(build.logs)
await Promise.all([
	Bun.write(join(assets, "index.html"), Bun.file(root + "/index.html")),
	Bun.write(join(assets, "editor.css"), Bun.file(root + "/editor.css")),
])
let running = await Effect.runPromise(
	startServer({
		port: 4331,
		hostname: "127.0.0.1",
		assets,
		data: join(directory, "data"),
		build: false,
		development: false,
	}),
)
for (let signal of ["SIGINT", "SIGTERM"])
	process.once(signal, () => {
		void Effect.runPromise(running.close()).then(() => process.exit(0))
	})
console.log("http://127.0.0.1:4331/?mode=session")
