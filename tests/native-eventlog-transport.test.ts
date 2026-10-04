import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as NetAddress from "effect/net/NetAddress"
import * as Queue from "effect/Queue"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Schema from "effect/Schema"
import * as Schedule from "effect/Schedule"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import * as Socket from "effect/socket/Socket"
import * as SocketServer from "effect/socket/SocketServer"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlError from "effect/sql/SqlError"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as EventGroup from "effect/eventlog/EventGroup"
import * as EventLog from "effect/eventlog/EventLog"
import * as EventLogEncryption from "effect/eventlog/EventLogEncryption"
import {
	ChangesRpc,
	EventLogProtocolError,
	EventLogRemoteRpcs,
	StoreId,
	WriteEntries,
} from "effect/eventlog/EventLogMessage"
import * as EventLogRemote from "effect/eventlog/EventLogRemote"
import * as EventLogServer from "effect/eventlog/EventLogServer"
import * as EventLogServerEncrypted from "effect/eventlog/EventLogServerEncrypted"
import * as SqlEventLogServerEncrypted from "effect/eventlog/SqlEventLogServerEncrypted"
import * as SqlEventJournal from "effect/eventlog/SqlEventJournal"
import { sqliteLayer } from "../src/platform/sqlite"
import { Replica } from "../src/shared/crdt"
import { parseCheckpoint } from "../src/shared/checkpoint"
import { OperationEnvelopeSchema, parseOperation } from "../src/shared/model"
import { socketServerLayer } from "./fixtures/bun-socket-server"

let directory = await mkdtemp(join(tmpdir(), "alkalye-eventlog-transport-"))
afterAll(() => rm(directory, { recursive: true, force: true }))
let storeId = StoreId.make("workspace")
type Role = "owner" | "writer" | "reader"
class Access extends Context.Service<
	Access,
	{
		grants: SubscriptionRef.SubscriptionRef<ReadonlyMap<string, Role>>
		writes: Ref.Ref<number>
		starts: Ref.Ref<ReadonlyArray<number>>
	}
>()("experiment/EventLogAccess") {}
let accessLayer = Layer.effect(Access)(
	Effect.gen(function* () {
		return {
			grants: yield* SubscriptionRef.make<ReadonlyMap<string, Role>>(new Map()),
			writes: yield* Ref.make(0),
			starts: yield* Ref.make<ReadonlyArray<number>>([]),
		}
	}),
)

