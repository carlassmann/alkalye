import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import { cliDocumentSessionLayer } from "../../src/cli/document-platform"
import { DocumentSession } from "../../src/shared/document-session"
import { Replica } from "../../src/shared/crdt"
import { newDocument } from "../../src/shared/documents"
import { FrameRequest } from "./frame-data-model"

let requests = await Effect.runPromise(
	Queue.bounded<typeof FrameRequest.Type>(64),
)
self.addEventListener("message", event => {
	let request = Schema.decodeUnknownSync(FrameRequest)(event.data)
	if (!Queue.offerUnsafe(requests, request))
		self.postMessage({
			kind: "failure",
			message: "Worker queue full; retain the unacknowledged edit",
		})
})
self.postMessage({ kind: "listening" })
let stage = "opening"
await Effect.runPromise(
	Effect.scoped(
		Effect.gen(function* () {
			let opening = yield* Queue.take(requests)
			if (opening.kind !== "open") throw Error("Worker must open first")
			let remote = new Replica("worker-origin")
			newDocument(remote, "document", "", opening.source)
			let snapshotFile = Bun.file(opening.directory + "/origin.json")
			let snapshotState = yield* Effect.promise(async () => {
				if (await snapshotFile.exists()) return snapshotFile.text()
				let state = JSON.stringify(remote.checkpoint())
				await Bun.write(snapshotFile, state)
				return state
			})
			let services = yield* Layer.build(
				cliDocumentSessionLayer(opening.directory, {
					document: "document",
					subject: "worker-writer",
					transport: {
						snapshot: () =>
							Effect.succeed({
								format: "document-state-v1",
								document: "document",
								log: "worker-log",
								position: 1,
								state: snapshotState,
							}),
						commit: () => Effect.fail(Error("Local persistence experiment")),
						history: () => Effect.succeed([]),
					},
				}),
			)
			let session = Context.get(services, DocumentSession)
			self.postMessage({
				kind: "ready",
				hash: Bun.hash(session.replica.text("document")).toString(),
			})
			let sequence = 0
			while (true) {
				let request = yield* Queue.take(requests)
				if (request.kind === "close") {
					yield* session.save
					self.postMessage({
						kind: "closed",
						hash: Bun.hash(session.replica.text("document")).toString(),
					})
					return
				}
				if (request.kind !== "edit" || request.sequence !== sequence + 1)
					throw Error("Out-of-order local transaction")
				let started = performance.now(),
					source = session.replica.text("document")
				stage = "edit-" + request.sequence
				if (
					!Number.isInteger(request.start) ||
					!Number.isInteger(request.remove) ||
					request.start < 0 ||
					request.remove < 0 ||
					request.start + request.remove > source.length
				)
					throw Error("Patch outside authoritative source")
				let result = session.edit(
					source.slice(0, request.start) +
						request.text +
						source.slice(request.start + request.remove),
				)
				yield* result.saved
				sequence = request.sequence
				self.postMessage({
					kind: "saved",
					sequence,
					milliseconds: performance.now() - started,
				})
			}
		}),
	).pipe(
		Effect.catchCause(cause =>
			Effect.sync(() =>
				self.postMessage({
					kind: "failure",
					message: stage + ": " + String(cause),
				}),
			),
		),
	),
)
