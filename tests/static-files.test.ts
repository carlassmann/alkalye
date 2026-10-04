import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import { serveAsset } from "../src/server/static-files"

let directory = await mkdtemp(join(tmpdir(), "alkalye-assets-"))
let source = 'console.log("Fast native loading")\n'.repeat(1000)
let path = join(directory, "fixture.js")
await Bun.write(path, source)
await Bun.write(path + ".gz", Bun.gzipSync(new TextEncoder().encode(source)))
afterAll(() => rm(directory, { recursive: true, force: true }))

test("static assets negotiate gzip while preserving their original media type", async () => {
	let response = await Effect.runPromise(
		serveAsset(
			new Request("https://app.example/fixture.js", {
				headers: { "Accept-Encoding": "br, gzip" },
			}),
			path,
			{ "Cache-Control": "no-cache" },
		),
	)
	if (!response) throw new Error("Missing asset")
	expect(response.headers.get("Content-Encoding")).toBe("gzip")
	expect(response.headers.get("Content-Type")).toContain("javascript")
	expect(response.headers.get("Vary")).toBe("Accept-Encoding")
	let bytes = new Uint8Array(await response.arrayBuffer())
	expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe(source)
	expect(bytes.length).toBeLessThan(source.length / 10)
})

test("gzip refusals and unsupported encodings receive the original asset", async () => {
	for (let encoding of ["", "br", "gzip;q=0", "GZIP; q=0", "gzip;q=invalid"]) {
		let response = await Effect.runPromise(
			serveAsset(
				new Request("https://app.example/fixture.js", {
					headers: { "Accept-Encoding": encoding },
				}),
				path,
				{},
			),
		)
		if (!response) throw new Error("Missing asset")
		expect(response.headers.has("Content-Encoding")).toBe(false)
		expect(await response.text()).toBe(source)
	}
})

test("missing compressed files fall back and missing source files remain missing", async () => {
	let plain = join(directory, "plain.css")
	await Bun.write(plain, "body { color: red }")
	let request = new Request("https://app.example/plain.css", {
		headers: { "Accept-Encoding": "gzip" },
	})
	let response = await Effect.runPromise(serveAsset(request, plain, {}))
	expect(response?.headers.has("Content-Encoding")).toBe(false)
	expect(await response?.text()).toBe("body { color: red }")
	expect(
		await Effect.runPromise(
			serveAsset(request, join(directory, "missing.js"), {}),
		),
	).toBeUndefined()
})