function serverLayer(name: string) {
	return Layer.unwrap(
		Effect.gen(function* () {
			let storage = yield* EventLogServerEncrypted.Storage
			let access = yield* Access
			function authorize(publicKey: string, writing = false) {
				return Effect.gen(function* () {
					let role = (yield* SubscriptionRef.get(access.grants)).get(publicKey)
					if (!role || (writing && role === "reader"))
						return yield* Effect.fail(forbidden(publicKey))
				})
			}
			let handlers = EventLogServer.layerRpcHandlers({
				remoteId: yield* storage.getId,
				authorizeIdentity: publicKey => authorize(publicKey),
				getOrCreateSessionAuthBinding: storage.getOrCreateSessionAuthBinding,
				onWrite: (data, authenticatedPublicKeys) =>
					Effect.gen(function* () {
						let request = yield* WriteEntries.decode(data).pipe(
							Effect.mapError(() => forbidden("invalid-request")),
						)
						if (
							request.storeId !== storeId ||
							!authenticatedPublicKeys.has(request.publicKey)
						)
							return yield* Effect.fail(forbidden(request.publicKey))
						yield* authorize(request.publicKey, true)
						let entries = request.encryptedEntries.map(
							entry => new EventLogServerEncrypted.PersistedEntry(entry),
						)
						yield* storage.write("workspace", storeId, entries)
						yield* Ref.update(access.writes, count => count + 1)
					}),
				changes: ({ publicKey, storeId: requestedStore, startSequence }) => {
					if (requestedStore !== storeId)
						return Stream.fail(forbidden(publicKey))
					let changes = storage
						.changes("workspace", storeId, startSequence)
						.pipe(
							Stream.mapArrayEffect(entries =>
								authorize(publicKey).pipe(
									Effect.andThen(ChangesRpc.encodeEncrypted(entries)),
									Effect.map(data => [data]),
								),
							),
							Stream.interruptWhen(
								SubscriptionRef.changes(access.grants).pipe(
									Stream.filter(grants => !grants.has(publicKey)),
									Stream.runHead,
								),
							),
						)
					return Stream.unwrap(
						Ref.update(access.starts, starts => [
							...starts,
							startSequence,
						]).pipe(Effect.as(changes)),
					)
				},
			})
			return RpcServer.layer(EventLogRemoteRpcs).pipe(Layer.provide(handlers))
		}),
	).pipe(
		Layer.provideMerge(accessLayer),
		Layer.provideMerge(SqlEventLogServerEncrypted.layerStorageSubtle()),
		Layer.provide(sqliteLayer(join(directory, name + ".sqlite"))),
		Layer.provide(
			RpcServer.layerProtocolSocketServer.pipe(
				Layer.provide(RpcSerialization.layerSchemaBinary()),
			),
		),
		Layer.provideMerge(socketServerLayer()),
	)
}
function forbidden(publicKey: string) {
	return new EventLogProtocolError({
		requestTag: "WorkspaceAccess",
		publicKey,
		code: "Forbidden",
		message: "Workspace permission denied",
	})
}
function remoteLayer(url: string, registry?: EventLog.Registry["Service"]) {
	return Layer.effect(EventLogRemote.EventLogRemote)(
		EventLogRemote.makeEncrypted,
	).pipe(
		Layer.provideMerge(EventLogRemote.EventLogRemoteClient.layer),
		Layer.provide(EventLogEncryption.layerSubtle),
		Layer.provide(
			registry
				? Layer.succeed(EventLog.Registry, registry)
				: EventLog.layerRegistry,
		),
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
function makeRemote(url: string) {
	return Effect.gen(function* () {
		return (yield* makeConnection(url)).remote
	})
}
function makeConnection(url: string) {
	return Effect.gen(function* () {
		let services = yield* Layer.build(remoteLayer(url))
		return {
			remote: Context.get(services, EventLogRemote.EventLogRemote),
			rpc: Context.get(services, EventLogRemote.EventLogRemoteClient),
		}
	})
}
function entry(text: string) {
	return new EventJournal.Entry({
		id: EventJournal.makeEntryIdUnsafe(),
		event: "DocumentChanged",
		primaryKey: "document",
		payload: new TextEncoder().encode(text),
	})
}
let documentEvents = EventGroup.empty
	.add({
		tag: "DocumentChanged",
		primaryKey: operation => operation.target,
		payload: OperationEnvelopeSchema,
		success: OperationEnvelopeSchema,
		error: Schema.Union([Schema.String, SqlError.SqlError]),
	})
	.add({
		tag: "WorkspaceCheckpoint",
		primaryKey: () => "workspace",
		payload: Schema.String,
		success: Schema.String,
		error: Schema.Union([Schema.String, SqlError.SqlError]),
	})
let documentSchema = EventLog.schema(documentEvents)
let documentCodec = SchemaBinary.toCodec(OperationEnvelopeSchema)
let snapshotCodec = SchemaBinary.toCodec(Schema.String)
let projectionRows = Schema.Array(
	Schema.Struct({
		event: Schema.Literals(["DocumentChanged", "WorkspaceCheckpoint"]),
		payload: Schema.Uint8Array,
	}),
)
let documentHandlers = EventLog.group(documentEvents, handlers =>
	handlers
		.handle("DocumentChanged", ({ payload, entry }) =>
			projectEntry(entry).pipe(Effect.as(payload)),
		)
		.handle("WorkspaceCheckpoint", ({ payload, entry }) =>
			Effect.gen(function* () {
				yield* Effect.try({
					try: () => parseCheckpoint(JSON.parse(payload)),
					catch: () => "Invalid checkpoint",
				})
				yield* projectEntry(entry)
				return payload
			}),
		),
)
function projectEntry(entry: EventJournal.Entry) {
	return SqlClient.SqlClient.use(
		sql =>
			sql`INSERT OR IGNORE INTO document_projection VALUES (${entry.id},${entry.event},${entry.payload})`,
	)
}
function makeDocumentClient(
	identity: EventLog.Identity["Service"],
	name: string,
) {
	return Effect.gen(function* () {
		let storage = Layer.effectDiscard(
			SqlClient.SqlClient.use(
				sql =>
					sql`CREATE TABLE IF NOT EXISTS document_projection (entry BLOB PRIMARY KEY,event TEXT NOT NULL,payload BLOB NOT NULL)`,
			),
		).pipe(Layer.provideMerge(sqliteLayer(join(directory, name + ".sqlite"))))
		let services = yield* Layer.build(
			EventLog.layer(documentSchema, documentHandlers).pipe(
				Layer.provideMerge(SqlEventJournal.layer()),
				Layer.provideMerge(storage),
				Layer.provideMerge(Layer.succeed(EventLog.Identity, identity)),
				Layer.provide(Layer.succeed(EventLog.CurrentStoreId, storeId)),
			),
		)
		let write = yield* EventLog.makeClient(documentSchema).pipe(
			Effect.provide(services),
		)
		let journal = Context.get(services, EventJournal.EventJournal)
		let sql = Context.get(services, SqlClient.SqlClient)
		let read = Effect.gen(function* () {
			let rows =
				yield* sql`SELECT event,payload FROM document_projection ORDER BY entry`.pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(projectionRows)),
				)
			let replica = new Replica(name)
			for (let row of rows) {
				if (row.event === "WorkspaceCheckpoint") {
					let snapshot = yield* Schema.decodeEffect(snapshotCodec)(
						new Uint8Array(row.payload),
					)
					replica.restore(parseCheckpoint(JSON.parse(snapshot)))
				} else {
					let operation = yield* Schema.decodeEffect(documentCodec)(
						new Uint8Array(row.payload),
					)
					replica.apply([parseOperation(operation)])
				}
			}
			return replica
		})
		let replay = EventLog.makeReplayFromRemote({
			handlers: Context.get(services, EventLog.Registry).handlers,
			storeId,
			identity,
			reactivity: yield* Reactivity.make,
			reactivityKeys: {},
			logAnnotations: { service: "experiment", effect: "checkpointSeed" },
		})
		return {
			journal,
			read,
			write: (operation: typeof OperationEnvelopeSchema.Type) =>
				write("DocumentChanged", operation),
			seed: (
				entry: EventJournal.RemoteEntry,
				remoteId: EventJournal.RemoteId,
			) =>
				journal
					.writeFromRemote({ remoteId, entries: [entry], effect: replay })
					.pipe(journal.withLock(storeId)),
			connect: (url: string) =>
				Layer.build(
					remoteLayer(url, Context.get(services, EventLog.Registry)),
				).pipe(
					Effect.map(services =>
						Context.get(services, EventLogRemote.EventLogRemote),
					),
				),
		}
	})
}
function waitFor<A, E, R>(
	effect: Effect.Effect<A, E, R>,
	ready: (value: A) => boolean,
) {
	return effect.pipe(
		Effect.flatMap(value =>
			ready(value)
				? Effect.succeed(value)
				: Effect.fail("Not yet synchronized"),
		),
		Effect.retry({
			while: failure => failure === "Not yet synchronized",
			schedule: Schedule.spaced("10 millis"),
		}),
		Effect.timeout("5 seconds"),
	)
}

