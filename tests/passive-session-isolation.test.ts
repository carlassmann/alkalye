import { expect, test } from "bun:test"
import { mkdtemp, rm, cp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import { makePassiveDocumentCache } from "../src/client/passive-document-cache"
import { cliDocumentSessionLayer } from "../src/cli/document-platform"
import { DocumentSession } from "../src/shared/document-session"
import type { DocumentTransport } from "../src/shared/document-session"
import { Replica } from "../src/shared/crdt"
import {
	buildAction,
	ResourceUnavailable,
} from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"
import { Identity } from "../src/shared/workspace"
import { WorkspaceStore } from "../src/server/document-store"

test.each([false, true])(
	"concurrent sessions keep cached accepted state isolated until each journal receives the remote edit (cooperative=%s)",
	async cooperativeWork => {
		let directory = await mkdtemp(join(tmpdir(), "alkalye-passive-isolation-"))
		try {
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						let services = yield* Layer.build(
							WorkspaceStore.layer(join(directory, "server.sqlite")),
						)
						let store = Context.get(services, WorkspaceStore)
						let subject = "passive-owner"
						let creation = yield* buildAction(
							new Replica("passive-birth"),
							"doc",
							"Create document",
							staged => newDocument(staged, "doc", "Cached", "Initial source"),
						)
						yield* store
							.create("space", "Cached workspace", "create-space")
							.pipe(Effect.provideService(Identity, { subject, actors: [] }))
						yield* store.createDocument("space", creation).pipe(
							Effect.provideService(Identity, {
								subject,
								actors: [creation.actor],
							}),
						)
						let passive = (yield* makePassiveDocumentCache())("doc")
						function request<A, E>(work: Effect.Effect<A, E, Identity>) {
							return work.pipe(
								Effect.provideService(Identity, { subject, actors: [] }),
							)
						}
						let transport: DocumentTransport = {
							create: () => Effect.fail(new Error("Document already exists")),
							snapshot: document =>
								request(store.snapshot(document)).pipe(
									Effect.flatMap(required),
								),
							commit: action =>
								store.commit(action).pipe(
									Effect.provideService(Identity, {
										subject,
										actors: [action.actor],
									}),
								),
							history: (document, after, log, limit) =>
								request(store.history(document, after, log, limit)),
							action: (document, action) =>
								request(store.action(document, action)).pipe(
									Effect.flatMap(required),
								),
							chain: (document, action) =>
								request(store.chain(document, action)).pipe(
									Effect.flatMap(required),
								),
						}
						function open(
							scope: Scope.Scope,
							transport: DocumentTransport,
							local = directory,
						) {
							return Layer.build(
								cliDocumentSessionLayer(local, {
									document: "doc",
									subject,
									passiveState: passive,
									cooperativeWork,
									transport,
								}),
							).pipe(
								Effect.provideService(Scope.Scope, scope),
								Effect.map(context => Context.get(context, DocumentSession)),
							)
						}
						let bootstrapScope = yield* Scope.make()
						yield* open(bootstrapScope, transport)
						yield* Scope.close(bootstrapScope, Exit.void)
						expect((yield* passive.read)?.replica?.text("doc")).toBe(
							'---\ntitle: "Cached"\n---\nInitial source',
						)
						let secondDirectory = join(directory, "peer")
						yield* Effect.tryPromise(() =>
							cp(
								join(directory, "documents"),
								join(secondDirectory, "documents"),
								{ recursive: true },
							),
						)
						let firstScope = yield* Scope.fork(yield* Scope.Scope, "sequential")
						let first = yield* open(firstScope, transport)
						let paused = true
						let blocked: DocumentTransport = {
							...transport,
							snapshot: document =>
								Effect.suspend(() =>
									paused
										? Effect.fail(new Error("Paused peer"))
										: transport.snapshot(document),
								),
							history: (document, after, log, limit) =>
								Effect.suspend(() =>
									paused
										? Effect.fail(new Error("Paused peer"))
										: transport.history(document, after, log, limit),
								),
						}
						let secondScope = yield* Scope.fork(
							yield* Scope.Scope,
							"sequential",
						)
						let second = yield* open(secondScope, blocked, secondDirectory)
						let retained = (yield* passive.read)?.replica
						expect(retained?.text("doc")).toBe(
							'---\ntitle: "Cached"\n---\nInitial source',
						)
						yield* first.edit("Remote accepted source").saved
						yield* first.sync
						expect(first.replica.text("doc")).toBe("Remote accepted source")
						expect(retained?.text("doc")).toBe(
							'---\ntitle: "Cached"\n---\nInitial source',
						)
						paused = false
						yield* second.sync
						expect(second.replica.text("doc")).toBe("Remote accepted source")
					}),
				),
			)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	},
	20000,
)

function required<A>(value: A | undefined) {
	return value === undefined
		? Effect.fail(new ResourceUnavailable({ message: "Document unavailable" }))
		: Effect.succeed(value)
}
