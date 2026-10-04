import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Deferred from "effect/Deferred"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Fiber from "effect/Fiber"
import {
	BrowserJournal,
	indexedDbJournalLayer,
} from "../src/platform/indexeddb-journal"
import { parseCheckpoint } from "../src/shared/checkpoint"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import { makeDocumentTransport } from "../src/client/document-transport"
import { Replica } from "../src/shared/crdt"
import {
	buildAction,
	DocumentConflict,
	restoreSnapshot,
} from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"

type Check = (value: unknown, message: string) => void

export function verifyLocalDocumentCreation(subject: string, check: Check) {
	return Effect.gen(function* () {
		let remote = yield* makeDocumentTransport(location.origin, subject)
		let document = "local-creation-proof"
		let action = yield* buildAction(
			new Replica(subject + "-local-creation"),
			document,
			"Create document",
			staged => newDocument(staged, document, "Untitled", "# Created locally"),
		)
		let initialCreation = { subject, workspace: "personal-" + subject, action }
		let snapshotRequests = 0
		let attempts = 0
		let transport = {
			...remote,
			snapshot: () =>
				Effect.sync(() => snapshotRequests++).pipe(
					Effect.andThen(Effect.fail(new Error("Opening must stay local"))),
				),
			create: () =>
				remote.create(initialCreation).pipe(
					Effect.flatMap(publication => {
						attempts++
						if (attempts === 1)
							return Effect.fail(
								new Error("Creation response lost after server commit"),
							)
						if (attempts === 2)
							return Effect.succeed({
								...publication,
								initial: {
									...publication.initial,
									action: {
										...publication.initial.action,
										subject: "wrong-subject",
									},
								},
							})
						return Effect.succeed(publication)
					}),
				),
		}
		let source = "# Created locally\n\nEdited before any connection."
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					check(
						session.replica.text(document) === "# Created locally" &&
							snapshotRequests === 0,
						"a local creation opens its complete root without inventing a remote snapshot",
					)
					yield* session.edit(source).saved
					yield* session.save
					check(
						session.pending().length === 2,
						"local creation and subsequent editing share one durable document journal",
					)
				}),
			).pipe(
				Effect.provide(
					browserDocumentSessionLayer({
						document,
						subject,
						initialCreation,
						transport,
					}),
				),
			),
		)
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					check(
						session.replica.text(document) === source && snapshotRequests === 0,
						"cached reopening remembers publication data without depending on the creation locator",
					)
					let lost = yield* session.sync.pipe(Effect.result)
					check(
						lost._tag === "Failure" &&
							session.pending().length === 2 &&
							session.replica.text(document) === source,
						"a lost creation response preserves the exact creation and later source proposal",
					)
					let malformed = yield* session.sync.pipe(Effect.result)
					check(
						malformed._tag === "Failure" &&
							malformed.failure instanceof DocumentConflict &&
							session.pending().length === 2,
						"publication cannot settle a creation receipt attributed to another subject",
					)
					yield* session.sync
					check(
						session.pending().length === 0 && attempts === 3,
						"retry publication settles only the matching creation and then accepts its later local edits",
					)
					let snapshot = yield* remote.snapshot(document)
					let replica = yield* restoreSnapshot(snapshot, "verified-reader")
					let history = yield* remote.history(document, 0, snapshot.log, 100)
					check(
						replica.text(document) === source &&
							history.filter(fact => fact.action.id === action.id).length === 1,
						"the server retains one creation after lost and invalid publication receipts",
					)
				}),
			).pipe(
				Effect.provide(
					browserDocumentSessionLayer({ document, subject, transport }),
				),
			),
		)
		let concurrent = "concurrent-local-creation"
		let shared = {
			...initialCreation,
			action: yield* buildAction(
				new Replica(subject + "-shared-creation"),
				concurrent,
				"Create document",
				staged =>
					newDocument(staged, concurrent, "Untitled", "# Two publishers"),
			),
		}
		yield* Effect.scoped(
			Effect.gen(function* () {
				let publishers = yield* Ref.make(0)
				let ready = yield* Deferred.make<void>()
				let rightResponse = yield* Deferred.make<void>()
				let releaseRight = yield* Deferred.make<void>()
				let rightCursors: number[] = []
				let options = {
					document: concurrent,
					subject,
					initialCreation: shared,
					transport: {
						...remote,
						create: () =>
							Effect.gen(function* () {
								if (
									(yield* Ref.updateAndGet(publishers, count => count + 1)) ===
									2
								)
									yield* Deferred.succeed(ready, undefined)
								yield* Deferred.await(ready)
								return yield* remote.create(shared)
							}),
					},
				}
				let [left, right] = yield* Effect.all(
					[
						Layer.build(browserDocumentSessionLayer(options)),
						Layer.build(
							browserDocumentSessionLayer({
								...options,
								transport: {
									...options.transport,
									create: () =>
										options.transport.create().pipe(
											Effect.tap(() =>
												Deferred.succeed(rightResponse, undefined),
											),
											Effect.tap(() => Deferred.await(releaseRight)),
										),
									history: (document, after, log, limit) =>
										Effect.sync(() => rightCursors.push(after)).pipe(
											Effect.andThen(
												remote.history(document, after, log, limit),
											),
										),
								},
							}),
						),
					],
					{ concurrency: 2 },
				)
				let leftSession = Context.get(left, DocumentSession)
				let rightSession = Context.get(right, DocumentSession)
				let rightSync = yield* rightSession.sync.pipe(Effect.forkScoped)
				yield* leftSession.sync
				yield* Deferred.await(rightResponse)
				yield* leftSession.edit(
					"# Two publishers\n\nAccepted before the late response",
				).saved
				yield* leftSession.sync
				yield* rightSession.replay
				let beforeResponse = yield* remote.snapshot(concurrent)
				yield* Deferred.succeed(releaseRight, undefined)
				yield* Fiber.join(rightSync)
				let snapshot = yield* remote.snapshot(concurrent)
				let history = yield* remote.history(concurrent, 0, snapshot.log, 100)
				check(
					leftSession.pending().length === 0 &&
						rightSession.pending().length === 0 &&
						history.filter(fact => fact.action.id === shared.action.id)
							.length === 1,
					"independent sessions initialize and publish one identical creation without resetting accepted state",
				)
				yield* leftSession.replay
				yield* leftSession.save
				let cached = yield* BrowserJournal.use(storage => storage.cache).pipe(
					Effect.provide(
						indexedDbJournalLayer(
							"alkalye-document-v1:" + JSON.stringify([subject, concurrent]),
						),
					),
				)
				if (!cached)
					return yield* Effect.die("Missing concurrent publication snapshot")
				let state = yield* Schema.decodeUnknownEffect(
					Schema.Struct({
						format: Schema.Literal("document-local-state-v3"),
						checkpoint: Schema.Unknown,
						remotePosition: Schema.Natural,
					}),
				)(cached.value)
				let accepted = new Replica("accepted-publication-reader")
				accepted.restore(parseCheckpoint(state.checkpoint))
				let server = yield* restoreSnapshot(
					snapshot,
					"server-publication-reader",
				)
				check(
					Ref.getUnsafe(publishers) === 2 &&
						accepted.revision(concurrent) === server.revision(concurrent) &&
						state.remotePosition === beforeResponse.position &&
						rightCursors.length > 0 &&
						rightCursors.every(position => position >= beforeResponse.position),
					"a delayed duplicate publication cannot rewind an accepted cursor or replay already accepted history",
				)
			}),
		)
	})
}
