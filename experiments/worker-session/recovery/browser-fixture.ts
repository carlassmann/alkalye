import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import { makeEditorQueue } from "./editor-queue"
import { verifyWorkerRevocation } from "./permission-fixture"
import { verifyWorkerHandoff } from "./handoff-fixture"
import { verifyWorkerRecovery } from "./recovery-fixture"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import { DocumentApi } from "../../../src/shared/document-api"
import {
	buildAction,
	restoreSnapshot,
	maximumActionText,
} from "../../../src/shared/document-actions"
import { Replica } from "../../../src/shared/crdt"
import { newDocument } from "../../../src/shared/documents"
import { bootstrapBrowserAccount } from "../../../tests/browser-account-fixture"
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
		let editing = yield* second.Begin()
		check(
			editing.source === expected && editing.sequence === 0,
			"worker Begin captures exact editor-local atom basis",
		)
		let peerBeforeQueued = yield* api.documents.snapshot({
			params: { document },
			query: { encoding: "compact" },
		})
		let queuedPeer = yield* restoreSnapshot(
			peerBeforeQueued,
			account.subject + "-queued-peer",
		)
		let unseenPeerSource = expected.replace("A😀", "UNSEEN A😀")
		let unseenAction = yield* buildAction(
			queuedPeer,
			document,
			"Unseen peer",
			staged => [staged.edit(document, unseenPeerSource)],
		)
		yield* api.documents.commit({ params: { document }, payload: unseenAction })
		yield* second.Sync()
		let offset = expected.length
		let ranges = [
			{ start: offset, remove: 0, text: "ab" },
			{ start: offset, remove: 1, text: "A" },
			{ start: offset + 1, remove: 1, text: "B" },
			{ start: offset + 2, remove: 0, text: "c" },
			{ start: offset, remove: 1, text: "x" },
			{ start: offset + 3, remove: 0, text: "d" },
			{ start: offset + 2, remove: 1, text: "C" },
			{ start: offset + 4, remove: 0, text: "e\n" },
		]
		let editor = yield* makeEditorQueue(second, editing)
		let optimistic = editing.source
		let requests = ranges.map(range => {
			optimistic =
				optimistic.slice(0, range.start) +
				range.text +
				optimistic.slice(range.start + range.remove)
			return editor.replace([range])
		})
		check(
			editor.state().source === optimistic &&
				editor.state().pending.length === 8,
			"FIFO adapter paints complete optimistic source while eight edits await acknowledgement",
		)
		for (let request of requests) yield* request.saved
		check(
			editor.state().acknowledged === 8 && editor.state().pending.length === 0,
			"one scoped queue drain delivers eight source edits in order",
		)
		check(
			editor.state().source === optimistic &&
				!editor.state().source.includes("UNSEEN"),
			"worker acknowledgements preserve actual adapter optimistic source before explicit idle merge",
		)
		let incompatible = yield* second
			.Replace({
				handle: separate.handle,
				ranges: [{ start: 0, remove: 0, text: "WRONG" }],
			})
			.pipe(Effect.result)
		check(
			incompatible._tag === "Failure" &&
				incompatible.failure instanceof WorkerDocumentFailure &&
				incompatible.failure.reason === "BasisUnavailable",
			"legacy handle replacement cannot bypass active editor basis",
		)
		let localState = yield* second.Read()
		check(
			localState.localSource === optimistic &&
				localState.sequence === 8 &&
				localState.source === optimistic.replace("A😀", "UNSEEN A😀"),
			"worker retains distinct local basis and merged authoritative source",
		)
		let duplicate = yield* second
			.ReplaceQueued({
				epoch: editing.epoch,
				sequence: 8,
				ranges: [{ start: optimistic.length, remove: 0, text: "DUPLICATE" }],
			})
			.pipe(Effect.result)
		check(
			duplicate._tag === "Failure" &&
				duplicate.failure instanceof WorkerDocumentFailure &&
				duplicate.failure.reason === "SequenceUnavailable",
			"ambiguous queued command cannot be blindly replayed into duplicate text",
		)
		yield* account.api.account.logout()
		let denied = yield* second.Sync().pipe(Effect.result)
		check(
			denied._tag === "Failure" &&
				denied.failure instanceof WorkerDocumentFailure &&
				denied.failure.category === "access",
			"authentication loss produces typed sync access failure",
		)
		let retained = yield* second.Read()
		check(
			retained.localSource === optimistic && retained.pending > 0,
			"failed remote access preserves queued local draft and durable pending edits",
		)
		yield* account.connect
		let ended = yield* second.End({ epoch: editing.epoch, sequence: 8 })
		expected = optimistic.replace("A😀", "UNSEEN A😀")
		check(
			ended.source === expected && ended.localSource === undefined,
			"explicit idle End adopts merged peer source without losing queued local edits",
		)
		yield* second.Sync()
		let queuedAccepted = yield* api.documents.snapshot({
			params: { document },
			query: { encoding: "compact" },
		})
		let queuedReplica = yield* restoreSnapshot(
			queuedAccepted,
			"queued-worker-reader",
		)
		check(
			queuedReplica.text(document) === expected,
			"queued basis edits converge exactly through real HTTP acceptance",
		)
		let interruptionBasis = yield* second.Begin()
		let interruptibleEditor = yield* makeEditorQueue(second, interruptionBasis)
		let interruptedEdit = interruptibleEditor.replace([
			{ start: expected.length, remove: 0, text: "ONCE" },
		])
		let waiting = yield* interruptedEdit.saved.pipe(
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* Fiber.interrupt(waiting)
		let interruptedObserver = yield* Fiber.await(waiting)
		check(
			Exit.hasInterrupts(interruptedObserver),
			"save observer reaches an interrupted exit",
		)
		yield* interruptedEdit.saved
		check(
			interruptibleEditor.state().source === expected + "ONCE" &&
				interruptibleEditor.state().acknowledged === 1,
			"interrupting one save observer preserves independent queued draft delivery",
		)
		let afterInterruption = yield* second.Read()
		check(
			afterInterruption.localSource === expected + "ONCE",
			"interrupted observer does not duplicate generated text in worker basis",
		)
		let interruptedEnd = yield* second.End({
			epoch: interruptionBasis.epoch,
			sequence: 1,
		})
		expected = interruptedEnd.source
		yield* second.Sync()
		let rejectionBasis = yield* second.Begin()
		let recoveryScope = yield* Scope.make()
		yield* Effect.addFinalizer(() => Scope.close(recoveryScope, Exit.void))
		let recovering = yield* makeEditorQueue(second, rejectionBasis).pipe(
			Effect.provideService(Scope.Scope, recoveryScope),
		)
		let overLimit = recovering.replace([
			{
				start: expected.length,
				remove: 0,
				text: "r".repeat(maximumActionText + 1),
			},
		])
		let suffix = recovering.replace([
			{ start: overLimit.source.length, remove: 0, text: "SUFFIX" },
		])
		let rejectedEdit = yield* overLimit.saved.pipe(Effect.result)
		let blockedSuffix = yield* suffix.saved.pipe(Effect.result)
		check(
			rejectedEdit._tag === "Failure" &&
				rejectedEdit.failure instanceof WorkerDocumentFailure &&
				rejectedEdit.failure.reason === "Rejected",
			"worker rejects over-limit edit before applying it",
		)
		check(
			blockedSuffix._tag === "Failure" &&
				blockedSuffix.failure instanceof WorkerDocumentFailure &&
				blockedSuffix.failure.reason === "QueuedBlocked",
			"FIFO adapter stops failed suffix instead of sending invalid dependent offsets",
		)
		check(
			recovering.state().source === suffix.source &&
				recovering.state().pending.length === 2 &&
				recovering.state().pending[0]?.delivery === "rejected" &&
				recovering.state().pending[1]?.delivery === "blocked" &&
				recovering.state().acknowledged === 0,
			"recovery retains complete optimistic draft and rejected suffix without silent reset",
		)
		let unchangedWorker = yield* second.Read()
		check(
			unchangedWorker.localSource === expected &&
				unchangedWorker.sequence === 0,
			"rejected edit leaves worker editor basis unchanged",
		)
		yield* Scope.close(recoveryScope, Exit.void)
		check(
			recovering.state().closed && recovering.state().source === suffix.source,
			"scoped adapter shutdown releases queue while draft remains available for recovery copy",
		)
		yield* second.Close()
		yield* verifyWorkerHandoff(account, document, expected, check)
		yield* verifyWorkerRevocation(account, check)
		yield* verifyWorkerRecovery(account, check)
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
