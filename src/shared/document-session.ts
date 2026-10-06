import * as Cache from "effect/Cache"
import type * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Queue from "effect/Queue"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import * as EventGroup from "effect/eventlog/EventGroup"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as EventLog from "effect/eventlog/EventLog"
import * as EventLogEncryption from "effect/eventlog/EventLogEncryption"
import { StoreId } from "effect/eventlog/EventLogMessage"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import * as Layer from "effect/Layer"
import * as SqlError from "effect/sql/SqlError"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { DocumentJournal } from "../platform/document-journal"
import { DocumentLifecycle } from "../platform/document-lifecycle"
import { webCryptoLayer } from "../platform/web-crypto"
import { makeDocumentRecovery } from "./document-recovery"
import {
	DocumentFailureSchema,
	LocalDocumentFailure,
	documentFailure as storageFailure,
} from "./document-failures"
import type { DocumentFailure } from "./document-failures"
import { encode } from "./base64"
import { hasBlobReferences } from "./document-blobs"
import { isBlobFailure, UndoUnavailable } from "./document-errors"
import {
	undoableDocumentAction,
	documentUndoCandidates,
	undoTextTarget,
} from "./document-undo"
import type { UndoEntry } from "./document-undo"
import { partitionDocumentActions } from "./document-dependencies"
import { validateTextCausality } from "./document-causality"
import { parseCheckpoint } from "./checkpoint"
import { Replica } from "./crdt"
import {
	CommittedActionSchema,
	AccessConflict,
	DocumentActionSchema,
	DocumentConflict,
	DocumentHistoryUnavailable,
	DocumentSnapshotSchema,
	DocumentPublicationSchema,
	LocalDocumentCreationSchema,
	buildAction,
	restoreSnapshot,
	validateAction,
	undoAction,
	prepareAction,
} from "./document-actions"
import type {
	ActionChain,
	CommittedAction,
	DocumentAction,
	DocumentSnapshot,
	DocumentPublication,
	LocalDocumentCreation,
} from "./document-actions"
import { compactOperation, parseOperation } from "./model"
import type { Atom, Operation, DocumentRecord } from "./model"

export interface DocumentProjectionState {
	document: string
	localPosition: number
	remoteLog: string
	remotePosition: number
	record: DocumentRecord | undefined
}
export interface DocumentActivity {
	proposing: Effect.Effect<unknown, unknown>
	projected(state: DocumentProjectionState): Effect.Effect<unknown, unknown>
	settled: Effect.Effect<unknown, unknown>
}

export interface DocumentTransport {
	create?(
		creation: LocalDocumentCreation,
	): Effect.Effect<DocumentPublication, unknown>
	snapshot(document: string): Effect.Effect<DocumentSnapshot, unknown>
	action?(document: string, id: string): Effect.Effect<CommittedAction, unknown>
	chain?(document: string, id: string): Effect.Effect<ActionChain, unknown>
	withdraw?(action: DocumentAction): Effect.Effect<void, unknown>
	commit(action: DocumentAction): Effect.Effect<number, unknown>
	history(
		document: string,
		after: number,
		log: string,
		limit: number,
	): Effect.Effect<ReadonlyArray<PositionedAction>, unknown>
}
export interface PositionedAction {
	position: number
	action: CommittedAction
}
export interface DocumentSessionOptions {
	document: string
	subject: string
	author?: string
	initialCreation?: LocalDocumentCreation
	activity?: DocumentActivity
	transport: DocumentTransport
}
export class DocumentSession extends Context.Service<
	DocumentSession,
	Effect.Success<ReturnType<typeof makeSession>>
>()("alkalye/DocumentSession") {
	static layer(options: DocumentSessionOptions) {
		let database = documentDatabaseName(options)
		let projection = Layer.effect(DocumentProjection, makeProjection(options))
		let log = EventLog.layer(events, handlers).pipe(
			Layer.provideMerge(projection),
			Layer.provide(
				Layer.effect(EventLog.Identity, EventLog.makeIdentity).pipe(
					Layer.provide(EventLogEncryption.layerSubtle),
				),
			),
			Layer.provide(
				Layer.succeed(EventLog.CurrentStoreId, StoreId.make(database)),
			),
		)
		return Layer.effect(DocumentSession, makeSession(options)).pipe(
			Layer.provide(log),
			Layer.provide(webCryptoLayer),
		)
	}
}

let positionedActions = Schema.Array(
	Schema.Struct({ position: Schema.Natural, action: CommittedActionSchema }),
)
let rejectionFailure = Schema.Union([UndoUnavailable, AccessConflict])
let rejectedAction = Schema.Struct({
	action: DocumentActionSchema,
	entry: Schema.String,
	root: Schema.String,
	failure: rejectionFailure,
	withdrawn: Schema.optional(Schema.Boolean),
})
type RejectedAction = typeof rejectedAction.Type
let recording = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("withdrawn"),
		action: Schema.String,
		entry: Schema.String,
	}),
	Schema.Struct({
		kind: Schema.Literal("localCreated"),
		creation: LocalDocumentCreationSchema,
	}),
	Schema.Struct({
		kind: Schema.Literal("published"),
		publication: DocumentPublicationSchema,
	}),
	Schema.Struct({
		kind: Schema.Literal("opened"),
		snapshot: DocumentSnapshotSchema,
	}),
	Schema.Struct({
		kind: Schema.Literal("proposed"),
		action: DocumentActionSchema,
	}),
	Schema.Struct({
		kind: Schema.Literal("rejected"),
		action: Schema.String,
		entry: Schema.String,
		failure: rejectionFailure,
		closure: Schema.Array(Schema.String),
	}),
	Schema.Struct({
		kind: Schema.Literal("received"),
		log: Schema.String,
		after: Schema.Natural,
		actions: positionedActions,
	}),
])
type Recording = typeof recording.Type
let codec = SchemaBinary.toCodec(recording)
let proposalIndex = Schema.Array(
	Schema.Tuple([Schema.String, Schema.String, Schema.Boolean]),
)
let legacyMaterialization = Schema.Struct({
	format: Schema.Literal("document-local-state-v1"),
	document: Schema.String,
	subject: Schema.String,
})
let previousMaterialization = Schema.Struct({
	format: Schema.Literal("document-local-state-v2"),
	document: Schema.String,
	subject: Schema.String,
	checkpoint: Schema.Unknown,
	log: Schema.String,
	remotePosition: Schema.Natural,
	proposals: proposalIndex,
	pending: Schema.Array(DocumentActionSchema),
	creation: Schema.optional(LocalDocumentCreationSchema),
})
let currentMaterialization = Schema.Struct({
	...previousMaterialization.fields,
	format: Schema.Literal("document-local-state-v3"),
	rejected: Schema.Array(rejectedAction),
})
let materialization = Schema.Union([
	legacyMaterialization,
	previousMaterialization,
	currentMaterialization,
])
let changes = EventGroup.empty.add({
	tag: "DocumentRecorded",
	primaryKey: () => "document",
	payload: recording,
	success: Schema.Void,
	error: DocumentFailureSchema,
})
let events = EventLog.schema(changes)
class DocumentProjection extends Context.Service<
	DocumentProjection,
	Effect.Success<ReturnType<typeof makeProjection>>