test("native encrypted EventLog streams Bun WebSocket writes between separate workspace grants", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let identity = yield* EventLog.makeIdentity
			let writer = { ...identity, publicKey: "writer-grant" }
			let reader = { ...identity, publicKey: "reader-grant" }
			let access = yield* Access
			yield* SubscriptionRef.set(
				access.grants,
				new Map([
					[writer.publicKey, "writer"],
					[reader.publicKey, "reader"],
				]),
			)
			let server = yield* SocketServer.SocketServer
			let url = NetAddress.formatUrlUnsafe(server.address, "ws")
			let sender = yield* makeRemote(url)
			let receiver = yield* makeRemote(url)
			let incoming = yield* receiver.changes({
				identity: reader,
				storeId,
				startSequence: 0,
			})
			let changed = entry("Encrypted document content")
			yield* sender.write({ identity: writer, storeId, entries: [changed] })
			let received = yield* Queue.take(incoming).pipe(
				Effect.timeout("5 seconds"),
			)
			expect(received.entry.idString).toBe(changed.idString)
			expect(new TextDecoder().decode(received.entry.payload)).toBe(
				"Encrypted document content",
			)
			let storage = yield* EventLogServerEncrypted.Storage
			let encrypted = yield* storage
				.changes("workspace", storeId, 0)
				.pipe(Stream.take(1), Stream.runCollect)
			expect(
				new TextDecoder().decode(encrypted[0]?.encryptedEntry),
			).not.toContain("Encrypted document content")
			expect(yield* Ref.get(access.writes)).toBe(1)
		}).pipe(
			Effect.provide(serverLayer("grant-sync")),
			Effect.provide(EventLogEncryption.layerSubtle),
			Effect.scoped,
			Effect.timeout("15 seconds"),
		),
	)
})

