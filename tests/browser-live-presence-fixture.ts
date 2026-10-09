import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { BrowserAccount } from "../src/client/browser-account"
import { DocumentLive } from "../src/client/document-live"
import { BrowserStorage, Storage } from "../src/client/storage"

interface PresenceProbe {
	changes: number
	messages: number
	connected(): boolean
	peers(): ReadonlyArray<{ actor: string; time: number }>
	advance(milliseconds: number): Promise<void>
	watch(): Promise<void>
	unwatch(): Promise<void>
	close(): Promise<void>
}
declare global {
	interface Window {
		presenceProbe?: PresenceProbe
		presenceFailure?: string
	}
}
Effect.runPromise(
	Effect.gen(function* () {
		let scope = yield* Scope.make()
		let storage = yield* Effect.acquireRelease(Storage.open(), storage =>
			Effect.sync(() => storage.close()),
		).pipe(Effect.provideService(Scope.Scope, scope))
		let accountContext = yield* Layer.build(
			BrowserAccount.layer(location.origin).pipe(
				Layer.provide(Layer.succeed(BrowserStorage, storage)),
				Layer.provide(FetchHttpClient.layer),
			),
		).pipe(Effect.provideService(Scope.Scope, scope))
		let account = Context.get(accountContext, BrowserAccount)
		yield* TestClock.withLive(account.connect)
		yield* TestClock.setTime(Date.now())
		let liveContext = yield* Layer.build(
			DocumentLive.layer.pipe(
				Layer.provide(Layer.succeed(BrowserAccount, account)),
			),
		).pipe(Effect.provideService(Scope.Scope, scope))
		let context = Context.merge(yield* Effect.context(), liveContext)
		let live = Context.get(liveContext, DocumentLive)
		let watchScope: Scope.Closeable | undefined
		let probe: PresenceProbe = {
			changes: 0,
			messages: 0,
			connected: live.connected,
			peers: () => live.presence.current("presence-doc"),
			advance: milliseconds =>
				Effect.runPromise(
					TestClock.adjust(milliseconds).pipe(Effect.provideContext(context)),
				),
			watch: () =>
				Effect.runPromise(
					Effect.gen(function* () {
						if (watchScope) return
						watchScope = yield* Scope.make()
						yield* live
							.watch("presence-doc")
							.pipe(Effect.provideService(Scope.Scope, watchScope))
					}).pipe(Effect.provideContext(context)),
				),
			unwatch: () =>
				Effect.runPromise(
					Effect.suspend(() => {
						let current = watchScope
						watchScope = undefined
						return current ? Scope.close(current, Exit.void) : Effect.void
					}).pipe(Effect.provideContext(context)),
				),
			close: () =>
				Effect.runPromise(
					Scope.close(scope, Exit.void).pipe(Effect.provideContext(context)),
				),
		}
		yield* live.presence.changes.pipe(
			Stream.runForEach(() => Effect.sync(() => probe.changes++)),
			Effect.forkScoped({ startImmediately: true }),
			Effect.provideService(Scope.Scope, scope),
		)
		yield* live.changes.pipe(
			Stream.runForEach(() => Effect.sync(() => probe.messages++)),
			Effect.forkScoped({ startImmediately: true }),
			Effect.provideService(Scope.Scope, scope),
		)
		window.presenceProbe = probe
	}).pipe(Effect.provide(TestClock.layer())),
).catch(error => {
	window.presenceFailure = String(error)
})
