import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as SqlEventJournal from "effect/eventlog/SqlEventJournal"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Migrator from "effect/sql/Migrator"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlSchema from "effect/sql/SqlSchema"
import { DocumentJournal } from "./document-journal"
import { sqliteLayer } from "./sqlite"

export function sqliteJournalLayer(filename: string) {
	return Layer.effect(EventJournal.EventJournal)(
		DocumentJournal.use(storage => Effect.succeed(storage.journal)),
	).pipe(
		Layer.provideMerge(Layer.effect(DocumentJournal, makeJournal(filename))),
		Layer.provide(sqliteLayer(filename)),
	)
}
let positionSchema = Schema.Natural.check(
	Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
let entryRow = Schema.Struct({
	id: EventJournal.EntryId,
	event: Schema.String,
	primary_key: Schema.String,
	payload: Schema.Uint8Array,
})
let equalEntry = Schema.toEquivalence(EventJournal.Entry)

function makeJournal(filename: string) {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		let base = yield* SqlEventJournal.make()
		yield* Migrator.make({})({
			table: "document_journal_migrations",
			loader: Migrator.fromRecord({
				"001_document_journal": Effect.gen(function* () {
					yield* sql`CREATE TABLE IF NOT EXISTS document_positions(position INTEGER PRIMARY KEY AUTOINCREMENT,entry BLOB NOT NULL UNIQUE)`
					yield* sql`CREATE TABLE IF NOT EXISTS document_cache(id INTEGER PRIMARY KEY CHECK(id=1),position INTEGER NOT NULL,value TEXT NOT NULL)`
					yield* sql`INSERT INTO document_positions(entry) SELECT j.id FROM effect_event_journal j WHERE NOT EXISTS (SELECT 1 FROM document_positions p WHERE p.entry=j.id) ORDER BY j.timestamp,j.id`
					yield* sql`CREATE TRIGGER IF NOT EXISTS document_position_insert AFTER INSERT ON effect_event_journal BEGIN INSERT INTO document_positions(entry) VALUES (NEW.id); END`
				}),
			}),
		})
		let reader =
			filename === ":memory:"
				? sql
				: Context.get(
						yield* Layer.build(sqliteLayer(filename, { readonly: true })),
						SqlClient.SqlClient,
					)
		let entries = SqlSchema.findAll({
			Request: Schema.Struct({
				after: positionSchema,
				through: positionSchema,
				limit: Schema.Union([Schema.Natural, Schema.Literal(-1)]),
			}),
			Result: Schema.Struct({ ...entryRow.fields, position: positionSchema }),
			execute: ({ after, through, limit }) =>
				reader`SELECT j.*,p.position FROM document_positions p JOIN effect_event_journal j ON j.id=p.entry WHERE p.position>${after} AND p.position<=${through} ORDER BY p.position LIMIT ${limit}`,
		})
		let readEntry = SqlSchema.findOneOption({
			Request: EventJournal.EntryId,
			Result: entryRow,
			execute: id => sql`SELECT * FROM effect_event_journal WHERE id=${id}`,
		})
		let hasPosition = SqlSchema.findOneOption({
			Request: positionSchema,
			Result: Schema.Struct({ position: positionSchema }),
			execute: position =>
				sql`SELECT position FROM document_positions WHERE position=${position}`,
		})
		let cache = SqlSchema.findOneOption({
			Request: Schema.Void,
			Result: Schema.Struct({
				position: positionSchema,
				value: Schema.fromJsonString(Schema.Unknown),
			}),
			execute: () => sql`SELECT position,value FROM document_cache WHERE id=1`,
		})(undefined).pipe(
			Effect.map(Option.getOrUndefined),
			journalFailure("cache"),
		)
		let journal = EventJournal.EventJournal.of({
			...base,
			writeFromRemote: options =>
				sql
					.withTransaction(
						Effect.gen(function* () {
							let incoming = new Map<string, EventJournal.RemoteEntry>()
							for (let received of options.entries) {
								let { entry } = received
								let existing = yield* readEntry(entry.id)
								if (
									Option.isSome(existing) &&
									!equalEntry(toEntry(existing.value), entry)
								)
									return yield* failure(
										"writeFromRemote",
										"Journal entry content changed",
									)
								let duplicate = incoming.get(entry.idString)
								if (duplicate && !equalEntry(duplicate.entry, entry))
									return yield* failure(
										"writeFromRemote",
										"Journal entry content changed",
									)
								if (
									!duplicate ||
									received.remoteSequence > duplicate.remoteSequence
								)
									incoming.set(entry.idString, received)
							}
							let result = yield* base.writeFromRemote({
								...options,
								entries: [...incoming.values()],
							})
							for (let received of options.entries)
								yield* sql`UPDATE effect_event_remotes SET sequence=max(sequence,${received.remoteSequence}) WHERE remote_id=${options.remoteId} AND entry_id=${received.entry.id}`
							return result
						}),
					)
					.pipe(journalFailure("writeFromRemote")),
			destroy: sql
				.withTransaction(
					Effect.gen(function* () {
						yield* sql`DELETE FROM effect_event_remotes`
						yield* sql`DELETE FROM effect_event_journal`
						yield* sql`DELETE FROM document_positions`
						yield* sql`DELETE FROM document_cache`
					}),
				)
				.pipe(journalFailure("destroy")),
		})
		return DocumentJournal.of({
			journal,
			entry: id =>
				Schema.decodeUnknownEffect(Schema.String.check(Schema.isUUID(7)))(
					id,
				).pipe(
					Effect.flatMap(id =>
						Schema.decodeEffect(Schema.Uint8ArrayFromHex)(
							id.replaceAll("-", ""),
						),
					),
					Effect.flatMap(Schema.decodeUnknownEffect(EventJournal.EntryId)),
					Effect.flatMap(readEntry),
					Effect.map(row =>
						Option.isSome(row) ? toEntry(row.value) : undefined,
					),
					journalFailure("entry"),
				),
			containsPosition: position =>
				hasPosition(position).pipe(
					Effect.map(Option.isSome),
					journalFailure("containsPosition"),
				),
			cache,
			readAfter: (position, limit, through = Number.MAX_SAFE_INTEGER) =>
				reader
					.withTransaction(
						Effect.gen(function* () {
							if (
								position &&
								!(yield* reader<{
									position: number
								}>`SELECT position FROM document_positions WHERE position=${position}`)
									.length
							)
								return yield* failure(
									"readAfter",
									"Journal cursor no longer exists",
								)
							if (limit !== undefined && (limit < 1 || limit > 1000))
								return yield* failure("readAfter", "Invalid journal page size")
							let rows = yield* entries({
								after: position,
								through,
								limit: limit ?? -1,
							})
							return {
								position: rows.at(-1)?.position ?? position,
								entries: rows.map(toEntry),
							}
						}),
					)
					.pipe(journalFailure("readAfter")),
			saveCache: (position, value) =>
				sql
					.withTransaction(
						Effect.gen(function* () {
							if (Option.isNone(yield* hasPosition(position))) return false
							let previous = (yield* sql<{
								position: number
							}>`SELECT position FROM document_cache WHERE id=1`)[0]
							if (
								previous &&
								previous.position > position &&
								Option.isSome(yield* hasPosition(previous.position))
							)
								return false
							let encoded = yield* Schema.encodeEffect(
								Schema.fromJsonString(Schema.Unknown),
							)(value)
							yield* sql`INSERT INTO document_cache(id,position,value) VALUES (1,${position},${encoded}) ON CONFLICT(id) DO UPDATE SET position=excluded.position,value=excluded.value`
							return true
						}),
					)
					.pipe(journalFailure("saveCache")),
		})
	})
}
function toEntry(row: typeof entryRow.Type) {
	return new EventJournal.Entry({
		id: row.id,
		event: row.event,
		primaryKey: row.primary_key,
		payload: row.payload,
	})
}
function journalFailure(method: string) {
	return Effect.mapError((cause: unknown) =>
		cause instanceof EventJournal.EventJournalError
			? cause
			: new EventJournal.EventJournalError({ method, cause }),
	)
}
function failure(method: string, cause: unknown) {
	return Effect.fail(new EventJournal.EventJournalError({ method, cause }))
}
