import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
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
import { newDocument, setFields } from "../src/shared/documents"

import { verifyUndoRaces } from "./browser-document-undo-races"
import { verifyUndoDurability } from "./browser-document-undo-durability"

type Check = (value: unknown, message: string) => void

export function verifyDocumentUndo(subject: string, check: Check) {
	return Effect.gen(function* () {
		let remote = yield* makeDocumentTransport(location.origin, subject)
		for (let document of [
			"native-undo",
			"native-undo-peer",
			"native-undo-pages",
			"native-undo-durability",
			"native-undo-tabs",
			"native-undo-input",
			"native-undo-exhausted",
			"native-undo-floor",
		])
			yield* remote.create({
				subject,
				workspace: "personal-" + subject,
				action: yield* buildAction(
					new Replica(subject + "-" + document + "-birth"),
					document,
					"Create",
					staged => newDocument(staged, document, "Untitled", "AB"),
				),
			})
		let online = true
		let requests = 0
		function request<A, E>(
			work: Effect.Effect<A, E>,
		): Effect.Effect<A, E | Error> {
			return Effect.suspend((): Effect.Effect<A, E | Error> => {
				requests++
				return online ? work : Effect.fail(new Error("Offline"))
			})
		}
		let transport = {
			snapshot: (document: string) => request(remote.snapshot(document)),
			history: (document: string, after: number, log: string, limit: number) =>
				request(remote.history(document, after, log, limit)),
			commit: (action: Parameters<typeof remote.commit>[0]) =>
				request(remote.commit(action)),
			withdraw: (action: Parameters<typeof remote.withdraw>[0]) =>
				request(remote.withdraw(action)),
			action: (document: string, id: string) =>
				request(remote.action(document, id)),
		}
		let options = { document: "native-undo", subject, transport }
		let first = yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					online = false
					requests = 0
					let discussion = yield* session.change("Discuss", staged => [
						...setFields(staged, "undo-comment", {
							document: options.document,
							type: "comment",
							body: "Note",
						}),
						staged.edit(options.document, "AXB"),
					])
					let attachment = yield* session.change(
						"Attach and present",
						staged => [
							...setFields(staged, "undo-photo", {
								document: options.document,
								type: "asset",
								name: "Photo",
								blob: "reference",
							}),
							staged.set(options.document, "mode", "slideshow"),
							staged.edit(options.document, "AXB\n![Photo](asset:undo-photo)"),
						],
					)
					let undoB = yield* session.undo()
					check(
						undoB.undoOf === attachment.id &&
							session.replica.text(options.document) === "AXB" &&
							session.replica.fields("undo-photo").type === "deleted" &&
							session.replica.fields("undo-comment").body === "Note",
						"offline undo compensates one mixed source, asset and settings action atomically",
					)
					let undoA = yield* session.undo()
					check(
						undoA.undoOf === discussion.id &&
							session.replica.text(options.document) === "AB" &&
							session.replica.fields("undo-comment").type === "deleted",
						"offline whole-document undo naturally includes discussion records",
					)
					let redoA = yield* session.redo()
					check(
						redoA.undoOf === undoA.id &&
							session.replica.text(options.document) === "AXB" &&
							session.replica.fields("undo-comment").body === "Note" &&
							requests === 0,
						"offline redo derives a pending compensation without treating it as a server fact",
					)
					yield* session.save
					return { discussion, attachment, undoB, undoA, redoA }
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					check(
						requests === 0 && session.replica.text(options.document) === "AXB",
						"a cold offline opening restores its document without fetching undo history",
					)
					let redoB = yield* session.redo()
					check(
						redoB.undoOf === first.undoB.id &&
							requests === 0 &&
							session.replica.text(options.document) ===
								"AXB\n![Photo](asset:undo-photo)" &&
							session.replica.fields("undo-photo").name === "Photo" &&
							session.replica.fields(options.document).mode === "slideshow",
						"cold offline redo reconstructs the same branch and complete asset state from its journal",
					)
					let undoB = yield* session.undo()
					check(
						undoB.undoOf === redoB.id,
						"undo follows the current compensation tip after a cold redo",
					)
					let branch = yield* session.change("New branch", staged => [
						staged.set(options.document, "note", "Keep"),
					])
					let pending = JSON.stringify(session.pending())
					let exhausted = yield* session.redo().pipe(Effect.result)
					check(
						exhausted._tag === "Failure" &&
							isUnavailable(exhausted.failure, "Exhausted") &&
							JSON.stringify(session.pending()) === pending,
						"a new normal action invalidates redo without changing or erasing pending history",
					)
					online = true
					yield* session.sync
					let history = yield* remote.history(
						options.document,
						0,
						(yield* remote.snapshot(options.document)).log,
						100,
					)
					check(
						!session.pending().length &&
							!session.rejected().length &&
							history
								.map(item => item.action.id)
								.slice(1)
								.join() ===
								[
									first.discussion.id,
									first.attachment.id,
									first.undoB.id,
									first.undoA.id,
									first.redoA.id,
									redoB.id,
									undoB.id,
									branch.id,
								].join(),
						"the native server verifies and accepts the exact offline undo/redo chain in original order",
					)
					let undoBranch = yield* session.undo()
					yield* session.sync
					check(
						undoBranch.undoOf === branch.id &&
							session.replica.fields(options.document).note === "" &&
							session.replica.text(options.document) === "AXB",
						"accepted whole-document undo uses its canonical journal receipt",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		let peerOptions = {
			document: "native-undo-peer",
			subject,
			transport: remote,
		}
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let original = yield* session.change("Source and mode", staged => [
						staged.edit(peerOptions.document, "AXB"),
						staged.set(peerOptions.document, "mode", "slideshow"),
					])
					yield* session.sync
					let stale = yield* session.undo()
					yield* remote.commit(
						yield* buildAction(
							yield* restoreSnapshot(
								yield* remote.snapshot(peerOptions.document),
								subject + "-native-undo-peer-device",
							),
							peerOptions.document,
							"Peer mode",
							staged => [
								staged.set(peerOptions.document, "mode", "teleprompter"),
							],
						),
					)
					yield* session.sync
					check(
						session.rejected()[0]?.action.id === stale.id &&
							session.replica.text(peerOptions.document) === "AXB",
						"a stale selected undo is quarantined while its original action remains undoable",
					)
					let fresh = yield* session.undo()
					yield* session.sync
					check(
						fresh.undoOf === original.id &&
							fresh.id !== stale.id &&
							session.replica.text(peerOptions.document) === "AB" &&
							session.replica.fields(peerOptions.document).mode ===
								"teleprompter" &&
							!session.pending().length,
						"a new undo after rejection derives from canonical provenance and preserves peer registers",
					)
					let redo = yield* session.redo()
					yield* session.sync
					let peerReplica = yield* restoreSnapshot(
						yield* remote.snapshot(peerOptions.document),
						subject + "-native-undo-peer-compensator",
					)
					yield* remote.commit(
						yield* undoAction(
							peerReplica,
							yield* remote.action(peerOptions.document, redo.id),
						),
					)
					yield* session.sync
					let pending = JSON.stringify(session.pending())
					let nothing = yield* session.undo().pipe(Effect.result)
					check(
						nothing._tag === "Failure" &&
							isUnavailable(nothing.failure, "Exhausted") &&
							JSON.stringify(session.pending()) === pending,
						"a peer compensation extends the indexed chain before another undo is proposed",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(peerOptions))),
		)
		online = true
		yield* verifyUndoDurability(
			{ document: "native-undo-durability", subject, transport },
			check,
		)
		yield* verifyUndoRaces(subject, remote, check)
		let pages = { document: "native-undo-pages", subject, transport }
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					online = false
					for (let index = 1; index <= 205; index++)
						yield* session.change("Settings " + index, staged => [
							staged.set(pages.document, "note", String(index)),
						])
					yield* session.save
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(pages))),
		)
		let getAll = IDBObjectStore.prototype.getAll
		let pageSizes: (number | undefined)[] = []
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				IDBObjectStore.prototype.getAll = getAll
			}),
		)
		IDBObjectStore.prototype.getAll = function (query, count) {
			if (
				this.name === "positions" &&
				this.transaction.db.name === database(pages)
			)
				pageSizes.push(count)
			return getAll.call(this, query, count)
		}
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					pageSizes = []
					requests = 0
					yield* session.undo()
					check(
						session.replica.fields(pages.document).note === "204" &&
							requests === 0 &&
							pageSizes.filter(size => size === 100).length === 3,
						"cold undo indexes a long local journal in bounded pages without a remote history download",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(pages))),
		)
		IDBObjectStore.prototype.getAll = getAll
	})
}
function isUnavailable(value: unknown, reason: string) {
	return Schema.is(
		Schema.Struct({
			_tag: Schema.Literal("UndoUnavailable"),
			reason: Schema.Literal(reason),
		}),
	)(value)
}
function database(options: { subject: string; document: string }) {
	return (
		"alkalye-document-v1:" + JSON.stringify([options.subject, options.document])
	)
}
