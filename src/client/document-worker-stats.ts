import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import { documentStats } from "../shared/document-stats"
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
							counts: yield* idleCounts(input.source),
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
											...replacement(source, input.source),
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
										counts: yield* idleCounts(input.source),
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
	let start = 0
	while (
		start < before.length &&
		start < after.length &&
		before.charCodeAt(start) === after.charCodeAt(start)
	)
		start++
	let end = before.length,
		insertEnd = after.length
	while (
		end > start &&
		insertEnd > start &&
		before.charCodeAt(end - 1) === after.charCodeAt(insertEnd - 1)
	) {
		end--
		insertEnd--
	}
	return { start, end, insert: after.slice(start, insertEnd) }
}

function idleCounts(source: string) {
	return Effect.callback<DocumentStats>(resume => {
		if (typeof requestIdleCallback !== "undefined") {
			let id = requestIdleCallback(
				() => resume(Effect.succeed(documentStats(source))),
				{ timeout: 250 },
			)
			return Effect.sync(() => cancelIdleCallback(id))
		}
		let id = setTimeout(() => resume(Effect.succeed(documentStats(source))), 0)
		return Effect.sync(() => clearTimeout(id))
	})
}
