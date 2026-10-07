import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { cliDocumentSessionLayer } from "../../src/cli/document-platform"
import { DocumentSession } from "../../src/shared/document-session"
import type { DocumentSnapshot } from "../../src/shared/document-actions"
import type { DocumentTransport } from "../../src/shared/document-session"
import { compactCheckpoint } from "../../src/shared/checkpoint"
import { Replica } from "../../src/shared/crdt"
import { newDocument } from "../../src/shared/documents"

let preparation = 0,
	application = 0
let prepareReplacement = Replica.prototype.prepareReplacements
Replica.prototype.prepareReplacements = function (target, replacements, atoms) {
	let started = performance.now()
	try {
		return prepareReplacement.call(this, target, replacements, atoms)
	} finally {
		preparation += performance.now() - started
	}
}
let apply = Replica.prototype.apply
Replica.prototype.apply = function (input) {
	let started = performance.now()
	try {
		return apply.call(this, input)
	} finally {
		application += performance.now() - started
	}
}
let results = []
for (let scenario of [
	{ size: 128 * 1024, unicode: false },
	{ size: 1024 * 1024, unicode: false },
	{ size: 128 * 1024, unicode: true },
	{ size: 1024 * 1024, unicode: true },
]) {
	let { size, unicode } = scenario
	let directory = await mkdtemp(join(tmpdir(), "alkalye-patch-performance-"))
	let remote = new Replica("birth")
	let source = (
		unicode ? "Plain 😀 repeated text.\n" : "Plain repeated text.\n"
	)
		.repeat(Math.ceil(size / 21))
		.slice(0, size)
	newDocument(remote, "doc", "", source)
	let snapshot: DocumentSnapshot = {
		format: "document-state-v1",
		document: "doc",
		log: "patch-performance",
		position: 1,
		state: JSON.stringify(compactCheckpoint(remote.checkpoint())),
	}
	let transport: DocumentTransport = {
		snapshot: () => Effect.succeed(snapshot),
		history: () => Effect.succeed([]),
		commit: () => Effect.fail(new Error("Offline")),
	}
	let timings: {
		location: string
		optimistic: number
		durable: number
		preparation: number
		application: number
	}[] = []
	try {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let services = yield* Layer.build(
						cliDocumentSessionLayer(directory, {
							document: "doc",
							subject: "owner",
							transport,
						}),
					)
					let session = Context.get(services, DocumentSession)
					for (let index = 0; index < 15; index++) {
						let location = ["top", "middle", "end"][index % 3] ?? "end"
						let content = session.replica.text("doc")
						let offset =
							location === "top"
								? 0
								: location === "middle"
									? Math.floor(content.length / 2)
									: content.length
						let before = content.charCodeAt(offset - 1),
							after = content.charCodeAt(offset)
						if (
							before >= 0xd800 &&
							before <= 0xdbff &&
							after >= 0xdc00 &&
							after <= 0xdfff
						)
							offset++
						preparation = 0
						application = 0
						let started = performance.now()
						let edit = session.replace([
							{ start: offset, remove: 0, text: "x" },
						])
						let optimistic = performance.now() - started
						let optimisticPreparation = preparation
						let optimisticApplication = application
						started = performance.now()
						yield* edit.saved
						timings.push({
							preparation: optimisticPreparation,
							application: optimisticApplication,
							location,
							optimistic,
							durable: performance.now() - started,
						})
						if (
							edit.content !==
							content.slice(0, offset) + "x" + content.slice(offset)
						)
							throw Error("Precise transaction lost text")
					}
				}),
			),
		)
		let sorted = timings.map(value => value.optimistic).sort((a, b) => a - b)
		results.push({
			characters: size,
			unicode,
			samples: timings.length,
			optimisticP95: sorted[Math.floor(sorted.length * 0.95)],
			timings,
		})
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}
console.log(JSON.stringify(results, null, 2))
