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
import {
	CausalDependencyMissing,
	DocumentConflict,
} from "../src/shared/document-errors"
import {
	CommittedActionSchema,
	buildAction,
} from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"
import { parseOperation } from "../src/shared/model"

export function verifyReceivedDocumentBatches(
	subject: string,
	check: (value: unknown, message: string) => void,
) {
	return Effect.gen(function* () {
		let remote = yield* makeDocumentTransport(location.origin, subject)
		let document = "received-batch-snapshot-proof"
		let source = "# Received batch"
		let action = yield* buildAction(
			new Replica(subject + "-batch-root"),
			document,
			"Create document",
			staged => newDocument(staged, document, "Untitled", source),
		)
		let publication = yield* remote.create({
			subject,
			workspace: "personal-" + subject,
			action,
		})
		let invalidHistory: PositionedAction[] | undefined
		let options: DocumentSessionOptions = {
			document,
			subject,
			transport: {
				...remote,
				history: (document, after, log, limit) =>
					Effect.suspend(() =>
						invalidHistory
							? Effect.succeed(invalidHistory)
							: remote.history(document, after, log, limit),
					),
			},
		}
		let database = "alkalye-document-v1:" + JSON.stringify([subject, document])
		let readCache = BrowserJournal.use(storage =>
			storage.cache.pipe(
				Effect.flatMap(cached => {
					if (!cached) return Effect.die("Missing received snapshot cache")
					return Schema.decodeUnknownEffect(
						Schema.Struct({
							format: Schema.Literal("document-local-state-v3"),
							remotePosition: Schema.Natural,
							checkpoint: Schema.Unknown,
						}),
					)(cached.value).pipe(
						Effect.map(state => ({ position: cached.position, state })),
					)
				}),
			),
		).pipe(Effect.provide(indexedDbJournalLayer(database)))
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let peer = new Replica(subject + "-batch-peer")
					peer.apply(action.changes.map(parseOperation))
					let first = yield* buildAction(
						peer,
						document,
						"First batch action",
						staged => [staged.edit(document, source + "\nFirst")],
					)
					yield* remote.commit(first)
					peer.apply(first.changes.map(parseOperation))
					let second = yield* buildAction(
						peer,
						document,
						"Dependent batch action",
						staged => [staged.edit(document, source + "\nFirst\nSecond")],
					)
					yield* remote.commit(second)
					yield* session.sync
					yield* session.save
					let cached = yield* readCache
					let accepted = new Replica("batch-snapshot-reader")
					accepted.restore(parseCheckpoint(cached.state.checkpoint))
					check(
						accepted.text(document) === source + "\nFirst\nSecond" &&
							cached.state.remotePosition === publication.initial.position + 2,
						"accepted history permits an anchor introduced by an earlier action in the same batch",
					)
					let valid = yield* buildAction(
						session.replica,
						document,
						"Valid prefix",
						staged => [staged.set(document, "mode", "slideshow")],
						subject + "-valid-batch-prefix",
					)
					let invalid = yield* buildAction(
						session.replica,
						document,
						"Invalid suffix",
						staged => [staged.edit(document, staged.text(document) + "!")],
						subject + "-invalid-batch-suffix",
					)
					invalidHistory = [
						{
							position: cached.state.remotePosition + 1,
							action: yield* Schema.decodeUnknownEffect(CommittedActionSchema)({
								...valid,
								subject,
								before: [],
							}),
						},
						{
							position: cached.state.remotePosition + 2,
							action: yield* Schema.decodeUnknownEffect(CommittedActionSchema)({
								...invalid,
								subject,
								before: [],
								changes: invalid.changes.map(change => ({
									...change,
									insert: change.insert.map(atom => ({
										...atom,
										after: "unaccepted-atom",
									})),
								})),
							}),
						},
					]
					let failed = yield* session.sync.pipe(Effect.result)
					yield* session.save
					let unchanged = yield* readCache
					check(
						failed._tag === "Failure" &&
							failed.failure instanceof CausalDependencyMissing &&
							unchanged.position === cached.position &&
							unchanged.state.remotePosition === cached.state.remotePosition &&
							session.replica.fields(document).mode !== "slideshow",
						"a bad suffix rejects the entire incoming batch before its valid prefix is journaled or projected",
					)
					let covered = first.changes.map(parseOperation)
					invalidHistory = [
						{
							position: cached.state.remotePosition + 1,
							action: yield* Schema.decodeUnknownEffect(CommittedActionSchema)({
								...valid,
								subject,
								before: [],
							}),
						},
						{
							position: cached.state.remotePosition + 2,
							action: yield* Schema.decodeUnknownEffect(CommittedActionSchema)({
								...first,
								subject,
								before: [],
								changes: covered.map(change => ({
									...change,
									insert: [
										...change.insert,
										{ id: `${change.id}:00000099`, after: "", value: "!" },
									],
								})),
							}),
						},
					]
					let identityFailure = yield* session.sync.pipe(Effect.result)
					yield* session.save
					let afterIdentityFailure = yield* readCache
					check(
						identityFailure._tag === "Failure" &&
							identityFailure.failure instanceof DocumentConflict &&
							identityFailure.failure.message.includes("immutable") &&
							afterIdentityFailure.position === cached.position &&
							afterIdentityFailure.state.remotePosition ===
								cached.state.remotePosition &&
							session.replica.text(document) === source + "\nFirst\nSecond" &&
							session.replica.fields(document).mode !== "slideshow",
						"a conflicting covered contribution rejects the entire received batch before persistence",
					)
					invalidHistory = undefined
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
	})
}
