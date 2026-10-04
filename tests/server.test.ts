import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import * as Effect from "effect/Effect"
import { startServer } from "../src/server/index"

let directory = await mkdtemp(join(tmpdir(), "alkalye-cutover-server-"))
let instance: Effect.Success<ReturnType<typeof startServer>>
beforeAll(async () => {
	instance = await Effect.runPromise(
		startServer({ port: 0, data: directory, build: false }),
	)
})
afterAll(async () => {
	await Effect.runPromise(instance.close())
	await rm(directory, { recursive: true, force: true })
})
test("the default app and former preview path serve one document app bundle", async () => {
	let response = await fetch(new URL("/app", instance.server.url))
	expect(response.status).toBe(200)
	let app = await response.text()
	expect(app).toContain("/app.js")
	expect(app).not.toContain("document-app.js")
	expect(
		await (await fetch(new URL("/app/native", instance.server.url))).text(),
	).toBe(app)
	let health = await (
		await fetch(new URL("/api/health", instance.server.url))
	).json()
	expect(health).toMatchObject({ architecture: "documents" })
})
test("retired room and socket protocols fail explicitly rather than reaching another engine", async () => {
	for (let path of ["/sync", "/api/rooms/example", "/api/oauth/consent"]) {
		for (let method of ["GET", "POST"])
			expect(
				(await fetch(new URL(path, instance.server.url), { method })).status,
			).toBe(410)
	}
})
test("fresh server databases contain document and agent storage without room relay tables", () => {
	let database = new Database(join(directory, "relay.sqlite"), {
		readonly: true,
	})
	try {
		let tables = database
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type='table'",
			)
			.all()
			.map(row => row.name)
		expect(tables).toContain("connections")
		for (let retired of ["rooms", "grants", "packets", "media", "checkpoints"])
			expect(tables).not.toContain(retired)
	} finally {
		database.close()
	}
})
