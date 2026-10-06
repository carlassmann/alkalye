import * as Cache from "effect/Cache"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Semaphore from "effect/Semaphore"
import type { PassiveDocumentState } from "../shared/document-session"

export function makePassiveDocumentCache() {
	return Effect.gen(function* () {
		let writes = yield* Semaphore.make(1)
		let states = yield* Cache.make({
			lookup: (_document: string) =>
				Effect.succeed<PassiveDocumentState | undefined>(undefined),
			capacity: 2,
			timeToLive: "30 seconds",
		})
		return (document: string) => ({
			read: Cache.get(states, document),
			write: (state: PassiveDocumentState) =>
				writes.withPermit(
					Effect.gen(function* () {
						let previous = Option.getOrUndefined(
							yield* Cache.getOption(states, document),
						)
						if (!previous || previous.position <= state.position)
							yield* Cache.set(states, document, state)
					}),
				),
			clear: Cache.invalidate(states, document),
		})
	})
}
