import { documentStoreLayer } from "../../src/server/bun-databases"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Replica } from "../../src/shared/crdt"
import { newDocument } from "../../src/shared/documents"
import { DocumentActionSchema } from "./document"
import { commit, Principal, readSnapshot } from "./journal"

let directory = await mkdtemp(join(tmpdir(), "alkalye-document-benchmark-"))
let actions = Number(process.env.BENCHMARK_ACTIONS ?? 5000)
let characters = Number(process.env.BENCHMARK_CHARACTERS ?? 50_000)
let filename = join(directory, "document.sqlite")
try {
	await Effect.runPromise(
		Effect.gen(function* () {
			let replica = new Replica("writer")
			let source =
				"---\ntitle: Performance\n---\n" +
				"Paragraph text.\n"
					.repeat(Math.ceil(characters / 16))
					.slice(0, characters)
			let changes = newDocument(replica, "doc", "Untitled", source).filter(
				change => change !== null,
			)
			let last = changes.at(-1)
			if (!last) return yield* Effect.die("Missing initial source")
			yield* commit(
				Schema.decodeUnknownSync(DocumentActionSchema)({
					id: last.id,
					document: "doc",
					actor: replica.actor,
					label: "Create document",
					changes,
					before: [],
					guards: [],
					accessGuards: [],
				}),
			)
			let started = performance.now()
			let times: number[] = []
			let clientTimes: number[] = []
			let commitTimes: number[] = []
			for (let index = 0; index < actions; index++) {
				let startedAction = performance.now()
				source += String(index % 10)
				let change = replica.edit("doc", source)
				if (!change) return yield* Effect.die("Missing typing action")
				clientTimes.push(performance.now() - startedAction)
				let startedCommit = performance.now()
				yield* commit(
					Schema.decodeUnknownSync(DocumentActionSchema)({
						id: change.id,
						document: "doc",
						actor: replica.actor,
						label: "Type",
						changes: [change],
						before: [],
						guards: [],
						accessGuards: [],
					}),
				)
				commitTimes.push(performance.now() - startedCommit)
				times.push(performance.now() - startedAction)
				if ((index + 1) % 100 === 0)
					console.log(
						"PROGRESS",
						JSON.stringify({
							actions: index + 1,
							milliseconds: performance.now() - started,
						}),
					)
			}
			let snapshot = yield* readSnapshot("doc")
			times.sort((a, b) => a - b)
			clientTimes.sort((a, b) => a - b)
			commitTimes.sort((a, b) => a - b)
			console.log(
				"MEASURE",
				JSON.stringify({
					characters,
					actions,
					milliseconds: performance.now() - started,
					median: times[Math.floor(times.length / 2)],
					p95: times[Math.floor(times.length * 0.95)],
					clientEditMedian: clientTimes[Math.floor(clientTimes.length / 2)],
					clientEditP95: clientTimes[Math.floor(clientTimes.length * 0.95)],
					commitMedian: commitTimes[Math.floor(commitTimes.length / 2)],
					commitP95: commitTimes[Math.floor(commitTimes.length * 0.95)],
					snapshotBytes:
						snapshot &&
						new TextEncoder().encode(JSON.stringify(snapshot)).length,
					databaseBytes: Bun.file(filename).size,
				}),
			)
		}).pipe(
			Effect.provide(documentStoreLayer(filename)),
			Effect.provideService(Principal, {
				subject: "writer",
				actors: ["writer"],
				role: "owner",
			}),
		),
	)
} finally {
	await rm(directory, { recursive: true, force: true })
}