test("native EventLog rejects reader writes and interrupts a revoked live reader", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let identity = yield* EventLog.makeIdentity
			let writer = { ...identity, publicKey: "writer-grant" }
			let reader = { ...identity, publicKey: "reader-grant" }
			let access = yield* Access
			yield* SubscriptionRef.set(
				access.grants,
				new Map([
					[writer.publicKey, "writer"],
					[reader.publicKey, "reader"],
				]),
			)
			let server = yield* SocketServer.SocketServer
			let url = NetAddress.formatUrlUnsafe(server.address, "ws")
			let sender = yield* makeRemote(url)
			let receiver = yield* makeRemote(url)
			let denied = yield* receiver
				.write({
					identity: reader,
					storeId,
					entries: [entry("Forbidden edit")],
				})
				.pipe(Effect.exit)
			expect(Exit.isFailure(denied)).toBe(true)
			expect(yield* Ref.get(access.writes)).toBe(0)
			let incoming = yield* receiver.changes({
				identity: reader,
				storeId,
				startSequence: 0,
			})
			yield* sender.write({
				identity: writer,
				storeId,
				entries: [entry("First")],
			})
			expect((yield* Queue.take(incoming)).remoteSequence).toBe(1)
			yield* SubscriptionRef.set(
				access.grants,
				new Map([[writer.publicKey, "writer"]]),
			)
			let ended = yield* Queue.take(incoming).pipe(
				Effect.timeout("5 seconds"),
				Effect.exit,
			)
			expect(Exit.isFailure(ended)).toBe(true)
			yield* sender.write({
				identity: writer,
				storeId,
				entries: [entry("Second")],
			})
			expect(yield* Ref.get(access.writes)).toBe(2)
		}).pipe(
			Effect.provide(serverLayer("reader-revocation")),
			Effect.provide(EventLogEncryption.layerSubtle),
			Effect.scoped,
			Effect.timeout("15 seconds"),
		),
	)
})

test("native encrypted transport chunks a large document and echoes duplicate retries", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let identity = yield* EventLog.makeIdentity
			let access = yield* Access
			yield* SubscriptionRef.set(
				access.grants,
				new Map([[identity.publicKey, "owner"]]),
			)
			let server = yield* SocketServer.SocketServer
			let remote = yield* makeRemote(
				NetAddress.formatUrlUnsafe(server.address, "ws"),
			)
			let incoming = yield* remote.changes({
				identity,
				storeId,
				startSequence: 0,
			})
			let content = "Large document\n".repeat(50_000)
			let changed = entry(content)
			for (let attempt = 0; attempt < 2; attempt++) {
				yield* remote.write({ identity, storeId, entries: [changed] })
				let received = yield* Queue.take(incoming).pipe(
					Effect.timeout("5 seconds"),
				)
				expect(received.entry.idString).toBe(changed.idString)
				expect(received.remoteSequence).toBe(1)
				expect(new TextDecoder().decode(received.entry.payload)).toBe(content)
			}
		}).pipe(
			Effect.provide(serverLayer("large-retry")),
			Effect.provide(EventLogEncryption.layerSubtle),
			Effect.scoped,
			Effect.timeout("15 seconds"),
		),
	)
})

