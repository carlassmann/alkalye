import * as HttpClient from "effect/http/HttpClient"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberSet from "effect/FiberSet"
import * as Scope from "effect/Scope"

export type Task = Effect.Effect<
	unknown,
	unknown,
	HttpClient.HttpClient | Scope.Scope
>
export class TaskGroup {
	private constructor(
		readonly scope: Scope.Closeable,
		readonly fork: <A, E>(
			work: Effect.Effect<A, E, HttpClient.HttpClient | Scope.Scope>,
			options?: Effect.RunOptions,
		) => import("effect").Fiber.Fiber<A, E>,
		private promise: <A, E>(
			work: Effect.Effect<A, E, HttpClient.HttpClient | Scope.Scope>,
			options?: Effect.RunOptions,
		) => Promise<A>,
	) {}
	static make = Effect.gen(function* () {
		let parent = yield* Scope.Scope
		let scope = yield* Scope.fork(parent, "parallel")
		let fibers = yield* FiberSet.make().pipe(
			Effect.provideService(Scope.Scope, scope),
		)
		let fork = yield* FiberSet.runtime(fibers)<
			HttpClient.HttpClient | Scope.Scope
		>().pipe(Effect.provideService(Scope.Scope, scope))
		let promise = yield* FiberSet.runtimePromise(fibers)<
			HttpClient.HttpClient | Scope.Scope
		>().pipe(Effect.provideService(Scope.Scope, scope))
		return new TaskGroup(scope, fork, promise)
	})
	async run<A, E>(
		work: Effect.Effect<A, E, HttpClient.HttpClient | Scope.Scope>,
		signal?: AbortSignal,
	) {
		let exit = await this.promise(Effect.exit(work), { signal })
		if (Exit.isSuccess(exit)) return exit.value
		throw Cause.squash(exit.cause)
	}
	close() {
		return Scope.close(this.scope, Exit.void)
	}
}
