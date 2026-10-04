import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberMap from "effect/FiberMap"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Context from "effect/Context"
import type { DocumentMedia, ResolvedDocumentMedia } from "./document-media"
import { documentFailure } from "./document-failures"

interface MediaViewOptions {
	media: Pick<
		Context.Service.Shape<typeof DocumentMedia>,
		"acquire" | "references" | "changes"
	>
	source(): string
	changed(): void
	clear(): void
	report(error: unknown): void
}
export function makeDocumentMediaView(options: MediaViewOptions) {
	return Effect.gen(function* () {
		let visible = yield* SubscriptionRef.make(false)
		let source = yield* SubscriptionRef.make(options.source())
		let retries = yield* SubscriptionRef.make(0)
		let current = yield* Ref.make<ResolvedDocumentMedia>(empty())
		yield* SubscriptionRef.changes(visible).pipe(
			Stream.changes,
			Stream.switchMap(show =>
				Stream.fromEffect(show ? Effect.scoped(view()) : Effect.void),
			),
			Stream.runDrain,
			Effect.forkScoped({ startImmediately: true }),
		)
		return Object.freeze({
			current: () => Ref.getUnsafe(current),
			visible(value: boolean) {
				Effect.runSync(SubscriptionRef.set(visible, value))
			},
			refresh() {
				Effect.runSync(SubscriptionRef.set(source, options.source()))
			},
			retry() {
				Effect.runSync(SubscriptionRef.update(retries, count => count + 1))
			},
		})

		function view() {
			return Effect.gen(function* () {
				let leases = yield* FiberMap.make<string, never, never>()
				let committing = yield* Semaphore.make(1)
				let results = new Map<string, Exit.Exit<string | undefined, unknown>>()
				let desired: [string, string][] = []
				let retry = SubscriptionRef.getUnsafe(retries)
				let available = yield* SubscriptionRef.make(0)
				yield* Effect.addFinalizer(() =>
					Ref.set(current, empty()).pipe(
						Effect.andThen(Effect.sync(options.clear)),
						Effect.andThen(Effect.sync(options.changed)),
						Effect.catchCause(report),
					),
				)
				yield* Stream.mergeAll(
					[
						options.media.changes.pipe(Stream.map(() => undefined)),
						SubscriptionRef.changes(source).pipe(
							Stream.changes,
							Stream.map(() => undefined),
						),
						SubscriptionRef.changes(retries).pipe(
							Stream.changes,
							Stream.map(() => undefined),
						),
						SubscriptionRef.changes(available).pipe(
							Stream.map(() => undefined),
						),
					],
					{ concurrency: "unbounded" },
				).pipe(
					Stream.runForEach(() =>
						committing.withPermit(reconcile()).pipe(Effect.catchCause(report)),
					),
				)

				function reconcile() {
					return Effect.uninterruptible(
						Effect.gen(function* () {
							desired = options.media.references(
								SubscriptionRef.getUnsafe(source),
							)
							let requestedRetry = SubscriptionRef.getUnsafe(retries)
							if (requestedRetry !== retry) {
								retry = requestedRetry
								for (let [reference, result] of results) {
									if (Exit.isFailure(result)) {
										yield* FiberMap.remove(leases, reference)
										results.delete(reference)
									}
								}
							}
							for (let reference of new Set(
								desired.map(([, reference]) => reference),
							))
								yield* FiberMap.run(leases, reference, acquire(reference), {
									onlyIfMissing: true,
									startImmediately: false,
								})
							yield* commit()
						}),
					)
				}
				function acquire(reference: string) {
					return Effect.scoped(
						Effect.gen(function* () {
							let parent = yield* Scope.Scope
							let scope = yield* Scope.fork(parent, "sequential")
							let result = yield* options.media.acquire(reference).pipe(
								Effect.provideService(Scope.Scope, scope),
								Effect.onError(cause =>
									Scope.close(scope, Exit.failCause(cause)),
								),
								Effect.exit,
							)
							yield* committing
								.withPermit(
									Effect.uninterruptible(
										Effect.gen(function* () {
											results.set(reference, result)
											yield* SubscriptionRef.update(
												available,
												count => count + 1,
											)
										}),
									),
								)
								.pipe(Effect.catchCause(report))
							yield* Effect.never
						}),
					).pipe(Effect.catchCause(report), Effect.andThen(Effect.never))
				}
				function commit() {
					return Effect.gen(function* () {
						let resolution = empty()
						for (let [id, reference] of desired) {
							let result = results.get(reference)
							if (result && Exit.isSuccess(result) && result.value)
								resolution.urls.set(id, result.value)
							else if (result && Exit.isFailure(result))
								resolution.failures.set(
									id,
									documentFailure(
										"load attachment",
										Cause.squash(result.cause),
									),
								)
						}
						yield* Ref.set(current, resolution)
						yield* Effect.try(options.changed)
						let references = new Set(desired.map(([, reference]) => reference))
						for (let [reference] of [...leases]) {
							if (!references.has(reference)) {
								yield* FiberMap.remove(leases, reference)
								results.delete(reference)
							}
						}
					})
				}
			}).pipe(Effect.catchCause(report))
		}
		function report(cause: Cause.Cause<unknown>) {
			return Cause.hasFails(cause) || Cause.hasDies(cause)
				? Effect.sync(() => options.report(Cause.squash(cause)))
				: Effect.void
		}
	})
}
function empty(): ResolvedDocumentMedia {
	return { urls: new Map(), failures: new Map() }
}
