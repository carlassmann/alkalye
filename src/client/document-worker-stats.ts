import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import { documentStatsEffect } from "../shared/document-stats"
import type { DocumentStats } from "../shared/document-stats"
import { createDocumentWorker } from "./document-worker-client"

export interface DerivedDocumentStats {
	revision: number
	counts: DocumentStats
}
export function makeDocumentWorkerStats(
	publish: (result: DerivedDocumentStats) => void,
	url = new URL("/document-worker.js", location.origin).href,
) {
	return Effect.gen(function* () {
		let updates = yield* Queue.make<{ revision: number; source: string }>({
			capacity: 1,
			strategy: "sliding",
		})
		let owner = yield* Scope.Scope
		let workerScope = yield* Scope.fork(owner)
		let worker = yield* createDocumentWorker(url).pipe(
			Effect.provideService(Scope.Scope, workerScope),
			Effect.option,
		)
		let source: string | undefined
		let revision = -1
		yield* Stream.fromQueue(updates).pipe(
			Stream.runForEach(input =>
				Effect.gen(function* () {
					let result: DerivedDocumentStats
					if (worker._tag === "None") {
						result = {
							revision: input.revision,
							counts: yield* fallbackCounts(input.source),
						}
					} else {
						let client = worker.value
						result = yield* (
							source === undefined
								? client.Reset(input)
								: client
										.Replace({
											baseRevision: revision,
											revision: input.revision,
											...(yield* replacement(source, input.source)),
										})
										.pipe(Effect.catch(() => client.Reset(input)))
						).pipe(
							Effect.timeout("1 second"),
							Effect.catch(() =>
								Effect.gen(function* () {
									worker = Option.none()
									yield* Scope.close(workerScope, Exit.void)
									return {
										revision: input.revision,
										counts: yield* fallbackCounts(input.source),
									}
								}),
							),
						)
					}
					source = input.source
					revision = input.revision
					yield* Effect.sync(() => publish(result))
				}),
			),
			Effect.forkScoped({ startImmediately: true }),
		)
		return {
			update: (revision: number, source: string) =>
				Queue.offerUnsafe(updates, { revision, source }),
		}
	})
}
function replacement(before: string, after: string) {
	return Effect.gen(function* () {
		let start = 0
		let chunks = 0
		let deadline = (yield* Clock.currentTimeMillis) + 1
		while (start < before.length && start < after.length) {
			let limit = Math.min(before.length, after.length, start + 32768)
			while (
				start < limit &&
				before.charCodeAt(start) === after.charCodeAt(start)
			)
				start++
			if (start < limit) break
			let now = yield* Clock.currentTimeMillis
			if (now >= deadline || ++chunks === 4) {
				yield* Effect.yieldNow
				chunks = 0
				deadline = (yield* Clock.currentTimeMillis) + 1
			}
		}
		let end = before.length,
			insertEnd = after.length
		while (end > start && insertEnd > start) {
			let limit = Math.max(start, end - 32768, end - (insertEnd - start))
			while (
				end > limit &&
				before.charCodeAt(end - 1) === after.charCodeAt(insertEnd - 1)
			) {
				end--
				insertEnd--
			}
			if (end > limit) break
			let now = yield* Clock.currentTimeMillis
			if (now >= deadline || ++chunks === 4) {
				yield* Effect.yieldNow
				chunks = 0
				deadline = (yield* Clock.currentTimeMillis) + 1
			}
		}
		return { start, end, insert: after.slice(start, insertEnd) }
	})
}

function fallbackCounts(source: string) {
	return Effect.yieldNow.pipe(Effect.andThen(documentStatsEffect(source)))
}
