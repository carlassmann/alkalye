import * as Effect from "effect/Effect"
import * as FiberSet from "effect/FiberSet"
import * as Layer from "effect/Layer"
import * as RpcServer from "effect/rpc/RpcServer"
import * as WorkerRunner from "effect/workers/WorkerRunner"
import { documentStats } from "../shared/document-stats"
import { DocumentDerivationsRpc } from "./document-worker-rpc"

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
let handlers = DocumentDerivationsRpc.toLayer(
	Effect.sync(() => {
		let source = ""
		let revision = -1
		return DocumentDerivationsRpc.of({
			Reset: input =>
				Effect.sync(() => {
					source = input.source
					revision = input.revision
					return { revision, counts: documentStats(source) }
				}),
			Replace: input =>
				Effect.gen(function* () {
					if (input.baseRevision !== revision || input.revision <= revision)
						return yield* Effect.fail<"Revision unavailable">(
							"Revision unavailable",
						)
					if (input.start > input.end || input.end > source.length)
						return yield* Effect.fail<"Replacement outside document">(
							"Replacement outside document",
						)
					source =
						source.slice(0, input.start) +
						input.insert +
						source.slice(input.end)
					revision = input.revision
					return { revision, counts: documentStats(source) }
				}),
		})
	}),
)
Effect.runFork(
	Layer.launch(
		RpcServer.layer(DocumentDerivationsRpc).pipe(
			Layer.provide(handlers),
			Layer.provide(RpcServer.layerProtocolWorkerRunner),
			Layer.provide(runner),
		),
	),
)
