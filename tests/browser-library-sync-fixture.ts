import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { LocalDocuments } from "../src/client/local-documents"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import { StorageError } from "../src/platform/errors"
import { BrowserStorage, Storage } from "../src/client/storage"
import { BrowserAccount } from "../src/client/browser-account"
import { BrowserLibrary } from "../src/client/browser-library"
import { DocumentLive } from "../src/client/document-live"
import { LocalDirectories } from "../src/client/local-directories"
import type { LiveServerMessage } from "../src/shared/document-live"

interface Counts {
	pulls: number
	projections: number
	catalogues: number
	catalogueChanges: number
	projectionWrites: number
}
interface Probe {
	startInput(): Promise<void>
	stopInput(): Promise<void>
	releaseDocument(): Promise<void>
	reopenDocument(): Promise<void>
	rows(): Promise<unknown>
	refresh(): Promise<void>
	cacheFault(value: boolean): void
	snapshotCacheFault(value: boolean): void
	snapshotFailure(): string | undefined
	state(): { refresh: string; message?: string; cacheFailure?: string }
	catalogueTitle(): string | undefined
	workspaceName(): string | undefined
	roles(): ReadonlyArray<string>

	edit(text: string): Promise<void>
	sync(): Promise<void>
	startSync(): Promise<void>
	retry(): Promise<void>
	pending(): number
	reconnect(): Promise<void>
	close(): Promise<void>
	source(): string
	status(): string
	reset(): void
	counts: Counts
}
declare global {
	interface Window {
		librarySync?: Probe
		librarySyncFailure?: string
	}
}
let failCache = false
let failDocumentSummary = false
let counts: Counts = {
	pulls: 0,
	projections: 0,
	catalogues: 0,
	catalogueChanges: 0,
	projectionWrites: 0,
}
let countedHttp = Layer.effect(
	HttpClient.HttpClient,
	Effect.gen(function* () {
		let client = yield* HttpClient.HttpClient
		return client.pipe(
			HttpClient.tapRequest(request =>
				Effect.sync(() => {
					if (
						request.url.endsWith("/snapshot") ||
						request.url.endsWith("/history")
					)
						counts.pulls++
					if (request.url.endsWith("/api/library")) counts.catalogues++
				}),
			),
		)
	}),
).pipe(Layer.provide(FetchHttpClient.layer))

