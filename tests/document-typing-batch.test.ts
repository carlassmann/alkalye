import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
	cliDocumentPlatform,
	cliDocumentSessionLayer,
} from "../src/cli/document-platform"
import { DocumentJournal } from "../src/platform/document-journal"
import {
	DocumentSession,
	documentDatabaseName,
} from "../src/shared/document-session"
import type { DocumentTransport } from "../src/shared/document-session"
import { workspaceStoreLayer } from "../src/server/bun-databases"
import { WorkspaceStore } from "../src/server/document-store"
import { Identity, personalWorkspaceRequest } from "../src/shared/workspace"
import { buildAction } from "../src/shared/document-actions"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"

test("typing bursts retain each operation in one durable action, retain same-account tab ordering and reopen with whole-burst undo", async () => {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-typing-batch-"))
	let remote = new Replica("birth")
	newDocument(remote, "doc", "", "Seed 😀")
	let base = remote.text("doc")
	let transport: DocumentTransport = {
		snapshot: () =>
			Effect.succeed({
				format: "document-state-v1",
				document: "doc",
				log: "batch-log",
				position: 1,
				state: JSON.stringify(remote.checkpoint()),
			}),
		commit: () => Effect.fail(new Error("Offline")),
		history: () => Effect.succeed([]),
	}
	let options = {
		document: "doc",
		subject: "owner",
		transport,
		batchTyping: true,
	}
	function open<A, E>(
		work: (session: DocumentSession["Service"]) => Effect.Effect<A, E>,
	) {
		return Effect.scoped(
			Effect.gen(function* () {
				let services = yield* Layer.build(
					cliDocumentSessionLayer(directory, options),
				)
				return yield* work(Context.get(services, DocumentSession))
			}),
		)
	}
	try {
		await Effect.runPromise(
			open(session =>
				Effect.gen(function* () {
					for (let character of "abcdefgh") {
						let edit = session.edit(session.replica.text("doc") + character)
						expect(edit.operation).not.toBeNull()
					}
					expect(session.replica.text("doc")).toBe(base + "abcdefgh")
					expect(session.unsaved()).toBe(8)
					expect(session.pending()).toHaveLength(0)
					yield* session.flush
					expect(session.unsaved()).toBe(0)
					expect(session.pending()).toHaveLength(1)
					expect(session.pending()[0]?.changes).toHaveLength(8)
					expect(session.pending()[0]?.id).toBe(
						session.pending()[0]?.changes.at(-1)?.id,
					)
					session.edit(session.replica.text("doc") + "🌟")
					session.closeTypingGroup()
					session.edit(session.replica.text("doc") + "!")
					yield* session.flush
					expect(session.pending()).toHaveLength(3)
				}),
			),
		)
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let services = yield* Layer.build(
						cliDocumentPlatform(directory).journal(
							documentDatabaseName(options),
						),
					)
					let journal = Context.get(services, DocumentJournal)
					let page = yield* journal.readAfter(0, 100)
					expect(page.entries).toHaveLength(4)
				}),
			),
		)
		await Effect.runPromise(
			open(session =>
				Effect.gen(function* () {
					expect(session.replica.text("doc")).toBe(base + "abcdefgh🌟!")
					yield* session.undo()
					expect(session.replica.text("doc")).toBe(base + "abcdefgh🌟")
					yield* session.undo()
					expect(session.replica.text("doc")).toBe(base + "abcdefgh")
					yield* open(peer =>
						Effect.gen(function* () {
							peer.edit("P" + peer.replica.text("doc"))
							yield* peer.flush
						}),
					)
					yield* session.replay
					yield* session.undo()
					expect(session.replica.text("doc")).toBe(base + "abcdefgh")
					yield* session.undo()
					expect(session.replica.text("doc")).toBe(base)
					yield* session.redo()
					expect(session.replica.text("doc")).toBe(base + "abcdefgh")
				}),
			),
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}, 20000)

