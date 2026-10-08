import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import * as Schema from "effect/Schema"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import * as EventJournal from "effect/eventlog/EventJournal"
import {
	cliDocumentPlatform,
	cliDocumentSessionLayer,
} from "../src/cli/document-platform"
import { DocumentJournal } from "../src/platform/document-journal"
import { DocumentLifecycle } from "../src/platform/document-lifecycle"
import {
	DocumentSession,
	documentDatabaseName,
} from "../src/shared/document-session"
import type { DocumentTransport } from "../src/shared/document-session"
import {
	CommittedActionSchema,
	AccessConflict,
	DocumentActionSchema,
	DocumentSnapshotSchema,
	DocumentPublicationSchema,
	LocalDocumentCreationSchema,
	buildAction,
} from "../src/shared/document-actions"
import { UndoUnavailable } from "../src/shared/document-errors"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"

let offline: DocumentTransport = {
	create: () => Effect.fail(new Error("Offline")),
	snapshot: () => Effect.fail(new Error("Offline")),
	commit: () => Effect.fail(new Error("Offline")),
	history: () => Effect.fail(new Error("Offline")),
	action: () => Effect.fail(new Error("Offline")),
	chain: () => Effect.fail(new Error("Offline")),
}

test("interrupted durable save retains protection until hidden-page retry, emits Saved without changing content, and reopens offline", async () => {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-save-lifecycle-"))
	let protectedDraft = false
	let protectionReleased = false
	try {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let action = yield* buildAction(
						new Replica("owner-birth"),
						"doc",
						"Create",
						staged => newDocument(staged, "doc", "Lifecycle", "Original 😀"),
					)
					let options = {
						document: "doc",
						subject: "owner",
						transport: offline,
						initialCreation: {
							workspace: "personal-owner",
							subject: "owner",
							action,
						},
					}
					yield* Effect.scoped(
						Effect.gen(function* () {
							let services = yield* Layer.build(
								cliDocumentPlatform(directory).journal(
									documentDatabaseName(options),
								),
							)
							let storage = Context.get(services, DocumentJournal)
							let held = yield* Deferred.make<void>()
							let release = yield* Deferred.make<void>()
							let hidden = yield* PubSub.unbounded<void>()
							let armed = false
							let failNextWrite = false
							let heldEntry: EventJournal.Entry | undefined
							let journal: EventJournal.EventJournal["Service"] = {
								...storage.journal,
								write: request =>
									Effect.suspend(() => {
										if (failNextWrite) {
											failNextWrite = false
											return Effect.fail(
												new EventJournal.EventJournalError({
													method: "write",
													cause: new Error("Controlled journal write failure"),
												}),
											)
										}
										return storage.journal.write({
											...request,
											effect: entry =>
												request.effect(entry).pipe(
													Effect.tap(() =>
														Effect.sync(() => {
															if (armed) heldEntry = entry
														}),
													),
												),
										})
									}),
								withLock: storeId => task =>
									storage.journal
										.withLock(storeId)(task)
										.pipe(
											Effect.tap(() =>
												Effect.suspend(() => {
													if (!armed || !heldEntry) return Effect.void
													armed = false
													return Deferred.succeed(held, undefined).pipe(
														Effect.andThen(Deferred.await(release)),
													)
												}),
											),
										),
							}
							let lifecycle: DocumentLifecycle["Service"] = {
								hidden: Stream.fromPubSub(hidden),
								changes: Stream.never,
								protect: predicate =>
									Effect.gen(function* () {
										yield* Effect.addFinalizer(() =>
											Effect.sync(() => {
												protectionReleased = true
											}),
										)
										return {
											update() {
												protectedDraft = predicate()
											},
										}
									}),
							}
							let opened = yield* Layer.build(
								DocumentSession.layer(options).pipe(
									Layer.provide(
										Layer.merge(
											Layer.succeed(DocumentJournal, { ...storage, journal }),
											Layer.succeed(EventJournal.EventJournal, journal),
										),
									),
									Layer.provide(Layer.succeed(DocumentLifecycle, lifecycle)),
								),
							)
							let session = Context.get(opened, DocumentSession)
							armed = true
							let edit = session.edit("Saved 😀 offline")
							let saving = yield* edit.saved.pipe(Effect.forkScoped)
							yield* Deferred.await(held).pipe(Effect.timeout("3 seconds"))
							expect(session.unsaved()).toBe(1)
							expect(protectedDraft).toBe(true)
							if (!heldEntry)
								return yield* Effect.die(
									new Error("Missing durable edit entry"),
								)
							let durableEntry = yield* storage.entry(heldEntry.idString)
							expect(durableEntry).toBeDefined()
							if (!durableEntry)
								return yield* Effect.die(
									new Error("Committed entry not independently readable"),
								)
							let recording = Schema.decodeUnknownSync(recordingCodec)(
								durableEntry.payload,
							)
							expect(recording.kind).toBe("proposed")
							if (recording.kind !== "proposed")
								return yield* Effect.die(
									new Error("Held entry was not proposed edit"),
								)
							if (!edit.operation)
								return yield* Effect.die(
									new Error("Edit did not produce an operation"),
								)
							expect(recording.action.id).toBe(edit.operation.id)
							let persisted = yield* storage.readAfter(0)
							let statuses: { version: number; unsaved: number }[] = []
							yield* Fiber.interrupt(saving)
							let interrupted = yield* Fiber.await(saving)
							expect(Exit.hasInterrupts(interrupted)).toBe(true)
							let saved = yield* Deferred.make<void>()
							yield* session.changes.pipe(
								Stream.runForEach(version =>
									Effect.sync(() => {
										statuses.push({ version, unsaved: session.unsaved() })
									}).pipe(
										Effect.andThen(
											session.unsaved() === 0
												? Deferred.succeed(saved, undefined)
												: Effect.void,
										),
									),
								),
								Effect.forkScoped({ startImmediately: true }),
							)
							yield* PubSub.publish(hidden, undefined)
							yield* Deferred.await(saved).pipe(Effect.timeout("3 seconds"))
							expect(session.unsaved()).toBe(0)
							expect(protectedDraft).toBe(false)
							let savedStatus = statuses.at(-1)
							let precedingStatus = statuses.at(-2)
							expect(savedStatus?.unsaved).toBe(0)
							expect(precedingStatus?.unsaved).toBe(1)
							expect(savedStatus?.version).toBe(precedingStatus?.version)
							expect(session.replica.text("doc")).toBe("Saved 😀 offline")
							let retried = yield* storage.readAfter(0)
							expect(retried.position).toBe(persisted.position)
							expect(retried.entries.map(entry => entry.idString)).toEqual(
								persisted.entries.map(entry => entry.idString),
							)
							failNextWrite = true
							let failedEdit = session.edit("Recovered 😀 offline")
							let failure = yield* Effect.exit(failedEdit.saved)
							expect(Exit.isFailure(failure)).toBe(true)
							expect(session.failures.current().save).toBeDefined()
							expect(session.unsaved()).toBe(1)
							expect(protectedDraft).toBe(true)
							expect(session.replica.text("doc")).toBe("Recovered 😀 offline")
							let cleared = yield* Deferred.make<void>()
							yield* session.failures.changes.pipe(
								Stream.runForEach(state =>
									state.save === undefined
										? Deferred.succeed(cleared, undefined)
										: Effect.void,
								),
								Effect.forkScoped({ startImmediately: true }),
							)
							yield* session.flush
							yield* Deferred.await(cleared).pipe(Effect.timeout("3 seconds"))
							expect(session.unsaved()).toBe(0)
							expect(session.failures.current().save).toBeUndefined()
							expect(protectedDraft).toBe(false)
						}),
					)
					expect(protectionReleased).toBe(true)
					let reopened = yield* Layer.build(
						cliDocumentSessionLayer(directory, {
							...options,
							initialCreation: undefined,
						}),
					)
					let session = Context.get(reopened, DocumentSession)
					expect(session.replica.text("doc")).toBe("Recovered 😀 offline")
					expect(session.unsaved()).toBe(0)
				}),
			),
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}, 20000)

let recordingCodec = SchemaBinary.toCodec(
	Schema.Union([
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
			failure: Schema.Union([UndoUnavailable, AccessConflict]),
			closure: Schema.Array(Schema.String),
		}),
		Schema.Struct({
			kind: Schema.Literal("received"),
			log: Schema.String,
			after: Schema.Natural,
			actions: Schema.Array(
				Schema.Struct({
					position: Schema.Natural,
					action: CommittedActionSchema,
				}),
			),
		}),
	]),
)
