import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { runMain } from "../src/cli/runtime"

test("native main removes both signal listeners when its fiber finishes immediately", () => {
	let interrupt = process.listenerCount("SIGINT")
	let terminate = process.listenerCount("SIGTERM")
	runMain(Effect.void, { disableErrorReporting: true })
	expect(process.listenerCount("SIGINT")).toBe(interrupt)
	expect(process.listenerCount("SIGTERM")).toBe(terminate)
})
test("a second signal forces exit while the native main waits for cleanup", async () => {
	let child = Bun.spawn(["bun", "tests/fixtures/cli-runtime.ts"], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	})
	let reader = child.stdout.getReader()
	try {
		expect(new TextDecoder().decode((await reader.read()).value)).toBe(
			"ready\n",
		)
		child.kill("SIGINT")
		expect(new TextDecoder().decode((await reader.read()).value)).toBe(
			"cleaning\n",
		)
		child.kill("SIGTERM")
		expect(await child.exited).toBe(143)
		expect(await new Response(child.stderr).text()).toBe("")
	} finally {
		reader.releaseLock()
		child.kill("SIGKILL")
	}
}, 5_000)
