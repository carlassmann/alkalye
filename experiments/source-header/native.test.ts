import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import * as EventGroup from "effect/eventlog/EventGroup"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as EventLog from "effect/eventlog/EventLog"
import * as SqlEventJournal from "effect/eventlog/SqlEventJournal"
import { sqliteLayer } from "../../src/platform/sqlite"
import {
	SourceHeader,
	HeaderChangeSchema,
	HeaderSnapshotSchema,
} from "./header"

let changes = EventGroup.empty.add({
	tag: "HeaderEdited",
	primaryKey: () => "document",
	payload: HeaderChangeSchema,
	success: Schema.Void,
})
let events = EventLog.schema(changes)
let handlers = EventLog.group(changes, handlers =>
	handlers.handle("HeaderEdited", () => Effect.void),
)
let database =
	"/tmp/alkalye-source-header-experiment-" + crypto.randomUUID() + ".sqlite"
let layer = EventLog.layer(events, handlers).pipe(
	Layer.provideMerge(SqlEventJournal.layer()),
	Layer.provideMerge(sqliteLayer(database)),
	Layer.provideMerge(
		Layer.succeed(EventLog.Identity, {
			publicKey: "header-prototype",
			privateKey: Redacted.make(new Uint8Array(32)),
		}),
	),
)
let binary = SchemaBinary.toCodec(HeaderChangeSchema)

test("native Effect EventLog persists source-entry patches and replays through Bun SQLite", async () => {
	let expected = await Effect.runPromise(
		Effect.gen(function* () {
			let write = yield* EventLog.makeClient(events)
			let source = new SourceHeader()
			let initial = source.change(
				"0000000000000001:a",
				"",
				"---\ntitle: Initial\n---\nBody",
			)
			yield* write("HeaderEdited", initial)
			source.apply(initial)
			for (let index = 0; index < 500; index++) {
				let previous = source.source("Body")
				let next = previous.replace(/^title:.*$/m, "title: Title " + index)
				let change = source.change(
					String(index + 2).padStart(16, "0") + ":a",
					previous,
					next,
				)
				yield* write("HeaderEdited", change)
				source.apply(change)
			}
			let entries = yield* (yield* EventJournal.EventJournal).entries
			expect(entries).toHaveLength(501)
			let snapshot = Schema.encodeSync(
				Schema.fromJsonString(HeaderSnapshotSchema),
			)(source.snapshot())
			expect(snapshot.length).toBeLessThan(800)
			console.log(
				"MEASURE header registers",
				JSON.stringify({
					events: entries.length,
					snapshotBytes: snapshot.length,
					payloadBytes: entries.reduce(
						(size, entry) => size + entry.payload.byteLength,
						0,
					),
				}),
			)
			return source.source("Body")
		}).pipe(Effect.provide(layer)),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let entries = yield* (yield* EventJournal.EventJournal).entries
			let source = new SourceHeader()
			for (let entry of [...entries].reverse())
				source.apply(yield* Schema.decodeUnknownEffect(binary)(entry.payload))
			expect(source.source("Body")).toBe(expected)
		}).pipe(Effect.provide(layer)),
	)
})
