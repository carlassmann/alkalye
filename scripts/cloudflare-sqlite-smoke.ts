import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import * as Schema from "effect/Schema"

let root = resolve(import.meta.dir, "..")
let directory = await mkdtemp(join(tmpdir(), "alkalye-cloudflare-sqlite-"))
let config = join(directory, "wrangler.json")
await Bun.write(
	config,
	JSON.stringify({
		name: "alkalye-sqlite-local-probe",
		main: join(root, "tests/cloudflare-sqlite-worker.ts"),
		compatibility_date: "2026-09-18",
		compatibility_flags: ["nodejs_compat"],
		durable_objects: {
			bindings: [{ name: "PROBE", class_name: "SqliteProbe" }],
		},
		migrations: [{ tag: "v1", new_sqlite_classes: ["SqliteProbe"] }],
	}),
)
let log = Bun.file(join(directory, "worker.log"))
let child = Bun.spawn(
	[
		"bun",
		"x",
		"--no-install",
		"wrangler",
		"dev",
		"--config",
		config,
		"--local",
		"--ip",
		"127.0.0.1",
		"--port",
		"8792",
		"--inspector-port",
		"0",
		"--persist-to",
		join(directory, "state"),
	],
	{ cwd: root, stdout: log, stderr: log },
)
let resultSchema = Schema.Struct({
	binary: Schema.Array(Schema.Number),
	boolean: Schema.Array(Schema.Struct({ value: Schema.Number })),
	failed: Schema.Struct({
		_tag: Schema.Literal("Failure"),
		failure: Schema.Literal("expected"),
	}),
	nested: Schema.Struct({
		_tag: Schema.Literal("Success"),
		value: Schema.Array(Schema.Struct({ name: Schema.String })),
	}),
	readWhileHeld: Schema.Struct({ _tag: Schema.Literal("None") }),
	isolatedRead: Schema.Array(Schema.Struct({ name: Schema.String })),
	rows: Schema.Array(Schema.Struct({ name: Schema.String })),
})
try {
	let deadline = Date.now() + 30000
	while (true) {
		let ready = await fetch("http://127.0.0.1:8792/health", {
			signal: AbortSignal.timeout(1000),
		}).catch(() => undefined)
		if (ready?.ok) break
		if (child.exitCode !== null || Date.now() >= deadline)
			throw Error("Local SqlClient probe unavailable")
	}
	let response = await fetch("http://127.0.0.1:8792", {
		signal: AbortSignal.timeout(60000),
	})
	if (!response.ok) throw Error("Local SqlClient probe failed")
	let body = await response.text()
	await Bun.write(join(directory, "result.json"), body)
	let result = Schema.decodeUnknownSync(resultSchema)(JSON.parse(body))
	if (
		JSON.stringify(result.binary) !== "[1,2,255]" ||
		JSON.stringify(result.boolean) !== '[{"value":1}]' ||
		JSON.stringify(result.nested.value) !== '[{"name":"outer"}]' ||
		JSON.stringify(result.rows) !== '[{"name":"isolated"},{"name":"outer"}]' ||
		JSON.stringify(result.isolatedRead) !== JSON.stringify(result.rows)
	)
		throw Error("SqlClient transaction state differs")
	console.log(JSON.stringify(result))
	console.log(
		"PASS actual workerd SqlClient: failed/nested/interrupted rollback, concurrent reader isolation",
	)
	child.kill("SIGTERM")
	await child.exited
	await rm(directory, { recursive: true, force: true })
} catch (error) {
	console.error(
		"Local SQL probe failed; private logs/state retained at",
		directory,
	)
	throw error
} finally {
	if (child.exitCode === null) child.kill("SIGTERM")
	await child.exited
}
