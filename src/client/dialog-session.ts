import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberSet from "effect/FiberSet"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import type * as HttpClient from "effect/http/HttpClient"
import type { Task } from "../platform/tasks"

export function openDialogSession(
	dialog: HTMLDialogElement,
	report: (error: unknown) => void,
) {
	return Effect.gen(function* () {
		let parent = yield* Scope.Scope
		let scope = yield* Scope.fork(parent, "parallel")
		return yield* Effect.gen(function* () {
			let form = dialog.querySelector("form")
			let serial = yield* Semaphore.make(1)
			let fork = yield* FiberSet.makeRuntime<
				HttpClient.HttpClient | Scope.Scope
			>()
			function close() {
				Effect.runFork(Scope.close(scope, Exit.void))
			}
			let observer = new MutationObserver(() => {
				if (!form?.isConnected) close()
			})
			observer.observe(dialog, { childList: true })
			function closed() {
				if (!dialog.open || !form?.isConnected) close()
			}
			dialog.addEventListener("close", closed)
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					observer.disconnect()
					dialog.removeEventListener("close", closed)
				}),
			)
			function run(work: Task) {
				return fork(
					work.pipe(
						Effect.catchCause(cause =>
							Effect.sync(() => {
								if (!Cause.hasInterrupts(cause)) report(Cause.squash(cause))
							}),
						),
					),
				)
			}
			return {
				run,
				serial(work: Task) {
					return run(serial.withPermit(work))
				},
			}
		}).pipe(Effect.provideService(Scope.Scope, scope))
	})
}
