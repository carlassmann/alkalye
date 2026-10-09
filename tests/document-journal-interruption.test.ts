import { workspaceStoreLayer } from "../src/server/bun-databases"
import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Fiber from "effect/Fiber"
import * as Exit from "effect/Exit"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as EventJournal from "effect/eventlog/EventJournal"
import { DocumentJournal } from "../src/platform/document-journal"
import type { DocumentSessionOptions } from "../src/shared/document-session"
import {
	cliDocumentSessionLayer,
	cliDocumentPlatform,
} from "../src/cli/document-platform"
import {
	DocumentSession,
	documentDatabaseName,
} from "../src/shared/document-session"
import type { DocumentTransport } from "../src/shared/document-session"
import { WorkspaceStore } from "../src/server/document-store"
import { Identity, personalWorkspaceRequest } from "../src/shared/workspace"
import { Replica } from "../src/shared/crdt"
import {
	buildAction,
	ResourceUnavailable,
	restoreSnapshot,
} from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"

test.each(["before", "after"])(
	"interruption at the journal commit boundary retains exactly the durable contribution (%j)",
	async phase => {
		let directory = await mkdtemp(
			join(tmpdir(), "alkalye-journal-interruption-"),
		)
		let source =
			'---\ntitle: "Replacement"\n---\n' +
			"Body 😀\n".repeat(4) +
			"TOKEN suffix 😀\n"
		let offsets: number[] = []
		for (
			let offset = source.indexOf("TOKEN");
			offset !== -1;
			offset = source.indexOf("TOKEN", offset + 5)
		)
			offsets.push(offset)
		let expected = source.replaceAll("TOKEN", "x")
		let armed = false
		let ready = await Effect.runPromise(Deferred.make<void>())
		let release = await Effect.runPromise(Deferred.make<void>())
		function controlledSessionLayer(
			directory: string,
			options: DocumentSessionOptions,
		) {
			let platform = cliDocumentPlatform(directory)
			let controlled = Layer.effectContext(
				Effect.gen(function* () {
					let storage = yield* DocumentJournal
					let journal = EventJournal.EventJournal.of({
						...storage.journal,
						withLock: store => effect => {
							let boundary = Effect.suspend(() => {
								if (!armed) return Effect.void
								armed = false
								return Deferred.succeed(ready, undefined).pipe(
									Effect.andThen(Deferred.await(release)),
								)
							})
							return phase === "before"
								? boundary.pipe(
										Effect.andThen(storage.journal.withLock(store)(effect)),
									)
								: storage.journal
										.withLock(store)(effect)
										.pipe(Effect.tap(() => boundary))
						},
					})
					return Context.make(DocumentJournal, { ...storage, journal }).pipe(
						Context.add(EventJournal.EventJournal, journal),
					)
				}),
			).pipe(Layer.provide(platform.journal(documentDatabaseName(options))))
			return DocumentSession.layer(options).pipe(
				Layer.provide(controlled),
				Layer.provide(platform.lifecycle),
			)
		}
		try {
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						let services = yield* Layer.build(
							workspaceStoreLayer(join(directory, "server.sqlite")),
						)
						let store = Context.get(services, WorkspaceStore)
						let subject = "replacement-owner"
						let creation = yield* buildAction(
							new Replica("birth"),
							"document",
							"Seed",
							staged => newDocument(staged, "document", "Replacement", source),
						)
						yield* store
							.create("workspace", "Workspace", personalWorkspaceRequest)
							.pipe(Effect.provideService(Identity, { subject, actors: [] }))
						yield* store.createDocument("workspace", creation).pipe(
							Effect.provideService(Identity, {
								subject,
								actors: [creation.actor],
							}),
						)
						function owner<A, E>(effect: Effect.Effect<A, E, Identity>) {
							return effect.pipe(
								Effect.provideService(Identity, { subject, actors: [] }),
							)
						}
						let transport: DocumentTransport = {
							snapshot: document =>
								owner(store.snapshot(document)).pipe(
									Effect.flatMap(value =>
										value
											? Effect.succeed(value)
											: Effect.fail(
													new ResourceUnavailable({
														message: "Missing snapshot",
													}),
												),
									),
								),
							commit: action =>
								store.commit(action).pipe(
									Effect.provideService(Identity, {
										subject,
										actors: [action.actor],
									}),
								),
							history: (document, after, log, limit) =>
								owner(store.history(document, after, log, limit)),
							action: (document, id) =>
								owner(store.action(document, id)).pipe(
									Effect.flatMap(value =>
										value
											? Effect.succeed(value)
											: Effect.fail(
													new ResourceUnavailable({
														message: "Missing action",
													}),
												),
									),
								),
							chain: (document, id) =>
								owner(store.chain(document, id)).pipe(
									Effect.flatMap(value =>
										value
											? Effect.succeed(value)
											: Effect.fail(
													new ResourceUnavailable({ message: "Missing chain" }),
												),
									),
								),
						}
						let sessionServices = yield* Layer.build(
							controlledSessionLayer(join(directory, "client"), {
								document: "document",
								subject,
								author: "Writer",
								transport,
								cooperativeWork: true,
							}),
						)
						let session = Context.get(sessionServices, DocumentSession)
						expect(session.replica.text("document")).toBe(source)
						let basis = yield* session.replica.forkEffect()
						basis.text("document")
						let edited = session.replace(
							offsets.map(start => ({ start, remove: 5, text: "x" })),
							basis.visible("document"),
						)
						yield* edited.saved
						let editId = session.pending()[0]?.id
						expect(editId).toBeDefined()
						yield* session.sync
						expect(session.pending()).toHaveLength(0)
						expect(session.replica.text("document")).toBe(expected)
						let editSnapshot = yield* transport.snapshot("document")
						let acceptedEdit = yield* restoreSnapshot(
							editSnapshot,
							"independent-edit",
						)
						expect(acceptedEdit.text("document")).toBe(expected)
						armed = true
						let pending = yield* session.undo().pipe(Effect.forkScoped)
						yield* Deferred.await(ready).pipe(Effect.timeout("5 seconds"))
						yield* Fiber.interrupt(pending)
						let interrupted = yield* Fiber.await(pending)
						expect(Exit.isFailure(interrupted)).toBe(true)
						if (Exit.isFailure(interrupted))
							expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true)
						let immediately = session.replica.text("document")
						expect(
							phase === "before"
								? immediately === expected
								: immediately === expected || immediately === source,
						).toBe(true)
						let coldBeforeSync = yield* Effect.scoped(
							DocumentSession.use(reopened =>
								Effect.sync(() => ({
									source: reopened.replica.text("document"),
									pending: reopened.pending(),
								})),
							).pipe(
								Effect.provide(
									cliDocumentSessionLayer(join(directory, "client"), {
										document: "document",
										subject,
										author: "Writer",
										transport,
										cooperativeWork: true,
									}),
								),
							),
						)
						expect(coldBeforeSync.source).toBe(
							phase === "before" ? expected : source,
						)
						expect(coldBeforeSync.pending).toHaveLength(
							phase === "after" ? 1 : 0,
						)
						let durableUndo = coldBeforeSync.pending[0]
						if (phase === "after") {
							expect(durableUndo).toBeDefined()
							expect(durableUndo?.undoOf).toBe(editId)
						}
						expect((yield* transport.snapshot("document")).position).toBe(
							editSnapshot.position,
						)
						yield* session.flush
						yield* session.sync
						let reconstructed = yield* restoreSnapshot(
							yield* transport.snapshot("document"),
							"boundary-oracle",
						)
						let final = session.replica.text("document")
						expect(final === (phase === "before" ? expected : source)).toBe(
							true,
						)
						expect(reconstructed.text("document")).toBe(final)
						let accepted = yield* transport.snapshot("document")
						expect(accepted.position).toBe(
							editSnapshot.position + (phase === "after" ? 1 : 0),
						)
						if (durableUndo) {
							if (!transport.action)
								throw new Error("Action lookup unavailable")
							let acceptedUndo = yield* transport.action(
								"document",
								durableUndo.id,
							)
							expect(acceptedUndo.id).toBe(durableUndo.id)
							expect(acceptedUndo.undoOf).toBe(editId)
						}
						yield* session.sync
						yield* session.sync
						expect((yield* transport.snapshot("document")).position).toBe(
							accepted.position,
						)
						let cold = yield* Effect.scoped(
							DocumentSession.use(reopened =>
								Effect.succeed(reopened.replica.text("document")),
							).pipe(
								Effect.provide(
									cliDocumentSessionLayer(join(directory, "client"), {
										document: "document",
										subject,
										author: "Writer",
										transport,
										cooperativeWork: true,
									}),
								),
							),
						)
						expect(cold).toBe(final)
					}),
				),
			)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	},
)