>()("alkalye/DocumentProjection") {}
let handlers = EventLog.group(changes, handlers =>
	handlers.handle("DocumentRecorded", ({ payload }) =>
		DocumentProjection.use(projection =>
			projection
				.record(payload)
				.pipe(
					Effect.mapError(error =>
						storageFailure("validate document action", error),
					),
				),
		),
	),
)
let equalAction = Schema.toEquivalence(DocumentActionSchema)
let equalCommittedAction = Schema.toEquivalence(CommittedActionSchema)
interface UndoReceipt {
	entry: string
	index: number
	position: number
}

function makeSession(options: DocumentSessionOptions) {
	return Effect.gen(function* () {
		let projection = yield* DocumentProjection
		let journal = yield* DocumentJournal
		let lifecycle = yield* DocumentLifecycle
		let cryptography = yield* Crypto.Crypto
		let write = yield* EventLog.makeClient(events)
		let gate = yield* Semaphore.make(1)
		let network = yield* Semaphore.make(1)
		let unsaved = yield* Queue.unbounded<DocumentAction, Cause.Done>()
		let requireOpen = Effect.suspend(() =>
			unsaved.state._tag === "Open"
				? Effect.void
				: conflict("This document session is closed"),
		)
		yield* Effect.addFinalizer(() =>
			Effect.suspend(() =>
				Queue.sizeUnsafe(unsaved) ? Effect.void : Queue.shutdown(unsaved),
			),
		)
		let cacheWrites = yield* Semaphore.make(1)
		let inFlight = yield* Ref.make(0)
		let background = yield* Scope.fork(yield* Scope.Scope, "parallel")
		let channel = yield* Effect.acquireRelease(
			Effect.sync(() => new BroadcastChannel(documentDatabaseName(options))),
			channel => Effect.sync(() => channel.close()),
		)
		let saveSnapshot = gate
			.withPermit(
				Effect.all([projection.captureSnapshot, projection.captureState]),
			)
			.pipe(
				Effect.flatMap(([snapshot, state]) =>
					Effect.gen(function* () {
						if (snapshot) yield* projection.saveSnapshot(snapshot)
						if (options.activity && state.localPosition)
							return yield* options.activity
								.projected(state)
								.pipe(Effect.as(Option.some(state)))
						return snapshot ? Option.some(snapshot) : Option.none()
					}),
				),
			)
		let notify = Effect.sync(() => channel.postMessage(null))
		let recovery = yield* makeDocumentRecovery(
			{
				save: Effect.suspend(() => rawFlushUnlocked),
				projection: projection.replay,
				snapshot: saveSnapshot,
				notification: notify,
			},
			{ save: gate, projection: gate, snapshot: cacheWrites },
		).pipe(Effect.provideService(Scope.Scope, background))
		let drafts = yield* lifecycle.protect(
			() =>
				Queue.sizeUnsafe(unsaved) > 0 ||
				Ref.getUnsafe(inFlight) > 0 ||
				!!recovery.failures.current().save,
		)
		let revision = yield* SubscriptionRef.make(0)
		advanceView()
		let persistUnlocked = (value: Recording) =>
			write("DocumentRecorded", value).pipe(
				Effect.catchDefect(cause =>
					SqlError.isSqlError(cause)
						? Effect.fail(storageFailure("save document action", cause))
						: Effect.die(cause),
				),
				Effect.andThen(recovery.run("projection", projection.replay)),
				Effect.andThen(recovery.run("notification")),
				Effect.mapError(error => storageFailure("save document action", error)),
			)
		let persist = (value: Recording) => gate.withPermit(persistUnlocked(value))
		let rawFlushUnlocked: Effect.Effect<void, DocumentFailure> = Effect.gen(
			function* () {
				while (Queue.sizeUnsafe(unsaved)) {
					let action = yield* Queue.peek(unsaved)
					yield* recovery.attempt("projection", projection.replay)
					if (projection.proposed(action.id))
						yield* projection.validate({ kind: "proposed", action })
					else yield* persistUnlocked({ kind: "proposed", action })
					yield* Queue.take(unsaved)
					projection.removeDraft(action.id)
				}
			},
		).pipe(
			Effect.mapError(error => storageFailure("save optimistic edits", error)),
		)
		let flushUnlocked = recovery.attempt("save", rawFlushUnlocked)
		let flush = recovery.attempt("save")
		let save = recovery.attempt("snapshot")
		yield* recovery.failures.changes.pipe(
			Stream.runForEach(() => Effect.sync(drafts.update)),
			Effect.forkScoped({ startImmediately: true }),
			Effect.provideService(Scope.Scope, background),
		)
		yield* Stream.fromEventListener(channel, "message", { bufferSize: 1 }).pipe(
			Stream.merge(lifecycle.changes),
			Stream.buffer({ capacity: 1, strategy: "sliding" }),
			Stream.runForEach(() => recovery.run("projection")),
			Effect.forkScoped({ startImmediately: true }),
			Effect.provideService(Scope.Scope, background),
		)
		yield* gate.withPermit(projection.replay)
		if (!projection.opened()) {
			yield* persist(
				options.initialCreation
					? { kind: "localCreated", creation: options.initialCreation }
					: {
							kind: "opened",
							snapshot: yield* options.transport.snapshot(options.document),
						},
			)
			yield* gate.withPermit(projection.replay)
		}
		yield* SubscriptionRef.changes(projection.version).pipe(
			Stream.drop(1),
			Stream.runForEach(() => Effect.sync(advanceView)),
			Effect.forkScoped({ startImmediately: true }),
			Effect.provideService(Scope.Scope, background),
		)
		yield* SubscriptionRef.changes(projection.version).pipe(
			Stream.debounce("500 millis"),
			Stream.merge(Stream.fromSchedule(Schedule.spaced("2 seconds"))),
			Stream.filter(() => !recovery.failures.current().snapshot),
			Stream.runForEach(() => recovery.run("snapshot")),
			Effect.forkScoped({ startImmediately: true }),
			Effect.provideService(Scope.Scope, background),
		)
		yield* lifecycle.hidden.pipe(
			Stream.runForEach(() =>
				flush.pipe(
					Effect.andThen(recovery.run("snapshot")),
					Effect.catch(error =>
						Effect.logError("Could not save document drafts", error),
					),
				),
			),
			Effect.forkScoped({ startImmediately: true }),
			Effect.provideService(Scope.Scope, background),
		)
		yield* Effect.addFinalizer(() =>
			Queue.end(unsaved).pipe(
				Effect.andThen(Scope.close(background, Exit.void)),
				Effect.andThen(
					flush.pipe(
						Effect.retry({
							times: 3,
							schedule: Schedule.exponential("100 millis"),
							while: error =>
								error instanceof LocalDocumentFailure && error.retryable,
						}),
						Effect.orDie,
					),
				),
				Effect.andThen(
					save.pipe(
						Effect.catch(error =>
							Effect.logError("Could not cache document state", error),
						),
					),
				),
				Effect.asVoid,
			),
		)
		let view = documentView(() => projection.replica)
		return {
			replica: view,
			version: () => SubscriptionRef.getUnsafe(revision),
			changes: SubscriptionRef.changes(revision),
			failures: recovery.failures,
			pending: () => projection.pending(),
			rejected: () => projection.rejected(),
			unsaved: () => Queue.sizeUnsafe(unsaved),
			flush,
			change: (
				label: string,
				build: (staged: Replica) => (Operation | null)[],
			) => propose(actor => projection.stage(label, build, actor)),
			undo: (textTarget?: string) => undo(false, textTarget),
			redo: (textTarget?: string) => undo(true, textTarget),
			compensate: (original: CommittedAction) =>
				propose(actor => projection.compensate(original, actor)),
			commit: (action: DocumentAction) =>
				Schema.decodeUnknownEffect(DocumentActionSchema)(action).pipe(
					Effect.flatMap(action =>
						gate.withPermit(
							Effect.gen(function* () {
								yield* requireOpen
								yield* flushUnlocked
								yield* recovery.attempt("projection", projection.replay)
								if (!projection.proposed(action.id))
									return yield* conflict(
										"Create new document actions through change",
									)
								yield* projection.validate({ kind: "proposed", action })
								let rejected = projection.rejection(action.id)
								if (rejected) return yield* Effect.fail(rejected.failure)
							}),
						),
					),
				),
			// Typing in the document or in one of its texts, such as a theme.
			edit: (content: string, base?: Atom[], target = options.document) => {
				let operation = projection.replica.prepareEdit(target, content, base)
				let unchanged = {
					operation: null,
					atoms: view.visible(target),
				}
				if (!operation) return { ...unchanged, saved: Effect.void }
				let decoded = Schema.decodeUnknownResult(DocumentActionSchema)({
					id: operation.id,
					document: options.document,
					actor: projection.replica.actor,
					label: "Type",
					changes: [compactOperation(operation)],
					guards: [],
					accessGuards: [],
				})
				if (decoded._tag === "Failure")
					return {
						...unchanged,
						saved: conflict(
							"This edit exceeds the action limits; split large changes into smaller edits",
						),
					}
				if (!Queue.offerUnsafe(unsaved, decoded.success))
					return {
						...unchanged,
						saved: conflict("This document session is closed"),
					}
				projection.replica.apply([operation])
				projection.addDraft(decoded.success)
				drafts.update()
				advanceView()
				return {
					operation: freezeOperation(operation),
					atoms: view.visible(target),
					saved: flush,
				}
			},
			replay: recovery.attempt("projection"),
			save,
			sync: network
				.withPermit(
					Effect.gen(function* () {
						yield* requireOpen
						yield* flush
						yield* recovery.attempt("projection")
						let creation = projection.creation()
						if (creation) {
							if (!options.transport.create)
								return yield* conflict(
									"This transport cannot publish a local document",
								)
							yield* persist({
								kind: "published",
								publication: yield* options.transport.create(creation),
							})
						}
						yield* pull()
						while (true) {
							yield* requireOpen
							let outbound = projection.outbound()
							if (!outbound) {
								if (options.activity)
									yield* gate.withPermit(
										journal.journal.withLock(
											StoreId.make(documentDatabaseName(options)),
										)(
											projection.replay.pipe(
												Effect.andThen(
													Effect.suspend(() =>
														projection.outbound() || Queue.sizeUnsafe(unsaved)
															? Effect.void
															: (options.activity?.settled ?? Effect.void),
													),
												),
											),
										),
									)
								return
							}
							let action = outbound.action
							if (outbound.kind === "withdraw") {
								if (!options.transport.withdraw)
									return yield* conflict(
										"This transport cannot withdraw a rejected proposal",
									)
								yield* options.transport.withdraw(action)
								yield* persist({
									kind: "withdrawn",
									action: action.id,
									entry: outbound.entry,
								})
								yield* pull()
								continue
							}
							yield* options.transport.commit(action).pipe(
								Effect.catch(error => {
									if (
										!Schema.is(rejectionFailure)(error) ||
										!canReject(action, error)
									)
										return Effect.fail(error)
									return gate.withPermit(
										Effect.gen(function* () {
											yield* flushUnlocked
											yield* projection.replay
											let recording = yield* projection.reject(action.id, error)
											if (recording) yield* persistUnlocked(recording)
										}),
									)
								}),
							)
							yield* pull()
						}
					}),
				)
				.pipe(
					Effect.tapError(error =>
						isBlobFailure(error)
							? recovery.synchronizationFailure(error)
							: Effect.void,
					),
					Effect.tap(() => recovery.synchronizationFailure()),
				),
			historyPage: (after = 0) =>
				Effect.suspend(() =>
					options.transport.history(
						options.document,
						after,
						projection.cursor().log,
						100,
					),
				),
			historyCursor: () => Object.freeze(projection.cursor()),
		}
		function undo(redo: boolean, textTarget?: string) {
			let generation = projection.editGeneration()
			return propose(actor =>
				projection.undo(redo, actor, textTarget).pipe(
					Effect.tap(() =>
						generation === projection.editGeneration()
							? Effect.void
							: Effect.fail(
									new UndoUnavailable({
										reason: "Stale",
										message:
											"New text arrived while undo was waiting; try again",
									}),
								),
					),
				),
			)
		}
		function propose(
			prepare: (
				actor: string,
			) => Effect.Effect<DocumentAction, DocumentFailure>,
		) {
			let prepared = Ref.makeUnsafe<DocumentAction | undefined>(undefined)
			return Effect.acquireUseRelease(
				Ref.update(inFlight, count => count + 1).pipe(
					Effect.andThen(Effect.sync(drafts.update)),
				),
				() =>
					gate.withPermit(
						Effect.gen(function* () {
							yield* requireOpen
							yield* flushUnlocked
							yield* recovery.attempt("projection", projection.replay)
							let action = yield* Ref.get(prepared)
							if (!action) {
								let actor = yield* documentActor(cryptography, options)
								action = freezeAction(yield* prepare(actor))
								yield* Ref.set(prepared, action)
							}
							if (projection.proposed(action.id)) {
								yield* projection.validate({ kind: "proposed", action })
								let rejected = projection.rejection(action.id)
								if (rejected) return yield* Effect.fail(rejected.failure)
								return action
							}
							yield* persistUnlocked({ kind: "proposed", action })
							return action
						}),
					),
				() =>
					Ref.update(inFlight, count => count - 1).pipe(
						Effect.andThen(Effect.sync(drafts.update)),
					),
			)
		}

		function advanceView() {
			Effect.runSync(SubscriptionRef.update(revision, current => current + 1))
		}
		function pull() {
			return Effect.gen(function* () {
				let pageSize = 100
				while (true) {
					yield* recovery.attempt("projection")
					let cursor = projection.cursor()
					let actions = yield* options.transport.history(
						options.document,
						cursor.position,
						cursor.log,
						pageSize,
					)
					if (!actions.length) return
					yield* persist({
						kind: "received",
						log: cursor.log,
						after: cursor.position,
						actions,
					})
					if (actions.length < pageSize) return
				}
			})
		}
	})
}

