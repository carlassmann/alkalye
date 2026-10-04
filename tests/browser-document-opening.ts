import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
	BrowserJournal,
	indexedDbJournalLayer,
} from "../src/platform/indexeddb-journal"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import { makeDocumentTransport } from "../src/client/document-transport"
import { Replica } from "../src/shared/crdt"
import { buildAction } from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"
import { parseOperation } from "../src/shared/model"

export function verifyDocumentOpeningRace(
	subject: string,
	check: (value: unknown, message: string) => void,
) {
	return Effect.gen(function* () {
		let remote = yield* makeDocumentTransport(location.origin, subject)
		let document = "snapshot-creation-race-proof"
		let requested = yield* Deferred.make<void>()
		let releaseSnapshot = yield* Deferred.make<void>()
		let snapshotRequests = 0
		let options = {
			document,
			subject,
			transport: {
				...remote,
				snapshot: () =>
					Effect.gen(function* () {
						snapshotRequests++
						yield* Deferred.succeed(requested, undefined)
						yield* Deferred.await(releaseSnapshot)
						return yield* remote.snapshot(document)
					}),
			},
		}
		let creation = {
			subject,
			workspace: "personal-" + subject,
			action: yield* buildAction(
				new Replica(subject + "-opening-race-root"),
				document,
				"Create document",
				staged => newDocument(staged, document, "Untitled", "# Local creation"),
			),
		}
		let source =
			"# Local creation\n\nAccepted by a peer before the late snapshot"
		yield* Effect.scoped(
			Effect.gen(function* () {
				let opening = yield* Layer.build(
					browserDocumentSessionLayer(options),
				).pipe(Effect.forkScoped)
				yield* Deferred.await(requested)
				let local = Context.get(
					yield* Layer.build(
						browserDocumentSessionLayer({
							...options,
							initialCreation: creation,
						}),
					),
					DocumentSession,
				)
				yield* local.save
				yield* remote.create(creation)
				let peer = new Replica(subject + "-opening-race-peer")
				peer.apply(creation.action.changes.map(parseOperation))
				yield* remote.commit(
					yield* buildAction(
						peer,
						document,
						"Peer edit before publication receipt",
						staged => [staged.edit(document, source)],
					),
				)
				yield* Deferred.succeed(releaseSnapshot, undefined)
				let late = Context.get(yield* Fiber.join(opening), DocumentSession)
				yield* late.save
				let cached = yield* BrowserJournal.use(storage => storage.cache).pipe(
					Effect.provide(
						indexedDbJournalLayer(
							"alkalye-document-v1:" + JSON.stringify([subject, document]),
						),
					),
				)
				if (!cached) return yield* Effect.die("Missing raced opening cache")
				let state = yield* Schema.decodeUnknownEffect(
					Schema.Struct({
						log: Schema.String,
						remotePosition: Schema.Natural,
						creation: Schema.Unknown,
					}),
				)(cached.value)
				check(
					state.log === "" &&
						state.remotePosition === 0 &&
						late.replica.text(document) === "# Local creation" &&
						late.pending()[0]?.id === creation.action.id,
					"a late initial snapshot cannot overwrite a concurrently recorded offline creation",
				)
				yield* late.sync
				yield* late.save
				check(
					late.replica.text(document) === source && late.pending().length === 0,
					"the retained creation publishes its exact identity and then merges newer accepted source",
				)
			}),
		)
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.sync(() =>
					check(
						session.replica.text(document) === source &&
							snapshotRequests === 1 &&
							session.pending().length === 0,
						"the creation-snapshot race leaves a valid local checkpoint that reopens without another snapshot",
					),
				),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
	})
}