test("distinct SQLite-backed writers retain remote edits through burst undo, retry and revoked pending delivery", async () => {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-batch-writers-"))
	try {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let services = yield* Layer.build(
						workspaceStoreLayer(join(directory, "server.sqlite")),
					)
					let store = Context.get(services, WorkspaceStore)
					function asAccount<A, E>(
						subject: string,
						actors: string[],
						work: Effect.Effect<A, E, Identity>,
					) {
						return work.pipe(
							Effect.provideService(Identity, { subject, actors }),
						)
					}
					yield* asAccount(
						"owner",
						[],
						store.create("workspace", "Workspace", personalWorkspaceRequest),
					)
					yield* asAccount(
						"owner",
						[],
						store.membership("workspace", "peer", "writer", "invite"),
					)
					let creation = yield* buildAction(
						new Replica("owner-birth"),
						"doc",
						"Create",
						staged => newDocument(staged, "doc", "", "Seed 😀"),
					)
					yield* asAccount(
						"owner",
						[creation.actor],
						store.createDocument("workspace", creation),
					)
					let batches = 0
					function transport(subject: string): DocumentTransport {
						return {
							snapshot: document =>
								asAccount(subject, [], store.snapshot(document)).pipe(
									Effect.flatMap(value =>
										value
											? Effect.succeed(value)
											: Effect.fail(new Error("Missing snapshot")),
									),
								),
							commit: action =>
								asAccount(subject, [action.actor], store.commit(action)),
							commitBatch: actions =>
								Effect.sync(() => {
									batches++
								}).pipe(
									Effect.andThen(
										asAccount(
											subject,
											[...new Set(actions.map(action => action.actor))],
											store.commitBatch([...actions]),
										),
									),
								),
							history: (document, after, log, limit) =>
								asAccount(
									subject,
									[],
									store.history(document, after, log, limit),
								),
						}
					}
					let ownerServices = yield* Layer.build(
						cliDocumentSessionLayer(directory, {
							document: "doc",
							subject: "owner",
							transport: transport("owner"),
							batchTyping: true,
						}),
					)
					let peerServices = yield* Layer.build(
						cliDocumentSessionLayer(directory, {
							document: "doc",
							subject: "peer",
							transport: transport("peer"),
							batchTyping: true,
						}),
					)
					let owner = Context.get(ownerServices, DocumentSession)
					let peer = Context.get(peerServices, DocumentSession)
					let base = owner.replica.text("doc")
					for (let letter of "abcdefgh")
						owner.edit(owner.replica.text("doc") + letter)
					peer.edit("P" + peer.replica.text("doc"))
					yield* peer.sync
					yield* owner.sync
					expect(owner.replica.text("doc")).toBe("P" + base + "abcdefgh")
					let history = yield* asAccount(
						"owner",
						[],
						store.history("doc", 0, owner.historyCursor().log, 100),
					)
					expect(history).toHaveLength(3)
					expect(history.at(-1)?.action.changes).toHaveLength(8)
					expect(history.at(-1)?.action.subject).toBe("owner")
					yield* owner.undo()
					expect(owner.replica.text("doc")).toBe("P" + base)
					yield* owner.sync
					yield* owner.redo()
					expect(owner.replica.text("doc")).toBe("P" + base + "abcdefgh")
					yield* owner.sync
					owner.edit(owner.replica.text("doc") + "1")
					owner.closeTypingGroup()
					owner.edit(owner.replica.text("doc") + "2")
					yield* owner.sync
					expect(batches).toBe(1)
					peer.edit(peer.replica.text("doc") + "Revoked")
					yield* peer.flush
					let ids = peer.pending().map(action => action.id)
					yield* asAccount(
						"owner",
						[],
						store.membership("workspace", "peer", null, "revoke"),
					)
					expect((yield* Effect.result(peer.sync))._tag).toBe("Failure")
					expect(peer.pending().map(action => action.id)).toEqual(ids)
					yield* asAccount(
						"owner",
						[],
						store.membership("workspace", "peer", "writer", "regrant"),
					)
					yield* peer.sync
					expect(peer.pending()).toHaveLength(0)
					yield* owner.sync
					expect(owner.replica.text("doc")).toBe(peer.replica.text("doc"))
					let writers: DocumentSession["Service"][] = [owner, peer]
					for (let index = 1; index <= 18; index++) {
						let subject = "writer-" + index
						yield* asAccount(
							"owner",
							[],
							store.membership(
								"workspace",
								subject,
								"writer",
								"invite-" + index,
							),
						)
						let context = yield* Layer.build(
							cliDocumentSessionLayer(directory, {
								document: "doc",
								subject,
								transport: transport(subject),
								batchTyping: true,
							}),
						)
						writers.push(Context.get(context, DocumentSession))
					}
					for (let [index, writer] of writers.entries()) {
						writer.closeTypingGroup()
						for (let letter of "[contribution-" + index + "]")
							writer.edit(writer.replica.text("doc") + letter)
					}
					yield* Effect.forEach(writers, writer => writer.sync, {
						concurrency: "unbounded",
					})
					yield* Effect.forEach(writers, writer => writer.sync, {
						concurrency: "unbounded",
					})
					let converged = owner.replica.text("doc")
					for (let [index, writer] of writers.entries()) {
						expect(writer.replica.text("doc")).toBe(converged)
						expect(writer.pending()).toHaveLength(0)
						expect(
							converged.split("[contribution-" + index + "]"),
						).toHaveLength(2)
					}
					let accepted = yield* asAccount(
						"owner",
						[],
						store.history("doc", 0, owner.historyCursor().log, 100),
					)
					let last = accepted.slice(-20)
					expect(
						new Set(last.map(receipt => receipt.action.subject)).size,
					).toBe(20)
					expect(last.every(receipt => receipt.action.changes.length > 1)).toBe(
						true,
					)
				}),
			),
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}, 20000)

