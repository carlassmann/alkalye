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
import { setSourceField } from "./actions"
import {
	SourceReplica,
	SourceChangeSchema,
	SourceSnapshotSchema,
} from "./replica"

let changes = EventGroup.empty.add({
	tag: "SourceEdited",
	primaryKey: () => "document",
	payload: SourceChangeSchema,
	success: Schema.Void,
})
let events = EventLog.schema(changes)
let handlers = EventLog.group(changes, handlers =>
	handlers.handle("SourceEdited", () => Effect.void),
)
let database =
	"/tmp/alkalye-source-text-experiment-" + crypto.randomUUID() + ".sqlite"
let layer = EventLog.layer(events, handlers).pipe(
	Layer.provideMerge(SqlEventJournal.layer()),
	Layer.provideMerge(sqliteLayer(database)),
	Layer.provideMerge(
		Layer.succeed(EventLog.Identity, {
			publicKey: "source-text-prototype",
			privateKey: Redacted.make(new Uint8Array(32)),
		}),
	),
)
let binary = SchemaBinary.toCodec(SourceChangeSchema)

test("native Effect EventLog persists minimal source splices and replays through Bun SQLite", async () => {
	let expected = await Effect.runPromise(
		Effect.gen(function* () {
			let write = yield* EventLog.makeClient(events)
			let source = new SourceReplica("a")
			let initial = source.edit("---\ntitle: Initial\n---\nBody")
			if (!initial) return yield* Effect.die("Missing initial source")
			yield* write("SourceEdited", initial)
			for (let index = 0; index < 500; index++) {
				let next = source.text().replace(/^title:.*$/m, "title: Title " + index)
				let change = source.edit(next)
				if (!change) return yield* Effect.die("Missing source edit")
				yield* write("SourceEdited", change)
			}
			let entries = yield* (yield* EventJournal.EventJournal).entries
			expect(entries).toHaveLength(501)
			let snapshot = Schema.encodeSync(
				Schema.fromJsonString(SourceSnapshotSchema),
			)(source.snapshot())
			expect(snapshot.length).toBeLessThan(250_000)
			console.log(
				"MEASURE source text",
				JSON.stringify({
					events: entries.length,
					snapshotBytes: snapshot.length,
					payloadBytes: entries.reduce(
						(size, entry) => size + entry.payload.byteLength,
						0,
					),
				}),
			)
			return source.text()
		}).pipe(Effect.provide(layer)),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let entries = yield* (yield* EventJournal.EventJournal).entries
			let source = new SourceReplica("reopened")
			for (let entry of [...entries].reverse())
				source.apply(yield* Schema.decodeUnknownEffect(binary)(entry.payload))
			expect(source.text()).toBe(expected)
		}).pipe(Effect.provide(layer)),
	)
})

test("native codecs retain shared header identities, slot ancestry and undo across reordered replay", async () => {
	let database =
		"/tmp/alkalye-source-text-actions-" + crypto.randomUUID() + ".sqlite"
	let actionLayer = EventLog.layer(events, handlers).pipe(
		Layer.provideMerge(SqlEventJournal.layer()),
		Layer.provideMerge(sqliteLayer(database)),
		Layer.provideMerge(
			Layer.succeed(EventLog.Identity, {
				publicKey: "source-actions-prototype",
				privateKey: Redacted.make(new Uint8Array(32)),
			}),
		),
	)
	let snapshot = await Effect.runPromise(
		Effect.gen(function* () {
			let write = yield* EventLog.makeClient(events)
			let a = new SourceReplica("a"),
				b = new SourceReplica("b")
			let initial = a.edit("Body")
			if (!initial) return yield* Effect.die("Missing source edit")
			b.apply(initial)
			yield* write("SourceEdited", initial)
			let title = setSourceField(a, "title", "T")
			let pin = setSourceField(b, "pinned", true)
			for (let change of [...title, ...pin])
				yield* write("SourceEdited", change)
			a.restore(b.snapshot())
			let renamed = setSourceField(a, "title", "New")
			for (let change of renamed) yield* write("SourceEdited", change)
			for (let change of renamed.reverse())
				yield* write("SourceEdited", a.inverse(change))
			return a.snapshot()
		}).pipe(Effect.provide(actionLayer)),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let entries = yield* (yield* EventJournal.EventJournal).entries
			let changes = yield* Effect.forEach(entries, entry =>
				Schema.decodeUnknownEffect(binary)(entry.payload),
			)
			let forward = new SourceReplica("forward"),
				reverse = new SourceReplica("reverse"),
				cold = new SourceReplica("snapshot")
			for (let change of changes) forward.apply(change)
			for (let change of [...changes].reverse()) reverse.apply(change)
			cold.restore(snapshot)
			expect(forward.text()).toBe(cold.text())
			expect(reverse.text()).toBe(cold.text())
			expect(cold.text()).toContain('title: "T"')
			expect(cold.text()).toContain("pinned: true")
		}).pipe(Effect.provide(actionLayer)),
	)
})