test("authenticated readers cannot forge writer grants and revoked writers cannot reuse sessions", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let identity = yield* EventLog.makeIdentity
			let writer = { ...identity, publicKey: "writer-grant" }
			let reader = { ...identity, publicKey: "reader-grant" }
			let access = yield* Access
			yield* SubscriptionRef.set(
				access.grants,
				new Map([
					[writer.publicKey, "writer"],
					[reader.publicKey, "reader"],
				]),
			)
			let server = yield* SocketServer.SocketServer
			let url = NetAddress.formatUrlUnsafe(server.address, "ws")
			let sender = yield* makeRemote(url)
			let receiver = yield* makeConnection(url)
			yield* receiver.remote
				.whenAuthenticated(Effect.void)
				.pipe(Effect.provideService(EventLog.Identity, reader))
			let encryption = yield* EventLogEncryption.EventLogEncryption
			let changed = entry("Forged writer edit")
			let encrypted = yield* encryption.encrypt(writer, [changed])
			let encryptedEntry = encrypted[0]
			if (!encryptedEntry) return yield* Effect.die("Missing encrypted entry")
			let data = yield* WriteEntries.encode(
				new WriteEntries({
					publicKey: writer.publicKey,
					storeId,
					encryptedEntries: [{ ...encryptedEntry, entryId: changed.id }],
				}),
			)
			let denied = yield* receiver.rpc["EventLog.WriteSingle"]({ data }).pipe(
				Effect.flip,
			)
			if (!EventLogProtocolError.is(denied))
				return yield* Effect.die("Expected protocol permission denial")
			expect(denied.code).toBe("Forbidden")
			expect(yield* Ref.get(access.writes)).toBe(0)
			yield* sender.write({
				identity: writer,
				storeId,
				entries: [entry("Before")],
			})
			yield* SubscriptionRef.set(
				access.grants,
				new Map([[reader.publicKey, "reader"]]),
			)
			let revoked = yield* sender
				.write({ identity: writer, storeId, entries: [entry("After")] })
				.pipe(Effect.exit)
			expect(Exit.isFailure(revoked)).toBe(true)
			expect(yield* Ref.get(access.writes)).toBe(1)
		}).pipe(
			Effect.provide(serverLayer("forged-revoked-grants")),
			Effect.provide(EventLogEncryption.layerSubtle),
			Effect.scoped,
			Effect.timeout("15 seconds"),
		),
	)
})

test("a fresh native journal seeds an encrypted checkpoint and downloads only its tail", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let identity = yield* EventLog.makeIdentity
			let writer = { ...identity, publicKey: "owner-grant" }
			let reader = { ...identity, publicKey: "reader-grant" }
			let access = yield* Access
			yield* SubscriptionRef.set(
				access.grants,
				new Map([
					[writer.publicKey, "owner"],
					[reader.publicKey, "reader"],
				]),
			)
			let server = yield* SocketServer.SocketServer
			let url = NetAddress.formatUrlUnsafe(server.address, "ws")
			let sender = yield* makeRemote(url)
			let receiver = yield* makeRemote(url)
			let source = new Replica("checkpoint-source")
			let operationCodec = SchemaBinary.toCodec(OperationEnvelopeSchema)
			let snapshotCodec = SchemaBinary.toCodec(Schema.String)
			let history: EventJournal.Entry[] = []
			for (let index = 0; index < 64; index++) {
				let payload = yield* Schema.encodeEffect(operationCodec)(
					source.set("document", "title", `Revision ${index}`),
				)
				history.push(
					new EventJournal.Entry({
						id: EventJournal.makeEntryIdUnsafe(),
						event: "DocumentChanged",
						primaryKey: "document",
						payload,
					}),
				)
			}
			yield* sender.write({ identity: writer, storeId, entries: history })
			let snapshot = new EventJournal.Entry({
				id: EventJournal.makeEntryIdUnsafe(),
				event: "WorkspaceCheckpoint",
				primaryKey: "workspace",
				payload: yield* Schema.encodeEffect(snapshotCodec)(
					JSON.stringify(source.checkpoint()),
				),
			})
			yield* sender.write({ identity: writer, storeId, entries: [snapshot] })
			let tail = new EventJournal.Entry({
				id: EventJournal.makeEntryIdUnsafe(),
				event: "DocumentChanged",
				primaryKey: "document",
				payload: yield* Schema.encodeEffect(operationCodec)(
					source.set("document", "title", "Current title"),
				),
			})
			yield* sender.write({ identity: writer, storeId, entries: [tail] })
			let storage = yield* EventLogServerEncrypted.Storage
			let downloaded = yield* storage
				.changes("workspace", storeId, history.length + 1)
				.pipe(Stream.take(1), Stream.runCollect)
			let encryption = yield* EventLogEncryption.EventLogEncryption
			let decrypted = yield* encryption.decrypt(reader, downloaded)
			let checkpoint = decrypted[0]
			if (!checkpoint) return yield* Effect.die("Missing checkpoint")
			let client = yield* makeDocumentClient(reader, "fresh-journal")
			yield* client.seed(checkpoint, receiver.id)
			expect((yield* client.read).fields("document").title).toBe("Revision 63")
			expect(yield* client.journal.entries).toHaveLength(1)
			let startSequence = yield* client.journal.nextRemoteSequence(receiver.id)
			expect(startSequence).toBe(history.length + 2)
			yield* client.connect(url)
			let received = yield* waitFor(
				client.journal.entries,
				entries => entries.length === 2,
			)
			expect(received.some(entry => entry.idString === tail.idString)).toBe(
				true,
			)
			expect((yield* client.read).fields("document")).toEqual(
				source.fields("document"),
			)
			expect(yield* Ref.get(access.starts)).toEqual([startSequence])
			let reopened = yield* makeDocumentClient(reader, "fresh-journal")
			expect((yield* reopened.read).fields("document")).toEqual(
				source.fields("document"),
			)
			expect(yield* Ref.get(access.starts)).toEqual([startSequence])
			yield* reopened.connect(url)
			expect(
				yield* waitFor(Ref.get(access.starts), starts => starts.length === 2),
			).toEqual([startSequence, startSequence + 1])
		}).pipe(
			Effect.provide(serverLayer("checkpoint-tail")),
			Effect.provide(EventLogEncryption.layerSubtle),
			Effect.scoped,
			Effect.timeout("15 seconds"),
		),
	)
})

