import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import {
	cliDocumentPlatform,
	cliDocumentSessionLayer,
} from "../src/cli/document-platform"
import { DocumentJournal } from "../src/platform/document-journal"
import { DocumentProperties } from "../src/client/document-properties"
import {
	DocumentSession,
	documentDatabaseName,
} from "../src/shared/document-session"
import type { DocumentTransport } from "../src/shared/document-session"
import type { DocumentSnapshot } from "../src/shared/document-actions"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"
import { frontmatter, withFrontmatter } from "../src/shared/markdown"

test("document properties preserve source metadata, peer text, undo, permissions and durable reopening", async () => {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-properties-"))
	let remote = new Replica("birth")
	newDocument(
		remote,
		"doc",
		"",
		withFrontmatter("Body 😀", { title: "Before", "theme-id": "theme" }),
	)
	let snapshot: DocumentSnapshot = {
		format: "document-state-v1",
		document: "doc",
		log: "properties-log",
		position: 1,
		state: JSON.stringify(remote.checkpoint()),
	}
	let transport: DocumentTransport = {
		snapshot: () => Effect.succeed(snapshot),
		commit: () => Effect.fail(new Error("Offline")),
		history: () => Effect.succeed([]),
	}
	let writable = true
	function open<A, E>(
		work: (
			session: DocumentSession["Service"],
			properties: DocumentProperties["Service"],
		) => Effect.Effect<A, E>,
	) {
		return Effect.scoped(
			Effect.gen(function* () {
				let services = yield* Layer.build(
					cliDocumentSessionLayer(directory, {
						document: "doc",
						subject: "owner",
						transport,
					}),
				)
				let session = Context.get(services, DocumentSession)
				let capabilities = yield* Layer.build(
					DocumentProperties.layer({
						document: "doc",
						canWrite: () => writable,
					}).pipe(Layer.provide(Layer.succeed(DocumentSession, session))),
				)
				return yield* work(
					session,
					Context.get(capabilities, DocumentProperties),
				)
			}),
		)
	}
	try {
		await Effect.runPromise(
			open((session, properties) =>
				Effect.gen(function* () {
					let updating = properties.update({
						title: "After",
						tags: ["one"],
						pinned: true,
					})
					yield* open(
						peer =>
							peer.replace([
								{
									start: peer.replica.text("doc").length,
									remove: 0,
									text: " peer",
								},
							]).saved,
					)
					yield* session.replay
					yield* updating
					let header = frontmatter(session.replica.text("doc"))
					expect(header.body).toBe("Body 😀 peer")
					expect(header.data["theme-id"]).toBe("theme")
					expect(session.replica.metadata("doc")).toMatchObject({
						title: "After",
						tags: ["one"],
						pinned: true,
					})
					yield* session.undo()
					expect(session.replica.metadata("doc").title).toBe("Before")
					expect(frontmatter(session.replica.text("doc")).body).toBe(
						"Body 😀 peer",
					)
					yield* session.redo()
					yield* properties.presentation(true)
					expect(frontmatter(session.replica.text("doc")).data.mode).toBe(
						"present",
					)
					yield* properties.presentation(false)
					expect(
						frontmatter(session.replica.text("doc")).data.mode,
					).toBeUndefined()
					let queued = properties.update({ title: "Denied" })
					let before = session.replica.text("doc")
					writable = false
					expect((yield* Effect.result(queued))._tag).toBe("Failure")
					expect(
						(yield* Effect.result(properties.presentation(true)))._tag,
					).toBe("Failure")
					expect(session.replica.text("doc")).toBe(before)
				}),
			),
		)
		await Effect.runPromise(
			open(session =>
				Effect.sync(() => {
					expect(session.replica.metadata("doc")).toMatchObject({
						title: "After",
						tags: ["one"],
						pinned: true,
					})
					let header = frontmatter(session.replica.text("doc"))
					expect(header.body).toBe("Body 😀 peer")
					expect(header.data["theme-id"]).toBe("theme")
					expect(header.data.mode).toBeUndefined()
				}),
			),
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test("queued property commands recheck permissions after a real journal read releases the session gate", async () => {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-properties-gate-"))
	let remote = new Replica("birth")
	newDocument(remote, "doc", "Before", "Body")
	let snapshot: DocumentSnapshot = {
		format: "document-state-v1",
		document: "doc",
		log: "properties-gate-log",
		position: 1,
		state: JSON.stringify(remote.checkpoint()),
	}
	let options = {
		document: "doc",
		subject: "owner",
		transport: {
			snapshot: () => Effect.succeed(snapshot),
			commit: () => Effect.fail(new Error("Offline")),
			history: () => Effect.succeed([]),
		},
	}
	try {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let entered = yield* Deferred.make<void>()
					let release = yield* Deferred.make<void>()
					let checked = yield* Deferred.make<void>()
					let armed = false,
						writable = true,
						checks = 0
					let platform = cliDocumentPlatform(directory)
					let journal = Layer.effect(
						DocumentJournal,
						Effect.gen(function* () {
							let original = yield* DocumentJournal
							return {
								...original,
								readAfter(position: number, limit?: number, through?: number) {
									return Effect.gen(function* () {
										if (armed) {
											armed = false
											yield* Deferred.succeed(entered, undefined)
											yield* Deferred.await(release)
										}
										return yield* original.readAfter(position, limit, through)
									})
								},
							}
						}),
					).pipe(
						Layer.provideMerge(platform.journal(documentDatabaseName(options))),
					)
					let services = yield* Layer.build(
						DocumentSession.layer(options).pipe(
							Layer.provide(journal),
							Layer.provide(platform.lifecycle),
						),
					)
					let session = Context.get(services, DocumentSession)
					let capabilities = yield* Layer.build(
						DocumentProperties.layer({
							document: "doc",
							canWrite() {
								let allowed = writable
								if (++checks === 2) Deferred.doneUnsafe(checked, Effect.void)
								return allowed
							},
						}).pipe(Layer.provide(Layer.succeed(DocumentSession, session))),
					)
					let properties = Context.get(capabilities, DocumentProperties)
					armed = true
					let holding = yield* session
						.change("Held edit", staged => [
							staged.edit("doc", staged.text("doc") + " peer"),
						])
						.pipe(Effect.forkScoped)
					yield* Deferred.await(entered)
					let updating = yield* properties
						.update({ title: "Denied" })
						.pipe(Effect.forkScoped)
					let presenting = yield* properties
						.presentation(true)
						.pipe(Effect.forkScoped)
					yield* Deferred.await(checked)
					writable = false
					yield* Deferred.succeed(release, undefined)
					yield* Fiber.join(holding)
					expect((yield* Effect.result(Fiber.join(updating)))._tag).toBe(
						"Failure",
					)
					expect((yield* Effect.result(Fiber.join(presenting)))._tag).toBe(
						"Failure",
					)
					expect(session.replica.metadata("doc").title).toBe("Before")
					let header = frontmatter(session.replica.text("doc"))
					expect(header.body).toBe("Body peer")
					expect(header.data.mode).toBeUndefined()
					writable = true
					yield* properties.update({ title: "Allowed again" })
					expect(session.replica.metadata("doc").title).toBe("Allowed again")
				}),
			).pipe(Effect.timeout("10 seconds")),
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
