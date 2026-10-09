import { TestClock } from "effect/testing"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { expect, test } from "bun:test"
import * as Cause from "effect/Cause"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Logger from "effect/Logger"
import { startOAuthMaintenance } from "../src/server/oauth-maintenance"
import * as Scope from "effect/Scope"
import { cancelOnSignal } from "../src/client/cancellation"
import { fetchResponse } from "../src/platform/http"
import { TaskGroup } from "../src/platform/tasks"
import { makeSaveFeedback } from "../src/shared/save-status"
import { RelaySettings } from "../src/server/settings"
import { bunSettingsLayer } from "../src/server/bun-settings"

test("closing a task group interrupts active callbacks and runs each finalizer once", async () => {
	let releases: string[] = []
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let tasks = yield* TaskGroup.make
				let started = yield* Deferred.make<void>()
				let fiber = tasks.fork(
					Effect.acquireUseRelease(
						Effect.succeed("socket"),
						() =>
							Deferred.succeed(started, undefined).pipe(
								Effect.andThen(Effect.never),
							),
						resource =>
							Effect.sync(() => {
								releases.push(resource)
							}),
					),
				)
				yield* Deferred.await(started)
				yield* tasks.close()
				let exit = yield* Fiber.await(fiber)
				expect(Exit.isFailure(exit)).toBe(true)
				yield* tasks.close()
			}),
		).pipe(Effect.provide(FetchHttpClient.layer)),
	)
	expect(releases).toEqual(["socket"])
})

test("parent scope closure releases nested task groups and rejects later callbacks", async () => {
	let scope = await Effect.runPromise(Scope.make())
	let tasks = await Effect.runPromise(
		TaskGroup.make.pipe(
			Effect.provideService(Scope.Scope, scope),
			Effect.provide(FetchHttpClient.layer),
		),
	)
	let finalized = false
	let started = await Effect.runPromise(Deferred.make<void>())
	let pending = tasks.run(
		Deferred.succeed(started, undefined).pipe(
			Effect.andThen(Effect.never),
			Effect.ensuring(
				Effect.sync(() => {
					finalized = true
				}),
			),
		),
	)
	let outcome = pending.then(
		() => false,
		() => true,
	)
	await Effect.runPromise(Deferred.await(started))
	await Effect.runPromise(Scope.close(scope, Exit.void))
	expect(await outcome).toBe(true)
	expect(finalized).toBe(true)
	await expect(tasks.run(Effect.succeed("late"))).rejects.toThrow()
})

test("abort interrupts a scoped operation and releases resources before returning", async () => {
	let controller = new AbortController()
	let released = false
	let started = await Effect.runPromise(Deferred.make<void>())
	let work = Effect.acquireUseRelease(
		Effect.void,
		() =>
			Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
		() =>
			Effect.sync(() => {
				released = true
			}),
	)
	let fiber = Effect.runFork(cancelOnSignal(work, controller.signal))
	await Effect.runPromise(Deferred.await(started))
	controller.abort()
	let exit = await Effect.runPromise(Fiber.await(fiber))
	expect(Exit.isFailure(exit)).toBe(true)
	expect(released).toBe(true)
})

test("an already aborted signal performs no work", async () => {
	let touched = false
	let exit = await Effect.runPromiseExit(
		cancelOnSignal(
			Effect.sync(() => {
				touched = true
			}),
			AbortSignal.abort(),
		),
	)
	expect(Exit.isFailure(exit)).toBe(true)
	expect(touched).toBe(false)
})

test("Effect HTTP transport exposes typed faults and injectable native fetch", async () => {
	let failure = new Error("Disconnected")
	let result = await Effect.runPromise(
		fetchResponse("https://relay.example/packets").pipe(
			Effect.catchTag("HttpClientError", error => Effect.succeed(error)),
			Effect.provide(FetchHttpClient.layer),
			Effect.provideService(
				FetchHttpClient.Fetch,
				nativeFetch(() => Promise.reject(failure)),
			),
		),
	)
	expect("reason" in result && result.reason._tag).toBe("TransportError")
	let body = await Effect.runPromise(
		fetchResponse("https://relay.example/packets").pipe(
			Effect.flatMap(response => response.text),
			Effect.provide(FetchHttpClient.layer),
			Effect.provideService(
				FetchHttpClient.Fetch,
				nativeFetch(() => Promise.resolve(new Response("cached"))),
			),
		),
	)
	expect(body).toBe("cached")
})

test("interrupting an Effect HTTP request aborts the native transport", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let started = yield* Deferred.make<void>()
				let aborted = false
				let pending = yield* Effect.forkScoped(
					fetchResponse("https://relay.example/slow").pipe(
						Effect.provide(FetchHttpClient.layer),
						Effect.provideService(
							FetchHttpClient.Fetch,
							nativeFetch(
								(_input, options) =>
									new Promise((_resolve, reject) => {
										options?.signal?.addEventListener(
											"abort",
											() => {
												aborted = true
												reject(new Error("Aborted"))
											},
											{ once: true },
										)
										Deferred.doneUnsafe(started, Effect.void)
									}),
							),
						),
					),
				)
				yield* Deferred.await(started)
				yield* Fiber.interrupt(pending)
				expect(aborted).toBe(true)
			}),
		),
	)
})

