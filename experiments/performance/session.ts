import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { cliDocumentSessionLayer } from "../../src/cli/document-platform"
import { DocumentSession } from "../../src/shared/document-session"
import type { DocumentTransport } from "../../src/shared/document-session"
import { Replica } from "../../src/shared/crdt"
import type { DocumentSnapshot } from "../../src/shared/document-actions"
import { newDocument } from "../../src/shared/documents"
import { performanceFixture } from "./fixture"

interface Measurement {
	calls: number
	milliseconds: number
}
let metrics = new Map<string, Measurement>()
function measured<A>(name: string, work: () => A) {
	let started = performance.now()
	try {
		return work()
	} finally {
		let result = metrics.get(name) ?? { calls: 0, milliseconds: 0 }
		result.calls++
		result.milliseconds += performance.now() - started
		metrics.set(name, result)
	}
}
if (process.env.PROFILE_FREEZE === "1") {
	let originalFreeze = Object.freeze
	Object.freeze = function <T>(value: T): Readonly<T> {
		return measured("freeze", () => originalFreeze(value))
	}
}
let originalRestore = Replica.prototype.restore
Replica.prototype.restore = function (snapshot) {
	return measured("restore", () => originalRestore.call(this, snapshot))
}
let originalCheckpoint = Replica.prototype.checkpoint
Replica.prototype.checkpoint = function () {
	return measured("checkpoint", () => originalCheckpoint.call(this))
}
let originalApply = Replica.prototype.apply
Replica.prototype.apply = function (input) {
	return measured("apply", () => originalApply.call(this, input))
}
let originalVisible = Replica.prototype.visible
Replica.prototype.visible = function (target, until) {
	return measured("visible", () => originalVisible.call(this, target, until))
}
let originalEdit = Replica.prototype.prepareEdit
Replica.prototype.prepareEdit = function (target, next, atoms, options) {
	return measured("prepareEdit", () =>
		originalEdit.call(this, target, next, atoms, options),
	)
}
function takeMetrics() {
	let result = Object.fromEntries(metrics)
	metrics.clear()
	return result
}
let directory = await mkdtemp(join(tmpdir(), "alkalye-session-performance-"))
let results = []
for (let kilobytes of [2, 32, 128]) {
	let source = performanceFixture(kilobytes)
	let document = "document-" + kilobytes
	let remote = new Replica("performance-subject-" + "x".repeat(43))
	newDocument(remote, document, "", source)
	let snapshot: DocumentSnapshot = {
		format: "document-state-v1",
		document,
		log: "performance-log",
		position: 1,
		state: JSON.stringify(remote.checkpoint()),
	}
	let transport: DocumentTransport = {
		snapshot: () => Effect.succeed(snapshot),
		commit: () =>
			Effect.fail(new Error("This experiment isolates local persistence")),
		history: () => Effect.succeed([]),
	}
	let expected = source
	let appendBytes = 0
	let phases: {
		phase: string
		milliseconds: number
		metrics: ReturnType<typeof takeMetrics>
	}[] = []
	function phase<A, E, R>(name: string, work: Effect.Effect<A, E, R>) {
		return Effect.gen(function* () {
			takeMetrics()
			let started = performance.now()
			let result = yield* work
			phases.push({
				phase: name,
				milliseconds: performance.now() - started,
				metrics: takeMetrics(),
			})
			return result
		})
	}
	async function open(edit: boolean) {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let services = yield* phase(
						edit ? "initial-open" : "cached-open",
						Layer.build(
							cliDocumentSessionLayer(directory, {
								document,
								subject: "performance-subject",
								transport,
							}),
						),
					)
					let session = Context.get(services, DocumentSession)
					let restoredSource = yield* phase(
						"materialize-source",
						Effect.sync(() => session.replica.text(document)),
					)
					if (restoredSource !== expected) throw Error("Source changed")
					if (edit) {
						yield* phase(
							"editor-capture-base",
							Effect.sync(() => session.replica.visible(document)),
						)
						let result = yield* phase(
							"append-optimistic",
							Effect.sync(() => session.edit(source + "x")),
						)
						expected = source + "x"
						appendBytes = JSON.stringify(result.operation).length
						yield* phase("append-durable", result.saved)
						for (let location of ["top", "middle", "delete"]) {
							let offset =
								location === "top"
									? expected.indexOf("# Benchmark")
									: Math.floor(expected.length / 2)
							let next =
								expected.slice(0, offset) +
								(location === "delete" ? "" : "x") +
								expected.slice(offset + (location === "delete" ? 1 : 0))
							let changed = yield* phase(
								location + "-optimistic",
								Effect.sync(() => session.edit(next)),
							)
							yield* phase(location + "-durable", changed.saved)
							if (changed.content !== next)
								throw Error("Incremental edit changed source")
							expected = next
						}
					}
					yield* phase("save-materialization", session.save)
				}),
			),
		)
	}
	await open(true)
	await open(false)
	results.push({
		kilobytes,
		sourceBytes: source.length,
		appendBytes,
		snapshotBytes: snapshot.state.length,
		atoms: remote
			.checkpoint()
			.targets.reduce((count, target) => count + target.atoms.length, 0),
		phases,
	})
}
let files = [...new Bun.Glob("documents/*.sqlite").scanSync(directory)]
let storage = files.map(file => {
	let database = new Database(join(directory, file), { readonly: true })
	let cache = database
		.query("SELECT position,length(value) AS bytes FROM document_cache")
		.get()
	let journal = database
		.query(
			"SELECT count(*) AS entries,sum(length(payload)) AS bytes FROM effect_event_journal",
		)
		.get()
	database.close()
	return { file, cache, journal }
})
console.log(JSON.stringify({ directory, results, storage }, null, 2))
