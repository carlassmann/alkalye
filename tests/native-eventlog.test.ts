import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as References from "effect/References"
import * as Option from "effect/Option"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import * as EventGroup from "effect/eventlog/EventGroup"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as EventLog from "effect/eventlog/EventLog"
import * as SqlEventJournal from "effect/eventlog/SqlEventJournal"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlError from "effect/sql/SqlError"
import { sqliteLayer } from "../src/platform/sqlite"
import { Replica } from "../src/shared/crdt"
import { parseCheckpoint } from "../src/shared/checkpoint"
import {
	IdentifierSchema,
	OperationEnvelopeSchema,
	parseOperation,
} from "../src/shared/model"

let directory = await mkdtemp(join(tmpdir(), "alkalye-native-eventlog-"))
afterAll(() => rm(directory, { recursive: true, force: true }))

class CurrentRole extends Context.Reference<"owner" | "writer" | "reader">(
	"experiment/CurrentRole",
	{
		defaultValue: () => "reader",
	},
) {}
let documentPayload = Schema.Struct({
	room: IdentifierSchema,
	operation: OperationEnvelopeSchema,
})
let documentBinary = SchemaBinary.toCodec(documentPayload)
let changes = EventGroup.empty
	.add({
		tag: "DocumentChanged",
		primaryKey: payload => payload.room + ":" + payload.operation.target,
		payload: documentPayload,
		success: OperationEnvelopeSchema,
		error: Schema.Union([SqlError.SqlError, Schema.String]),
	})
	.add({
		tag: "WorkspaceCheckpoint",
		primaryKey: payload => payload.room,
		payload: Schema.Struct({ room: IdentifierSchema, snapshot: Schema.String }),
		success: Schema.String,
		error: Schema.Union([SqlError.SqlError, Schema.String]),
	})
let events = EventLog.schema(changes)
let handlers = EventLog.group(changes, handlers =>
	handlers
		.handle("DocumentChanged", ({ payload, entry }) =>
			Effect.gen(function* () {
				let sql = yield* SqlClient.SqlClient
				yield* sql`INSERT INTO projection VALUES (${entry.idString},${payload.room},${payload.operation.target})`
				return payload.operation
			}),
		)
		.handle("WorkspaceCheckpoint", ({ payload, entry }) =>
			Effect.gen(function* () {
				yield* Effect.try({
					try: () => parseCheckpoint(JSON.parse(payload.snapshot)),
					catch: () => "Invalid checkpoint",
				})
				let sql = yield* SqlClient.SqlClient
				yield* sql`INSERT INTO projection VALUES (${entry.idString},${payload.room},'checkpoint')`
				return payload.snapshot
			}),
		),
)

function nativeLayer(name: string) {
	return EventLog.layer(events, handlers).pipe(
		Layer.provideMerge(Layer.succeed(CurrentRole, "writer")),
		Layer.provideMerge(SqlEventJournal.layer()),
		Layer.provideMerge(sqliteLayer(join(directory, name + ".sqlite"))),
		Layer.provideMerge(
			Layer.succeed(EventLog.Identity, {
				publicKey: "local-journal-fixture",
				privateKey: Redacted.make(new Uint8Array(32)),
			}),
		),
	)
}
function authorizedDocumentWriter() {
	return Effect.gen(function* () {
		let write = yield* EventLog.makeClient(events)
		return (payload: typeof documentPayload.Type) =>
			Effect.gen(function* () {
				let role = yield* CurrentRole
				if (role === "reader") return yield* Effect.fail("Read-only workspace")
				return yield* write("DocumentChanged", payload)
			})
	})
}
function fixtureOperation() {
	return new Replica("eventlog-fixture", "Writer").set(
		"document",
		"title",
		"Native journal",
	)
}
function initialize() {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		yield* sql`CREATE TABLE IF NOT EXISTS projection (entry TEXT PRIMARY KEY, room TEXT NOT NULL, target TEXT NOT NULL)`
	})
}

test("native EventLog commits typed CRDT events through Bun SQLite and replays after reopening", async () => {
	let operation = fixtureOperation()
	let saved = await Effect.runPromise(
		Effect.gen(function* () {
			yield* initialize()
			let write = yield* authorizedDocumentWriter()
			let committed = yield* write({
				room: "workspace",
				operation,
			})
			let live = new Replica("live-projection")
			live.apply([parseOperation(committed)])
			expect(live.fields("document").title).toBe("Native journal")
			let journal = yield* EventJournal.EventJournal
			let entries = yield* journal.entries
			expect(entries).toHaveLength(1)
			expect(entries[0]?.primaryKey).toBe("workspace:document")
			let entry = entries[0]
			if (!entry) return yield* Effect.die("Missing committed entry")
			return entry.idString
		}).pipe(Effect.provide(nativeLayer("restart"))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let journal = yield* EventJournal.EventJournal
			let entries = yield* journal.entries
			let entry = entries[0]
			if (!entry) return yield* Effect.die("Missing committed entry")
			expect(entry.idString).toBe(saved)
			let payload = yield* Schema.decodeEffect(documentBinary)(
				new Uint8Array(entry.payload),
			)
			let restored = new Replica("reopened-projection")
			restored.apply([parseOperation(payload.operation)])
			expect(restored.fields("document").title).toBe("Native journal")
		}).pipe(Effect.provide(nativeLayer("restart"))),
	)
})

