import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import { makeDocumentTransport } from "../src/client/document-transport"
import {
	buildAction,
	restoreSnapshot,
	undoAction,
} from "../src/shared/document-actions"
import { Replica } from "../src/shared/crdt"
import { newComment, newDocument, setFields } from "../src/shared/documents"

type Check = (value: unknown, message: string) => void

export function verifyReceivedDocumentCompensations(
	subject: string,
	check: Check,
) {
	return Effect.gen(function* () {
		let document = "browser-causal-compensation"
		let remote = yield* makeDocumentTransport(location.origin, subject)
		yield* remote.create({
			subject,
			workspace: "personal-" + subject,
			action: yield* buildAction(
				new Replica(subject + "-undo-birth"),
				document,
				"Create",
				staged => newDocument(staged, document, "Untitled", "ab"),
			),
		})
		let historicalRequests = 0,
			snapshotRequests = 0,
			online = true
		let options = {
			document,
			subject,
			transport: {
				...remote,
				snapshot: (document: string) =>
					Effect.suspend(() => {
						snapshotRequests++
						return online
							? remote.snapshot(document)
							: Effect.die("Offline opening requested a snapshot")
					}),
				history: (
					document: string,
					after: number,
					log: string,
					limit: number,
				) =>
					Effect.suspend(() => {
						if (!after) historicalRequests++
						return online
							? remote.history(document, after, log, limit)
							: Effect.die("Offline opening requested history")
					}),
			},
		}
		let redo = yield* Effect.scoped(
			Effect.gen(function* () {
				let session = Context.get(
					yield* Layer.build(browserDocumentSessionLayer(options)),
					DocumentSession,
				)
				let composed = yield* session.change("Attach and discuss", staged => [
					...newComment(
						staged,
						"causal-undo-comment",
						document,
						"ab",
						"Note",
						"Owner",
					),
					...setFields(staged, "causal-undo-photo", {
						type: "asset",
						document,
						name: "Photo.png",
						blob: "immutable-reference",
					}),
					staged.edit(document, "aXYZb\n![Photo](asset:causal-undo-photo)"),
				])
				yield* session.sync
				check(
					!session.pending().length &&
						session.replica.fields("causal-undo-comment").body === "Note",
					"native browser accepts the original whole-document action",
				)
				let peer = yield* buildAction(
					yield* restoreSnapshot(
						yield* remote.snapshot(document),
						subject + "-undo-peer",
					),
					document,
					"Peer deletion",
					staged => [
						staged.edit(document, "aXZb\n![Photo](asset:causal-undo-photo)"),
					],
				)
				yield* remote.commit(peer)
				yield* session.sync
				let original = yield* remote.action(document, composed.id)
				let first = yield* remote.chain(document, composed.id)
				check(
					first.latest === composed.id && first.depth === 0,
					"browser discovers an uncompensated action through metadata only",
				)
				let cold = yield* restoreSnapshot(
					yield* remote.snapshot(document),
					subject + "-undo-action",
				)
				let undo = yield* undoAction(cold, original)
				check(
					undo.undoOf === original.id &&
						undo.changes.some(change => change.kind === "cancel"),
					"snapshot and one indexed action derive a mixed causal compensation",
				)
				yield* remote.commit(undo)
				yield* session.sync
				check(
					session.replica.text(document) === "ab" &&
						session.replica.fields("causal-undo-photo").type === "deleted" &&
						session.replica.fields("causal-undo-comment").type === "deleted",
					"browser session journals accepted text and record compensation as one action",
				)
				let undone = yield* remote.action(document, undo.id)
				let redo = yield* undoAction(
					yield* restoreSnapshot(
						yield* remote.snapshot(document),
						subject + "-redo-action",
					),
					undone,
				)
				yield* remote.commit(redo)
				yield* session.sync
				let latest = yield* remote.chain(document, composed.id)
				check(
					latest.latest === redo.id &&
						latest.depth === 2 &&
						latest.log === first.log,
					"browser resolves the current undo/redo tip without downloading earlier actions",
				)
				check(
					session.replica.text(document) ===
						"aXZb\n![Photo](asset:causal-undo-photo)" &&
						session.replica.fields("causal-undo-comment").body === "Note" &&
						session.replica.fields("causal-undo-photo").name === "Photo.png",
					"browser redo retains peer deletion while restoring comments and manifests",
				)
				yield* session.save
				return yield* remote.action(document, redo.id)
			}),
		)
		let downloads = snapshotRequests
		online = false
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					check(
						snapshotRequests === downloads &&
							!historicalRequests &&
							session.replica.text(document) ===
								"aXZb\n![Photo](asset:causal-undo-photo)" &&
							!session.pending().length,
						"offline reopening restores whole-document undo and redo without snapshots or historical downloads",
					)
					let current = new Replica(subject + "-offline-undo")
					current.restore(session.replica.checkpoint())
					let compensation = yield* undoAction(current, redo)
					check(
						compensation.changes.some(change => change.kind === "cancel") &&
							compensation.changes.some(
								change =>
									change.target === "causal-undo-photo" &&
									change.value === "deleted",
							),
						"cold browser checkpoint retains enough provenance for the next complete compensation",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		online = true
		yield* Effect.scoped(
			Effect.gen(function* () {
				let session = Context.get(
					yield* Layer.build(browserDocumentSessionLayer(options)),
					DocumentSession,
				)
				let deletion = yield* session.change("Delete records", staged => [
					staged.set("causal-undo-comment", "type", "deleted"),
					staged.set("causal-undo-photo", "type", "deleted"),
					staged.edit(document, "aXZb"),
				])
				yield* session.sync
				let fact = yield* remote.action(document, deletion.id)
				let restore = yield* undoAction(
					yield* restoreSnapshot(
						yield* remote.snapshot(document),
						subject + "-restore-records",
					),
					fact,
				)
				yield* remote.commit(restore)
				yield* session.sync
				let restored = yield* remote.action(document, restore.id)
				check(
					restored.retained?.some(
						field =>
							field.target === "causal-undo-comment" && field.field === "body",
					) &&
						restored.retained.some(
							field =>
								field.target === "causal-undo-photo" && field.field === "name",
						),
					"single-action HTTP carries server-recorded inherited register identities for deletion redo",
				)
				check(
					session.replica.fields("causal-undo-comment").type === "comment" &&
						session.replica.fields("causal-undo-photo").type === "asset",
					"browser receipt replay restores deleted records without changing inherited fields",
				)
				let repeatDeletion = yield* undoAction(
					yield* restoreSnapshot(
						yield* remote.snapshot(document),
						subject + "-repeat-deletion",
					),
					restored,
				)
				yield* remote.commit(repeatDeletion)
				yield* session.sync
				check(
					session.replica.fields("causal-undo-comment").type === "deleted" &&
						session.replica.fields("causal-undo-photo").type === "deleted" &&
						session.replica.text(document) === "aXZb",
					"native browser redo of mixed record deletion removes links and records together",
				)
			}),
		)
	})
}
