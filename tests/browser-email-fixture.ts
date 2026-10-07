import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { TestClock } from "effect/testing"
import { BunServer, serverLayer } from "../src/server/index"

let mailbox = Bun.argv[2]
if (!mailbox) throw new Error("Missing test mailbox")
let directory = await mkdtemp(join(tmpdir(), "alkalye-browser-email-"))
let clock = Layer.effect(
	Clock.Clock,
	Effect.gen(function* () {
		let clock = yield* TestClock.make()
		yield* clock.setTime(Date.now())
		return clock
	}),
)
let runtime = ManagedRuntime.make(
	serverLayer({
		port: 0,
		data: directory,
		assets: process.env.ALKALYE_TEST_ASSETS ?? join(directory, "app-shell"),
		build: !process.env.ALKALYE_TEST_ASSETS,
	}).pipe(
		Layer.provideMerge(clock),
		Layer.provide(
			Layer.succeed(
				ConfigProvider.ConfigProvider,
				ConfigProvider.fromUnknown({
					NODE_ENV: "test",
					ALKALYE_TEST_EMAIL_MAILBOX: mailbox,
				}),
			),
		),
	),
)
let instance = await runtime.runPromise(BunServer)
let closing = false
async function close() {
	if (closing) return
	closing = true
	await runtime.dispose()
	await rm(directory, { recursive: true, force: true })
	process.exit(0)
}
process.once("SIGTERM", () => {
	void close()
})
console.log(instance.server.url.href)
for await (let chunk of Bun.stdin.stream()) {
	if (new TextDecoder().decode(chunk).includes("advance")) {
		await runtime.runPromise(TestClock.adjust("61 seconds"))
		console.log("advanced")
	}
}