test.each(["before", "after"])(
	"a frozen typing burst retains identical operations across interrupted durable append (%s)",
	async phase => {
		let directory = await mkdtemp(join(tmpdir(), "alkalye-batch-interruption-"))
		let remote = new Replica("birth")
		newDocument(remote, "doc", "", "Seed")
		let base = remote.text("doc")
		let transport: DocumentTransport = {
			snapshot: () =>
				Effect.succeed({
					format: "document-state-v1",
					document: "doc",
					log: "interrupt-log",
					position: 1,
					state: JSON.stringify(remote.checkpoint()),
				}),
			commit: () => Effect.fail(new Error("Offline")),
			history: () => Effect.succeed([]),
		}
		let options = {
			document: "doc",
			subject: "owner",
			transport,
			batchTyping: true,
		}
		try {
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						let platform = cliDocumentPlatform(directory)
						let held = yield* Deferred.make<void>()
						let release = yield* Deferred.make<void>()
						let armed = false
						let controlled = Layer.effectContext(
							Effect.gen(function* () {
								let storage = yield* DocumentJournal
								let journal = EventJournal.EventJournal.of({
									...storage.journal,
									withLock: store => task => {
										let boundary = Effect.suspend(() => {
											if (!armed) return Effect.void
											armed = false
											return Deferred.succeed(held, undefined).pipe(
												Effect.andThen(Deferred.await(release)),
											)
										})
										return phase === "before"
											? boundary.pipe(
													Effect.andThen(storage.journal.withLock(store)(task)),
												)
											: storage.journal
													.withLock(store)(task)
													.pipe(Effect.tap(() => boundary))
									},
								})
								return Context.make(DocumentJournal, {
									...storage,
									journal,
								}).pipe(Context.add(EventJournal.EventJournal, journal))
							}),
						).pipe(
							Layer.provide(platform.journal(documentDatabaseName(options))),
						)
						let services = yield* Layer.build(
							DocumentSession.layer(options).pipe(
								Layer.provide(controlled),
								Layer.provide(platform.lifecycle),
							),
						)
						let session = Context.get(services, DocumentSession)
						let operations: string[] = []
						for (let character of "abcdefgh") {
							let edit = session.edit(session.replica.text("doc") + character)
							if (!edit.operation) throw new Error("Missing typing operation")
							operations.push(edit.operation.id)
						}
						armed = true
						let saving = yield* session.flush.pipe(Effect.forkScoped)
						yield* Deferred.await(held)
						let independent = yield* Layer.build(
							platform.journal(documentDatabaseName(options)),
						)
						let storage = Context.get(independent, DocumentJournal)
						let durable = yield* storage.readAfter(0, 100)
						expect(durable.entries).toHaveLength(phase === "after" ? 2 : 1)
						yield* Fiber.interrupt(saving)
						let interrupted = yield* Fiber.await(saving)
						expect(
							Exit.isFailure(interrupted) &&
								Cause.hasInterrupts(interrupted.cause),
						).toBe(true)
						expect(session.unsaved()).toBe(8)
						session.closeTypingGroup()
						session.edit(session.replica.text("doc") + "🌟")
						yield* session.flush
						expect(session.unsaved()).toBe(0)
						expect(session.pending()).toHaveLength(2)
						expect(
							session.pending()[0]?.changes.map(change => change.id),
						).toEqual(operations)
						expect(session.pending()[0]?.id).toBe(operations.at(-1))
						expect((yield* storage.readAfter(0, 100)).entries).toHaveLength(3)
					}),
				),
			)
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						let services = yield* Layer.build(
							cliDocumentSessionLayer(directory, options),
						)
						let reopened = Context.get(services, DocumentSession)
						expect(reopened.replica.text("doc")).toBe(base + "abcdefgh🌟")
						expect(reopened.pending()).toHaveLength(2)
						yield* reopened.undo()
						yield* reopened.undo()
						expect(reopened.replica.text("doc")).toBe(base)
					}),
				),
			)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	},
	20000,
)
