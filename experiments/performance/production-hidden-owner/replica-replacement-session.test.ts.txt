import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Fiber from "effect/Fiber"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { cliDocumentSessionLayer } from "../src/cli/document-platform"
import { DocumentSession } from "../src/shared/document-session"
import type { DocumentTransport } from "../src/shared/document-session"
import { WorkspaceStore } from "../src/server/document-store"
import { Identity, personalWorkspaceRequest } from "../src/shared/workspace"
import { Replica } from "../src/shared/crdt"
import {
	buildAction,
	ResourceUnavailable,
	restoreSnapshot,
} from "../src/shared/document-actions"
import { newDocument, newComment } from "../src/shared/documents"

let cases = [1, 512].flatMap(count =>
	["none", "insert", "delete", "retype", "frontmatter", "comment", "scope"].map(
		peer => ({ count, peer }),
	),
)
test.each(cases)(
	"accepted replacement / Undo / Redo preserves authoritative peer changes (%j)",
	async ({ count, peer }) => {
		let directory = await mkdtemp(
			join(tmpdir(), "alkalye-replacement-diagnostic-"),
		)
		let source =
			'---\ntitle: "Replacement"\n---\n' +
			"Body 😀\n".repeat(8192) +
			"TOKEN suffix 😀\n".repeat(count)
		let offsets: number[] = []
		for (
			let offset = source.indexOf("TOKEN");
			offset !== -1;
			offset = source.indexOf("TOKEN", offset + 5)
		)
			offsets.push(offset)
		let expected = source.replaceAll("TOKEN", "x")
		try {
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						let services = yield* Layer.build(
							WorkspaceStore.layer(join(directory, "server.sqlite")),
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
							cliDocumentSessionLayer(join(directory, "client"), {
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
						yield* session.sync
						expect(session.pending()).toHaveLength(0)
						expect(session.replica.text("document")).toBe(expected)
						let editSnapshot = yield* transport.snapshot("document")
						let acceptedEdit = yield* restoreSnapshot(
							editSnapshot,
							"independent-edit",
						)
						expect(acceptedEdit.text("document")).toBe(expected)
						let expectedUndo = source
						let expectedRedo = expected
						if (peer === "scope") {
							let closedScope = yield* Scope.make()
							let closedServices = yield* Layer.build(
								cliDocumentSessionLayer(join(directory, "closed-client"), {
									document: "document",
									subject,
									author: "Closed",
									transport,
									cooperativeWork: true,
								}),
							).pipe(Scope.provide(closedScope))
							let closedSession = Context.get(closedServices, DocumentSession)
							let closedText = closedSession.replica.text("document")
							yield* Scope.close(closedScope, Exit.void)
							expect(
								yield* closedSession.undo().pipe(Effect.flip),
							).toMatchObject({
								_tag: "DocumentConflict",
								message: "This document session is closed",
							})
							expect(closedSession.replica.text("document")).toBe(closedText)
							expect((yield* transport.snapshot("document")).position).toBe(
								editSnapshot.position,
							)
							let canceling = yield* session
								.undo()
								.pipe(Effect.forkScoped({ startImmediately: true }))
							let completion = canceling.pollUnsafe()
							if (completion && Exit.isSuccess(completion)) {
								yield* session.flush
								yield* session.sync
								expect(session.replica.text("document")).toBe(source)
								expect(
									(yield* restoreSnapshot(
										yield* transport.snapshot("document"),
										"completed-oracle",
									)).text("document"),
								).toBe(source)
								yield* session.redo()
							} else {
								expect(completion).toBeUndefined()
								yield* Fiber.interrupt(canceling)
								expect(Exit.isFailure(yield* Fiber.await(canceling))).toBe(true)
								expect(session.replica.text("document")).toBe(expected)
							}
							yield* session.flush
							yield* session.sync
							expect(session.pending()).toHaveLength(0)
							expect(session.replica.text("document")).toBe(expected)
							expect(
								(yield* restoreSnapshot(
									yield* transport.snapshot("document"),
									"scope-oracle",
								)).text("document"),
							).toBe(expected)
						}
						if (peer !== "none" && peer !== "scope") {
							yield* owner(
								store.membership(
									"workspace",
									"peer-owner",
									"writer",
									"peer-membership",
								),
							)
							let remote = yield* restoreSnapshot(
								editSnapshot,
								"peer-owner-client",
							)
							let remoteText = expected
							if (peer === "insert") {
								let offset = expected.indexOf("Body")
								remoteText =
									expected.slice(0, offset) + "Peer 🦊" + expected.slice(offset)
								expectedUndo =
									source.slice(0, offset) + "Peer 🦊" + source.slice(offset)
							} else if (peer === "delete") {
								let offset = expected.indexOf("x")
								remoteText =
									expected.slice(0, offset) + expected.slice(offset + 1)
							} else if (peer === "retype") {
								remoteText = expected.replace("x", "TOKEN")
								expectedUndo = source.replace("TOKEN", "TOKENTOKEN")
							} else if (peer === "frontmatter") {
								remoteText = expected.replace(
									'title: "Replacement"',
									'title: "Peer title"',
								)
								expectedUndo = source.replace(
									'title: "Replacement"',
									'title: "Peer title"',
								)
							}
							let proposal = yield* buildAction(
								remote,
								"document",
								"Peer change",
								staged =>
									peer === "comment"
										? newComment(
												staged,
												"comment",
												"document",
												"Body",
												"Thread",
												"Peer",
											)
										: [staged.prepareEdit("document", remoteText)],
							)
							yield* store.commit(proposal).pipe(
								Effect.provideService(Identity, {
									subject: "peer-owner",
									actors: [proposal.actor],
								}),
							)
							expectedRedo = remoteText
							yield* session.sync
							expect(session.replica.text("document")).toBe(remoteText)
						}
						yield* session.undo()
						yield* session.sync
						expect(session.pending()).toHaveLength(0)
						let undoneSnapshot = yield* transport.snapshot("document")
						let acceptedUndo = yield* restoreSnapshot(
							undoneSnapshot,
							"independent-undo",
						)
						expect(acceptedUndo.text("document")).toBe(expectedUndo)
						expect(session.replica.text("document")).toBe(expectedUndo)
						expect(undoneSnapshot.position).toBeGreaterThan(
							editSnapshot.position,
						)
						yield* session.redo()
						yield* session.sync
						expect(session.pending()).toHaveLength(0)
						expect(session.replica.text("document")).toBe(expectedRedo)
						let redoSnapshot = yield* transport.snapshot("document")
						expect(
							(yield* restoreSnapshot(redoSnapshot, "independent-redo")).text(
								"document",
							),
						).toBe(expectedRedo)
					}),
				),
			)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	},
)
