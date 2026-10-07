import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Scheduler from "effect/Scheduler"
import { browserBackgroundWorkLayer } from "./background-work"

let nativeSchedulerLayer = Layer.effect(
	Scheduler.Scheduler,
	Effect.gen(function* () {
		let callbacks = new Map<number, () => void>()
		let sequence = 0
		let closed = false
		function dispatch(id: number) {
			let callback = callbacks.get(id)
			callbacks.delete(id)
			callback?.()
		}
		let channel = yield* Effect.acquireRelease(
			Effect.sync(() => new MessageChannel()),
			channel =>
				Effect.sync(() => {
					closed = true
					channel.port1.onmessage = null
					channel.port1.close()
					channel.port2.close()
					for (let id of callbacks.keys()) setTimeout(() => dispatch(id), 0)
				}),
		)
		channel.port1.onmessage = (event: MessageEvent<unknown>) => {
			if (typeof event.data !== "number") return
			dispatch(event.data)
		}
		// Native tasks avoid the browser's delay on repeatedly nested timers.
		return new Scheduler.MixedScheduler("async", task => {
			if (closed) {
				let timer = setTimeout(task, 0)
				return () => clearTimeout(timer)
			}
			let id = ++sequence
			callbacks.set(id, task)
			channel.port2.postMessage(id)
			return () => callbacks.delete(id)
		})
	}),
)

export let browserSchedulerLayer = Layer.merge(
	nativeSchedulerLayer,
	browserBackgroundWorkLayer,
)
