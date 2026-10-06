import { makePassiveDocumentCache } from "../src/client/passive-document-cache"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	BrowserJournal,
	indexedDbJournalLayer,
} from "../src/platform/indexeddb-journal"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import type {
	DocumentSessionOptions,
	PositionedAction,
} from "../src/client/document-session"
import { makeDocumentTransport } from "../src/client/document-transport"
import { Replica } from "../src/shared/crdt"
import { parseCheckpoint } from "../src/shared/checkpoint"
import { CausalDependencyMissing } from "../src/shared/document-errors"
import {
	CommittedActionSchema,
	DocumentActionSchema,
	buildAction,
} from "../src/shared/document-actions"
import { newComment, newDocument } from "../src/shared/documents"

type Check = (value: unknown, message: string) => void
let savedState = Schema.Struct({
	format: Schema.Literal("document-local-state-v3"),
	document: Schema.String,
	subject: Schema.String,
	checkpoint: Schema.Unknown,
	remotePosition: Schema.Natural,
	pending: Schema.Array(DocumentActionSchema),
})

export function verifyAcceptedDocumentSnapshots(subject: string, check: Check) {
	return Effect.gen(function* () {
		let remote = yield* makeDocumentTransport(location.origin, subject)
		let passiveState = yield* makePassiveDocumentCache()
		let document = "accepted-snapshot-proof"
		let source = "# Accepted source"
		let creation = {
			subject,
			workspace: "personal-" + subject,
			action: yield* buildAction(
				new Replica(subject + "-snapshot-creation"),
				document,
				"Create document",
				staged => newDocument(staged, document, "Untitled", source),
			),
		}
		let publication = yield* remote.create(creation)
		let snapshotRequests = 0
		let historyRequests = 0
		let invalidHistory: PositionedAction[] | undefined
		let options: DocumentSessionOptions = {
			passiveState: passiveState(document),
			document,
			subject,
			transport: {
				...remote,
				snapshot: document =>
					Effect.sync(() => snapshotRequests++).pipe(
						Effect.andThen(remote.snapshot(document)),
					),
				history: (document, after, log, limit) =>
					Effect.sync(() => historyRequests++).pipe(
						Effect.andThen(
							Effect.suspend(() =>
								invalidHistory
									? Effect.succeed(invalidHistory)
									: remote.history(document, after, log, limit),
							),
						),
					),
			},
		}
		let localSource = source + "\n\nPending text"
		let original = yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					yield* session.edit(localSource).saved
					yield* session.change("Pending discussion and attachment", staged => [
						...newComment(
							staged,
							"pending-comment",
							document,
							"Pending text",
							"Local discussion",
							subject,
						),
						staged.set("pending-asset", "document", document),
						staged.set("pending-asset", "type", "asset"),
						staged.set("pending-asset", "name", "Local asset"),
						staged.set("pending-asset", "data", "legacy-manifest"),
					])
					yield* session.save
					let cached = yield* readState(options)
					let accepted = restore(cached.state.checkpoint)
					check(
						accepted.text(document) === source &&
							cached.state.remotePosition === publication.initial.position,
						"a local snapshot contains accepted source at its exact remote position",
					)
					check(
						accepted.fields("pending-comment").type === undefined &&
							accepted.fields("pending-asset").type === undefined &&
							cached.state.pending.length === 2,
						"pending source, discussion and attachment records remain separate from the accepted checkpoint",
					)
					let invalid = yield* buildAction(
						session.replica,
						document,
						"Unaccepted dependency",
						staged => [
							staged.edit(document, staged.text(document) + "!"),
							staged.set(document, "mode", "slideshow"),
						],
						subject + "-invalid-history",
					)
					invalidHistory = [
						{
							position: publication.initial.position + 1,
							action: yield* Schema.decodeUnknownEffect(CommittedActionSchema)({
								...invalid,
								subject,
								before: [],
							}),
						},
					]
					let rejected = yield* session.sync.pipe(Effect.result)
					check(
						rejected._tag === "Failure" &&
							rejected.failure instanceof CausalDependencyMissing &&
							session.pending().length === 2 &&
							session.replica.fields(document).mode !== "slideshow",
						"incoming history cannot use a pending local atom to legitimize an unaccepted fact",
					)
					yield* session.save
					let after = yield* readState(options)
					check(
						after.position === cached.position &&
							after.state.remotePosition === cached.state.remotePosition,
						"invalid incoming history appends no journal entry and advances no accepted snapshot cursor",
					)
					invalidHistory = undefined
					return {
						pending: session.pending(),
						checkpoint: session.replica.checkpoint(),
					}
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		let beforeOpening = { snapshotRequests, historyRequests }
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.sync(() => {
					check(
						session.replica.text(document) === localSource &&
							session.replica.fields("pending-comment").body ===
								"Local discussion" &&
							session.replica.fields("pending-asset").name === "Local asset",
						"reopening an accepted-only snapshot restores complete pending document state",
					)
					check(
						JSON.stringify(session.pending()) ===
							JSON.stringify(original.pending) &&
							snapshotRequests === beforeOpening.snapshotRequests &&
							historyRequests === beforeOpening.historyRequests,
						"accepted-only reopening preserves exact ordered proposals without snapshot or history requests",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		yield* passiveState(document).clear
		options.passiveState = undefined
		yield* BrowserJournal.use(storage =>
			storage.cache.pipe(
				Effect.flatMap(cached => {
					if (!cached) return Effect.die("Missing migration cache")
					let value = Schema.decodeUnknownSync(
						Schema.Record(Schema.String, Schema.Unknown),
					)(cached.value)
					return storage.saveCache(cached.position, {
						...value,
						format: "document-local-state-v1",
						checkpoint: original.checkpoint,
					})
				}),
			),
		).pipe(Effect.provide(indexedDbJournalLayer(databaseName(options))))
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					check(
						session.replica.text(document) === localSource &&
							JSON.stringify(session.pending()) ===
								JSON.stringify(original.pending),
						"v1 migration replays the local journal without losing pending source or action identities",
					)
					yield* session.save
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		let migrated = yield* readState(options)
		check(
			restore(migrated.state.checkpoint).text(document) === source &&
				migrated.state.pending.length === 2 &&
				snapshotRequests === beforeOpening.snapshotRequests &&
				historyRequests === beforeOpening.historyRequests,
			"v1 migration writes an accepted-only v3 checkpoint using no remote history",
		)
		yield* Effect.scoped(
			BrowserJournal.use(storage =>
				Effect.gen(function* () {
					let cached = yield* storage.cache
					if (!cached)
						return yield* Effect.die("Missing original snapshot cache")
					let value = yield* Schema.decodeUnknownEffect(
						Schema.Record(Schema.String, Schema.Unknown),
					)(cached.value)
					let damaged = restore(migrated.state.checkpoint)
					damaged.set("cache-only-record", "document", document)
					damaged.set("cache-only-record", "type", "comment")
					yield* storage.saveCache(cached.position, {
						...value,
						checkpoint: damaged.checkpoint(),
						pending: migrated.state.pending.slice(1),
					})
					let recovered = yield* Effect.scoped(
						DocumentSession.use(session =>
							Effect.gen(function* () {
								yield* session.save
								return {
									source: session.replica.text(document),
									pending: session.pending(),
									cacheOnlyRecord:
										session.replica.fields("cache-only-record").type,
									cached: yield* readState(options),
								}
							}),
						).pipe(Effect.provide(browserDocumentSessionLayer(options))),
					).pipe(
						Effect.ensuring(
							storage
								.saveCache(cached.position, cached.value)
								.pipe(Effect.orDie),
						),
					)
					check(
						recovered.source === localSource &&
							recovered.cacheOnlyRecord === undefined &&
							JSON.stringify(recovered.pending) ===
								JSON.stringify(original.pending) &&
							JSON.stringify(recovered.cached.state.pending) ===
								JSON.stringify(original.pending) &&
							restore(recovered.cached.state.checkpoint).fields(
								"cache-only-record",
							).type === undefined,
						"a damaged derived snapshot rebuilds from the journal and preserves every durable pending action",
					)
				}),
			).pipe(Effect.provide(indexedDbJournalLayer(databaseName(options)))),
		)
		yield* Effect.tryPromise(
			() =>
				new Promise<void>((resolve, reject) => {
					let request = indexedDB.open(databaseName(options))
					request.onerror = () => reject(request.error)
					request.onsuccess = () => {
						let database = request.result
						let transaction = database.transaction("cache", "readwrite")
						transaction
							.objectStore("cache")
							.put({ position: "unreadable", value: null }, "projection")
						transaction.oncomplete = () => {
							database.close()
							resolve()
						}
						transaction.onabort = transaction.onerror = () => {
							database.close()
							reject(transaction.error)
						}
					}
				}),
		)
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					yield* session.save
					check(
						session.replica.text(document) === localSource &&
							JSON.stringify(session.pending()) ===
								JSON.stringify(original.pending),
						"an unreadable derived cache rebuilds without losing pending actions or downloading remote history",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)

		yield* BrowserJournal.use(storage =>
			storage.cache.pipe(
				Effect.flatMap(cached => {
					if (!cached) return Effect.die("Missing legacy identity cache")
					return storage.saveCache(cached.position, {
						format: "document-local-state-v1",
						document,
						subject,
					})
				}),
			),
		).pipe(Effect.provide(indexedDbJournalLayer(databaseName(options))))
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					yield* session.save
					check(
						session.replica.text(document) === localSource &&
							JSON.stringify(session.pending()) ===
								JSON.stringify(original.pending) &&
							snapshotRequests === beforeOpening.snapshotRequests &&
							historyRequests === beforeOpening.historyRequests,
						"legacy cache migration depends only on its identity and covered journal position",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		let getAll = IDBObjectStore.prototype.getAll
		let readsFromStart = 0
		IDBObjectStore.prototype.getAll = function (query, count) {
			if (
				this.name === "positions" &&
				this.transaction.db.name === databaseName(options) &&
				query instanceof IDBKeyRange &&
				query.lower === 0
			)
				readsFromStart++
			return getAll.call(this, query, count)
		}
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					check(
						readsFromStart === 0 &&
							session.replica.text(document) === localSource,
						"subsequent v3 opening reads only the local journal tail rather than replaying old entries",
					)
					yield* session.sync
					yield* session.save
					let settled = yield* readState(options)
					let accepted = restore(settled.state.checkpoint)
					check(
						settled.state.pending.length === 0 &&
							settled.state.remotePosition > publication.initial.position &&
							accepted.text(document) === localSource &&
							accepted.fields("pending-comment").body === "Local discussion" &&
							accepted.fields("pending-asset").name === "Local asset",
						"exact accepted receipts move source, comments and attachment records into the accepted checkpoint",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		).pipe(
			Effect.ensuring(
				Effect.sync(() => {
					IDBObjectStore.prototype.getAll = getAll
				}),
			),
		)
		let unpublished = {
			...creation,
			action: yield* buildAction(
				new Replica(subject + "-unpublished-snapshot"),
				"unpublished-snapshot-proof",
				"Create document",
				staged =>
					newDocument(staged, "unpublished-snapshot-proof", "Untitled", source),
			),
		}
		let localOptions = {
			...options,
			document: unpublished.action.document,
			initialCreation: unpublished,
		}
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					yield* session.save
					let cached = yield* readState(localOptions)
					check(
						restore(cached.state.checkpoint).fields(localOptions.document)
							.type === undefined &&
							cached.state.remotePosition === 0 &&
							cached.state.pending[0]?.id === unpublished.action.id,
						"an unpublished document keeps its root only in the exact pending creation action",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(localOptions))),
		)
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					yield* session.sync
					yield* session.save
					let published = yield* readState(localOptions)
					check(
						restore(published.state.checkpoint).text(localOptions.document) ===
							source &&
							published.state.pending.length === 0 &&
							published.state.remotePosition > 0,
						"publication installs the accepted creation root before later receipt replay",
					)
				}),
			).pipe(
				Effect.provide(
					browserDocumentSessionLayer({
						...localOptions,
						initialCreation: undefined,
					}),
				),
			),
		)
	})
}
function readState(options: DocumentSessionOptions) {
	return BrowserJournal.use(storage =>
		Effect.gen(function* () {
			let cached = yield* storage.cache
			if (!cached) return yield* Effect.die("Missing document snapshot cache")
			return {
				position: cached.position,
				state: yield* Schema.decodeUnknownEffect(savedState)(cached.value),
			}
		}),
	).pipe(Effect.provide(indexedDbJournalLayer(databaseName(options))))
}
function restore(checkpoint: unknown) {
	let replica = new Replica("snapshot-reader")
	replica.restore(parseCheckpoint(checkpoint))
	return replica
}
function databaseName(options: DocumentSessionOptions) {
	return (
		"alkalye-document-v1:" + JSON.stringify([options.subject, options.document])
	)
}