test("native EventLog journals offline, registers later, and converges concurrent writers with a reader", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let identity = yield* EventLog.makeIdentity
			let writerA = { ...identity, publicKey: "writer-a" }
			let writerB = { ...identity, publicKey: "writer-b" }
			let reader = { ...identity, publicKey: "reader" }
			let access = yield* Access
			yield* SubscriptionRef.set(
				access.grants,
				new Map([
					[writerA.publicKey, "writer"],
					[writerB.publicKey, "writer"],
					[reader.publicKey, "reader"],
				]),
			)
			let first = yield* makeDocumentClient(writerA, "writer-a")
			let draft = new Replica("offline-writer")
			let initial = draft.edit("document", "Before")
			if (!initial) return yield* Effect.die("Missing initial operation")
			yield* first.write(initial)
			expect((yield* first.read).text("document")).toBe("Before")
			expect(yield* Ref.get(access.writes)).toBe(0)
			let server = yield* SocketServer.SocketServer
			let url = NetAddress.formatUrlUnsafe(server.address, "ws")
			let firstRemote = yield* first.connect(url)
			let second = yield* makeDocumentClient(writerB, "writer-b")
			let secondRemote = yield* second.connect(url)
			yield* waitFor(second.journal.entries, entries => entries.length === 1)
			let firstDraft = yield* first.read
			let secondDraft = yield* second.read
			let firstEdit = firstDraft.edit("document", "Before A")
			let secondEdit = secondDraft.edit("document", "Before B")
			if (!firstEdit || !secondEdit)
				return yield* Effect.die("Missing concurrent operations")
			yield* Effect.all([first.write(firstEdit), second.write(secondEdit)], {
				concurrency: "unbounded",
			})
			for (let { client, remote } of [
				{ client: first, remote: firstRemote },
				{ client: second, remote: secondRemote },
			]) {
				yield* waitFor(client.journal.entries, entries => entries.length === 3)
				yield* waitFor(
					client.journal.withRemoteUncommited(remote.id, entries =>
						Effect.succeed(entries.length),
					),
					Option.isNone,
				)
			}
			let firstState = yield* first.read
			let secondState = yield* second.read
			expect(firstState.text("document")).toBe(secondState.text("document"))
			expect(firstState.text("document")).toContain("A")
			expect(firstState.text("document")).toContain("B")
			let third = yield* makeDocumentClient(reader, "native-reader")
			yield* third.connect(url)
			yield* waitFor(third.journal.entries, entries => entries.length === 3)
			expect((yield* third.read).text("document")).toBe(
				firstState.text("document"),
			)
		}).pipe(
			Effect.provide(serverLayer("native-convergence")),
			Effect.provide(EventLogEncryption.layerSubtle),
			Effect.scoped,
			Effect.timeout("15 seconds"),
		),
	)
})