function makeProjection(options: DocumentSessionOptions) {
	return Effect.gen(function* () {
		let storage = yield* DocumentJournal
		let cryptography = yield* Crypto.Crypto
		let actor = yield* documentActor(cryptography, options)
		let replica = new Replica(actor, options.author)
		let durable = new Replica("local-document", options.author)
		let accepted = new Replica("accepted-document", options.author)
		let pending = new Map<string, DocumentAction>()
		let rejected = new Map<string, RejectedAction>()
		let drafts = new Map<string, DocumentAction>()
		let draftVersion = 0
		let editGeneration = 0
		let proposals = new Map<string, { entry: string; settled: boolean }>()
		let log = ""
		let creation: LocalDocumentCreation | undefined
		let remotePosition = 0
		let localPosition = 0
		let cachedPosition = 0
		let undoEntries = new Map<string, Omit<UndoEntry, "active">>()
		let undoReceipts = new Map<string, UndoReceipt>()
		let undoPosition = 0
		let undoOrder = 0
		let projectionComplete = true
		let version = yield* SubscriptionRef.make(0)
		let knownProposals = yield* Cache.makeWith(
			(id: string) =>
				storage
					.entry(id)
					.pipe(
						Effect.flatMap(entry =>
							entry
								? decode(entry)
								: conflict("Missing saved proposal").pipe(
										Effect.mapError(error =>
											storageFailure("read proposal", error),
										),
									),
						),
					),
			{
				capacity: 32,
				timeToLive: exit => (Exit.isSuccess(exit) ? "1 minute" : 0),
			},
		)
		let cached = yield* storage.cache.pipe(
			Effect.catch(error =>
				Effect.logWarning(
					"Rebuilding unreadable document cache from its journal",
					error,
				).pipe(Effect.as(undefined)),
			),
		)
		if (cached) {
			yield* restoreCache(cached).pipe(
				Effect.catch(error =>
					Effect.sync(() => {
						replica = new Replica(actor, options.author)
						durable = new Replica("local-document", options.author)
						accepted = new Replica("accepted-document", options.author)
						pending.clear()
						rejected.clear()
						proposals.clear()
						log = ""
						creation = undefined
						remotePosition = localPosition = cachedPosition = 0
					}).pipe(
						Effect.andThen(
							Effect.logWarning(
								"Rebuilding derived document cache from its journal",
								error,
							),
						),
					),
				),
			)
		}
		function restoreCache(cached: { position: number; value: unknown }) {
			return Effect.gen(function* () {
				if (!(yield* storage.containsPosition(cached.position)))
					return yield* conflict(
						"Saved document cache has a stale journal cursor",
					)
				let state = yield* Schema.decodeUnknownEffect(materialization)(
					cached.value,
				)
				if (
					state.document !== options.document ||
					state.subject !== options.subject
				)
					return yield* conflict(
						"Saved document belongs to another account or journal",
					)
				if (state.format === "document-local-state-v1") return
				if (
					state.creation &&
					(state.log ||
						state.creation.subject !== options.subject ||
						state.creation.action.document !== options.document ||
						!state.pending.some(
							action =>
								equalAction(action, state.creation?.action ?? action) &&
								action.id === state.creation?.action.id,
						))
				)
					return yield* conflict(
						"Saved local creation is inconsistent with its pending action",
					)
				yield* Effect.try({
					try: () => {
						let checkpoint = parseCheckpoint(state.checkpoint)
						accepted.restore(checkpoint)
						durable.restore(checkpoint)
						replica.restore(checkpoint)
					},
					catch: cause => storageFailure("restore document", cause),
				})
				log = state.log
				creation = state.creation ? freezeCreation(state.creation) : undefined
				remotePosition = state.remotePosition
				localPosition = cached.position
				cachedPosition = cached.position
				if (state.format === "document-local-state-v2") cachedPosition = 0
				for (let [id, entry, settled] of state.proposals) {
					if (proposals.has(id))
						return yield* conflict(
							"Saved proposal receipts contain duplicate identities",
						)
					proposals.set(id, { entry, settled })
				}
				if (state.format === "document-local-state-v3")
					for (let item of state.rejected) {
						let proposal = proposals.get(item.action.id)
						if (
							!proposal ||
							proposal.settled ||
							proposal.entry !== item.entry ||
							!proposals.has(item.root) ||
							rejected.has(item.action.id) ||
							item.action.document !== options.document ||
							!item.action.actor.startsWith(options.subject + "-")
						)
							return yield* conflict(
								"Saved rejected action has no matching proposal",
							)
						let known = yield* Cache.get(knownProposals, item.entry)
						if (
							known.kind !== "proposed" ||
							!equalAction(known.action, item.action)
						)
							return yield* conflict(
								"Saved rejection differs from its journal proposal",
							)
						rejected.set(item.action.id, freezeRejected(item))
					}
				for (let action of state.pending) {
					if (
						action.document !== options.document ||
						!action.actor.startsWith(options.subject + "-") ||
						!proposals.has(action.id) ||
						proposals.get(action.id)?.settled ||
						pending.has(action.id) ||
						rejected.has(action.id)
					)
						return yield* conflict(
							"Saved pending action has no matching receipt",
						)
					let operations = yield* validateAction(durable, action)
					yield* validateTextCausality(durable, options.document, operations)
					yield* Effect.try({
						try: () => {
							durable.validate(operations)
							replica.validate(operations)
							durable.apply(operations)
							replica.apply(operations)
						},
						catch: cause =>
							storageFailure("restore pending document action", cause),
					})
					pending.set(action.id, freezeAction(action))
				}
				for (let [id, proposal] of proposals)
					if (!proposal.settled && !pending.has(id) && !rejected.has(id))
						return yield* conflict(
							"Saved proposal receipt lost its pending action",
						)
				let outstanding = false
				for (let [id, proposal] of proposals) {
					if (proposal.settled) continue
					if (rejected.get(id)?.withdrawn) {
						if (outstanding)
							return yield* conflict(
								"Saved withdrawal skips an earlier proposal",
							)
					} else outstanding = true
				}
				for (let item of rejected.values())
					if (
						!proposals.get(item.root)?.settled &&
						rejected.get(item.root)?.root !== item.root
					)
						return yield* conflict("Saved rejected action lost its root")
			})
		}
		let replay = Effect.gen(function* () {
			projectionComplete = false
			let changed = false
			while (true) {
				let tail = yield* storage.readAfter(localPosition, 1000)
				for (let entry of tail.entries) {
					let value = yield* decode(entry)
					yield* check(value)
					if (value.kind === "published") {
						if (creation) {
							accepted.apply(
								value.publication.initial.action.changes.map(parseOperation),
							)
							log = value.publication.log
							remotePosition = Math.max(
								remotePosition,
								value.publication.initial.position,
							)
							pending.delete(creation.action.id)
							let proposal = proposals.get(creation.action.id)
							if (proposal) proposal.settled = true
							creation = undefined
						}
					} else if (value.kind === "opened") {
						if (!log && !creation) {
							let restored = yield* restoreSnapshot(value.snapshot, actor)
							accepted.restore(restored.checkpoint())
							durable.restore(restored.checkpoint())
							replica.restore(restored.checkpoint())
							log = value.snapshot.log
							remotePosition = value.snapshot.position
						}
					} else if (
						value.kind === "proposed" ||
						value.kind === "localCreated"
					) {
						let action =
							value.kind === "proposed" ? value.action : value.creation.action
						if (!proposals.has(action.id)) {
							let operations = action.changes.map(parseOperation)
							yield* applyChanges([durable, replica], operations)
							pending.set(action.id, freezeAction(action))
							proposals.set(action.id, {
								entry: entry.idString,
								settled: false,
							})
							if (value.kind === "localCreated")
								creation = freezeCreation(value.creation)
						}
					} else if (value.kind === "withdrawn") {
						let item = rejected.get(value.action)
						if (item)
							rejected.set(
								value.action,
								freezeRejected({ ...item, withdrawn: true }),
							)
					} else if (value.kind === "rejected") {
						let root = pending.get(value.action)
						if (root) {
							let partition = yield* partitionDocumentActions(
								accepted,
								[...pending.values()],
								[root.id],
							)
							let items = yield* Effect.forEach(partition.blocked, action =>
								Effect.gen(function* () {
									let proposal = proposals.get(action.id)
									if (!proposal)
										return yield* conflict("Rejected dependent has no proposal")
									return freezeRejected({
										action,
										entry: proposal.entry,
										root: root.id,
										failure: value.failure,
									})
								}),
							)
							while (true) {
								let replacement = yield* rebuild(partition.ready)
								let swapped = yield* Effect.sync(() => {
									if (replacement.draftVersion !== draftVersion) return false
									for (let item of items) {
										rejected.set(item.action.id, item)
										pending.delete(item.action.id)
									}
									replacement.replica.clock = Math.max(
										replica.clock,
										replacement.replica.clock,
									)
									durable = replacement.durable
									replica = replacement.replica
									return true
								})
								if (swapped) break
							}
						}
					} else {
						for (let { position, action } of value.actions) {
							if (position <= remotePosition) continue
							yield* validateAction(accepted, action)
							let operations = action.changes.map(parseOperation)
							yield* applyChanges([accepted, durable, replica], operations)
							remotePosition = position
							pending.delete(action.id)
							rejected.delete(action.id)
							let proposal = proposals.get(action.id)
							if (proposal) proposal.settled = true
						}
					}
				}
				localPosition = tail.position
				changed ||= tail.entries.length > 0
				if (tail.entries.length < 1000) break
			}
			projectionComplete = true
			if (changed)
				yield* SubscriptionRef.update(version, current => current + 1)
		}).pipe(Effect.mapError(error => storageFailure("replay document", error)))
		return {
			get replica() {
				return replica
			},
			stage: (
				label: string,
				build: (staged: Replica) => (Operation | null)[],
				actor: string,
			) => buildAction(durable, options.document, label, build, actor),
			undo: (redo: boolean, actor: string, textTarget?: string) =>
				Effect.gen(function* () {
					yield* indexUndoHistory()
					let excluded = new Set<string>()
					for (let item of rejected.values()) {
						if (
							item.failure._tag !== "UndoUnavailable" ||
							item.failure.reason !== "BelowFloor"
						)
							continue
						let entry = undoEntries.get(item.action.undoOf ?? "")
						let visited = new Set<string>()
						while (entry?.undoOf && !visited.has(entry.id)) {
							visited.add(entry.id)
							entry = undoEntries.get(entry.undoOf)
						}
						if (entry) excluded.add(entry.id)
					}
					let candidates = yield* documentUndoCandidates(
						[...undoEntries.values()].map(entry => ({
							...entry,
							eligible: !excluded.has(entry.id),
							active:
								!rejected.has(entry.id) &&
								(undoReceipts.has(entry.id) || pending.has(entry.id)),
						})),
						options.subject,
						redo,
						textTarget,
					)
					let unavailable: UndoUnavailable | undefined
					for (let candidate of candidates) {
						let original = yield* undoBasis(candidate.tip.id)
						let result = yield* undoAction(durable, original, actor).pipe(
							Effect.result,
						)
						if (result._tag === "Success") return result.success
						if (
							!(result.failure instanceof UndoUnavailable) ||
							(result.failure.reason !== "Exhausted" &&
								result.failure.reason !== "BelowFloor")
						)
							return yield* Effect.fail(result.failure)
						unavailable = result.failure
					}
					return yield* Effect.fail(
						unavailable ??
							new UndoUnavailable({
								reason: "Exhausted",
								message: redo ? "Nothing to redo" : "Nothing to undo",
							}),
					)
				}).pipe(
					Effect.mapError(error =>
						storageFailure("prepare document undo", error),
					),
				),
			compensate: (original: CommittedAction, actor: string) =>
				Effect.suspend(() =>
					rejected.has(original.id)
						? Effect.fail(
								new UndoUnavailable({
									reason: "Stale",
									message:
										"This action was rejected; create a new action from current state",
								}),
							)
						: undoAction(durable, original, actor),
				),
			version,
			opened: () => !!log || !!creation,
			creation: () => creation,
			proposed: (id: string) => proposals.has(id),

			rejection: (id: string) => rejected.get(id),
			reject: (id: string, failure: typeof rejectionFailure.Type) =>
				Effect.gen(function* () {
					let action = pending.get(id)
					if (!action) return undefined
					let entry = proposals.get(id)?.entry
					if (!entry)
						return yield* conflict("Rejected action has no saved proposal")
					let partition = yield* partitionDocumentActions(
						accepted,
						[...pending.values()],
						[id],
					)
					if (partition.blocked.some(hasInsertedText))
						return yield* Effect.fail(failure)
					return {
						kind: "rejected",
						action: id,
						entry,
						failure,
						closure: partition.blocked.map(action => action.id),
					} satisfies Recording
				}),
			outbound() {
				for (let [id, proposal] of proposals) {
					if (proposal.settled) continue
					let item = rejected.get(id)
					if (item && !item.withdrawn)
						return {
							kind: "withdraw",
							action: item.action,
							entry: proposal.entry,
						}
					let action = pending.get(id)
					if (action) return { kind: "commit", action, entry: proposal.entry }
				}
				return undefined
			},
			rejected: () => Object.freeze([...rejected.values()]),
			addDraft(action: DocumentAction) {
				drafts.set(action.id, freezeAction(action))
				draftVersion++
				editGeneration++
			},
			editGeneration: () => editGeneration,
			removeDraft(id: string) {
				if (drafts.delete(id)) draftVersion++
			},
			pending: () => Object.freeze([...pending.values()]),
			cursor: () => ({ log, position: remotePosition }),
			replay,
			validate: (value: Recording) => replay.pipe(Effect.andThen(check(value))),
			record: (value: Recording) =>
				replay.pipe(
					Effect.andThen(
						Effect.suspend(() =>
							value.kind === "proposed" && !proposals.has(value.action.id)
								? checkCompensationSuccessor(value.action)
								: Effect.void,
						),
					),
					Effect.andThen(check(value)),
					Effect.andThen(
						value.kind === "proposed" || value.kind === "localCreated"
							? (options.activity?.proposing ?? Effect.void)
							: Effect.void,
					),
				),
			captureState: Effect.sync((): DocumentProjectionState => ({
				document: options.document,
				localPosition,
				remoteLog: log,
				remotePosition,
				record: durable.documents("").find(doc => doc.id === options.document),
			})),
			captureSnapshot: Effect.sync(() =>
				projectionComplete && localPosition && localPosition !== cachedPosition
					? {
							position: localPosition,
							value: Schema.encodeSync(currentMaterialization)({
								format: "document-local-state-v3",
								document: options.document,
								subject: options.subject,
								checkpoint: accepted.checkpoint(),
								log,
								remotePosition,
								proposals: [...proposals].map(([id, value]) => [
									id,
									value.entry,
									value.settled,
								]),
								pending: [...pending.values()],
								rejected: [...rejected.values()],
								creation,
							}),
						}
					: undefined,
			),
			saveSnapshot: (snapshot: { position: number; value: unknown }) =>
				Effect.gen(function* () {
					let saved = yield* storage.saveCache(
						snapshot.position,
						snapshot.value,
					)
					if (!saved && !(yield* storage.containsPosition(snapshot.position)))
						return yield* conflict(
							"The snapshot's journal position was removed",
						)
					cachedPosition = Math.max(cachedPosition, snapshot.position)
				}),
		}

		function indexUndoHistory() {
			return Effect.gen(function* () {
				while (undoPosition < localPosition) {
					let page = yield* storage.readAfter(undoPosition, 100, localPosition)
					if (!page.entries.length)
						return yield* conflict("Undo history lost its journal position")
					for (let entry of page.entries) {
						let value = yield* decode(entry)
						if (value.kind === "received" || value.kind === "published")
							yield* Cache.set(knownProposals, entry.idString, value)
						if (value.kind === "proposed" || value.kind === "localCreated") {
							let action =
								value.kind === "proposed" ? value.action : value.creation.action
							let existing = undoEntries.get(action.id)
							if (!existing?.local)
								undoEntries.set(action.id, {
									id: action.id,
									subject: options.subject,
									undoOf: action.undoOf,
									order: ++undoOrder,
									local: true,
									birth: value.kind === "localCreated",
									undoable: undoableDocumentAction(action),
									textTarget: undoTextTarget(action),
								})
						} else if (value.kind === "published") {
							yield* indexReceipt(entry.idString, 0, value.publication.initial)
						} else if (value.kind === "received") {
							for (let [index, action] of value.actions.entries())
								yield* indexReceipt(entry.idString, index, action)
						}
					}
					undoPosition = page.position
				}
			}).pipe(
				Effect.mapError(error =>
					storageFailure("index document undo history", error),
				),
			)
		}
		function indexReceipt(
			entry: string,
			index: number,
			value: PositionedAction,
		) {
			return Effect.gen(function* () {
				let { action, position } = value
				let previous = undoReceipts.get(action.id)
				if (previous) {
					if (
						previous.position !== position ||
						!equalCommittedAction(
							yield* receiptAction(previous, action.id),
							action,
						)
					)
						return yield* conflict(
							"Undo history has conflicting accepted receipts",
						)
					return
				}
				if (action.document !== options.document || position > remotePosition)
					return yield* conflict(
						"Undo receipt is outside the accepted document",
					)
				let existing = undoEntries.get(action.id)
				let proposal = proposals.get(action.id)
				if (proposal) {
					let recorded = yield* Cache.get(knownProposals, proposal.entry)
					let proposed =
						recorded.kind === "proposed"
							? recorded.action
							: recorded.kind === "localCreated"
								? recorded.creation.action
								: undefined
					if (
						!proposed ||
						!equalAction(proposed, {
							...action,
							guards: proposed.guards,
							accessGuards: proposed.accessGuards,
						})
					)
						return yield* conflict(
							"Undo receipt differs from its saved proposal",
						)
				}
				if (
					existing &&
					(existing.subject !== action.subject ||
						existing.undoOf !== action.undoOf)
				)
					return yield* conflict("Undo receipt differs from its proposal")
				undoEntries.set(action.id, {
					id: action.id,
					undoable: undoableDocumentAction(action),
					textTarget: undoTextTarget(action),
					subject: action.subject,
					undoOf: action.undoOf,
					order: existing?.order ?? ++undoOrder,
					local: existing?.local ?? false,
					birth:
						existing?.birth ??
						action.before.some(
							field =>
								field.target === options.document &&
								field.field === "type" &&
								!field.value,
						),
				})
				undoReceipts.set(action.id, { entry, index, position })
			})
		}
		function receiptAction(receipt: UndoReceipt, id: string) {
			return Effect.gen(function* () {
				let value = yield* Cache.get(knownProposals, receipt.entry)
				let action =
					value.kind === "received"
						? value.actions[receipt.index]?.action
						: value.kind === "published" && receipt.index === 0
							? value.publication.initial.action
							: undefined
				if (!action || action.id !== id || action.document !== options.document)
					return yield* conflict("Undo receipt has no matching action")
				return action
			})
		}
		function undoBasis(id: string) {
			return Effect.gen(function* () {
				let receipt = undoReceipts.get(id)
				if (receipt) return yield* receiptAction(receipt, id)
				let original = pending.get(id)
				if (!original)
					return yield* Effect.fail(
						new UndoUnavailable({
							reason: "BelowFloor",
							message: "This action has no retained undo provenance",
						}),
					)
				let before = new Replica("undo-basis")
				yield* Effect.try({
					try: () => before.restore(accepted.checkpoint()),
					catch: cause => storageFailure("restore undo basis", cause),
				})
				for (let action of pending.values()) {
					if (action.id === id)
						return yield* prepareAction(before, action, options.subject)
					let operations = yield* validateAction(before, action)
					yield* validateTextCausality(before, options.document, operations)
					yield* applyChanges([before], operations)
				}
				return yield* conflict("Undo basis lost its pending action")
			})
		}

		function checkCompensationSuccessor(action: DocumentAction) {
			return Effect.gen(function* () {
				if (!action.undoOf) return
				yield* indexUndoHistory()
				if (
					[...undoEntries.values()].some(
						entry =>
							entry.undoOf === action.undoOf &&
							!rejected.has(entry.id) &&
							(pending.has(entry.id) || undoReceipts.has(entry.id)),
					)
				)
					return yield* Effect.fail(
						new UndoUnavailable({
							reason: "Superseded",
							message: "Another tab already compensated this action",
						}),
					)
			})
		}
		function check(value: Recording) {
			return Effect.gen(function* () {
				if (value.kind === "localCreated") {
					let action = value.creation.action
					if (hasBlobReferences(action))
						return yield* conflict(
							"Attachments must be added after document creation",
						)
					if (
						value.creation.subject !== options.subject ||
						action.document !== options.document ||
						!action.actor.startsWith(options.subject + "-")
					)
						return yield* conflict(
							"Creation belongs to another document or account",
						)
					let previous = proposals.get(action.id)
					if (previous) {
						let known = yield* Cache.get(knownProposals, previous.entry)
						if (
							known.kind === "localCreated" &&
							known.creation.workspace === value.creation.workspace &&
							equalAction(known.creation.action, action)
						)
							return
						return yield* conflict(
							"Creation identity reused with different content",
						)
					}
					if (log || creation || proposals.size)
						return yield* conflict("This document is already initialized")
					let operations = yield* validateAction(new Replica("empty"), action)
					let initialized = new Replica("creation")
					yield* applyChanges([initialized], operations)
					if (
						initialized.fields(options.document).type !== "document" ||
						initialized.fields(options.document).metadata !== "frontmatter-v1"
					)
						return yield* conflict(
							"Creation must include the document root and source metadata",
						)
					return
				}
				if (value.kind === "published") {
					let publication = value.publication
					let initial = publication.initial.action
					let proposal = proposals.get(initial.id)
					if (!proposal)
						return yield* conflict("Publication has no local creation receipt")
					let recorded = yield* Cache.get(knownProposals, proposal.entry)
					if (
						recorded.kind !== "localCreated" ||
						initial.subject !== options.subject ||
						!equalAction(recorded.creation.action, {
							...initial,
							guards: recorded.creation.action.guards,
							accessGuards: recorded.creation.action.accessGuards,
						})
					)
						return yield* conflict(
							"Publication differs from the saved creation",
						)
					if (log && log !== publication.log) return yield* epochConflict()
					if (!creation && publication.initial.position > remotePosition)
						return yield* conflict(
							"Publication skips the accepted creation position",
						)
					return
				}
				if (value.kind === "opened") {
					if (value.snapshot.document !== options.document)
						return yield* conflict("Snapshot belongs to another document")
					if (!log && !creation) yield* restoreSnapshot(value.snapshot, actor)
					return
				}
				if (!log && !creation)
					return yield* conflict("Initialize a document before editing")
				if (value.kind === "withdrawn") {
					let proposal = proposals.get(value.action)
					if (!proposal || proposal.entry !== value.entry)
						return yield* conflict("Withdrawal has no matching proposal")
					if (proposal.settled || !rejected.has(value.action))
						return yield* conflict("Only a rejected proposal can be withdrawn")
					for (let [id, earlier] of proposals) {
						if (id === value.action) break
						if (!earlier.settled && !rejected.get(id)?.withdrawn)
							return yield* conflict("Withdrawal skips an earlier proposal")
					}
					return
				}
				if (value.kind === "rejected") {
					let proposal = proposals.get(value.action)
					if (!proposal || proposal.entry !== value.entry)
						return yield* conflict("Rejection has no matching proposal")
					if (proposal.settled || rejected.has(value.action)) return
					let root = pending.get(value.action)
					if (!root || !canReject(root, value.failure))
						return yield* conflict(
							"This proposal cannot be automatically rejected",
						)
					let partition = yield* partitionDocumentActions(
						accepted,
						[...pending.values()],
						[root.id],
					)
					if (
						JSON.stringify(value.closure) !==
						JSON.stringify(partition.blocked.map(action => action.id))
					)
						return yield* conflict(
							"Rejection raced another proposal; synchronize again",
						)
					if (partition.blocked.some(hasInsertedText))
						return yield* conflict(
							"Rejected actions with inserted text require explicit draft recovery",
						)
					for (let action of partition.blocked)
						if (!proposals.has(action.id))
							return yield* conflict("Rejected dependent has no proposal")
					yield* rebuild(partition.ready)
					return
				}
				if (value.kind === "proposed") {
					if (
						value.action.document !== options.document ||
						!value.action.actor.startsWith(options.subject + "-")
					)
						return yield* conflict(
							"Proposal belongs to another document or account",
						)
					let previous = proposals.get(value.action.id)
					if (previous) {
						let known = yield* Cache.get(knownProposals, previous.entry)
						if (
							known.kind !== "proposed" ||
							!equalAction(known.action, value.action)
						)
							return yield* conflict(
								"Proposal identity reused with different content",
							)
						if (rejected.has(value.action.id)) return
					} else {
						for (let guard of value.action.accessGuards)
							if (
								guard.observed !==
								(durable.register(options.document, guard.field)?.id ?? "")
							)
								return yield* Effect.fail(
									new AccessConflict({
										message:
											"Document permissions changed; create a new action from current state",
									}),
								)
					}
					let operations = yield* validateAction(durable, value.action)
					yield* validateTextCausality(durable, options.document, operations)
					yield* validateChanges([durable, replica], operations)
					return
				}
				if (value.log !== log) return yield* epochConflict()
				if (value.after > remotePosition)
					return yield* conflict(
						"Received history skips the current document position",
					)
				let previous = value.after
				let ownership = new Map<string, Operation>()
				let atoms = new Map<string, string>()
				let contributions = new Map<string, string>()
				let incoming: Operation[] = []
				let view = {
					register(target: string, field: string) {
						return field === "document"
							? (ownership.get(target) ?? accepted.register(target, field))
							: accepted.register(target, field)
					},
					textOperationTarget(id: string) {
						return contributions.get(id) ?? accepted.textOperationTarget(id)
					},
					atomTarget(id: string) {
						return atoms.get(id) ?? accepted.atomTarget(id)
					},
				}
				for (let { position, action } of value.actions) {
					if (position <= previous || action.document !== options.document)
						return yield* conflict(
							"Received history is unordered or belongs to another document",
						)
					previous = position
					if (position <= remotePosition) continue
					let operations = yield* validateAction(view, action)
					yield* validateTextCausality(view, options.document, operations)
					incoming.push(...operations)
					for (let operation of operations) {
						if (
							operation.kind !== "set" &&
							(operation.kind === "cancel" ||
								operation.insert.length ||
								operation.remove.length)
						)
							contributions.set(operation.id, operation.target)
						if (operation.kind === "text")
							for (let atom of operation.insert)
								atoms.set(atom.id, operation.target)
						if (operation.kind !== "set" || operation.field !== "document")
							continue
						let observed = view.register(operation.target, "document")
						if (!observed || operation.id > observed.id)
							ownership.set(operation.target, operation)
					}
					if (rejected.get(action.id)?.withdrawn)
						return yield* conflict(
							"A withdrawn proposal appears in accepted history",
						)
					let proposed =
						pending.get(action.id) ?? rejected.get(action.id)?.action
					if (
						proposed &&
						!equalAction(proposed, {
							...action,
							guards: proposed.guards,
							accessGuards: proposed.accessGuards,
						})
					)
						return yield* conflict(
							"Accepted action differs from the saved proposal",
						)
				}
				yield* validateChanges([accepted, durable, replica], incoming)
			})
		}
		function rebuild(healthy: readonly DocumentAction[]) {
			return Effect.gen(function* () {
				let nextDurable = new Replica("local-document", options.author)
				nextDurable.restore(accepted.checkpoint())
				for (let action of healthy) {
					let operations = yield* validateAction(nextDurable, action)
					yield* validateTextCausality(
						nextDurable,
						options.document,
						operations,
					)
					yield* applyChanges([nextDurable], operations)
				}
				while (true) {
					let captured = draftVersion
					let nextReplica = new Replica(actor, options.author)
					let queued = [...drafts.values()].filter(
						action => !proposals.has(action.id),
					)
					nextReplica.restore(nextDurable.checkpoint())
					for (let action of queued) {
						let operations = yield* validateAction(nextReplica, action)
						yield* validateTextCausality(
							nextReplica,
							options.document,
							operations,
						)
						yield* applyChanges([nextReplica], operations)
					}
					if (captured === draftVersion)
						return {
							durable: nextDurable,
							replica: nextReplica,
							draftVersion: captured,
						}
				}
			})
		}
		function epochConflict() {
			return Effect.fail(
				new DocumentHistoryUnavailable({
					document: options.document,
					reason: "EpochChanged",
					position: remotePosition,
					message:
						"Document history changed; pending edits are preserved on this device",
				}),
			)
		}
	})
}
function documentView(current: () => Replica) {
	let protectedViews = new WeakSet<Atom[]>()
	return Object.freeze({
		get actor() {
			return current().actor
		},
		get clock() {
			return current().clock
		},
		get author() {
			return current().author
		},
		text: (target: string, until: number | string = Infinity) =>
			current().text(target, until),
		visible(target: string, until: number | string = Infinity) {
			let atoms = current().visible(target, until)
			if (!protectedViews.has(atoms)) {
				for (let atom of atoms) freezeAtom(atom)
				Object.freeze(atoms)
				protectedViews.add(atoms)
			}
			return atoms
		},
		records: (type: string) => current().records(type),
		register: (target: string, field: string) =>
			current().register(target, field),
		fields: (target: string, until = "") => ({
			...current().fields(target, until),
		}),
		metadata: (target: string) => structuredClone(current().metadata(target)),
		documents: (room: string, includeDeleted = false) =>
			structuredClone(current().documents(room, includeDeleted)),
		checkpoint: () => structuredClone(current().checkpoint()),
	})
}
function canReject(
	action: DocumentAction,
	failure: typeof rejectionFailure.Type,
) {
	return failure._tag === "UndoUnavailable"
		? !!action.undoOf &&
				action.changes.every(
					change => change.kind === "cancel" || change.kind === "set",
				)
		: action.accessGuards.length > 0 &&
				action.changes.every(
					change =>
						change.kind === "set" &&
						change.target === action.document &&
						change.field.startsWith("access:"),
				)
}
function hasInsertedText(action: DocumentAction) {
	return action.changes.some(
		change => change.kind === "text" && change.insert.length > 0,
	)
}
function freezeRejected(item: RejectedAction) {
	return Object.freeze({
		...item,
		action: freezeAction(item.action),
		failure: Object.freeze(item.failure),
	})
}
function freezeAtom(atom: Atom) {
	if (atom.order) Object.freeze(atom.order)
	if (atom.deleted) Object.freeze(atom.deleted)
	return Object.freeze(atom)
}
function freezeOperation(operation: Operation) {
	for (let atom of operation.insert) freezeAtom(atom)
	Object.freeze(operation.insert)
	Object.freeze(operation.remove)
	return Object.freeze(operation)
}
function freezeCreation(creation: LocalDocumentCreation) {
	return Object.freeze({ ...creation, action: freezeAction(creation.action) })
}
function freezeAction(action: DocumentAction) {
	for (let operation of action.changes) {
		for (let atom of operation.insert) freezeAtom(atom)
		for (let removed of operation.remove)
			if (typeof removed !== "string") Object.freeze(removed)
		Object.freeze(operation.insert)
		Object.freeze(operation.remove)
		Object.freeze(operation)
	}
	for (let guard of action.guards) Object.freeze(guard)
	for (let guard of action.accessGuards) Object.freeze(guard)
	Object.freeze(action.changes)
	Object.freeze(action.guards)
	Object.freeze(action.accessGuards)
	return Object.freeze(action)
}
function documentActor(
	cryptography: Crypto.Crypto,
	options: DocumentSessionOptions,
) {
	return Effect.gen(function* () {
		let nonce = yield* cryptography.randomBytes(32)
		return yield* Schema.decodeUnknownEffect(
			Schema.String.check(Schema.isPattern(/^[\w-]{1,100}$/)),
		)(options.subject + "-" + encode(nonce))
	})
}
export function documentDatabaseName(options: DocumentSessionOptions) {
	return (
		"alkalye-document-v1:" + JSON.stringify([options.subject, options.document])
	)
}
function decode(
	entry: EventJournal.Entry,
): Effect.Effect<Recording, DocumentFailure> {
	if (entry.event !== "DocumentRecorded")
		return conflict("Unknown document journal entry").pipe(
			Effect.mapError(error =>
				storageFailure("decode document journal", error),
			),
		)
	return Schema.decodeEffect(codec)(new Uint8Array(entry.payload)).pipe(
		Effect.mapError(error => storageFailure("decode document journal", error)),
	)
}
function conflict(message: string) {
	return Effect.fail(new DocumentConflict({ message }))
}

function validateChanges(replicas: Replica[], operations: Operation[]) {
	return Effect.try({
		try: () => {
			for (let replica of replicas) replica.validate(operations)
		},
		catch: cause =>
			new DocumentConflict({
				message:
					cause instanceof Error ? cause.message : "Invalid document changes",
			}),
	})
}
function applyChanges(replicas: Replica[], operations: Operation[]) {
	return Effect.try({
		try: () => {
			for (let replica of replicas) replica.validate(operations)
			for (let replica of replicas) replica.apply(operations)
		},
		catch: cause =>
			new DocumentConflict({
				message:
					cause instanceof Error ? cause.message : "Invalid document changes",
			}),
	})
}
