import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as RpcClient from "effect/rpc/RpcClient"
import * as Workers from "effect/workers/Worker"
import { WorkerError, WorkerReceiveError } from "effect/workers/WorkerError"
import { DocumentDerivationsRpc } from "./document-worker-rpc"

let platform = Workers.makePlatform<Worker>()({
	setup({ worker, scope }) {
		return Scope.addFinalizer(
			scope,
			Effect.sync(() => worker.terminate()),
		).pipe(Effect.as(worker))
	},
	listen({ port, emit, deferred, scope }) {
		function message(event: MessageEvent<unknown>) {
			let data = event.data
			emit(data)
		}
		function error(event: ErrorEvent) {
			failed(event.message)
		}
		function messageError() {
			failed("Worker response could not be decoded")
		}
		function failed(message: string) {
			Effect.runFork(
				Deferred.fail(
					deferred,
					new WorkerError({
						reason: new WorkerReceiveError({ message }),
					}),
				),
			)
		}
		port.addEventListener("message", message)
		port.addEventListener("error", error)
		port.addEventListener("messageerror", messageError)
		return Scope.addFinalizer(
			scope,
			Effect.sync(() => {
				port.removeEventListener("message", message)
				port.removeEventListener("error", error)
				port.removeEventListener("messageerror", messageError)
			}),
		)
	},
})
export function createDocumentWorker(url: string) {
	return Effect.gen(function* () {
		let scope = yield* Scope.Scope
		let context = yield* Layer.buildWithScope(
			RpcClient.layerProtocolWorker({ size: 1, concurrency: 1 }).pipe(
				Layer.provide(Layer.succeed(Workers.WorkerPlatform, platform)),
				Layer.provide(
					Workers.layerSpawner(() => new Worker(url, { type: "module" })),
				),
			),
			scope,
		)
		return yield* RpcClient.make(DocumentDerivationsRpc).pipe(
			Effect.provideContext(context),
		)
	})
}
