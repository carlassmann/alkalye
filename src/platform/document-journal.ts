import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as EventJournal from "effect/eventlog/EventJournal"

export interface DocumentJournalStorage {
	journal: EventJournal.EventJournal["Service"]
	readAfter(
		position: number,
		limit?: number,
		through?: number,
	): Effect.Effect<
		{
			position: number
			entries: ReadonlyArray<EventJournal.Entry>
		},
		EventJournal.EventJournalError
	>
	entry(
		id: string,
	): Effect.Effect<
		EventJournal.Entry | undefined,
		EventJournal.EventJournalError
	>
	containsPosition(
		position: number,
	): Effect.Effect<boolean, EventJournal.EventJournalError>
	cache: Effect.Effect<
		{ position: number; value: unknown } | undefined,
		EventJournal.EventJournalError
	>
	saveCache(
		position: number,
		value: unknown,
	): Effect.Effect<boolean, EventJournal.EventJournalError>
}
export class DocumentJournal extends Context.Service<
	DocumentJournal,
	DocumentJournalStorage
>()("alkalye/DocumentJournal") {}
