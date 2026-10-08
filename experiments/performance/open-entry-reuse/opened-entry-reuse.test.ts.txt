import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as Fiber from "effect/Fiber"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import {
	cliDocumentPlatform,
	cliDocumentSessionLayer,
} from "../src/cli/document-platform"
import { DocumentJournal } from "../src/platform/document-journal"
import type { DocumentJournalStorage } from "../src/platform/document-journal"
import {
	DocumentSession,
	documentDatabaseName,
} from "../src/shared/document-session"
import type { DocumentTransport } from "../src/shared/document-session"
import type { DocumentSnapshot } from "../src/shared/document-actions"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"

function snapshot(source: string): DocumentSnapshot {
	let replica = new Replica("birth")
	newDocument(replica, "doc", "Opened", source)
	return {
		format: "document-state-v1",
		document: "doc",
		log: "opened-log",
		position: 1,
		state: JSON.stringify(replica.checkpoint()),
	}
}
function options(value: DocumentSnapshot, cooperativeWork: boolean) {
	let transport: DocumentTransport = {
		snapshot: () => Effect.succeed(value),
		commit: () => Effect.fail(new Error("Offline")),
		history: () => Effect.succeed([]),
	}
	return { document: "doc", subject: "owner", cooperativeWork, transport }
}
function opening(
	directory: string,
	value: DocumentSnapshot,
	cooperativeWork: boolean,
	adapt: (storage: DocumentJournalStorage) => DocumentJournalStorage,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let platform = cliDocumentPlatform(directory)
			let settings = options(value, cooperativeWork)
			let storage = Context.get(
				yield* Layer.build(platform.journal(documentDatabaseName(settings))),
				DocumentJournal,
			)
			let adapted = adapt(storage)
			let services = yield* Layer.build(
				DocumentSession.layer(settings).pipe(
					Layer.provide(Layer.succeed(DocumentJournal, adapted)),
					Layer.provide(
						Layer.succeed(EventJournal.EventJournal, adapted.journal),
					),
					Layer.provide(platform.lifecycle),
				),
			)
			return Context.get(services, DocumentSession).replica.text("doc")
		}),
	)
}
function reopen(
	directory: string,
	value: DocumentSnapshot,
	cooperativeWork: boolean,
) {
	let settings = options(value, cooperativeWork)
	settings.transport.snapshot = () =>
		Effect.fail(new Error("Durable reopen must not request a snapshot"))
	return Effect.scoped(
		Effect.gen(function* () {
			let services = yield* Layer.build(
				cliDocumentSessionLayer(directory, settings),
			)
			return Context.get(services, DocumentSession).replica.text("doc")
		}),
	)
}
async function fixture(work: (directory: string) => Promise<unknown>) {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-entry-reuse-"))
	try {
		await work(directory)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}
function corruptCheckpoint(payload: Uint8Array) {
	let bytes = new Uint8Array(payload)
	let marker = new TextEncoder().encode("alkalye-state-v2")
	for (let offset = 0; offset <= bytes.length - marker.length; offset++) {
		if (!marker.every((byte, index) => bytes[offset + index] === byte)) continue
		bytes[offset] = 120
		return bytes
	}
	throw new Error("Fixture checkpoint format was not present in encoded entry")
}

test.each([false, true])(
	"encoded journal bytes retain original snapshot despite later caller mutation (cooperative=%s)",
	cooperativeWork =>
		fixture(directory =>
			Effect.runPromise(
				Effect.gen(function* () {
					let value = snapshot("Original 😀")
					let original = value.state
					let opened = yield* opening(
						directory,
						value,
						cooperativeWork,
						storage => ({
							...storage,
							journal: {
								...storage.journal,
								write: settings =>
									storage.journal.write({
										...settings,
										effect: entry =>
											Effect.sync(() => {
												Reflect.set(value, "state", "{broken")
											}).pipe(Effect.andThen(settings.effect(entry))),
									}),
							},
						}),
					)
					expect(value.state).toBe("{broken")
					expect(opened).toContain("Original 😀")
					expect(
						yield* reopen(
							directory,
							{ ...value, state: original },
							cooperativeWork,
						),
					).toBe(opened)
				}),
			),
		),
)

test.each([false, true])(
	"failed journal commit does not publish prepared snapshot (cooperative=%s)",
	cooperativeWork =>
		fixture(directory =>
			Effect.runPromise(
				Effect.gen(function* () {
					let validated = false
					let failed = yield* opening(
						directory,
						snapshot("Uncommitted"),
						cooperativeWork,
						storage => ({
							...storage,
							journal: {
								...storage.journal,
								write: settings =>
									storage.journal.write({
										...settings,
										effect: entry =>
											settings.effect(entry).pipe(
												Effect.andThen(
													Effect.sync(() => {
														validated = true
													}),
												),
												Effect.andThen(
													Effect.fail(
														new EventJournal.EventJournalError({
															method: "write",
															cause: "Injected commit failure",
														}),
													),
												),
											),
									}),
							},
						}),
					).pipe(Effect.exit)
					expect(Exit.isFailure(failed)).toBe(true)
					expect(validated).toBe(true)
					let opened = yield* opening(
						directory,
						snapshot("Fresh after failure"),
						cooperativeWork,
						storage => storage,
					)
					expect(opened).toContain("Fresh after failure")
					expect(opened).not.toContain("Uncommitted")
					expect(
						yield* reopen(directory, snapshot("Unused"), cooperativeWork),
					).toBe(opened)
				}),
			),
		),
)

test.each([false, true])(
	"interruption before journal commit leaves no prepared publication (cooperative=%s)",
	cooperativeWork =>
		fixture(directory =>
			Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						let held = yield* Deferred.make<void>()
						let fiber = yield* opening(
							directory,
							snapshot("Interrupted"),
							cooperativeWork,
							storage => ({
								...storage,
								journal: {
									...storage.journal,
									write: settings =>
										storage.journal.write({
											...settings,
											effect: entry =>
												settings
													.effect(entry)
													.pipe(
														Effect.andThen(Deferred.succeed(held, undefined)),
														Effect.andThen(Effect.never),
														Effect.interruptible,
													),
										}),
								},
							}),
						).pipe(Effect.forkScoped)
						yield* Deferred.await(held).pipe(Effect.timeout("3 seconds"))
						yield* Fiber.interrupt(fiber).pipe(Effect.timeout("3 seconds"))
						let opened = yield* opening(
							directory,
							snapshot("Fresh after interruption"),
							cooperativeWork,
							storage => storage,
						)
						expect(opened).toContain("Fresh after interruption")
						expect(opened).not.toContain("Interrupted")
						expect(
							yield* reopen(directory, snapshot("Unused"), cooperativeWork),
						).toBe(opened)
					}),
				),
			),
		),
)

test.each([false, true])(
	"same entry identity cannot reuse validation of different payload bytes (cooperative=%s)",
	cooperativeWork =>
		fixture(directory =>
			Effect.runPromise(
				Effect.gen(function* () {
					let value = snapshot("Original durable source")
					let corruptedRead = false
					let failed = yield* opening(
						directory,
						value,
						cooperativeWork,
						storage => ({
							...storage,
							readAfter: (position, limit, through) =>
								storage.readAfter(position, limit, through).pipe(
									Effect.map(tail => ({
										...tail,
										entries: tail.entries.map(entry => {
											let original = new Uint8Array(entry.payload)
											let altered = new EventJournal.Entry({
												...entry,
												payload: corruptCheckpoint(original),
											})
											let reads = 0
											Object.defineProperty(altered, "payload", {
												get() {
													corruptedRead = true
													return reads++ === 0
														? corruptCheckpoint(original)
														: original
												},
											})
											return altered
										}),
									})),
								),
						}),
					).pipe(Effect.exit)
					expect(Exit.isFailure(failed)).toBe(true)
					expect(corruptedRead).toBe(true)
					expect(yield* reopen(directory, value, cooperativeWork)).toContain(
						"Original durable source",
					)
				}),
			),
		),
)
