import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Layer from "effect/Layer"
import { makePassiveDocumentCache } from "../src/client/passive-document-cache"
import { cliDocumentSessionLayer } from "../src/cli/document-platform"
import { DocumentSession } from "../src/shared/document-session"
import type { DocumentTransport } from "../src/shared/document-session"
import { Replica } from "../src/shared/crdt"
import {
	buildAction,
	ResourceUnavailable,
	restoreSnapshot,
} from "../src/shared/document-actions"
import { newDocument, newComment, setFields } from "../src/shared/documents"
import { changeMetadata } from "../src/shared/document-metadata"
import { Identity, personalWorkspaceRequest } from "../src/shared/workspace"
import { WorkspaceStore } from "../src/server/document-store"

test.each([false, true])(
	"the browser document engine creates, edits, undoes and reopens offline in Bun, then publishes identical whole-document facts (passive cache: %s)",
	async cached => {
		let directory = await mkdtemp(join(tmpdir(), "alkalye-cli-document-"))
		let offline = true
		let requests = 0
		try {
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						let services = yield* Layer.build(
							WorkspaceStore.layer(join(directory, "server.sqlite")),
						)
						let store = Context.get(services, WorkspaceStore)
						let passiveState = yield* makePassiveDocumentCache()
						let subject = "cli-owner"
						function request<A, E>(work: Effect.Effect<A, E, Identity>) {
							return Effect.suspend<A, E | Error, never>(() => {
								requests++
								return offline
									? Effect.fail(new Error("Offline"))
									: work.pipe(
											Effect.provideService(Identity, { subject, actors: [] }),
										)
							})
						}
						let transport: DocumentTransport = {
							create: creation =>
								request(
									Effect.gen(function* () {
										yield* store.create(
											creation.workspace,
											"Personal",
											personalWorkspaceRequest,
										)
										let position = yield* store
											.createDocument(creation.workspace, creation.action)
											.pipe(
												Effect.provideService(Identity, {
													subject,
													actors: [creation.action.actor],
												}),
											)
										let snapshot = yield* store.snapshot(
											creation.action.document,
										)
										if (!snapshot)
											return yield* new ResourceUnavailable({
												message: "Document unavailable",
											})
										let initial = (yield* store.history(
											creation.action.document,
											position - 1,
											snapshot.log,
											1,
										))[0]
										if (!initial)
											return yield* new ResourceUnavailable({
												message: "Receipt unavailable",
											})
										return { log: snapshot.log, initial }
									}),
								),
							snapshot: document =>
								request(
									store.snapshot(document).pipe(
										Effect.flatMap(snapshot =>
											snapshot
												? Effect.succeed(snapshot)
												: Effect.fail(
														new ResourceUnavailable({
															message: "Document unavailable",
														}),
													),
										),
									),
								),
							commit: action =>
								request(
									store.commit(action).pipe(
										Effect.provideService(Identity, {
											subject,
											actors: [action.actor],
										}),
									),
								),
							history: (document, after, log, limit) =>
								request(store.history(document, after, log, limit)),
							action: (document, id) =>
								request(
									store.action(document, id).pipe(Effect.flatMap(requireValue)),
								),
							chain: (document, id) =>
								request(
									store.chain(document, id).pipe(Effect.flatMap(requireValue)),
								),
						}
						let action = yield* buildAction(
							new Replica(subject + "-birth"),
							"doc",
							"Create document",
							staged =>
								newDocument(staged, "doc", "Offline CLI", "First source"),
						)
						let initialCreation = {
							workspace: "personal-" + subject,
							subject,
							action,
						}
						function withSession<A, E>(
							work: (
								session: DocumentSession["Service"],
							) => Effect.Effect<A, E>,
							initial = false,
						) {
							return Effect.scoped(
								Effect.gen(function* () {
									let services = yield* Layer.build(
										cliDocumentSessionLayer(directory, {
											document: "doc",
											passiveState: cached ? passiveState("doc") : undefined,
											subject,
											transport,
											initialCreation: initial ? initialCreation : undefined,
										}),
									)
									return yield* work(Context.get(services, DocumentSession))
								}),
							)
						}
						yield* withSession(
							session =>
								Effect.gen(function* () {
									yield* session.edit("Second source").saved
									yield* session.change("Comment", staged =>
										newComment(
											staged,
											"comment",
											"doc",
											"Second",
											"Offline discussion",
											"CLI",
										),
									)
									expect(session.replica.text("doc")).toBe("Second source")
								}),
							true,
						)
						expect(requests).toBe(0)
						yield* withSession(session =>
							Effect.gen(function* () {
								expect(session.replica.text("doc")).toBe("Second source")
								expect(session.replica.fields("comment").body).toBe(
									"Offline discussion",
								)
								yield* session.undo()
								expect(session.replica.fields("comment").type).toBe("deleted")
								yield* session.redo()
								expect(session.replica.fields("comment").body).toBe(
									"Offline discussion",
								)
							}),
						)
						yield* withSession(session =>
							Effect.gen(function* () {
								let exit = yield* Effect.tryPromise(
									() =>
										Bun.spawn(
											[
												"bun",
												"tests/fixtures/cli-document-worker.ts",
												directory,
												subject,
											],
											{ stdout: "ignore", stderr: "inherit" },
										).exited,
								)
								expect(exit).toBe(0)
								yield* Effect.sync(
									() =>
										session.replica.fields("process-comment").body ===
										"From another process",
								).pipe(
									Effect.repeat({
										until: ready => ready,
										schedule: Schedule.spaced("50 millis"),
									}),
									Effect.timeout("5 seconds"),
								)
								expect(session.replica.fields("process-comment").body).toBe(
									"From another process",
								)
							}),
						)
						expect(requests).toBe(0)
						offline = false
						yield* withSession(session => session.sync)
						let accepted = yield* request(store.snapshot("doc"))
						expect(accepted?.position).toBeGreaterThan(0)
						let history = yield* request(store.history("doc", 0, accepted?.log))
						expect(history.map(moment => moment.action.label)).toEqual([
							"Create document",
							"Type",
							"Comment",
							"Undo Comment",
							"Undo Undo Comment",
							"Process comment",
						])
						offline = true
						let before = requests
						yield* withSession(session =>
							Effect.sync(() => {
								expect(session.pending()).toHaveLength(0)
								expect(session.replica.text("doc")).toBe("Second source")
								expect(session.replica.fields("comment").body).toBe(
									"Offline discussion",
								)
							}),
						)
						yield* withSession(session =>
							Effect.gen(function* () {
								yield* session.change("Create theme", staged => [
									...setFields(staged, "theme", {
										type: "theme",
										document: "doc",
									}),
									staged.edit("theme", "Base theme"),
								])
								yield* session.edit("Theme edit", undefined, "theme").saved
								yield* session.change("Rename", staged =>
									changeMetadata(staged, "doc", { title: "Renamed" }),
								)
								yield* session.undo("theme")
								expect(session.replica.text("theme")).toBe("Base theme")
								expect(session.replica.metadata("doc").title).toBe("Renamed")
								expect(session.replica.fields("comment").body).toBe(
									"Offline discussion",
								)
								yield* session.redo("theme")
								expect(session.replica.text("theme")).toBe("Theme edit")
							}),
						)
						let complete = yield* withSession(session =>
							Effect.gen(function* () {
								expect(session.replica.text("theme")).toBe("Theme edit")
								yield* session.undo("theme")
								expect(session.replica.text("theme")).toBe("Base theme")
								expect(session.replica.metadata("doc").title).toBe("Renamed")
								return session.replica.text("doc")
							}),
						)
						expect(requests).toBe(before)
						offline = false
						yield* withSession(session => session.sync)
						let finalSnapshot = yield* request(store.snapshot("doc"))
						if (!finalSnapshot)
							return yield* new ResourceUnavailable({
								message: "Snapshot unavailable",
							})
						let restored = yield* restoreSnapshot(finalSnapshot, "cold-reader")
						expect(restored.text("theme")).toBe("Base theme")
						expect(restored.text("doc")).toBe(complete)
						expect(restored.metadata("doc").title).toBe("Renamed")
						expect(restored.fields("comment").body).toBe("Offline discussion")
					}),
				),
			)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	},
	20000,
)

function requireValue<A>(value: A | undefined) {
	return value === undefined
		? Effect.fail(new ResourceUnavailable({ message: "Receipt unavailable" }))
		: Effect.succeed(value)
}
