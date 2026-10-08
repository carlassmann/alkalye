import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as Fiber from "effect/Fiber"
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
import type { DocumentSnapshot } from "../src/shared/document-actions"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"

function snapshot(source = "Body 😀\n", document = "doc"): DocumentSnapshot {
	let replica = new Replica("birth")
	newDocument(replica, document, "Opened", source)
	return {
		format: "document-state-v1",
		document,
		log: "opened-log",
		position: 1,
		state: JSON.stringify(replica.checkpoint()),
	}
}
function transport(value: DocumentSnapshot): DocumentTransport {
	return {
		snapshot: () => Effect.succeed(value),
		commit: () => Effect.fail(new Error("Offline")),
		history: () => Effect.succeed([]),
	}
}
function open<A, E>(
	directory: string,
	cooperativeWork: boolean,
	source: DocumentTransport,
	work: (session: DocumentSession["Service"]) => Effect.Effect<A, E>,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let services = yield* Layer.build(
				cliDocumentSessionLayer(directory, {
					document: "doc",
					subject: "owner",
					author: "Visible writer",
					cooperativeWork,
					transport: source,
				}),
			)
			return yield* work(Context.get(services, DocumentSession))
		}),
	)
}
async function fixture(work: (directory: string) => Promise<unknown>) {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-open-reuse-"))
	try {
		await work(directory)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

test.each([false, true])(
	"opened snapshot retains authorship, exact source, save, undo and independent offline reopen (cooperative=%s)",
	cooperativeWork =>
		fixture(directory =>
			Effect.runPromise(
				Effect.gen(function* () {
					let value = snapshot()
					let expected = ""
					yield* open(directory, cooperativeWork, transport(value), session =>
						Effect.gen(function* () {
							expected = session.replica.text("doc")
							expect(expected).toContain("Body 😀\n")
							let edit = session.replace([
								{ start: expected.length, remove: 0, text: "Tail 🦊" },
							])
							expect(edit.operation?.author).toBe("Visible writer")
							yield* edit.saved
							expect(session.replica.text("doc")).toBe(expected + "Tail 🦊")
							yield* session.undo()
							expect(session.replica.text("doc")).toBe(expected)
							yield* session.save
						}),
					)
					yield* open(
						directory,
						cooperativeWork,
						{
							...transport(value),
							snapshot: () =>
								Effect.fail(
									new Error("Snapshot must not be requested on durable reopen"),
								),
						},
						session =>
							Effect.sync(() =>
								expect(session.replica.text("doc")).toBe(expected),
							),
					)
				}),
			),
		),
)

test.each([false, true])(
	"wrong-document and corrupt snapshots do not poison a subsequent valid open (cooperative=%s)",
	cooperativeWork =>
		fixture(directory =>
			Effect.runPromise(
				Effect.gen(function* () {
					for (let invalid of [
						snapshot("Other", "other"),
						{ ...snapshot(), state: "{broken" },
					]) {
						let failed = yield* open(
							directory,
							cooperativeWork,
							transport(invalid),
							() => Effect.void,
						).pipe(Effect.result)
						expect(failed._tag).toBe("Failure")
					}
					yield* open(
						directory,
						cooperativeWork,
						transport(snapshot()),
						session =>
							Effect.sync(() =>
								expect(session.replica.text("doc")).toContain("Body 😀\n"),
							),
					)
				}),
			),
		),
)

test.each([false, true])(
	"a racing second opened record cannot replace the already accepted snapshot (cooperative=%s)",
	cooperativeWork =>
		fixture(directory =>
			Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						let requested = yield* Deferred.make<void>()
						let release = yield* Deferred.make<void>()
						let stale = { ...snapshot("Stale second snapshot"), position: 9 }
						let waiting: DocumentTransport = {
							...transport(stale),
							snapshot: () =>
								Deferred.succeed(requested, undefined).pipe(
									Effect.andThen(Deferred.await(release)),
									Effect.as(stale),
								),
						}
						let second = yield* open(
							directory,
							cooperativeWork,
							waiting,
							session =>
								Effect.succeed({
									source: session.replica.text("doc"),
									cursor: session.historyCursor(),
								}),
						).pipe(Effect.forkScoped)
						yield* Deferred.await(requested)
						let first = yield* open(
							directory,
							cooperativeWork,
							transport(snapshot("First snapshot")),
							session =>
								Effect.succeed({
									source: session.replica.text("doc"),
									cursor: session.historyCursor(),
								}),
						)
						yield* Deferred.succeed(release, undefined)
						expect(yield* Fiber.join(second)).toEqual(first)
					}),
				),
			),
		),
)

test.each([false, true])(
	"interruption after a real opened journal write leaves replay independently recoverable (cooperative=%s)",
	cooperativeWork =>
		fixture(directory =>
			Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						let held = yield* Deferred.make<void>()
						let storage = Context.get(
							yield* Layer.build(
								cliDocumentPlatform(directory).journal(
									documentDatabaseName({
										document: "doc",
										subject: "owner",
										transport: transport(snapshot()),
									}),
								),
							),
							DocumentJournal,
						)
						let blocked = {
							...storage,
							readAfter: (position: number, limit?: number, through?: number) =>
								storage
									.readAfter(position, limit, through)
									.pipe(
										Effect.flatMap(tail =>
											tail.entries.length > 0
												? Deferred.succeed(held, undefined).pipe(
														Effect.andThen(Effect.never),
													)
												: Effect.succeed(tail),
										),
									),
						}
						let opening = DocumentSession.layer({
							document: "doc",
							subject: "owner",
							author: "Visible writer",
							cooperativeWork,
							transport: transport(snapshot()),
						}).pipe(
							Layer.provide(Layer.succeed(DocumentJournal, blocked)),
							Layer.provide(
								Layer.succeed(EventJournal.EventJournal, storage.journal),
							),
							Layer.provide(cliDocumentPlatform(directory).lifecycle),
						)
						let fiber = yield* Effect.scoped(Layer.build(opening)).pipe(
							Effect.forkScoped,
						)
						yield* Deferred.await(held).pipe(Effect.timeout("3 seconds"))
						yield* Fiber.interrupt(fiber)
						yield* open(
							directory,
							cooperativeWork,
							{
								...transport(snapshot()),
								snapshot: () =>
									Effect.fail(
										new Error(
											"Durable opened event must replay without network",
										),
									),
							},
							session =>
								Effect.sync(() =>
									expect(session.replica.text("doc")).toContain("Body 😀\n"),
								),
						)
					}),
				),
			),
		),
)