test("Effect config rejects invalid ports and origins before server startup", async () => {
	for (let values of [
		{ PORT: "invalid" },
		{ PORT: "65536" },
		{ PUBLIC_ORIGIN: "not a URL" },
	]) {
		let result = await Effect.runPromise(
			RelaySettings.pipe(
				Effect.provide(bunSettingsLayer()),
				Effect.provideService(
					ConfigProvider.ConfigProvider,
					ConfigProvider.fromUnknown(values),
				),
				Effect.exit,
			),
		)
		expect(Exit.isFailure(result)).toBe(true)
	}
	let settings = await Effect.runPromise(
		RelaySettings.pipe(
			Effect.provide(bunSettingsLayer({ port: 0, build: false })),
			Effect.provideService(
				ConfigProvider.ConfigProvider,
				ConfigProvider.fromUnknown({
					PUBLIC_ORIGIN: "https://alkalye.example/app",
					ALKALYE_RESET_LOG: "1",
				}),
			),
		),
	)
	expect(settings.port).toBe(0)
	expect(settings.publicOrigin).toBe("https://alkalye.example")
	expect(settings.resetLog).toBe(true)
	expect(settings.development).toBe(true)
	let production = await Effect.runPromise(
		RelaySettings.pipe(
			Effect.provide(bunSettingsLayer({ build: false })),
			Effect.provideService(
				ConfigProvider.ConfigProvider,
				ConfigProvider.fromUnknown({ NODE_ENV: "production" }),
			),
		),
	)
	expect(production.development).toBe(false)
})

test("native callback runners give acquired resources their own task scope", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let tasks = yield* TaskGroup.make
				let released = false
				yield* Effect.promise(() =>
					tasks.run(
						Effect.acquireRelease(Effect.void, () =>
							Effect.sync(() => {
								released = true
							}),
						),
					),
				)
				expect(released).toBe(false)
				yield* tasks.close()
				expect(released).toBe(true)
			}),
		).pipe(Effect.provide(FetchHttpClient.layer)),
	)
})

test("OAuth maintenance survives startup and scheduled failures and stops with its scope", async () => {
	let sweeps = 0
	let logs = 0
	let cleanup = Effect.suspend(() => {
		sweeps++
		return sweeps <= 2
			? Effect.fail(new Error("Temporary storage failure"))
			: Effect.void
	})
	let logger = Logger.make(() => {
		logs++
	})
	await Effect.runPromise(
		Effect.gen(function* () {
			let fiber = yield* Effect.scoped(
				Effect.gen(function* () {
					let fiber = yield* startOAuthMaintenance(cleanup)
					expect(sweeps).toBe(1)
					yield* TestClock.adjust("59 minutes")
					expect(sweeps).toBe(1)
					yield* TestClock.adjust("1 minute")
					expect(sweeps).toBe(2)
					yield* TestClock.adjust("1 hour")
					expect(sweeps).toBe(3)
					expect(logs).toBe(2)
					return fiber
				}),
			)
			let exit = yield* Fiber.await(fiber)
			expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
				true,
			)
			yield* TestClock.adjust("2 hours")
			expect(sweeps).toBe(3)
		}).pipe(
			Effect.provide(Logger.layer([logger])),
			Effect.provide(TestClock.layer()),
		),
	)
})

function nativeFetch(
	work: (
		input: Parameters<typeof fetch>[0],
		options?: Parameters<typeof fetch>[1],
	) => Promise<Response>,
): typeof fetch {
	return Object.assign(work, { preconnect: fetch.preconnect })
}

test("save feedback coalesces rapid writes, reports failures immediately, and releases timers", async () => {
	let rendered: string[] = []
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* Effect.scoped(
				Effect.gen(function* () {
					let feedback = yield* makeSaveFeedback(value =>
						rendered.push(value.text),
					)
					yield* feedback.update("one", { text: "Saving…", state: "busy" })
					yield* TestClock.adjust("400 millis")
					yield* feedback.update("one", { text: "Saved", state: "quiet" })
					yield* TestClock.adjust("400 millis")
					expect(rendered).toEqual(["Saved"])
					yield* feedback.update("one", { text: "Saving…", state: "busy" })
					yield* TestClock.adjust("800 millis")
					expect(rendered.at(-1)).toBe("Saving…")
					yield* feedback.update("one", { text: "Saved", state: "quiet" })
					yield* TestClock.adjust("500 millis")
					expect(rendered.at(-1)).toBe("Saving…")
					yield* feedback.update("one", { text: "Failed", state: "error" })
					yield* Effect.yieldNow
					expect(rendered.at(-1)).toBe("Failed")
					yield* feedback.update("two", {
						text: "Saving next document",
						state: "busy",
					})
					expect(rendered.at(-1)).toBe("Saved")
				}),
			)
			let count = rendered.length
			yield* TestClock.adjust("10 seconds")
			expect(rendered.length).toBe(count)
		}).pipe(Effect.provide(TestClock.layer())),
	)
})
