import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as EventGroup from "effect/eventlog/EventGroup"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as EventLog from "effect/eventlog/EventLog"
import * as EventLogEncryption from "effect/eventlog/EventLogEncryption"
import { StoreId } from "effect/eventlog/EventLogMessage"
import * as EventLogRemote from "effect/eventlog/EventLogRemote"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Schema from "effect/Schema"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import * as Scope from "effect/Scope"
import * as Socket from "effect/socket/Socket"
import { indexedDbJournalLayer } from "../src/platform/indexeddb-journal"
import { Replica } from "../src/shared/crdt"
import { OperationEnvelopeSchema, parseOperation } from "../src/shared/model"

class Projection extends Context.Service<Projection, Replica>()(
	"experiment/BrowserProjection",
) {}
let group = EventGroup.empty.add({
	tag: "DocumentChanged",
	primaryKey: operation => operation.target,
	payload: OperationEnvelopeSchema,
	success: OperationEnvelopeSchema,
})
let schema = EventLog.schema(group)
let codec = SchemaBinary.toCodec(OperationEnvelopeSchema)
let handlers = EventLog.group(group, handlers =>
	handlers.handle("DocumentChanged", ({ payload }) =>
		Projection.use(replica =>
			Effect.sync(() => {
				replica.apply([parseOperation(payload)])
				return payload
			}),
		),
	),
)
let storeId = StoreId.make("workspace")

export function runBrowserEventLog(
	prefix: string,
	check: (condition: unknown, message: string) => void,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let url = new URLSearchParams(location.search).get("remote")
			if (!url) return yield* Effect.die("Missing native relay URL")
			let identity = yield* EventLog.makeIdentity
			let writer = yield* makeClient(prefix + "-writer", identity)
			yield* writer.write(
				writer.replica.set("document", "title", "Offline draft"),
			)
			check(
				writer.replica.fields("document").title === "Offline draft",
				"native browser EventLog projects offline commands",
			)
			check(
				(yield* writer.journal.entries).length === 1,
				"native browser EventLog durably journals offline commands",
			)
			yield* writer.connect(url)
			yield* waitFor(writer.confirmed, Boolean)
			check(
				true,
				"native browser EventLog confirms offline entries through encrypted remote echoes",
			)
			let reader = yield* makeClient(prefix + "-reader", identity)
			yield* reader.connect(url)
			yield* waitFor(reader.journal.entries, entries => entries.length === 1)
			check(
				reader.replica.fields("document").title === "Offline draft",
				"an independent browser journal receives the encrypted document",
			)
			let otherWriter = yield* makeClient(prefix + "-other-writer", identity)
			yield* otherWriter.connect(url)
			yield* waitFor(
				otherWriter.journal.entries,
				entries => entries.length === 1,
			)
			let first = writer.replica.edit("document", "Writer A\n")
			let second = otherWriter.replica.edit("document", "Writer B\n")
			if (!first || !second)
				return yield* Effect.die("Missing concurrent edits")
			yield* Effect.all([writer.write(first), otherWriter.write(second)], {
				concurrency: "unbounded",
			})
			yield* waitFor(reader.journal.entries, entries => entries.length === 3)
			yield* waitFor(writer.confirmed, Boolean)
			yield* waitFor(otherWriter.confirmed, Boolean)
			check(
				writer.replica.text("document") ===
					otherWriter.replica.text("document") &&
					writer.replica.text("document") === reader.replica.text("document"),
				"concurrent browser writers and an independent replica converge through native EventLog",
			)
			check(
				reader.replica.text("document").includes("Writer A") &&
					reader.replica.text("document").includes("Writer B"),
				"browser convergence retains both concurrent insertions",
			)
			let remoteId = (yield* writer.connect(url)).id
			let expected = writer.replica.text("document")
			let cursor = yield* writer.journal.nextRemoteSequence(remoteId)
			yield* writer.close
			let reopened = yield* makeClient(prefix + "-writer", identity)
			check(
				reopened.replica.text("document") === expected,
				"closing and reopening the browser runtime restores its document without network access",
			)
			check(
				(yield* reopened.journal.nextRemoteSequence(remoteId)) === cursor,
				"browser runtime reopening retains the native receive cursor",
			)
			yield* reopened.connect(url)
			yield* reopened.write(
				reopened.replica.set("document", "title", "After reopen"),
			)
			yield* waitFor(reader.journal.entries, entries => entries.length === 4)
			check(
				reader.replica.fields("document").title === "After reopen",
				"a reopened browser runtime resumes live encrypted collaboration",
			)
			check(
				(yield* reopened.journal.entries).length === 4,
				"reconnecting keeps journal entries deduplicated",
			)
		}),
	).pipe(Effect.provide(EventLogEncryption.layerSubtle))
}

