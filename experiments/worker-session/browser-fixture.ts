import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import { DocumentApi } from "../../src/shared/document-api"
import { buildAction, restoreSnapshot } from "../../src/shared/document-actions"
import { Replica } from "../../src/shared/crdt"
import { newDocument } from "../../src/shared/documents"
import { bootstrapBrowserAccount } from "../../tests/browser-account-fixture"
import { createWorkerSessionClient } from "./worker-client"
import { WorkerDocumentFailure } from "./worker-rpc"

declare global {
	interface Window {
		workerSessionDone: boolean
		workerSessionFailure?: string
		workerSessionResults: string[]
	}
}
window.workerSessionDone = false
window.workerSessionResults = []
function check(value: unknown, message: string) {
	if (!value) throw new Error(message)
	window.workerSessionResults.push(message)
}

let journey = Effect.scoped(
	Effect.gen(function* () {
		let account = yield* bootstrapBrowserAccount(check)
		let api = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: location.origin,
		})
		let document = "worker-document-" + crypto.randomUUID()
		let workspace = "worker-workspace-" + crypto.randomUUID()
		let source = "---\ntitle: Worker fixture\n---\nA😀 B tail\n"
		yield* api.workspaces.create({
			payload: { workspace, name: "Worker fixture", request: "create" },
		})
		let creation = yield* buildAction(
			new Replica(account.subject + "-worker-fixture"),
			document,
			"Create",
			staged => newDocument(staged, document, "Untitled", source),
		)
		yield* api.documents.create({ payload: { workspace, action: creation } })
		let worker = yield* createWorkerSessionClient(
			new URL("/worker.js", location.origin).href,
		)
		yield* Effect.addFinalizer(() =>
			worker.Close().pipe(Effect.catch(() => Effect.void)),
		)
		let options = {
			document,
			subject: account.subject,
			origin: location.origin,
		}
		let original = yield* worker.Open(options)
		check(
			original.source === source && original.unsaved === 0,
			"worker opens real HTTP source into its IndexedDB-backed session",
		)
		let snapshot = yield* api.documents.snapshot({
			params: { document },
			query: { encoding: "compact" },
		})
		let peer = yield* restoreSnapshot(
			snapshot,
			account.subject + "-independent-peer",
		)
		let peerSource = source.replace("A😀", "PEER A😀")
		let peerAction = yield* buildAction(
			peer,
			document,
			"Peer insertion",
			staged => [staged.edit(document, peerSource)],
		)
		yield* api.documents.commit({ params: { document }, payload: peerAction })
		yield* worker.Sync()
		let synchronized = yield* worker.Read()
		check(
			synchronized.source === peerSource,
			"worker sync pulls independent peer HTTP action",
		)
		let replaced = yield* worker.Replace({
			handle: original.handle,
			ranges: [{ start: source.indexOf("tail"), remove: 4, text: "done" }],
		})
		let expected = peerSource.replace("tail", "done")
		check(
			replaced.source === expected && replaced.unsaved === 0,
			"replacement against stale Unicode source handle preserves peer insertion and persists locally",
		)
		let retitled = yield* worker.Replace({
			handle: original.handle,
			ranges: [
				{
					start: source.indexOf("Worker fixture"),
					remove: "Worker fixture".length,
					text: "Worker changed",
				},
			],
		})
		expected = expected.replace("Worker fixture", "Worker changed")
		check(
			retitled.source === expected,
			"independent stale frontmatter replacement preserves prior local edit and peer body",
		)
		yield* worker.Flush()
		yield* worker.Sync()
		let accepted = yield* api.documents.snapshot({
			params: { document },
			query: { encoding: "compact" },
		})
		let acceptedReplica = yield* restoreSnapshot(
			accepted,
			"worker-fixture-reader",
		)
		check(
			acceptedReplica.text(document) === expected,
			"worker edits converge through native server accepted snapshot",
		)
		yield* worker.Close()
		let closed = yield* worker.Read().pipe(Effect.result)
		check(
			closed._tag === "Failure" &&
				closed.failure instanceof WorkerDocumentFailure &&
				closed.failure.reason === "Closed",
			"explicit Close releases session and prevents subsequent read",
		)
		let reopened = yield* worker.Open(options)
		check(
			reopened.source === expected,
			"same worker reopens exact durable source",
		)
		let expired = yield* worker
			.Replace({
				handle: original.handle,
				ranges: [{ start: 0, remove: 0, text: "INVALID" }],
			})
			.pipe(Effect.result)
		check(
			expired._tag === "Failure" &&
				expired.failure instanceof WorkerDocumentFailure &&
				expired.failure.reason === "HandleUnavailable",
			"old session handles fail without mutation after reopen",
		)
		let unchanged = yield* worker.Read()
		check(
			unchanged.source === expected,
			"expired handle rejection leaves source unchanged",
		)
		yield* worker.Release({ handle: reopened.handle })
		yield* worker.Release({ handle: unchanged.handle })
		yield* Effect.promise(() =>
			fetch("/__tests/network?blocked=1").then(response => {
				if (!response.ok) throw new Error("Network gate failed")
			}),
		)
		let offline = yield* worker.Read()
		let offlineEdit = yield* worker.Replace({
			handle: offline.handle,
			ranges: [{ start: expected.length, remove: 0, text: "OFFLINE\n" }],
		})
		expected += "OFFLINE\n"
		check(
			offlineEdit.source === expected && offlineEdit.unsaved === 0,
			"worker saves local edit while HTTP is unavailable",
		)
		let disconnected = yield* worker.Sync().pipe(Effect.result)
		check(
			disconnected._tag === "Failure" &&
				disconnected.failure instanceof WorkerDocumentFailure,
			"failed remote sync remains a typed worker boundary failure",
		)
		yield* worker.Close()
		let restored = yield* worker.Open(options)
		check(
			restored.source === expected && restored.pending > 0,
			"offline Close and reopen preserve durable pending source",
		)
		yield* Effect.promise(() =>
			fetch("/__tests/network?blocked=0").then(response => {
				if (!response.ok) throw new Error("Network recovery gate failed")
			}),
		)
		yield* worker.Sync()
		let settled = yield* worker.Read()
		check(
			settled.source === expected && settled.pending === 0,
			"reconnected worker publishes exact offline source and clears pending actions",
		)
		yield* worker.Close()
		let second = yield* createWorkerSessionClient(
			new URL("/worker.js", location.origin).href,
		)
		yield* Effect.addFinalizer(() =>
			second.Close().pipe(Effect.catch(() => Effect.void)),
		)
		let separate = yield* second.Open(options)
		check(
			separate.source === expected && separate.pending === 0,
			"independent worker opens existing durable accepted state after scoped close",
		)
		yield* second.Close()
	}),
).pipe(Effect.provide(FetchHttpClient.layer))

Effect.runPromise(journey).then(
	() => {
		window.workerSessionDone = true
	},
	error => {
		window.workerSessionFailure =
			error instanceof Error ? error.message : "Worker journey failed"
		window.workerSessionDone = true
	},
)
