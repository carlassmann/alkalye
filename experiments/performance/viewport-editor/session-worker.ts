import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberSet from "effect/FiberSet"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as RpcServer from "effect/rpc/RpcServer"
import * as WorkerRunner from "effect/workers/WorkerRunner"
import {
	DocumentSession,
	documentDatabaseName,
} from "../../../src/shared/document-session"
import { DocumentLifecycle } from "../../../src/platform/document-lifecycle"
import { DocumentJournal } from "../../../src/platform/document-journal"
import { indexedDbJournalLayer } from "../../../src/platform/indexeddb-journal"
import { webCryptoLayer } from "../../../src/platform/web-crypto"
import { Replica } from "../../../src/shared/crdt"
import { newDocument } from "../../../src/shared/documents"
import type { DocumentSnapshot } from "../../../src/shared/document-actions"
import { buildAction } from "../../../src/shared/document-actions"
import { makeDocumentTransport } from "../../../src/shared/document-transport"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { SessionRpc } from "./session-rpc"

let runner = Layer.succeed(WorkerRunner.WorkerRunnerPlatform, {
	start: <O, I>() =>
		Effect.succeed({
			send: (_port: number, message: O) =>
				Effect.sync(() => self.postMessage([1, message])),
			sendUnsafe: (_port: number, message: O) => self.postMessage([1, message]),
			run: <A, E, R>(
				handler: (port: number, message: I) => Effect.Effect<A, E, R> | void,
			) =>
				Effect.scoped(
					Effect.gen(function* () {
						let fibers = yield* FiberSet.make<void, never>()
						let run = yield* FiberSet.runtime(fibers)<R>()
						function receive(
							event: MessageEvent<WorkerRunner.PlatformMessage<I>>,
						) {
							if (event.data[0] === 1) return
							let work = handler(0, event.data[1])
							if (work) run(work.pipe(Effect.orDie, Effect.asVoid))
						}
						yield* Effect.acquireRelease(
							Effect.sync(() => self.addEventListener("message", receive)),
							() =>
								Effect.sync(() => self.removeEventListener("message", receive)),
						)
						self.postMessage([0])
						yield* FiberSet.join(fibers)
					}),
				),
		}),
})
let handlers = SessionRpc.toLayer(
	Effect.gen(function* () {
		let owner = yield* Scope.make()
		yield* Effect.addFinalizer(() => Scope.close(owner, Exit.void))
		let gate = yield* Semaphore.make(1)
		let session: DocumentSession["Service"] | undefined
		let document = "",
			epoch = "",
			revision = 0,
			sequence = 0,
			knownContent = "",
			uncertain = false
		let sessionScope: Scope.Closeable | undefined
		let openingScope: Scope.Closeable | undefined
		function requireSession(expected: string) {
			return session && expected === epoch
				? Effect.succeed(session)
				: Effect.fail("Session epoch unavailable")
		}
		return SessionRpc.of({
			Open: input =>
				gate.withPermit(
					Effect.gen(function* () {
						if (session)
							return yield* Effect.fail("Worker already owns a session")
						document = input.document
						epoch = input.epoch
						let options = {
							document,
							subject: input.subject,
							transport: {
								snapshot: () =>
									Effect.sync((): DocumentSnapshot => {
										let remote = new Replica("worker-origin")
										newDocument(remote, document, "", input.source)
										return {
											format: "document-state-v1",
											document,
											log: "worker-log",
											position: 1,
											state: JSON.stringify(remote.checkpoint()),
										}
									}),
								commit: () => Effect.fail(Error("Offline worker experiment")),
								history: () => Effect.succeed([]),
							},
						}
						let transport = input.origin
							? yield* makeDocumentTransport(input.origin, input.subject).pipe(
									Effect.provide(FetchHttpClient.layer),
								)
							: options.transport
						let candidate = yield* Scope.fork(owner)
						openingScope = candidate
						let journalContext = yield* Layer.buildWithScope(
							indexedDbJournalLayer(documentDatabaseName(options)),
							candidate,
						)
						let journal = Context.get(journalContext, DocumentJournal)
						let existing = yield* journal.readAfter(0, 1)
						let fresh = existing.entries.length === 0
						let seedEnd = seedBoundary(input.source, 0)
						let initialCreation =
							input.create && fresh
								? {
										subject: input.subject,
										workspace: "personal-" + input.subject,
										action: yield* buildAction(
											new Replica(input.subject + "-origin"),
											document,
											"Create prototype",
											staged =>
												newDocument(
													staged,
													document,
													"",
													input.source.slice(0, seedEnd),
												),
										).pipe(Effect.provide(webCryptoLayer)),
									}
								: undefined
						let services = yield* Layer.buildWithScope(
							DocumentSession.layer({
								...options,
								transport,
								initialCreation,
							}).pipe(
								Layer.provide(Layer.succeedContext(journalContext)),
								Layer.provide(
									Layer.succeed(DocumentLifecycle, {
										hidden: Stream.never,
										changes: Stream.never,
										protect: () => Effect.succeed({ update() {} }),
									}),
								),
								Layer.provide(webCryptoLayer),
							),
							candidate,
						).pipe(
							Effect.onExit(exit =>
								Exit.isFailure(exit)
									? Scope.close(candidate, exit)
									: Effect.void,
							),
						)
						let initialized = Context.get(services, DocumentSession)
						if (input.create && fresh) {
							for (let end = seedEnd; end < input.source.length;) {
								end = seedBoundary(input.source, end)
								yield* initialized.edit(input.source.slice(0, end)).saved
							}
						}
						let content = initialized.replica.text(document)
						if (
							!fresh &&
							input.create &&
							input.source.length > seedEnd &&
							content.length >= seedEnd &&
							content.length < input.source.length &&
							input.source.startsWith(content)
						) {
							yield* Scope.close(candidate, Exit.void)
							return yield* Effect.fail(
								"Prototype fixture seed incomplete; use a fresh document ID",
							)
						}
						openingScope = undefined
						sessionScope = candidate
						session = initialized
						knownContent = content
						revision = 0
						return { epoch, revision, content: knownContent }
					}).pipe(
						Effect.catchCause(cause =>
							Effect.gen(function* () {
								if (openingScope) yield* Scope.close(openingScope, Exit.void)
								openingScope = undefined
								return yield* Effect.fail(String(cause))
							}),
						),
					),
				),
			Replace: input =>
				gate.withPermit(
					Effect.gen(function* () {
						let current = yield* requireSession(input.epoch)
						yield* current.replay
						if (uncertain)
							return yield* Effect.fail(
								"Uncertain transaction requires worker reopen",
							)
						if (
							input.baseRevision !== revision ||
							input.sequence !== sequence + 1
						)
							return yield* Effect.fail(
								"Stale replacement requires explicit resynchronization",
							)
						let source = current.replica.text(document)
						if (source !== knownContent) {
							return yield* Effect.fail(
								"Concurrent source change requires explicit resynchronization",
							)
						}
						if (input.start + input.remove > source.length)
							return yield* Effect.fail("Replacement outside source")
						let started = performance.now()
						let expected =
							source.slice(0, input.start) +
							input.text +
							source.slice(input.start + input.remove)
						uncertain = true
						let edit = current.edit(expected)
						yield* edit.saved
						if (current.replica.text(document) !== expected)
							return yield* Effect.fail(
								"Saved transaction includes unseen changes; reopen before more edits",
							)
						uncertain = false
						knownContent = expected
						revision++
						sequence = input.sequence
						return {
							epoch,
							revision,
							sequence,
							durable: true,
							milliseconds: performance.now() - started,
							patch: input,
						}
					}).pipe(Effect.catchCause(cause => Effect.fail(String(cause)))),
				),
			Read: input =>
				gate.withPermit(
					Effect.gen(function* () {
						let current = yield* requireSession(input.epoch)
						yield* current.replay
						knownContent = current.replica.text(document)
						revision++
						return { epoch, revision, content: knownContent }
					}).pipe(Effect.catchCause(cause => Effect.fail(String(cause)))),
				),
			Sync: input =>
				gate.withPermit(
					Effect.gen(function* () {
						let current = yield* requireSession(input.epoch)
						yield* current.sync
						knownContent = current.replica.text(document)
						revision++
						return { epoch, revision, content: current.replica.text(document) }
					}).pipe(Effect.catchCause(cause => Effect.fail(String(cause)))),
				),
			Close: () =>
				gate.withPermit(
					Effect.gen(function* () {
						if (session) yield* session.save
						if (sessionScope) yield* Scope.close(sessionScope, Exit.void)
						session = undefined
						sessionScope = undefined
						epoch = ""
						document = ""
						revision = 0
						sequence = 0
						uncertain = false
					}).pipe(Effect.catchCause(cause => Effect.fail(String(cause)))),
				),
		})
	}),
)
Effect.runCallback(
	Layer.launch(
		RpcServer.layer(SessionRpc).pipe(
			Layer.provide(handlers),
			Layer.provide(
				RpcServer.layerProtocolWorkerRunner.pipe(Layer.provide(runner)),
			),
		),
	),
	{
		onExit(exit) {
			if (Exit.isFailure(exit))
				self.postMessage({
					kind: "session-failure",
					message: String(exit.cause),
				})
		},
	},
)

function seedBoundary(source: string, start: number) {
	let end = Math.min(source.length, start + 65536)
	let before = source.charCodeAt(end - 1),
		after = source.charCodeAt(end)
	if (
		before >= 0xd800 &&
		before <= 0xdbff &&
		after >= 0xdc00 &&
		after <= 0xdfff
	)
		end--
	return end
}