test("native EventLog rejects reader edits without journaling or changing the SQL projection", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* initialize()
			let write = yield* authorizedDocumentWriter()
			let denied = yield* write({
				room: "workspace",
				operation: fixtureOperation(),
			}).pipe(Effect.provideService(CurrentRole, "reader"), Effect.exit)
			expect(Exit.isFailure(denied)).toBe(true)
			let journal = yield* EventJournal.EventJournal
			expect(yield* journal.entries).toEqual([])
			let sql = yield* SqlClient.SqlClient
			expect(yield* sql`SELECT * FROM projection`).toEqual([])
		}).pipe(Effect.provide(nativeLayer("reader"))),
	)
})

test("native EventLog rolls back its SQL projection when the journal insert fails", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* initialize()
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TRIGGER reject_entry BEFORE INSERT ON effect_event_journal BEGIN SELECT RAISE(ABORT,'fixture journal failure'); END`
			let write = yield* authorizedDocumentWriter()
			let failed = yield* write({
				room: "workspace",
				operation: fixtureOperation(),
			}).pipe(Effect.exit)
			expect(Exit.isFailure(failed)).toBe(true)
			let journal = yield* EventJournal.EventJournal
			expect(yield* journal.entries).toEqual([])
			expect(yield* sql`SELECT * FROM projection`).toEqual([])
			yield* sql`DROP TRIGGER reject_entry`
			expect(
				(yield* write({
					room: "workspace",
					operation: fixtureOperation(),
				})).id,
			).toBe(fixtureOperation().id)
			expect(yield* journal.entries).toHaveLength(1)
		}).pipe(Effect.provide(nativeLayer("journal-failure"))),
	)
})

test("native journal echo dedupes retries and a new remote identity requeues committed entries", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* initialize()
			let write = yield* authorizedDocumentWriter()
			yield* write({
				room: "workspace",
				operation: fixtureOperation(),
			})
			let journal = yield* EventJournal.EventJournal
			let entries = yield* journal.entries
			let entry = entries[0]
			if (!entry) return yield* Effect.die("Missing committed entry")
			let remoteId = EventJournal.makeRemoteIdUnsafe()
			expect(
				yield* journal.withRemoteUncommited(remoteId, entries =>
					Effect.succeed(entries.length),
				),
			).toEqual(Option.some(1))
			expect(yield* journal.nextRemoteSequence(remoteId)).toBe(0)
			for (let attempt = 0; attempt < 2; attempt++) {
				let receipt = yield* journal
					.writeFromRemote({
						remoteId,
						entries: [
							new EventJournal.RemoteEntry({ entry, remoteSequence: 12 }),
						],
						effect: () =>
							Effect.die("A duplicate entry must not replay its handler"),
					})
					.pipe(journal.withLock(yield* EventLog.CurrentStoreId))
				expect(receipt.duplicateEntries).toHaveLength(1)
			}
			expect(yield* journal.entries).toHaveLength(1)
			expect(
				yield* journal.withRemoteUncommited(remoteId, entries =>
					Effect.succeed(entries.length),
				),
			).toEqual(Option.none())
			expect(yield* journal.nextRemoteSequence(remoteId)).toBe(13)
			let reset = EventJournal.makeRemoteIdUnsafe()
			expect(yield* journal.nextRemoteSequence(reset)).toBe(0)
			expect(
				yield* journal.withRemoteUncommited(reset, entries =>
					Effect.succeed(entries.length),
				),
			).toEqual(Option.some(1))
		}).pipe(Effect.provide(nativeLayer("echo-reset"))),
	)
})

test("default native remote replay retains the journal when its SQL projection fails", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* initialize()
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TRIGGER reject_projection BEFORE INSERT ON projection BEGIN SELECT RAISE(ABORT,'fixture projection failure'); END`
			let journal = yield* EventJournal.EventJournal
			let registry = yield* EventLog.Registry
			let identity = yield* EventLog.Identity
			let storeId = yield* EventLog.CurrentStoreId
			let remoteId = EventJournal.makeRemoteIdUnsafe()
			let payload = yield* Schema.encodeEffect(documentBinary)({
				room: "workspace",
				operation: fixtureOperation(),
			})
			let entry = new EventJournal.Entry({
				id: EventJournal.makeEntryIdUnsafe(),
				event: "DocumentChanged",
				primaryKey: "workspace:document",
				payload,
			})
			let replay = EventLog.makeReplayFromRemote({
				handlers: registry.handlers,
				storeId,
				identity,
				reactivity: yield* Reactivity.make,
				reactivityKeys: {},
				logAnnotations: { service: "experiment", effect: "failedProjection" },
			})
			yield* journal
				.writeFromRemote({
					remoteId,
					entries: [new EventJournal.RemoteEntry({ entry, remoteSequence: 1 })],
					effect: replay,
				})
				.pipe(
					journal.withLock(storeId),
					Effect.provideService(References.MinimumLogLevel, "None"),
				)
			expect(yield* sql`SELECT * FROM projection`).toEqual([])
			expect(yield* journal.entries).toHaveLength(1)
			expect(yield* journal.nextRemoteSequence(remoteId)).toBe(2)
			yield* sql`DROP TRIGGER reject_projection`
			let saved = (yield* journal.entries)[0]
			if (!saved) return yield* Effect.die("Missing retained entry")
			yield* replay({ entry: saved, conflicts: [] }).pipe(sql.withTransaction)
			expect(yield* sql`SELECT * FROM projection`).toHaveLength(1)
		}).pipe(Effect.provide(nativeLayer("remote-projection-failure"))),
	)
})
