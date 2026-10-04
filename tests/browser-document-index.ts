import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import { makeDocumentTransport } from "../src/client/document-transport"
import { LocalDocuments } from "../src/client/local-documents"
import { BrowserStorage, Storage } from "../src/client/storage"
import { Replica } from "../src/shared/crdt"
import { buildAction } from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"

type Check = (value: unknown, message: string) => void

export function verifyDocumentIndex(subject: string, check: Check) {
	return Effect.scoped(
		Effect.gen(function* () {
			let storage = yield* Effect.acquireRelease(Storage.open(), storage =>
				Effect.sync(() => storage.close()),
			)
			let context = yield* Layer.build(
				LocalDocuments.layer(subject).pipe(
					Layer.provide(Layer.succeed(BrowserStorage, storage)),
				),
			)
			let local = Context.get(context, LocalDocuments)
			let remote = yield* makeDocumentTransport(location.origin, subject)
			let workspace = "personal-" + subject
			let document = "dirty-marker-race"
			let creation = {
				subject,
				workspace,
				action: yield* buildAction(
					new Replica(subject + "-dirty-marker"),
					document,
					"Create document",
					staged => newDocument(staged, document, "Untitled", "# Marker race"),
				),
			}
			yield* local.create(creation)
			let activity = local.activity(document, () => undefined)
			let clearing = false
			let entered = yield* Deferred.make<void>()
			let release = yield* Deferred.make<void>()
			let first = Context.get(
				yield* Layer.build(
					browserDocumentSessionLayer({
						document,
						subject,
						initialCreation: creation,
						transport: remote,
						activity: {
							...activity,
							settled: Effect.suspend(() =>
								clearing
									? Deferred.succeed(entered, undefined).pipe(
											Effect.andThen(Deferred.await(release)),
											Effect.andThen(activity.settled),
										)
									: activity.settled,
							),
						},
					}),
				),
				DocumentSession,
			)
			yield* first.sync
			yield* first.save
			clearing = true
			let clear = yield* first.sync.pipe(
				Effect.forkScoped({ startImmediately: true }),
			)
			yield* Deferred.await(entered)
			let peer = Context.get(
				yield* Layer.build(
					browserDocumentSessionLayer({
						document,
						subject,
						transport: remote,
						activity,
					}),
				),
				DocumentSession,
			)
			let append = yield* peer
				.change("After marker clearing", staged => [
					staged.set(document, "mode", "teleprompter"),
				])
				.pipe(Effect.forkScoped({ startImmediately: true }))
			let database =
				"alkalye-document-v1:" + JSON.stringify([subject, document])
			yield* Effect.tryPromise(() => navigator.locks.query()).pipe(
				Effect.flatMap(snapshot =>
					snapshot.pending?.some(lock => lock.name === database)
						? Effect.void
						: Effect.fail(new Error("Append not waiting for journal lease")),
				),
				Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }),
			)
			check(
				!(yield* local.rows).find(row => row.summary.document === document)
					?.dirty,
				"a waiting writer cannot mark dirty before acquiring the lease held by marker clearing",
			)
			yield* Deferred.succeed(release, undefined)
			yield* Fiber.join(clear)
			yield* Fiber.join(append)
			check(
				(yield* local.rows).find(row => row.summary.document === document)
					?.dirty,
				"an append after marker clearing remains discoverable by the closed-document drainer",
			)
			clearing = false
			yield* peer.sync
			yield* peer.save
			check(
				!(yield* local.rows).find(row => row.summary.document === document)
					?.dirty,
				"only accepted journal state clears the durable dirty marker",
			)
			let put = IDBObjectStore.prototype.put
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					IDBObjectStore.prototype.put = put
				}),
			)
			IDBObjectStore.prototype.put = function (
				value: unknown,
				key?: IDBValidKey,
			) {
				if (key === "document-summary:" + subject + ":" + document)
					throw new DOMException("Derived copy quota", "QuotaExceededError")
				return put.call(this, value, key)
			}
			yield* peer.edit("---\ntitle: Recovered copy\n---\nDurable source.").saved
			let failedCopy = yield* peer.save.pipe(Effect.result)
			check(
				failedCopy._tag === "Failure" &&
					!!peer.failures.current().snapshot &&
					!peer.failures.current().save &&
					!peer.unsaved(),
				"a failed derived metadata copy does not invalidate a successful source journal append",
			)
			IDBObjectStore.prototype.put = put
			yield* peer.save
			check(
				!peer.failures.current().snapshot &&
					(yield* local.rows).find(row => row.summary.document === document)
						?.summary.metadata.title === "Recovered copy",
				"metadata-copy recovery heals after the journal checkpoint was already copied",
			)
			let orphan = "orphaned-creation-intent"
			let orphanCreation = {
				subject,
				workspace,
				action: yield* buildAction(
					new Replica(subject + "-orphaned-creation"),
					orphan,
					"Create document",
					staged =>
						newDocument(
							staged,
							orphan,
							"Untitled",
							"# Recovered initial intent",
						),
				),
			}
			yield* storage.set(
				"document-creation:" + subject + ":" + orphan,
				orphanCreation,
			)
			let repaired = (yield* local.rows).find(
				row => row.summary.document === orphan,
			)
			check(
				repaired?.creation?.action.id === orphanCreation.action.id &&
					repaired.summary.metadata.title === "Recovered initial intent",
				"a durable creation intent repairs its missing sidebar summary after interrupted initialization",
			)
			let restored = Context.get(
				yield* Layer.build(
					browserDocumentSessionLayer({
						document: orphan,
						subject,
						initialCreation: yield* local.creation(orphan),
						transport: {
							...remote,
							snapshot: () => Effect.fail(new Error("Must recover locally")),
						},
						activity: local.activity(orphan, () => undefined),
					}),
				),
				DocumentSession,
			)
			check(
				restored.replica.text(orphan) === "# Recovered initial intent" &&
					restored.pending().length === 1,
				"recovered creation intent initializes its complete journal without network or regenerated identities",
			)
		}),
	)
}
