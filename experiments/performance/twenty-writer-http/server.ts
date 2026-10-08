import * as Effect from "effect/Effect"
import { startServer } from "../../../src/server/index"
let data = Bun.argv[2]
if (!data) throw Error("Disposable data directory required")
let instance = await Effect.runPromise(
	startServer({ port: 4470, data, build: false }),
)
let samples = setInterval(
	() =>
		console.info(
			JSON.stringify({
				phase: "server-resource-sample",
				unixMs: performance.timeOrigin + performance.now(),
				cpu: process.cpuUsage(),
				rss: process.memoryUsage().rss,
			}),
		),
	1000,
)
console.info(
	JSON.stringify({
		phase: "server-ready",
		url: instance.server.url.href,
		pid: process.pid,
	}),
)
async function close() {
	clearInterval(samples)
	await Effect.runPromise(instance.close())
	process.exit(0)
}
process.on("SIGTERM", close)
process.on("SIGINT", close)