Effect.runPromise(
	Effect.gen(function* () {
		let scope = yield* Scope.make()
		let storage = yield* Effect.acquireRelease(Storage.open(), storage =>
			Effect.sync(() => storage.close()),
		).pipe(Effect.provideService(Scope.Scope, scope))
		let counted = new Proxy(storage, {
			get(target, property, receiver) {
				if (property === "set")
					return function (key: string, value: unknown) {
						return failCache && key.startsWith("document-library:")
							? Effect.fail(
									new StorageError({
										operation: "controlled library cache",
										cause: "fixture failure",
									}),
								)
							: target.set(key, value)
					}
				if (property === "modify")
					return function (key: string, update: (value: unknown) => unknown) {
						if (failDocumentSummary && key.startsWith("document-summary:"))
							return Effect.fail(
								new StorageError({
									operation: "controlled document summary",
									cause: new DOMException(
										"Retryable snapshot fault",
										"UnknownError",
									),
								}),
							)
						return target.modify(key, update).pipe(
							Effect.tap(changed =>
								Effect.sync(() => {
									if (key.startsWith("document-summary:")) {
										counts.projections++
										if (changed) counts.projectionWrites++
									}
								}),
							),
						)
					}
				return Reflect.get(target, property, receiver)
			},
		})
		let accountContext = yield* Layer.build(
			BrowserAccount.layer(location.origin).pipe(
				Layer.provide(Layer.succeed(BrowserStorage, counted)),
				Layer.provide(countedHttp),
			),
		).pipe(Effect.provideService(Scope.Scope, scope))
		let account = Context.get(accountContext, BrowserAccount)
		if (navigator.onLine) yield* account.connect
		let messages = yield* PubSub.unbounded<LiveServerMessage>()
		yield* Scope.addFinalizer(scope, PubSub.shutdown(messages))
		let live: Context.Service.Shape<typeof DocumentLive> = {
			watch: () => Effect.void,
			actor: () => "",
			connected: () => true,
			transport: () => "socket",
			changes: Stream.fromPubSub(messages),
			presence: { current: () => [], changes: Stream.never },
			announce: () => Effect.void,
		}
		let base = Layer.mergeAll(
			Layer.succeed(BrowserStorage, counted),
			Layer.succeed(BrowserAccount, account),
			Layer.succeed(DocumentLive, live),
			countedHttp,
		)
		let libraryContext = yield* Layer.build(
			BrowserLibrary.layer.pipe(
				Layer.provideMerge(
					LocalDirectories.layer.pipe(Layer.provideMerge(base)),
				),
			),
		).pipe(Effect.provideService(Scope.Scope, scope))
		let library = Context.get(libraryContext, BrowserLibrary)
		if (navigator.onLine) yield* library.refresh
		let document = sessionStorage.getItem("sync-document")
		if (!document) {
			yield* Effect.promise(() =>
				fetch("/test/shared", { method: "POST", body: account.subject }).then(
					response => {
						if (!response.ok) throw new Error("Shared fixture setup failed")
					},
				),
			)
			document = "sync-proof"
			sessionStorage.setItem("sync-document", document)
			yield* library.refresh
		}

		yield* library.state.changes.pipe(
			Stream.map(state => state.library),
			Stream.changesWith((previous, current) => previous === current),
			Stream.runForEach(() => Effect.sync(() => counts.catalogueChanges++)),
			Effect.forkIn(scope),
		)

		let documentScope = yield* Scope.make()
		yield* Scope.addFinalizer(scope, Scope.close(documentScope, Exit.void))
		let opened = yield* library
			.open(document)
			.pipe(Effect.provideService(Scope.Scope, documentScope))
		let local = Context.get(
			yield* Layer.build(
				LocalDocuments.layer(account.subject).pipe(
					Layer.provide(Layer.succeed(BrowserStorage, counted)),
				),
			).pipe(Effect.provideService(Scope.Scope, scope)),
			LocalDocuments,
		)
		let inputFiber: Fiber.Fiber<void, never> | undefined
		yield* opened.connection.synchronize
		function run<A, E>(effect: Effect.Effect<A, E>) {
			return Effect.runPromise(effect)
		}
		window.librarySync = {
			startInput() {
				return run(
					Effect.gen(function* () {
						if (inputFiber) throw Error("Input activity already active")
						inputFiber = yield* Effect.forever(
							Effect.sync(() =>
								globalThis.document.dispatchEvent(new Event("keydown")),
							).pipe(Effect.andThen(Effect.sleep("50 millis"))),
						).pipe(Effect.forkIn(scope))
					}),
				).then(() => {})
			},
			stopInput() {
				let fiber = inputFiber
				inputFiber = undefined
				return fiber
					? run(Fiber.interrupt(fiber)).then(() => {})
					: Promise.resolve()
			},
			releaseDocument() {
				return run(Scope.close(documentScope, Exit.void))
			},
			reopenDocument() {
				return run(
					Effect.gen(function* () {
						documentScope = yield* Scope.make()
						yield* Scope.addFinalizer(
							scope,
							Scope.close(documentScope, Exit.void),
						)
						opened = yield* library
							.open(document)
							.pipe(Effect.provideService(Scope.Scope, documentScope))
					}),
				).then(() => {})
			},
			rows() {
				return run(local.rows)
			},
			refresh: () => run(library.refresh),
			snapshotCacheFault(value) {
				failDocumentSummary = value
			},
			snapshotFailure: () =>
				opened.session.failures.current().snapshot?.message,
			cacheFault(value) {
				failCache = value
			},
			state() {
				let { refresh, message, cacheFailure } = library.state.current()
				return { refresh, message, cacheFailure }
			},
			catalogueTitle: () =>
				library.state
					.current()
					.library.documents.find(row => row.document === document)?.metadata
					.title,
			workspaceName: () =>
				library.state
					.current()
					.library.workspaces.find(space => space.workspace === "sync-space")
					?.name,
			roles: () =>
				library.state
					.current()
					.library.documents.map(document => document.role),
			counts,
			reset() {
				counts.pulls = 0
				counts.projections = 0
				counts.catalogues = 0
				counts.catalogueChanges = 0
				counts.projectionWrites = 0
			},
			source: () => opened.session.replica.text(document),
			status: () => opened.connection.current().status,
			pending: () => opened.session.pending().length,
			retry() {
				return run(opened.connection.retry)
			},
			edit(text) {
				return run(opened.session.edit(text).saved).then(() => {})
			},
			sync() {
				return run(opened.connection.synchronize)
			},
			startSync() {
				return run(Effect.forkIn(opened.connection.synchronize, scope)).then(
					() => {},
				)
			},
			reconnect() {
				return run(
					PubSub.publish(messages, { type: "connected", actor: "probe" }),
				).then(() => {})
			},
			close() {
				return run(Scope.close(scope, Exit.void))
			},
		}
	}),
).catch(error => {
	window.librarySyncFailure = String(error)
})