function makeClient(database: string, identity: EventLog.Identity["Service"]) {
	return Effect.gen(function* () {
		let scope = yield* Scope.fork(yield* Effect.scope)
		let replica = new Replica(database)
		let services = yield* Layer.build(
			EventLog.layer(schema, handlers).pipe(
				Layer.provideMerge(indexedDbJournalLayer(database)),
				Layer.provide(Layer.succeed(Projection, replica)),
				Layer.provideMerge(Layer.succeed(EventLog.Identity, identity)),
				Layer.provide(Layer.succeed(EventLog.CurrentStoreId, storeId)),
			),
		).pipe(Effect.provideService(Scope.Scope, scope))
		let journal = Context.get(services, EventJournal.EventJournal)
		for (let entry of yield* journal.entries) {
			let operation = yield* Schema.decodeEffect(codec)(
				new Uint8Array(entry.payload),
			)
			replica.apply([parseOperation(operation)])
		}
		let write = yield* EventLog.makeClient(schema).pipe(
			Effect.provide(services),
		)
		let remote: EventLogRemote.EventLogRemote["Service"] | undefined
		return {
			replica,
			journal,
			write: (operation: typeof OperationEnvelopeSchema.Type) =>
				write("DocumentChanged", operation),
			close: Scope.close(scope, Exit.void),
			confirmed: Effect.suspend(() =>
				remote
					? journal
							.withRemoteUncommited(remote.id, () => Effect.void)
							.pipe(Effect.map(Option.isNone))
					: Effect.succeed(false),
			),
			connect: (url: string) =>
				Effect.gen(function* () {
					if (remote) return remote
					let connected = yield* Layer.build(
						remoteLayer(url, Context.get(services, EventLog.Registry)),
					).pipe(Effect.provideService(Scope.Scope, scope))
					remote = Context.get(connected, EventLogRemote.EventLogRemote)
					return remote
				}),
		}
	})
}
function remoteLayer(url: string, registry: EventLog.Registry["Service"]) {
	return Layer.effect(EventLogRemote.EventLogRemote)(
		EventLogRemote.makeEncrypted,
	).pipe(
		Layer.provide(EventLogRemote.EventLogRemoteClient.layer),
		Layer.provide(EventLogEncryption.layerSubtle),
		Layer.provide(Layer.succeed(EventLog.Registry, registry)),
		Layer.provide(
			RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
				Layer.provide(RpcSerialization.layerSchemaBinary()),
				Layer.provide(
					Socket.layerWebSocket(url).pipe(
						Layer.provide(Socket.layerWebSocketConstructorGlobal),
					),
				),
			),
		),
	)
}
function waitFor<A, E, R>(
	effect: Effect.Effect<A, E, R>,
	ready: (value: A) => boolean,
) {
	return Effect.gen(function* () {
		while (true) {
			let value = yield* effect
			if (ready(value)) return value
			yield* Effect.sleep("10 millis")
		}
	}).pipe(Effect.timeout("5 seconds"))
}
