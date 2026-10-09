import * as Context from "effect/Context"
import * as Config from "effect/Config"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Cache from "effect/Cache"
import * as Semaphore from "effect/Semaphore"
import * as Redacted from "effect/Redacted"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import * as EventGroup from "effect/eventlog/EventGroup"
import * as EventLog from "effect/eventlog/EventLog"
import * as EventLogEncryption from "effect/eventlog/EventLogEncryption"
import * as Migrator from "effect/sql/Migrator"
import * as SqlEventJournal from "effect/eventlog/SqlEventJournal"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlError from "effect/sql/SqlError"
import * as SqlSchema from "effect/sql/SqlSchema"
import { DocumentBlobObjects } from "./document-blob-objects"
import { webCryptoLayer } from "../platform/web-crypto"
import { IdentifierSchema } from "../shared/model"
import { decode, encode } from "../shared/base64"
import { InvitationRevoked } from "../shared/invitations"
import type { InvitationDescription } from "../shared/invitations"
import { Replica } from "../shared/crdt"
import { compactCheckpoint } from "../shared/checkpoint"
import {
	ResourceUnavailable,
	PermissionDenied,
	AccessConflict,
	applyAction,
	CommittedActionSchema,
	DocumentActionSchema,
	DocumentConflict,
	DocumentHistoryUnavailable,
	DocumentSnapshotSchema,
	ActionChainSchema,
	ActionIdSchema,
	restoreSnapshot,
	committedAction,
	admitClocks,
	validateActionIdentity,
	validateAction,
} from "../shared/document-actions"
import { sourceMetadataFields } from "../shared/document-metadata"
import {
	makeWorkspaceProjection,
	allowsWorkspace,
	attenuateRole,
} from "./workspace-projection"
import { validateTextCausality } from "../shared/document-causality"
import {
	BlobBytesMissing,
	BlobQuotaExceeded,
	UndoUnavailable,
	StaleRevision,
} from "../shared/document-errors"
import type { DocumentRevision } from "../shared/document-errors"
import type { PreferencePatch } from "../shared/preferences"
import { personalWorkspaceRequest, publicMember } from "../shared/workspace"
import {
	BlobDigestSchema,
	BlobChunkDescriptorSchema,
	verifyBlobChunk,
	hasBlobReferences,
	requiredBlobChunks,
	maximumDocumentBlobBytes,
} from "../shared/document-blobs"
import type { BlobChunkDescriptor } from "../shared/document-blobs"
import {
	Identity,
	WorkspaceDeletionRefused,
	WorkspaceFactSchema,
} from "../shared/workspace"
import type { WorkspaceFact } from "../shared/workspace"
import type {
	CommittedAction,
	DocumentAction,
	DocumentSnapshot,
} from "../shared/document-actions"

export {
	ResourceUnavailable,
	PermissionDenied,
	AccessConflict,
} from "../shared/document-actions"

type LiveNotice =
	| { kind: "document"; document: string; subjects: ReadonlySet<string> }
	| {
			kind: "workspace"
			subjects: ReadonlySet<string>
			documents: ReadonlySet<string>
	  }
	| { kind: "preferences"; subject: string; subjects: ReadonlySet<string> }

interface DocumentState {
	replica: Replica
	log: string
	position: number
	version: number
	fingerprint: string
	serialized?: string
}
type InvitationTarget = { workspace: string } | { document: string }
interface DocumentSession {
	state: DocumentState | undefined
	gate: Semaphore.Semaphore
	uncommitted: boolean
}
let checkpointInterval = 100
class ReadDatabase extends Context.Service<ReadDatabase, SqlClient.SqlClient>()(
	"DocumentStore/ReadDatabase",
) {}

export class Principal extends Context.Service<
	Principal,
	{
		subject: string
		actors: ReadonlyArray<string>
		role: "owner" | "writer" | "reader"
	}
>()("DocumentStore/Principal") {}

export class TransactionOwnershipError extends Schema.TaggedError<TransactionOwnershipError>()(
	"TransactionOwnershipError",
	{ message: Schema.String },
) {}
export class DocumentStore extends Context.Service<
	DocumentStore,
	Effect.Success<ReturnType<typeof makeDocumentStore>>["documentFixture"]
>()("DocumentStore/Store") {
	static get live() {
		return Layer.effect(
			DocumentStore,
			StoreEngine.pipe(Effect.map(store => store.documentFixture)),
		).pipe(Layer.provide(documentDatabaseLayer))
	}
}
export class WorkspaceStore extends Context.Service<
	WorkspaceStore,
	Effect.Success<ReturnType<typeof makeDocumentStore>>["workspace"]
>()("WorkspaceStore/Store") {
	static get live() {
		return Layer.effect(
			WorkspaceStore,
			StoreEngine.pipe(Effect.map(store => store.workspace)),
		).pipe(Layer.provide(documentDatabaseLayer))
	}
}
class StoreEngine extends Context.Service<
	StoreEngine,
	Effect.Success<ReturnType<typeof makeDocumentStore>>
>()("WorkspaceStore/StoreEngine") {}
export let documentDatabaseLayer = Layer.suspend(() =>
	Layer.effect(StoreEngine, makeDocumentStore()).pipe(
		Layer.provide(
			Layer.merge(
				EventLog.layer(events, handlers).pipe(
					Layer.provideMerge(SqlEventJournal.layer()),
					Layer.provideMerge(webCryptoLayer),
					Layer.provide(
						Layer.effect(EventLog.Identity, journalIdentity()).pipe(
							Layer.provide(EventLogEncryption.layerSubtle),
						),
					),
				),
				Layer.effect(ReadDatabase, SqlClient.SqlClient),
			),
		),
	),
)

function journalIdentity() {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		let encryption = yield* EventLogEncryption.EventLogEncryption
		yield* Migrator.make({})({
			table: "document_identity_migrations",
			loader: Migrator.fromRecord({
				"001_journal_identity": identitySchema.pipe(
					Effect.provideService(
						EventLogEncryption.EventLogEncryption,
						encryption,
					),
				),
			}),
		})
		let read = SqlSchema.findOneOption({
			Request: Schema.Void,
			Result: Schema.Struct({
				publicKey: Schema.String,
				secret: Schema.Uint8Array,
			}),
			execute: () =>
				sql`SELECT publicKey,secret FROM journal_identity WHERE id=1`,
		})
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				let existing = yield* read(undefined)
				if (Option.isSome(existing))
					return {
						publicKey: existing.value.publicKey,
						privateKey: Redacted.make(new Uint8Array(existing.value.secret)),
					}
				let identity = yield* EventLog.makeIdentity
				yield* sql`INSERT INTO journal_identity(id,publicKey,secret) VALUES (1,${identity.publicKey},${Redacted.value(identity.privateKey)})`
				return identity
			}),
		)
	})
}
let identitySchema = Effect.gen(function* () {
	let sql = yield* SqlClient.SqlClient
	yield* sql`CREATE TABLE IF NOT EXISTS journal_identity (id INTEGER PRIMARY KEY CHECK(id=1),publicKey TEXT NOT NULL,secret BLOB NOT NULL)`
	let columns = yield* SqlSchema.findAll({
		Request: Schema.Void,
		Result: Schema.Struct({ name: Schema.String }),
		execute: () => sql`PRAGMA table_info(journal_identity)`,
	})(undefined)
	if (!columns.some(column => column.name === "publicKey")) {
		yield* sql`ALTER TABLE journal_identity ADD COLUMN publicKey TEXT NOT NULL DEFAULT ''`
		let identity = yield* EventLog.makeIdentity
		yield* sql`UPDATE journal_identity SET publicKey=${identity.publicKey}`
	}
})

export function commit(action: DocumentAction) {
	return DocumentStore.use(store => store.commit(action))
}
export function readSnapshot(document: string) {
	return DocumentStore.use(store => store.snapshot(document))
}
export function readHistory(document: string, after = 0, log?: string) {
	return DocumentStore.use(store => store.history(document, after, log))
}
export function readAction(document: string, id: string) {
	return DocumentStore.use(store => store.action(document, id))
}

let WithdrawalSchema = Schema.Struct({
	action: DocumentActionSchema,
	subject: IdentifierSchema,
})
let group = EventGroup.empty
	.add({
		tag: "DocumentWithdrawn",
		primaryKey: fact => fact.action.document,
		payload: WithdrawalSchema,
		success: Schema.Void,
		error: Schema.Union([DocumentConflict, SqlError.SqlError]),
	})
	.add({
		tag: "DocumentChanged",
		primaryKey: action => action.document,
		payload: CommittedActionSchema,
		success: Schema.Natural,
		error: Schema.Union([DocumentConflict, UndoUnavailable, SqlError.SqlError]),
	})
	.add({
		tag: "WorkspaceChanged",
		primaryKey: fact => fact.workspace,
		payload: WorkspaceFactSchema,
		success: Schema.Natural,
		error: Schema.Union([DocumentConflict, SqlError.SqlError]),
	})
let events = EventLog.schema(group)
let binary = SchemaBinary.toCodec(CommittedActionSchema)
let proposalJson = Schema.encodeSync(
	Schema.fromJsonString(DocumentActionSchema),
)
let HeadSchema = Schema.Struct({
	log: Schema.String,
	position: Schema.Natural,
	version: Schema.Natural,
	state: Schema.String,
})
let TipSchema = Schema.Struct({
	log: Schema.String,
	position: Schema.Natural,
	version: Schema.Natural,
	fingerprint: Schema.String,
})
let ReceiptSchema = Schema.Struct({
	position: Schema.Natural,
	fingerprint: Schema.String,
})
let PayloadSchema = Schema.Struct({
	position: Schema.Natural,
	action: Schema.String,
	payload: Schema.Union([Schema.Uint8Array, Schema.Null]),
})
let ActionIdentitySchema = Schema.Struct({
	document: Schema.String,
	id: Schema.String,
})
let handlers = EventLog.group(group, handlers =>
	Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		let crypto = yield* Crypto.Crypto
		let queries = makeQueries(sql)
		let workspace = makeWorkspaceProjection(sql)
		yield* workspace.initialize()
		yield* sql`CREATE TABLE IF NOT EXISTS document_heads (document TEXT PRIMARY KEY, log TEXT NOT NULL, position INTEGER NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL)`
		yield* sql`CREATE TABLE IF NOT EXISTS document_tips (document TEXT PRIMARY KEY, log TEXT NOT NULL, position INTEGER NOT NULL, version INTEGER NOT NULL, fingerprint TEXT NOT NULL)`
		yield* sql`CREATE TABLE IF NOT EXISTS document_actions (position INTEGER PRIMARY KEY AUTOINCREMENT, document TEXT NOT NULL, action TEXT NOT NULL, entry BLOB NOT NULL, fingerprint TEXT NOT NULL, UNIQUE(document,action))`
		yield* sql`CREATE INDEX IF NOT EXISTS document_action_position ON document_actions(document,position)`
		yield* sql`CREATE TABLE IF NOT EXISTS document_targets (target TEXT PRIMARY KEY, document TEXT NOT NULL)`
		yield* sql`CREATE TABLE IF NOT EXISTS document_operation_ids (document TEXT NOT NULL, id TEXT NOT NULL, action TEXT NOT NULL, PRIMARY KEY(document,id))`
		yield* sql`CREATE TABLE IF NOT EXISTS document_actor_subjects (actor TEXT PRIMARY KEY, subject TEXT NOT NULL, document TEXT NOT NULL)`
		yield* initializeCompensations(sql)
		yield* Migrator.make({})({
			table: "document_withdrawal_migrations",
			loader: Migrator.fromRecord({
				"001_withdrawals": Effect.gen(function* () {
					yield* sql`CREATE TABLE document_withdrawals (document TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(document,action))`
					yield* sql`CREATE TABLE document_clock_reservations (document TEXT NOT NULL, subject TEXT NOT NULL, clock INTEGER NOT NULL, PRIMARY KEY(document,subject))`
				}),
			}),
		})
		return handlers
			.handle("DocumentWithdrawn", ({ payload }) =>
				Effect.gen(function* () {
					let { action, subject } = payload
					let clock = action.changes.reduce(
						(maximum, change) => Math.max(maximum, change.clock),
						0,
					)
					let operations = yield* validateActionIdentity(action)
					yield* sql`INSERT INTO document_actor_subjects VALUES (${action.actor},${subject},${action.document}) ON CONFLICT DO NOTHING`
					let actor = yield* queries.actorSubject(action.actor)
					if (
						Option.isNone(actor) ||
						actor.value.subject !== subject ||
						actor.value.document !== action.document
					)
						return yield* conflict("Actor identity is not authorized")
					if (
						Option.isSome(
							yield* queries.receipt({
								document: action.document,
								id: action.id,
							}),
						)
					)
						return yield* conflict("A committed action cannot be withdrawn")
					yield* sql`INSERT INTO document_withdrawals VALUES (${action.document},${action.id},${subject},${yield* hashWithdrawal(crypto, action)})`
					for (let change of operations) {
						if (
							Option.isSome(
								yield* queries.operation({
									document: action.document,
									id: change.id,
								}),
							)
						)
							return yield* conflict("Operation identity is already admitted")
						yield* sql`INSERT INTO document_operation_ids VALUES (${action.document},${change.id},${action.id})`
					}
					yield* sql`INSERT INTO document_clock_reservations VALUES (${action.document},${subject},${clock}) ON CONFLICT(document,subject) DO UPDATE SET clock=MAX(document_clock_reservations.clock,excluded.clock)`
				}).pipe(
					Effect.mapError(cause =>
						cause._tag === "DocumentConflict" || cause._tag === "SqlError"
							? cause
							: new DocumentConflict({ message: cause.message }),
					),
				),
			)
			.handle("WorkspaceChanged", ({ payload, entry }) =>
				Effect.gen(function* () {
					return yield* workspace.project(
						payload,
						entry.id,
						yield* hashWorkspace(crypto, payload),
					)
				}).pipe(
					Effect.mapError(cause =>
						cause._tag === "DocumentConflict" || cause._tag === "SqlError"
							? cause
							: new DocumentConflict({ message: cause.message }),
					),
				),
			)
			.handle("DocumentChanged", ({ payload, entry }) =>
				Effect.gen(function* () {
					let current = Option.getOrUndefined(
						yield* queries.notice(payload.document),
					)
					let fingerprint = yield* hashProposal(crypto, payload)
					yield* sql`INSERT INTO document_actions(document,action,entry,fingerprint) VALUES (${payload.document},${payload.id},${entry.id},${fingerprint})`
					if (payload.undoOf) {
						yield* sql`INSERT INTO document_compensations VALUES (${payload.document},${payload.undoOf},${payload.id}) ON CONFLICT(document,original) DO NOTHING`
						let compensation = yield* queries.compensation({
							document: payload.document,
							id: payload.undoOf,
						})
						if (
							Option.isNone(compensation) ||
							compensation.value.action !== payload.id
						)
							return yield* new UndoUnavailable({
								reason: "Superseded",
								message:
									"This action was already compensated; undo the latest action in its chain",
							})
					}
					let receipt = yield* queries.receipt({
						document: payload.document,
						id: payload.id,
					})
					if (Option.isNone(receipt))
						return yield* Effect.fail(
							new DocumentConflict({ message: "Missing action receipt" }),
						)
					let log = current?.log ?? (yield* crypto.randomUUIDv4)
					yield* sql`INSERT INTO document_tips VALUES (${payload.document},${log},${receipt.value.position},${(current?.version ?? 0) + 1},${fingerprint}) ON CONFLICT(document) DO UPDATE SET position=excluded.position,version=excluded.version,fingerprint=excluded.fingerprint`
					return receipt.value.position
				}).pipe(
					Effect.mapError(cause =>
						cause._tag === "DocumentConflict" ||
						cause._tag === "UndoUnavailable" ||
						cause._tag === "SqlError"
							? cause
							: new DocumentConflict({ message: cause.message }),
					),
				),
			)
	}),
)

function makeDocumentStore() {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		let crypto = yield* Crypto.Crypto
		let blobObjects = yield* DocumentBlobObjects
		let write = yield* EventLog.makeClient(events)
		let blobLimit = yield* Config.schema(
			Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
			"ALKALYE_DOCUMENT_BLOB_BYTES",
		).pipe(Config.withDefault(maximumDocumentBlobBytes))
		let accountBlobLimit = yield* Config.schema(
			Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
			"ALKALYE_ACCOUNT_BLOB_BYTES",
		).pipe(Config.withDefault(maximumDocumentBlobBytes * 4))
		let serverBlobLimit = yield* Config.schema(
			Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
			"ALKALYE_SERVER_BLOB_BYTES",
		).pipe(Config.withDefault(maximumDocumentBlobBytes * 16))
		let queries = makeQueries(sql)
		let workspace = makeWorkspaceProjection(sql)
		let sessions = yield* Cache.make({
			lookup: (_document: string) => makeSession(),
			capacity: 32,
		})
		let readSql = yield* ReadDatabase
		let readQueries = makeQueries(readSql)
		let readWorkspace = makeWorkspaceProjection(readSql)
		yield* sql`CREATE TABLE IF NOT EXISTS document_blobs (document TEXT NOT NULL, digest TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(document,digest))`
		yield* Migrator.make({})({
			table: "document_blob_migrations",
			loader: Migrator.fromRecord({
				"001_external_blob_objects": Effect.gen(function* () {
					yield* sql`ALTER TABLE document_blobs ADD COLUMN size INTEGER`
					yield* sql`ALTER TABLE document_blobs ADD COLUMN external INTEGER NOT NULL DEFAULT 0`
				}),
				"002_blob_object_receipts": Effect.gen(function* () {
					yield* sql`ALTER TABLE document_blobs ADD COLUMN object_key TEXT`
				}),
				"003_blob_object_versions": Effect.gen(function* () {
					yield* sql`ALTER TABLE document_blobs ADD COLUMN object_receipt TEXT`
				}),
			}),
		})
		let readBlob = SqlSchema.findOneOption({
			Request: Schema.Struct({
				document: IdentifierSchema,
				digest: BlobDigestSchema,
			}),
			Result: Schema.Struct({
				bytes: Schema.Unknown,
				external: Schema.Literals([0, 1]),
				object_key: Schema.NullOr(Schema.String),
				object_receipt: Schema.NullOr(Schema.String),
			}),
			execute: ({ document, digest }) =>
				readSql`SELECT bytes,external,object_key,object_receipt FROM document_blobs WHERE document=${document} AND digest=${digest}`,
		})
		let storedBlobSize = SqlSchema.findOneOption({
			Request: Schema.Struct({
				document: IdentifierSchema,
				digest: BlobDigestSchema,
			}),
			Result: Schema.Struct({ size: Schema.Natural }),
			execute: ({ document, digest }) =>
				sql`SELECT CASE WHEN external=1 THEN size ELSE length(bytes) END AS size FROM document_blobs WHERE document=${document} AND digest=${digest}`,
		})
		let accountBlobBytes = SqlSchema.findOne({
			Request: IdentifierSchema,
			Result: Schema.Struct({ size: Schema.Natural }),
			execute: owner =>
				sql`SELECT COALESCE(SUM(CASE WHEN b.external=1 THEN b.size ELSE length(b.bytes) END),0) AS size FROM document_blobs b JOIN workspace_documents d ON d.document=b.document JOIN workspaces w ON w.workspace=d.workspace WHERE w.owner=${owner}`,
		})
		let blobBytes = SqlSchema.findOne({
			Request: IdentifierSchema,
			Result: Schema.Struct({ size: Schema.Natural }),
			execute: document =>
				sql`SELECT COALESCE(SUM(CASE WHEN external=1 THEN size ELSE length(bytes) END),0) AS size FROM document_blobs WHERE document=${document}`,
		})
		let serverBlobBytes = SqlSchema.findOne({
			Request: Schema.Void,
			Result: Schema.Struct({ size: Schema.Natural }),
			execute: () =>
				sql`SELECT COALESCE(SUM(CASE WHEN external=1 THEN size ELSE length(bytes) END),0) AS size FROM document_blobs`,
		})
		let knownBlobs = SqlSchema.findAll({
			Request: Schema.Struct({
				document: IdentifierSchema,
				chunks: Schema.Array(BlobChunkDescriptorSchema).check(
					Schema.isMaxLength(4096),
				),
			}),
			Result: Schema.Struct({ digest: BlobDigestSchema, size: Schema.Natural }),
			execute: ({ document, chunks }) =>
				readSql`SELECT digest, CASE WHEN external=1 THEN size ELSE length(bytes) END AS size FROM document_blobs WHERE document=${document} AND (external=1 OR typeof(bytes)='blob') AND ${readSql.in(
					"digest",
					chunks.map(chunk => chunk.digest),
				)}`,
		})
		yield* sql.withTransaction(
			Effect.gen(function* () {
				for (let summary of yield* workspace.uninitializedSummaries(
					undefined,
				)) {
					let tip = Option.getOrUndefined(
						yield* queries.notice(summary.document),
					)
					let state = yield* refresh(
						summary.document,
						yield* makeSession(),
						tip,
					)
					if (!state.log)
						return yield* Effect.fail(
							new DocumentConflict({
								message: "Document summary has no durable state",
							}),
						)
					yield* workspace.rebuildSummary(
						state.replica,
						summary.document,
						state.log,
						state.position,
					)
				}
			}),
		)
		// Notices wake readers to check their subscribed heads; history remains in SQLite.
		let notices = yield* PubSub.sliding<{
			document: string
			position: number
			log: string
		}>(1)
		yield* Effect.addFinalizer(() => PubSub.shutdown(notices))
		let wakeups = yield* PubSub.sliding<LiveNotice>(64)
		yield* Effect.addFinalizer(() => PubSub.shutdown(wakeups))
		return {
			documentFixture: {
				commit: commitProposal,
				withdraw: withdrawProposal,
				snapshot,
				history,
				action,
				chain,
				changes: PubSub.subscribe(notices),
			},
			workspace: {
				preferences: () =>
					Identity.use(identity =>
						readSql.withTransaction(
							readWorkspace.preferences(identity.subject),
						),
					),
				savePreferences: Effect.fn("WorkspaceStore.savePreferences")(
					savePreferences,
				),
				missingBlobs: Effect.fn("WorkspaceStore.missingBlobs")(missingBlobs),
				putBlob: Effect.fn("WorkspaceStore.putBlob")(putBlob),
				getBlob: Effect.fn("WorkspaceStore.getBlob")(getBlob),
				create: Effect.fn("WorkspaceStore.create")(createWorkspace),
				rename: Effect.fn("WorkspaceStore.rename")(renameWorkspace),
				avatar: Effect.fn("WorkspaceStore.avatar")(changeAvatar),
				remove: Effect.fn("WorkspaceStore.remove")(deleteWorkspace),
				membership: Effect.fn("WorkspaceStore.membership")(changeMembership),
				moveDocument: Effect.fn("WorkspaceStore.moveDocument")(moveDocument),
				leave: Effect.fn("WorkspaceStore.leave")(leave),
				createInvitation: Effect.fn("WorkspaceStore.createInvitation")(
					createInvitation,
				),
				invitations: listInvitations,
				revokeInvitation: Effect.fn("WorkspaceStore.revokeInvitation")(
					revokeInvitation,
				),
				describeInvitation,
				acceptInvitation: Effect.fn("WorkspaceStore.acceptInvitation")(
					acceptInvitation,
				),
				leaveInvitation: Effect.fn("WorkspaceStore.leaveInvitation")(
					leaveInvitation,
				),
				createDocument: Effect.fn("WorkspaceStore.createDocument")(
					createDocument,
				),
				commit: Effect.fn("WorkspaceStore.commit")(commitAuthorized),
				withdraw: Effect.fn("WorkspaceStore.withdraw")(withdrawAuthorized),
				snapshot: (document: string) =>
					Identity.use(identity => snapshot(document, identity)),
				history: (document: string, after = 0, log?: string, limit?: number) =>
					Identity.use(identity =>
						history(document, after, log, identity, limit),
					),
				action: (document: string, id: string) =>
					Identity.use(identity => action(document, id, identity)),
				chain: (document: string, id: string) =>
					Identity.use(identity => chain(document, id, identity)),
				workspaceSnapshot: Effect.fn("WorkspaceStore.workspaceSnapshot")(
					workspaceSnapshot,
				),
				workspaceHistory: Effect.fn("WorkspaceStore.workspaceHistory")(
					workspaceHistory,
				),
				accessRole: (document: string, subject: string) =>
					Identity.use(identity =>
						readSql.withTransaction(
							Effect.gen(function* () {
								if (
									identity.subject === subject &&
									identity.access === undefined
								) {
									let role = yield* readWorkspace.documentRole(
										document,
										subject,
									)
									return role ?? (yield* unavailable())
								}
								yield* authorizeRead(document, identity)
								return yield* readWorkspace.documentRole(document, subject)
							}),
						),
					),
				sharedDocuments: () =>
					Identity.use(identity =>
						readSql.withTransaction(
							readWorkspace.sharedDocuments(identity.subject),
						),
					),
				library: () =>
					Identity.use(identity =>
						readSql.withTransaction(
							readWorkspace.library(identity.subject).pipe(
								Effect.map(library => ({
									workspaces: library.workspaces
										.filter(space =>
											allowsWorkspace(space.workspace, identity.access),
										)
										.map(space => ({
											...space,
											role:
												attenuateRole(space.role, identity.access) ?? "reader",
										})),
									documents: library.documents
										.filter(document =>
											allowsWorkspace(document.workspace, identity.access),
										)
										.map(document => ({
											...document,
											role:
												attenuateRole(document.role, identity.access) ??
												"reader",
										})),
								})),
							),
						),
					),
				changes: PubSub.subscribe(wakeups),
			},
		}

		function missingBlobs(
			document: string,
			chunks: ReadonlyArray<BlobChunkDescriptor>,
		) {
			return Identity.use(identity =>
				readSql.withTransaction(
					Effect.gen(function* () {
						yield* readWorkspace
							.documentRole(document, identity.subject, identity.access)
							.pipe(Effect.flatMap(authorizeWriting))
						let sizes = new Map<string, number>()
						for (let chunk of chunks) {
							let previous = sizes.get(chunk.digest)
							if (previous !== undefined && previous !== chunk.size)
								return yield* conflict(
									"One blob digest cannot have different sizes",
								)
							sizes.set(chunk.digest, chunk.size)
						}
						for (let row of yield* knownBlobs({ document, chunks }))
							if (sizes.get(row.digest) === row.size) sizes.delete(row.digest)
						return [...sizes.keys()]
					}),
				),
			)
		}
		function putBlob(document: string, digest: string, input: Uint8Array) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				yield* readSql.withTransaction(
					readWorkspace
						.documentRole(document, identity.subject, identity.access)
						.pipe(Effect.flatMap(authorizeWriting)),
				)
				let bytes = new Uint8Array(input)
				yield* verifyBlobChunk(digest, bytes).pipe(
					Effect.provideService(Crypto.Crypto, crypto),
				)
				let object = blobObjects
					? yield* blobObjects
							.put(document, digest, bytes)
							.pipe(Effect.mapError(blobObjectFailure))
					: null
				return yield* transact(
					Effect.gen(function* () {
						yield* workspace
							.documentRole(document, identity.subject, identity.access)
							.pipe(Effect.flatMap(authorizeWriting))
						let existing = yield* storedBlobSize({ document, digest })
						let additional =
							bytes.length - (Option.isSome(existing) ? existing.value.size : 0)
						if ((yield* blobBytes(document)).size + additional > blobLimit)
							return yield* Effect.fail(
								new BlobQuotaExceeded({
									scope: "document",
									limit: blobLimit,
									message:
										"This document's retained attachments exceed its storage limit",
								}),
							)
						let associated = yield* workspace.document(document)
						if (Option.isNone(associated)) return yield* unavailable()
						let space = yield* workspace.workspace(associated.value.workspace)
						if (Option.isNone(space)) return yield* unavailable()
						if (
							(yield* accountBlobBytes(space.value.owner)).size + additional >
							accountBlobLimit
						)
							return yield* Effect.fail(
								new BlobQuotaExceeded({
									scope: "account",
									limit: accountBlobLimit,
									message:
										"This account's retained attachments exceed its storage limit",
								}),
							)
						if (
							(yield* serverBlobBytes(undefined)).size + additional >
							serverBlobLimit
						)
							return yield* Effect.fail(
								new BlobQuotaExceeded({
									scope: "server",
									limit: serverBlobLimit,
									message:
										"The server's retained attachments exceed its storage limit",
								}),
							)
						let storedBytes = blobObjects ? new Uint8Array() : bytes
						let external = blobObjects ? 1 : 0
						yield* sql`INSERT INTO document_blobs(document,digest,bytes,size,external,object_key,object_receipt) VALUES (${document},${digest},${storedBytes},${bytes.length},${external},${object?.key ?? null},${object?.receipt ?? null}) ON CONFLICT(document,digest) DO UPDATE SET bytes=excluded.bytes,size=excluded.size,external=excluded.external,object_key=excluded.object_key,object_receipt=excluded.object_receipt WHERE document_blobs.bytes IS NOT excluded.bytes OR document_blobs.size IS NOT excluded.size OR document_blobs.external IS NOT excluded.external OR document_blobs.object_key IS NOT excluded.object_key OR document_blobs.object_receipt IS NOT excluded.object_receipt`
					}),
					() => Effect.void,
				)
			})
		}
		function getBlob(document: string, digest: string) {
			return Identity.use(identity =>
				Effect.gen(function* () {
					let corrupted: unknown
					let corruptedObjectKey: string | undefined
					let corruptedReceipt: string | null = null
					return yield* readSql
						.withTransaction(
							Effect.gen(function* () {
								yield* authorizeRead(document, identity)
								let stored = yield* readBlob({ document, digest })
								if (Option.isNone(stored)) return yield* unavailable()
								let bytes =
									stored.value.external === 1
										? blobObjects && stored.value.object_key !== null
											? yield* blobObjects
													.get(document, digest, stored.value.object_key)
													.pipe(Effect.mapError(blobObjectFailure))
											: undefined
										: stored.value.bytes
								return yield* verifyBlobChunk(digest, bytes).pipe(
									Effect.provideService(Crypto.Crypto, crypto),
									Effect.tapError(error =>
										Effect.sync(() => {
											if (error._tag === "BlobCorrupt") {
												corrupted = stored.value.bytes
												corruptedReceipt = stored.value.object_receipt
												corruptedObjectKey =
													stored.value.external === 1
														? (stored.value.object_key ?? undefined)
														: undefined
											}
										}),
									),
								)
							}),
						)
						.pipe(
							Effect.catchTag("BlobCorrupt", error =>
								transact(
									Effect.gen(function* () {
										if (
											!(yield* workspace.documentRole(
												document,
												identity.subject,
												identity.access,
											))
										)
											return yield* unavailable()
										if (corruptedObjectKey !== undefined)
											yield* sql`DELETE FROM document_blobs WHERE document=${document} AND digest=${digest} AND external=1 AND object_key=${corruptedObjectKey} AND object_receipt IS ${corruptedReceipt}`
										else if (corrupted instanceof Uint8Array)
											yield* sql`DELETE FROM document_blobs WHERE document=${document} AND digest=${digest} AND external=0 AND bytes=${corrupted}`
										else
											yield* sql`DELETE FROM document_blobs WHERE document=${document} AND digest=${digest} AND external=0 AND typeof(bytes)!='blob'`
									}),
									() => Effect.void,
								).pipe(Effect.andThen(Effect.fail(error))),
							),
						)
				}),
			)
		}
		function commitProposal(input: DocumentAction) {
			return Effect.gen(function* () {
				let action = yield* decodeProposal(input)
				let principal = yield* Principal
				yield* authorizeProposal(action, principal)
				return yield* withSession(action.document, session =>
					transact(
						Effect.gen(function* () {
							yield* refuseManaged(action.document, workspace)
							return yield* accept(action, principal, session)
						}),
						result => finish(action.document, session, result),
					),
				)
			})
		}
		function withdrawProposal(input: DocumentAction) {
			return Effect.gen(function* () {
				let action = yield* decodeProposal(input)
				let principal = yield* Principal
				return yield* withSession(action.document, session =>
					transact(
						refuseManaged(action.document, workspace).pipe(
							Effect.andThen(withdraw(action, principal, session)),
						),
						() => Effect.void,
					),
				)
			})
		}
		function withdrawAuthorized(input: DocumentAction) {
			return Effect.gen(function* () {
				let action = yield* decodeProposal(input)
				let identity = yield* Identity
				yield* readSql.withTransaction(authorizeRead(action.document, identity))
				return yield* withSession(action.document, session =>
					transact(
						Effect.gen(function* () {
							let role = yield* workspace.documentRole(
								action.document,
								identity.subject,
								identity.access,
							)
							if (!role) return yield* unavailable()
							return yield* withdraw(action, { ...identity, role }, session)
						}),
						() => Effect.void,
					),
				)
			})
		}
		function withdraw(
			action: DocumentAction,
			principal: typeof Principal.Service,
			session: DocumentSession,
		) {
			return Effect.gen(function* () {
				if (!principal.actors.includes(action.actor))
					return yield* conflict("Actor identity is not authorized")
				let operations = yield* validateActionIdentity(action)
				let previous = yield* queries.withdrawal({
					document: action.document,
					id: action.id,
				})
				let fingerprint = yield* hashWithdrawal(crypto, action)
				if (Option.isSome(previous)) {
					if (
						previous.value.subject !== principal.subject ||
						previous.value.fingerprint !== fingerprint
					)
						return yield* conflict("Action identity is immutable")
					return
				}
				if (principal.role === "reader") return yield* forbidden()
				if (
					Option.isSome(
						yield* queries.receipt({
							document: action.document,
							id: action.id,
						}),
					)
				)
					return yield* conflict("A committed action cannot be withdrawn")
				let base = yield* refresh(
					action.document,
					session,
					Option.getOrUndefined(yield* queries.notice(action.document)),
				)
				session.state = base
				let reservation = yield* queries.reservation({
					document: action.document,
					subject: principal.subject,
				})
				let frontier = Math.max(
					base.replica.clock,
					Option.isSome(reservation) ? reservation.value.clock : 0,
				)
				yield* Effect.try({
					try: () => admitClocks(frontier, operations),
					catch: cause =>
						new DocumentConflict({
							message:
								cause instanceof Error
									? cause.message
									: "Invalid withdrawal clocks",
						}),
				})
				yield* write("DocumentWithdrawn", {
					action,
					subject: principal.subject,
				}).pipe(
					Effect.catchTag("EventJournalError", error =>
						Effect.fail(
							SqlError.isSqlError(error.cause)
								? error.cause
								: new DocumentConflict({
										message: "Document journal write failed",
									}),
						),
					),
				)
			})
		}
		function commitAuthorized(
			input: DocumentAction,
			expected?: DocumentRevision,
		) {
			return Effect.gen(function* () {
				let action = yield* decodeProposal(input)
				let identity = yield* Identity
				if (!identity.actors.includes(action.actor))
					return yield* conflict("Actor identity is not authorized")
				yield* readSql.withTransaction(
					readWorkspace
						.documentRole(action.document, identity.subject, identity.access)
						.pipe(Effect.flatMap(authorizeWriting)),
				)
				return yield* withSession(action.document, session =>
					transact(
						Effect.gen(function* () {
							let role = yield* workspace.documentRole(
								action.document,
								identity.subject,
								identity.access,
							)
							if (!role) return yield* unavailable()
							if (role === "reader") return yield* forbidden()
							let principal = { ...identity, role }
							yield* authorizeProposal(action, principal, true)
							return yield* accept(action, principal, session, true, expected)
						}),
						result => finish(action.document, session, result, true),
					),
				)
			})
		}
		function createWorkspace(id: string, name: string, request: string) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				if (
					(id.startsWith("personal-") &&
						id !== "personal-" + identity.subject) ||
					!allowsWorkspace(id, identity.access) ||
					identity.access?.ceiling === "reader"
				)
					return yield* forbidden()
				let fact = yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
					id: request,
					workspace: id,
					subject: identity.subject,
					change: { kind: "created", name },
				})
				return yield* transact(
					Effect.gen(function* () {
						let current = yield* workspace.workspace(id)
						if (
							Option.isSome(current) &&
							current.value.owner !== identity.subject
						)
							return yield* forbidden()
						return yield* writeWorkspace(fact)
					}),
					finishWorkspace,
				)
			})
		}
		function savePreferences(patch: PreferencePatch, request: string) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				let id = "personal-" + identity.subject
				let fact = yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
					id: "preferences:" + request,
					workspace: id,
					subject: identity.subject,
					change: { kind: "preferences", patch },
				})
				yield* createWorkspace(id, "Personal", personalWorkspaceRequest)
				return yield* transact(
					Effect.gen(function* () {
						if (
							(yield* workspace.workspaceRole(
								id,
								identity.subject,
								identity.access,
							)) !== "owner"
						)
							return yield* forbidden()
						return yield* writeWorkspace(fact)
					}),
					finishWorkspace,
				)
			})
		}
		function renameWorkspace(id: string, name: string, request: string) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				let fact = yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
					id: request,
					workspace: id,
					subject: identity.subject,
					change: { kind: "renamed", name },
				})
				return yield* transact(
					Effect.gen(function* () {
						if (
							(yield* workspace.workspaceRole(
								id,
								identity.subject,
								identity.access,
							)) !== "owner"
						)
							return yield* forbidden()
						return yield* writeWorkspace(fact)
					}),
					finishWorkspace,
				)
			})
		}
		// Only an owner changes a space's avatar; personal workspaces have none.
		function changeAvatar(id: string, image: string | null, request: string) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				if (id.startsWith("personal-")) return yield* forbidden()
				let fact = yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
					id: request,
					workspace: id,
					subject: identity.subject,
					change: { kind: "avatar", image },
				})
				return yield* transact(
					Effect.gen(function* () {
						if (
							(yield* workspace.workspaceRole(
								id,
								identity.subject,
								identity.access,
							)) !== "owner"
						)
							return yield* forbidden()
						return yield* writeWorkspace(fact)
					}),
					finishWorkspace,
				)
			})
		}
		// Deletion tombstones the workspace: its documents leave every library and
		// stop granting access, while the journal keeps their history. Confirming
		// the current name refuses a deletion aimed at a workspace renamed since.
		function deleteWorkspace(id: string, name: string, request: string) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				if (identity.access) return yield* forbidden()
				let fact = yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
					id: "workspace-deleted:" + request,
					workspace: id,
					subject: identity.subject,
					change: { kind: "deleted" },
				})
				return yield* transact(
					Effect.gen(function* () {
						// A retried deletion returns its original receipt.
						if (Option.isSome(yield* workspace.receipt(fact)))
							return yield* writeWorkspace(fact)
						let role = yield* workspace.workspaceRole(id, identity.subject)
						if (!role) return yield* unavailable()
						if (role !== "owner") return yield* forbidden()
						let record = yield* workspace.workspace(id)
						if (Option.isNone(record)) return yield* unavailable()
						if (id === "personal-" + record.value.owner)
							return yield* new WorkspaceDeletionRefused({
								reason: "Personal",
								message: "The personal workspace cannot be deleted",
							})
						if (name !== record.value.name)
							return yield* new WorkspaceDeletionRefused({
								reason: "NameMismatch",
								message: "Type the workspace's current name to delete it",
							})
						return yield* writeWorkspace(fact)
					}),
					finishWorkspace,
				)
			})
		}
		// Moving preserves document ownership while inheriting destination access.
		function moveDocument(
			document: string,
			destination: string,
			request: string,
		) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				if (identity.access) return yield* forbidden()
				let id = "document-moved:" + request
				return yield* transact(
					Effect.gen(function* () {
						// A retried move returns its original receipt.
						let previous = yield* workspace.receipt({
							workspace: destination,
							id,
						})
						if (Option.isSome(previous)) return previous.value.position
						let record = yield* workspace.document(document)
						let role = yield* workspace.documentRole(document, identity.subject)
						if (Option.isNone(record) || !role) return yield* unavailable()
						if (role !== "owner") return yield* forbidden()
						let target = yield* workspace.workspaceRole(
							destination,
							identity.subject,
						)
						if (!target) return yield* unavailable()
						if (target === "reader") return yield* forbidden()
						if (record.value.workspace === destination)
							return yield* conflict(
								"The document is already in that workspace",
							)
						return yield* writeWorkspace(
							yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
								id,
								workspace: destination,
								subject: identity.subject,
								change: {
									kind: "documentMoved",
									document,
									from: record.value.workspace,
								},
							}),
						)
					}),
					result =>
						typeof result === "number"
							? Effect.succeed(result)
							: finishWorkspace(result),
				)
			})
		}
		// Leaving removes every link membership the caller has for a target.
		// Direct grants stay with the owner, who can remove them.
		function leave(target: InvitationTarget, request: string) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				if (identity.access) return yield* forbidden()
				return yield* transact(
					Effect.gen(function* () {
						let space =
							"document" in target
								? Option.getOrUndefined(
										yield* workspace.document(target.document),
									)?.workspace
								: target.workspace
						if (!space) return yield* unavailable()
						let memberships = yield* workspace.memberships(
							identity.subject,
							space,
							"document" in target ? target.document : null,
						)
						let written: Effect.Success<ReturnType<typeof writeWorkspace>>[] =
							[]
						for (let [index, { invitation }] of memberships.entries())
							written.push(
								yield* writeWorkspace(
									yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
										id: "invitation-left:" + request + ":" + index,
										workspace: space,
										subject: identity.subject,
										change: {
											kind: "invitationLeft",
											invitation,
											member: identity.subject,
										},
									}),
								),
							)
						return written
					}),
					written =>
						Effect.forEach(written, finishWorkspace).pipe(
							Effect.map(positions => positions.length),
						),
				)
			})
		}
		function changeMembership(
			id: string,
			member: string,
			role: "reader" | "writer" | null,
			request: string,
		) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				let fact = yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
					id: request,
					workspace: id,
					subject: identity.subject,
					change: { kind: "membership", member, role },
				})
				return yield* transact(
					Effect.gen(function* () {
						if (
							(yield* workspace.workspaceRole(
								id,
								identity.subject,
								identity.access,
							)) !== "owner"
						)
							return yield* forbidden()
						let current = yield* workspace.workspace(id)
						if (Option.isSome(current) && current.value.owner === member)
							return yield* conflict(
								"Workspace ownership cannot be changed by a grant",
							)
						return yield* writeWorkspace(fact)
					}),
					finishWorkspace,
				)
			})
		}
		function createInvitation(
			invitation: string,
			target: InvitationTarget,
			role: "writer" | "reader",
			digest: string,
		) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				if (identity.access) return yield* forbidden()
				return yield* transact(
					Effect.gen(function* () {
						let space = yield* ownedInvitationTarget(target, identity.subject)
						let existing = yield* workspace.invitation(invitation)
						if (Option.isSome(existing) && existing.value.workspace !== space)
							return yield* conflict("Invitation identity is already in use")
						return yield* writeWorkspace(
							yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
								id: "invitation:" + invitation,
								workspace: space,
								subject: identity.subject,
								change: {
									kind: "invitationCreated",
									invitation,
									document: "document" in target ? target.document : null,
									role,
									digest,
								},
							}),
						)
					}),
					finishWorkspace,
				)
			})
		}
		function listInvitations(target: InvitationTarget) {
			return Identity.use(identity =>
				readSql.withTransaction(
					Effect.gen(function* () {
						if (identity.access) return yield* forbidden()
						let space = yield* ownedInvitationTarget(
							target,
							identity.subject,
							readWorkspace,
						)
						return yield* readWorkspace.invitations(
							space,
							"document" in target ? target.document : null,
						)
					}),
				),
			)
		}
		function revokeInvitation(invitation: string) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				if (identity.access) return yield* forbidden()
				return yield* transact(
					Effect.gen(function* () {
						let record = yield* workspace.invitation(invitation)
						if (Option.isNone(record)) return yield* unavailable()
						let space = yield* ownedInvitationTarget(
							invitationTarget(record.value),
							identity.subject,
						)
						return yield* writeWorkspace(
							yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
								id: "invitation-revoked:" + invitation,
								workspace: space,
								subject: identity.subject,
								change: { kind: "invitationRevoked", invitation },
							}),
						)
					}),
					finishWorkspace,
				)
			})
		}
		function describeInvitation(invitation: string, secret: string) {
			return readSql.withTransaction(
				Effect.gen(function* () {
					let record = yield* verifiedInvitation(
						readWorkspace,
						invitation,
						secret,
					)
					let owner = (yield* readWorkspace.preferences(record.creator)).name
					let description: InvitationDescription
					if (record.document) {
						let summary = yield* readWorkspace.summary(record.document)
						if (Option.isNone(summary) || summary.value.deleted)
							return yield* invitationUnavailable()
						description = {
							kind: "document",
							title: summary.value.metadata.title,
							role: record.role,
							owner,
						}
					} else {
						let space = yield* readWorkspace.workspace(record.workspace)
						if (Option.isNone(space)) return yield* invitationUnavailable()
						description = {
							kind: "workspace",
							title: space.value.name,
							role: record.role,
							owner,
						}
					}
					return description
				}),
			)
		}
		function acceptInvitation(
			invitation: string,
			secret: string,
			request: string,
		) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				if (identity.access) return yield* forbidden()
				let accepted = yield* transact(
					Effect.gen(function* () {
						let record = yield* verifiedInvitation(
							workspace,
							invitation,
							secret,
						)
						if (record.document) {
							let summary = yield* workspace.summary(record.document)
							if (Option.isNone(summary) || summary.value.deleted)
								return yield* invitationUnavailable()
						}
						let current = record.document
							? yield* workspace.documentRole(record.document, identity.subject)
							: yield* workspace.workspaceRole(
									record.workspace,
									identity.subject,
								)
						let acceptance = {
							workspace: record.workspace,
							document: record.document,
							role: record.role,
						}
						if (current === "owner") return { acceptance, written: undefined }
						let written = yield* writeWorkspace(
							yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
								id: "invitation-accept:" + request,
								workspace: record.workspace,
								subject: identity.subject,
								change: {
									kind: "invitationAccepted",
									invitation,
									member: identity.subject,
								},
							}),
						)
						return { acceptance, written }
					}),
					result =>
						(result.written
							? finishWorkspace(result.written)
							: Effect.void
						).pipe(Effect.as(result.acceptance)),
				)
				return accepted
			})
		}
		function leaveInvitation(
			invitation: string,
			member: string,
			request: string,
		) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				if (identity.access) return yield* forbidden()
				return yield* transact(
					Effect.gen(function* () {
						let record = yield* workspace.invitation(invitation)
						if (Option.isNone(record)) return yield* unavailable()
						if (member !== identity.subject)
							yield* ownedInvitationTarget(
								invitationTarget(record.value),
								identity.subject,
							)
						let previous = yield* workspace.receipt({
							workspace: record.value.workspace,
							id: "invitation-left:" + request,
						})
						if (Option.isNone(previous)) {
							for (let receipt of yield* workspace.actionReceipts(
								"invitation-left:" + request,
							)) {
								let fact = yield* Schema.decodeUnknownEffect(
									WorkspaceFactSchema,
								)({
									id: "invitation-left:" + request,
									workspace: receipt.workspace,
									subject: identity.subject,
									change: { kind: "invitationLeft", invitation, member },
								})
								if (
									receipt.fingerprint === (yield* hashWorkspace(crypto, fact))
								)
									return { position: receipt.position, fact, fresh: false }
							}
							let memberships = yield* workspace.memberships(
								member,
								record.value.workspace,
								record.value.document,
							)
							if (
								record.value.revoked ||
								!memberships.some(
									membership => membership.invitation === invitation,
								)
							)
								return yield* unavailable()
						}
						return yield* writeWorkspace(
							yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
								id: "invitation-left:" + request,
								workspace: record.value.workspace,
								subject: identity.subject,
								change: { kind: "invitationLeft", invitation, member },
							}),
						)
					}),
					finishWorkspace,
				)
			})
		}
		// Callers without any role learn nothing about the target's existence.
		function ownedInvitationTarget(
			target: InvitationTarget,
			subject: string,
			lookup = workspace,
		) {
			return Effect.gen(function* () {
				if ("document" in target) {
					let record = yield* lookup.document(target.document)
					let role = yield* lookup.documentRole(target.document, subject)
					if (Option.isNone(record) || !role) return yield* unavailable()
					if (role !== "owner") return yield* forbidden()
					return record.value.workspace
				}
				let role = yield* lookup.workspaceRole(target.workspace, subject)
				if (!role) return yield* unavailable()
				if (role !== "owner") return yield* forbidden()
				return target.workspace
			})
		}
		function verifiedInvitation(
			lookup: typeof workspace,
			invitation: string,
			secret: string,
		) {
			return Effect.gen(function* () {
				let record = yield* lookup.invitation(invitation)
				if (Option.isNone(record)) return yield* invitationUnavailable()
				let digest = yield* crypto
					.digest("SHA-256", decode(secret))
					.pipe(Effect.map(encode))
				if (!equalSecrets(digest, record.value.digest))
					return yield* invitationUnavailable()
				if (record.value.revoked)
					return yield* new InvitationRevoked({
						message: "This invitation link was revoked",
					})
				return record.value
			})
		}
		function createDocument(id: string, input: DocumentAction) {
			return Effect.gen(function* () {
				let proposal = yield* decodeProposal(input)
				if (hasBlobReferences(proposal))
					return yield* conflict(
						"Attachments must be added after document creation",
					)
				let identity = yield* Identity
				if (!identity.actors.includes(proposal.actor))
					return yield* conflict("Actor identity is not authorized")
				let fact = yield* Schema.decodeUnknownEffect(WorkspaceFactSchema)({
					id: "document:" + proposal.document,
					workspace: id,
					subject: identity.subject,
					change: { kind: "documentAdded", document: proposal.document },
				})
				yield* readSql.withTransaction(
					readWorkspace
						.workspaceRole(id, identity.subject, identity.access)
						.pipe(
							Effect.flatMap(role =>
								role === "owner" || role === "writer"
									? Effect.void
									: forbidden(),
							),
						),
				)
				return yield* withSession(proposal.document, session =>
					transact(
						Effect.gen(function* () {
							let role = yield* workspace.workspaceRole(
								id,
								identity.subject,
								identity.access,
							)
							if (role !== "owner" && role !== "writer")
								return yield* forbidden()
							let associated = yield* workspace.document(proposal.document)
							if (
								Option.isNone(associated) &&
								Option.isSome(yield* queries.notice(proposal.document))
							)
								return yield* conflict("Document identity is already in use")
							let membership = yield* writeWorkspace(fact)
							yield* authorizeProposal(proposal, { ...identity, role }, true)
							let result = yield* accept(
								proposal,
								{ ...identity, role },
								session,
								true,
							)
							if (
								result.accepted &&
								(result.accepted.replacement?.fields(proposal.document).type !==
									"document" ||
									result.accepted.replacement?.fields(proposal.document)
										.metadata !== "frontmatter-v1")
							)
								return yield* conflict(
									"Creation must include the document root and frontmatter metadata",
								)
							return { ...result, membership }
						}),
						result =>
							finish(proposal.document, session, result, true).pipe(
								Effect.tap(() =>
									result.notice
										? Effect.void
										: finishWorkspace(result.membership),
								),
							),
					),
				)
			})
		}
		function writeWorkspace(fact: WorkspaceFact) {
			return Effect.gen(function* () {
				let fingerprint = yield* hashWorkspace(crypto, fact)
				let previous = yield* workspace.receipt(fact)
				if (Option.isSome(previous)) {
					if (previous.value.fingerprint !== fingerprint)
						return yield* conflict("Workspace action identity is immutable")
					return { position: previous.value.position, fact, fresh: false }
				}
				let existing = yield* workspace.workspaceRecord(fact.workspace)
				if (Option.isSome(existing) && existing.value.deleted)
					return yield* unavailable()
				if (fact.change.kind === "created" && Option.isSome(existing))
					return yield* conflict("Workspace already exists")
				if (
					fact.change.kind === "documentAdded" &&
					Option.isSome(yield* workspace.document(fact.change.document))
				)
					return yield* conflict("Document already belongs to a workspace")
				let position = yield* write("WorkspaceChanged", fact).pipe(
					Effect.catchTag("EventJournalError", error =>
						Effect.fail(
							SqlError.isSqlError(error.cause)
								? error.cause
								: new DocumentConflict({
										message: "Workspace journal write failed",
									}),
						),
					),
				)
				return { position, fact, fresh: true }
			})
		}
		function publishNotice<E, R>(
			lookup: Effect.Effect<LiveNotice, E, R>,
			fallback: LiveNotice,
		) {
			return lookup.pipe(
				Effect.retry({ times: 3, schedule: Schedule.exponential("20 millis") }),
				Effect.catchCause(cause =>
					Effect.logWarning(
						"Committed change notification lookup failed",
						cause,
					).pipe(Effect.as(fallback)),
				),
				Effect.flatMap(notice => PubSub.publish(wakeups, notice)),
			)
		}
		function finishWorkspace(result: {
			position: number
			fact: WorkspaceFact
			fresh: boolean
		}) {
			if (!result.fresh) return Effect.succeed(result.position)
			let { fact } = result,
				change = fact.change
			let subjects = new Set([fact.subject])
			if ("member" in change) subjects.add(change.member)
			let fallback: LiveNotice =
				change.kind === "preferences"
					? { kind: "preferences", subject: fact.subject, subjects }
					: {
							kind: "workspace",
							subjects,
							documents: new Set(
								"document" in change && change.document
									? [change.document]
									: [],
							),
						}
			return publishNotice(workspaceNotice(fact), fallback).pipe(
				Effect.as(result.position),
			)
		}
		function workspaceNotice(fact: WorkspaceFact) {
			return Effect.gen(function* () {
				let change = fact.change
				if (change.kind === "preferences") {
					let subjects =
						change.patch.name === undefined
							? new Set([fact.subject])
							: yield* profileRecipients(fact.subject)
					let notice: LiveNotice = {
						kind: "preferences",
						subject: fact.subject,
						subjects,
					}
					return notice
				} else {
					let subjects = yield* workspaceRecipients(fact.workspace)
					subjects.add(fact.subject)
					if ("member" in change) subjects.add(change.member)
					if (change.kind === "invitationRevoked") {
						let previous = yield* SqlSchema.findAll({
							Request: Schema.Void,
							Result: Schema.Struct({ subject: Schema.String }),
							execute: () =>
								readSql`SELECT member AS subject FROM invitation_members WHERE invitation=${change.invitation}`,
						})(undefined)
						for (let row of previous) subjects.add(row.subject)
					}
					if (change.kind === "documentMoved")
						for (let subject of yield* workspaceRecipients(change.from))
							subjects.add(subject)
					let documents = new Set<string>()
					if ("document" in change && change.document)
						documents.add(change.document)
					if (change.kind === "deleted") {
						let rows = yield* SqlSchema.findAll({
							Request: Schema.Void,
							Result: Schema.Struct({ document: Schema.String }),
							execute: () =>
								readSql`SELECT document FROM workspace_documents WHERE workspace=${fact.workspace}`,
						})(undefined)
						for (let row of rows) documents.add(row.document)
					}
					let notice: LiveNotice = {
						kind: "workspace",
						subjects,
						documents,
					}
					return notice
				}
			})
		}
		function workspaceRecipients(workspace: string) {
			return SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({ subject: Schema.String }),
				execute: () => readSql`
					SELECT owner AS subject FROM workspaces WHERE workspace=${workspace}
					UNION SELECT member FROM workspace_grants WHERE workspace=${workspace}
					UNION SELECT owner FROM workspace_documents WHERE workspace=${workspace}
					UNION SELECT g.member FROM document_grants g JOIN workspace_documents d ON d.document=g.document WHERE d.workspace=${workspace}
				`,
			})(undefined).pipe(
				Effect.map(rows => new Set(rows.map(row => row.subject))),
			)
		}
		function documentRecipients(document: string) {
			return SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({ subject: Schema.String }),
				execute: () => readSql`
					SELECT owner AS subject FROM workspace_documents WHERE document=${document}
					UNION SELECT w.owner FROM workspaces w JOIN workspace_documents d ON d.workspace=w.workspace WHERE d.document=${document}
					UNION SELECT g.member FROM workspace_grants g JOIN workspace_documents d ON d.workspace=g.workspace WHERE d.document=${document}
					UNION SELECT member FROM document_grants WHERE document=${document}
				`,
			})(undefined).pipe(
				Effect.map(rows => new Set(rows.map(row => row.subject))),
			)
		}
		function profileRecipients(subject: string) {
			return SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({ subject: Schema.String }),
				execute: () => readSql`
					WITH spaces AS (
						SELECT workspace,owner AS subject FROM workspaces WHERE deleted=0
						UNION SELECT g.workspace,g.member FROM workspace_grants g JOIN workspaces w ON w.workspace=g.workspace WHERE w.deleted=0
					), viewers AS (
						SELECT d.document,d.owner AS subject FROM workspace_documents d JOIN workspaces w ON w.workspace=d.workspace WHERE w.deleted=0
						UNION SELECT d.document,w.owner FROM workspace_documents d JOIN workspaces w ON w.workspace=d.workspace WHERE w.deleted=0
						UNION SELECT d.document,g.member FROM workspace_documents d JOIN workspace_grants g ON g.workspace=d.workspace JOIN workspaces w ON w.workspace=d.workspace WHERE w.deleted=0
						UNION SELECT d.document,g.member FROM workspace_documents d JOIN document_grants g ON g.document=d.document JOIN workspaces w ON w.workspace=d.workspace WHERE w.deleted=0
					)
					SELECT ${subject} AS subject
					UNION SELECT peer.subject FROM spaces mine JOIN spaces peer ON peer.workspace=mine.workspace WHERE mine.subject=${subject}
					UNION SELECT peer.subject FROM viewers mine JOIN viewers peer ON peer.document=mine.document WHERE mine.subject=${subject}
				`,
			})(undefined).pipe(
				Effect.map(rows => new Set(rows.map(row => row.subject))),
			)
		}

		function workspaceSnapshot(id: string) {
			return Identity.use(identity =>
				readSql.withTransaction(
					Effect.gen(function* () {
						if (
							!(yield* readWorkspace.workspaceRole(
								id,
								identity.subject,
								identity.access,
							))
						)
							return yield* unavailable()
						return yield* readWorkspace.snapshot(id)
					}),
				),
			)
		}
		function workspaceHistory(id: string, after = 0) {
			return Identity.use(identity =>
				readSql.withTransaction(
					Effect.gen(function* () {
						if (
							(yield* readWorkspace.workspaceRole(
								id,
								identity.subject,
								identity.access,
							)) !== "owner"
						)
							return yield* forbidden()
						return yield* readWorkspace.history(id, after)
					}),
				),
			)
		}
		function transact<A, E, R, B, E2, R2>(
			body: Effect.Effect<A, E, R>,
			committed: (result: A) => Effect.Effect<B, E2, R2>,
		) {
			return Effect.gen(function* () {
				let transaction = yield* Effect.serviceOption(sql.transactionService)
				let callerSql = yield* Effect.serviceOption(SqlClient.SqlClient)
				let callerTransaction = Option.isSome(callerSql)
					? yield* Effect.serviceOption(callerSql.value.transactionService)
					: Option.none()
				if (Option.isSome(transaction) || Option.isSome(callerTransaction))
					return yield* Effect.fail(
						new TransactionOwnershipError({
							message: "The store must own its transaction",
						}),
					)
				return yield* Effect.uninterruptibleMask(restore =>
					sql.withTransaction(restore(body)).pipe(Effect.flatMap(committed)),
				)
			}).pipe(
				Effect.catchDefect(cause =>
					SqlError.isSqlError(cause) ? Effect.fail(cause) : Effect.die(cause),
				),
			)
		}
		function finish(
			document: string,
			session: DocumentSession,
			result: Effect.Success<ReturnType<typeof accept>>,
			managed = false,
		) {
			return Effect.gen(function* () {
				if (result.accepted) {
					let { base, tip, changes, replacement } = result.accepted
					yield* Effect.sync(() => {
						if (!replacement) base.replica.apply(changes)
						session.state = { ...tip, replica: replacement ?? base.replica }
						session.uncommitted = false
					}).pipe(
						Effect.onError(() =>
							Effect.sync(() => {
								session.state = undefined
							}),
						),
						Effect.catchCause(cause =>
							Effect.logWarning(
								"Committed document cache will reload",
								cause,
							).pipe(Effect.ignoreCause),
						),
					)
					yield* Cache.set(sessions, document, session).pipe(
						Effect.provideContext(Context.empty()),
					)
				}
				if (result.notice) {
					yield* PubSub.publish(notices, result.notice)
					if (managed) {
						let subjects = new Set<string>()
						for (let change of result.accepted?.changes ?? [])
							if (
								change.target === document &&
								change.field.startsWith("access:") &&
								change.field !== "access:public"
							)
								subjects.add(change.field.slice("access:".length))
						let fallback: LiveNotice = { kind: "document", document, subjects }
						let lookup = documentRecipients(document).pipe(
							Effect.map(recipients => {
								for (let subject of subjects) recipients.add(subject)
								let notice: LiveNotice = {
									kind: "document",
									document,
									subjects: recipients,
								}
								return notice
							}),
						)
						yield* publishNotice(lookup, fallback)
					}
				}
				return result.position
			})
		}
		function authorizeProposal(
			action: DocumentAction,
			principal: typeof Principal.Service,
			managed = false,
		) {
			return Effect.gen(function* () {
				if (
					principal.role === "reader" ||
					!principal.actors.includes(action.actor) ||
					(principal.role !== "owner" &&
						action.changes.some(change => change.field.startsWith("access:")))
				)
					return yield* managed
						? forbidden()
						: conflict("Document action is not authorized")
				if (
					managed &&
					action.changes.some(
						change =>
							change.target === action.document &&
							change.kind === "set" &&
							(sourceMetadataFields.includes(change.field) ||
								(change.field === "metadata" &&
									change.value !== "frontmatter-v1")),
					)
				)
					return yield* conflict("Document metadata belongs in frontmatter")
				// Deleting the whole document is the owner's decision.
				if (
					principal.role !== "owner" &&
					action.changes.some(
						change =>
							change.target === action.document &&
							change.kind === "set" &&
							change.field === "type" &&
							change.value === "deleted",
					)
				)
					return yield* managed
						? forbidden()
						: conflict("Only the owner can delete a document")
				for (let change of action.changes.filter(change =>
					change.field.startsWith("access:"),
				)) {
					if (
						change.target !== action.document ||
						change.kind !== "set" ||
						!["writer", "reader", ""].includes(change.value)
					)
						return yield* conflict("Invalid document access register")
					if (
						change.field === "access:" + publicMember &&
						change.value === "writer"
					)
						return yield* conflict("Public links can only grant reading")
					let member = yield* Schema.decodeUnknownEffect(IdentifierSchema)(
						change.field.slice("access:".length),
					).pipe(
						Effect.mapError(
							() =>
								new DocumentConflict({
									message: "Invalid document access subject",
								}),
						),
					)
					if (managed) {
						let document = yield* workspace.document(action.document)
						if (Option.isSome(document)) {
							let room = yield* workspace.workspace(document.value.workspace)
							if (
								member === document.value.owner ||
								(Option.isSome(room) && member === room.value.owner)
							)
								return yield* conflict("Ownership cannot be changed by a grant")
						}
					}
				}
			})
		}
		function accept(
			action: DocumentAction,
			principal: typeof Principal.Service,
			session: DocumentSession,
			managed = false,
			expected?: DocumentRevision,
		) {
			return Effect.gen(function* () {
				yield* sql`INSERT INTO document_actor_subjects VALUES (${action.actor},${principal.subject},${action.document}) ON CONFLICT DO NOTHING`
				let actor = yield* queries.actorSubject(action.actor)
				if (
					Option.isNone(actor) ||
					actor.value.subject !== principal.subject ||
					actor.value.document !== action.document
				)
					return yield* Effect.fail(
						new DocumentConflict({
							message: "Actor identity is not authorized",
						}),
					)
				if (
					Option.isSome(
						yield* queries.withdrawal({
							document: action.document,
							id: action.id,
						}),
					)
				)
					return yield* conflict("A withdrawn action cannot be committed")
				let fingerprint = yield* hashProposal(crypto, action)
				let receipt = yield* queries.receipt({
					document: action.document,
					id: action.id,
				})
				if (Option.isSome(receipt)) {
					if (receipt.value.fingerprint !== fingerprint)
						return yield* Effect.fail(
							new DocumentConflict({ message: "Action identity is immutable" }),
						)
					return {
						position: receipt.value.position,
						notice: undefined,
						accepted: undefined,
					}
				}
				let tip = Option.getOrUndefined(yield* queries.notice(action.document))
				let base = yield* refresh(action.document, session, tip)
				if (
					expected &&
					(expected.log !== base.log || expected.position !== base.position)
				)
					return yield* new StaleRevision({
						message: "Document changed; read it again before editing",
						expected,
						current: { log: base.log, position: base.position },
					})
				session.state = base
				let replica = base.replica
				let original = action.undoOf
					? yield* queries.action(action.document, action.undoOf)
					: undefined
				if (
					action.undoOf &&
					(!original ||
						(principal.role !== "owner" &&
							original.subject !== principal.subject))
				)
					return yield* Effect.fail(
						new DocumentConflict({
							message: "Undo must reference an authorized committed action",
						}),
					)
				if (action.undoOf) {
					if (
						Option.isSome(
							yield* queries.compensation({
								document: action.document,
								id: action.undoOf,
							}),
						)
					)
						return yield* new UndoUnavailable({
							reason: "Superseded",
							message:
								"This action was already compensated; undo the latest action in its chain",
						})
					let boundary = yield* queries.undoBoundary(action.document)
					let originalReceipt = yield* queries.receipt({
						document: action.document,
						id: action.undoOf,
					})
					if (
						Option.isSome(boundary) &&
						Option.isSome(originalReceipt) &&
						originalReceipt.value.position <= boundary.value.position
					)
						return yield* new UndoUnavailable({
							reason: "BelowFloor",
							message:
								"Retained history cannot establish this action's undo chain",
						})
				}
				let reservation = yield* queries.reservation({
					document: action.document,
					subject: principal.subject,
				})
				let frontier = Math.max(
					replica.clock,
					Option.isSome(reservation) ? reservation.value.clock : 0,
				)
				let fact = yield* committedAction(
					replica,
					action,
					principal.subject,
					original,
					frontier,
				).pipe(Effect.provideService(Crypto.Crypto, crypto))
				let changes = yield* validateAction(replica, fact)
				yield* validateTextCausality(replica, fact.document, changes)
				yield* Effect.try({
					try: () => replica.validate(changes),
					catch: cause =>
						new DocumentConflict({
							message:
								cause instanceof Error
									? cause.message
									: "Invalid document projection",
						}),
				})
				if (managed) {
					for (let chunk of yield* requiredBlobChunks(fact)) {
						let stored = yield* storedBlobSize({
							document: fact.document,
							digest: chunk.digest,
						})
						if (Option.isNone(stored) || stored.value.size !== chunk.size)
							return yield* Effect.fail(
								new BlobBytesMissing({
									document: fact.document,
									digest: chunk.digest,
									message:
										"Attachment bytes must be uploaded before its action",
								}),
							)
					}
					let latest = new Map<string, (typeof changes)[number]>()
					for (let change of changes.filter(change =>
						change.field.startsWith("access:"),
					)) {
						let previous = latest.get(change.field)
						if (!previous || change.id > previous.id)
							latest.set(change.field, change)
					}
					let guards = new Map(
						action.accessGuards.map(guard => [guard.field, guard.observed]),
					)
					if (
						guards.size !== action.accessGuards.length ||
						guards.size !== latest.size
					)
						return yield* Effect.fail(
							new AccessConflict({
								message:
									"Permission changes require exactly one observed register per field",
							}),
						)
					for (let change of latest.values()) {
						let previous = replica.register(action.document, change.field)
						if (
							guards.get(change.field) !== (previous?.id ?? "") ||
							(previous && previous.id >= change.id)
						)
							return yield* Effect.fail(
								new AccessConflict({
									message: "Document access changed; reload before sharing",
								}),
							)
					}
				}
				for (let target of new Set(fact.changes.map(change => change.target))) {
					let owner = yield* queries.owner(target)
					if (Option.isSome(owner) && owner.value.document !== fact.document)
						return yield* Effect.fail(
							new DocumentConflict({
								message: "Target belongs to another document",
							}),
						)
					yield* sql`INSERT INTO document_targets VALUES (${target},${fact.document}) ON CONFLICT DO NOTHING`
				}
				for (let change of fact.changes) {
					let previous = yield* queries.operation({
						document: fact.document,
						id: change.id,
					})
					if (Option.isSome(previous))
						return yield* Effect.fail(
							new DocumentConflict({
								message: "Operation identity is already committed",
							}),
						)
					yield* sql`INSERT INTO document_operation_ids VALUES (${fact.document},${change.id},${fact.id})`
				}
				let position = yield* write("DocumentChanged", fact).pipe(
					Effect.catchTag("EventJournalError", error =>
						Effect.fail(
							SqlError.isSqlError(error.cause)
								? error.cause
								: new DocumentConflict({
										message: "Document journal write failed",
									}),
						),
					),
				)
				let head = yield* queries.notice(action.document)
				if (Option.isNone(head))
					return yield* Effect.fail(
						new DocumentConflict({ message: "Missing committed head" }),
					)
				let replacement: Replica | undefined
				if (
					!tip ||
					head.value.version % checkpointInterval === 0 ||
					(managed &&
						changes.some(
							change =>
								change.target === action.document &&
								(change.kind === "text" ||
									change.kind === "cancel" ||
									change.field === "type" ||
									change.field === "whiteboard" ||
									change.field.startsWith("access:")),
						))
				) {
					if (tip && head.value.version % checkpointInterval === 0) {
						replacement = new Replica("projection")
						let rebuilt = replacement
						yield* Effect.try({
							try: () => rebuilt.restore(replica.checkpoint()),
							catch: cause =>
								new DocumentConflict({
									message:
										cause instanceof Error
											? cause.message
											: "Invalid document checkpoint",
								}),
						})
					} else {
						session.uncommitted = true
						replacement = replica
					}
					let staged = replacement
					yield* Effect.try({
						try: () => staged.apply(changes),
						catch: cause =>
							new DocumentConflict({
								message:
									cause instanceof Error
										? cause.message
										: "Invalid document projection",
							}),
					})
					if (!tip || head.value.version % checkpointInterval === 0) {
						let state = JSON.stringify(
							compactCheckpoint(replacement.checkpoint()),
						)
						yield* sql`INSERT INTO document_heads VALUES (${action.document},${head.value.log},${position},${head.value.version},${state}) ON CONFLICT(document) DO UPDATE SET log=excluded.log,position=excluded.position,version=excluded.version,state=excluded.state WHERE excluded.position>document_heads.position OR excluded.log<>document_heads.log`
					}
				}
				if (managed)
					yield* workspace.projectDocument(
						replacement ?? replica,
						fact,
						head.value.log,
						position,
					)
				return {
					position,
					notice: { document: action.document, position, log: head.value.log },
					accepted: { base, tip: head.value, changes, replacement },
				}
			})
		}
		function history(
			document: string,
			after = 0,
			log?: string,
			subject?: string | Context.Service.Shape<typeof Identity>,
			limit?: number,
		) {
			return readSql.withTransaction(
				Effect.gen(function* () {
					if (subject !== undefined) yield* authorizeRead(document, subject)
					else yield* refuseManaged(document, readWorkspace)
					let head = Option.getOrUndefined(yield* readQueries.notice(document))
					yield* Schema.decodeUnknownEffect(Schema.Natural)(after)
					if (log !== undefined && log !== head?.log)
						return yield* Effect.fail(
							new DocumentHistoryUnavailable({
								document,
								reason: "EpochChanged",
								position: after,
								message: "History epoch changed; reload the snapshot",
							}),
						)
					if (after && (!head || after > head.position || !log))
						return yield* Effect.fail(
							new DocumentHistoryUnavailable({
								document,
								reason: "CursorInvalid",
								position: after,
								message: "History cursor is unavailable; reload the snapshot",
							}),
						)
					if (limit !== undefined)
						yield* Schema.decodeUnknownEffect(
							Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
						)(limit)
					let rows = yield* readQueries.history({ document, after, limit })
					return yield* Effect.forEach(rows, row => decodeRow(document, row))
				}),
			)
		}

		function withSession<A, E, R>(
			document: string,
			use: (session: DocumentSession) => Effect.Effect<A, E, R>,
		) {
			return Effect.gen(function* () {
				let existing = yield* Cache.getOption(sessions, document)
				let session = Option.isSome(existing)
					? existing.value
					: Option.isSome(yield* readQueries.notice(document))
						? yield* Cache.get(sessions, document).pipe(
								Effect.provideContext(Context.empty()),
							)
						: yield* makeSession()
				return yield* session.gate.withPermit(
					use(session).pipe(
						Effect.onExit(() =>
							Effect.sync(() => {
								if (session.uncommitted) {
									session.state = undefined
									session.uncommitted = false
								}
							}),
						),
					),
				)
			}).pipe(Effect.scoped)
		}
		function snapshot(
			document: string,
			subject?: string | Context.Service.Shape<typeof Identity>,
		) {
			return Effect.gen(function* () {
				if (subject !== undefined)
					yield* readSql.withTransaction(authorizeRead(document, subject))
				else
					yield* readSql.withTransaction(refuseManaged(document, readWorkspace))
				if (Option.isNone(yield* readQueries.notice(document))) return undefined
				return yield* withSession(document, session =>
					Effect.gen(function* () {
						let result = yield* readSql.withTransaction(
							Effect.gen(function* () {
								if (subject !== undefined)
									yield* authorizeRead(document, subject)
								else yield* refuseManaged(document, readWorkspace)
								let tip = Option.getOrUndefined(
									yield* readQueries.notice(document),
								)
								if (!tip) return undefined
								let state = yield* refresh(document, session, tip, readQueries)
								return state
							}),
						)
						session.state = result
						return result ? snapshotOf(document, result) : undefined
					}),
				)
			})
		}
		function authorizeRead(
			document: string,
			subject: string | Context.Service.Shape<typeof Identity>,
		) {
			return readWorkspace
				.documentRole(
					document,
					typeof subject === "string" ? subject : subject.subject,
					typeof subject === "string" ? undefined : subject.access,
				)
				.pipe(Effect.flatMap(role => (role ? Effect.void : unavailable())))
		}
		function action(
			document: string,
			id: string,
			subject?: string | Context.Service.Shape<typeof Identity>,
		) {
			return readSql.withTransaction(
				Effect.gen(function* () {
					if (subject !== undefined) yield* authorizeRead(document, subject)
					else yield* refuseManaged(document, readWorkspace)
					return yield* readQueries.action(document, id)
				}),
			)
		}
		function chain(
			document: string,
			id: string,
			subject?: string | Context.Service.Shape<typeof Identity>,
		) {
			return readSql.withTransaction(
				Effect.gen(function* () {
					if (subject !== undefined) yield* authorizeRead(document, subject)
					else yield* refuseManaged(document, readWorkspace)
					let tip = yield* readQueries.chain({ document, id })
					if (Option.isNone(tip)) return undefined
					let notice = yield* readQueries.notice(document)
					if (
						tip.value.successor !== null ||
						Option.isNone(notice) ||
						tip.value.position > notice.value.position
					)
						return yield* Effect.fail(
							new DocumentConflict({
								message: "The action chain is inconsistent",
							}),
						)
					let boundary = yield* readQueries.undoBoundary(document)
					if (
						Option.isSome(boundary) &&
						tip.value.position <= boundary.value.position
					)
						return yield* new UndoUnavailable({
							reason: "BelowFloor",
							message:
								"Retained history cannot establish this action's undo chain",
						})
					return yield* Schema.decodeUnknownEffect(ActionChainSchema)({
						document,
						from: id,
						latest: tip.value.action,
						position: tip.value.position,
						depth: tip.value.depth,
						log: notice.value.log,
					})
				}),
			)
		}
		function refresh(
			document: string,
			session: DocumentSession,
			tip: typeof TipSchema.Type | undefined,
			lookup = queries,
		) {
			return Effect.gen(function* () {
				if (!tip)
					return {
						replica: new Replica("projection"),
						log: "",
						position: 0,
						version: 0,
						fingerprint: "",
					}
				let cached = session.state
				if (
					cached?.log === tip.log &&
					cached.position === tip.position &&
					cached.fingerprint === tip.fingerprint
				)
					return cached
				let head = yield* lookup.checkpoint(document)
				let state: DocumentState
				if (
					cached?.log === tip.log &&
					cached.position < tip.position &&
					(!head || head.position <= cached.position)
				) {
					let replica = new Replica("projection")
					replica.restore(cached.replica.checkpoint())
					state = { ...cached, replica }
				} else {
					if (!head || head.log !== tip.log || head.position > tip.position)
						return yield* Effect.fail(
							new DocumentConflict({
								message: "Document checkpoint is unavailable",
							}),
						)
					let replica = yield* restoreSnapshot(
						{ format: "document-state-v1", document, ...head },
						"projection",
					)
					state = { ...head, replica, fingerprint: "" }
				}
				let rows = yield* lookup.history({ document, after: state.position })
				if (
					rows.length !== tip.version - state.version ||
					(rows.at(-1)?.position ?? state.position) !== tip.position
				)
					return yield* Effect.fail(
						new DocumentConflict({
							message: "Document recovery tail is incomplete",
						}),
					)
				for (let row of rows)
					yield* applyAction(
						state.replica,
						(yield* decodeRow(document, row)).action,
					)
				return { ...tip, replica: state.replica }
			})
		}
	})
}

function makeSession() {
	return Semaphore.make(1).pipe(
		Effect.map((gate): DocumentSession => ({
			state: undefined,
			gate,
			uncommitted: false,
		})),
	)
}
function snapshotOf(document: string, state: DocumentState): DocumentSnapshot {
	state.serialized ??= JSON.stringify(
		compactCheckpoint(state.replica.checkpoint()),
	)
	return Schema.decodeUnknownSync(DocumentSnapshotSchema)({
		format: "document-state-v1",
		document,
		log: state.log,
		position: state.position,
		state: state.serialized,
	})
}

function makeQueries(sql: SqlClient.SqlClient) {
	let head = SqlSchema.findOneOption({
		Request: Schema.String,
		Result: HeadSchema,
		execute: document =>
			sql`SELECT log,position,version,state FROM document_heads WHERE document=${document}`,
	})
	let payload = SqlSchema.findOneOption({
		Request: ActionIdentitySchema,
		Result: PayloadSchema,
		execute: ({ document, id }) =>
			sql`SELECT a.position,a.action,j.payload FROM document_actions a LEFT JOIN effect_event_journal j ON j.id=a.entry WHERE a.document=${document} AND a.action=${id}`,
	})
	return {
		withdrawal: SqlSchema.findOneOption({
			Request: ActionIdentitySchema,
			Result: Schema.Struct({
				subject: Schema.String,
				fingerprint: Schema.String,
			}),
			execute: ({ document, id }) =>
				sql`SELECT subject,fingerprint FROM document_withdrawals WHERE document=${document} AND action=${id}`,
		}),
		reservation: SqlSchema.findOneOption({
			Request: Schema.Struct({
				document: Schema.String,
				subject: Schema.String,
			}),
			Result: Schema.Struct({ clock: Schema.Natural }),
			execute: ({ document, subject }) =>
				sql`SELECT clock FROM document_clock_reservations WHERE document=${document} AND subject=${subject}`,
		}),
		chain: SqlSchema.findOneOption({
			Request: ActionIdentitySchema,
			Result: Schema.Struct({
				action: ActionIdSchema,
				position: Schema.Natural,
				depth: Schema.Natural,
				successor: Schema.NullOr(Schema.String),
			}),
			execute: ({ document, id }) =>
				sql`WITH RECURSIVE chain(action,position,depth) AS (
					SELECT action,position,0 FROM document_actions WHERE document=${document} AND action=${id}
					UNION ALL
					SELECT next.action,next.position,chain.depth+1 FROM chain
					JOIN document_compensations edge ON edge.document=${document} AND edge.original=chain.action
					JOIN document_actions next ON next.document=${document} AND next.action=edge.action
					WHERE next.position>chain.position
				), tip AS (SELECT * FROM chain ORDER BY depth DESC LIMIT 1)
				SELECT tip.action,tip.position,tip.depth,edge.action AS successor FROM tip
				LEFT JOIN document_compensations edge ON edge.document=${document} AND edge.original=tip.action`,
		}),
		compensation: SqlSchema.findOneOption({
			Request: ActionIdentitySchema,
			Result: Schema.Struct({ action: Schema.String }),
			execute: ({ document, id }) =>
				sql`SELECT action FROM document_compensations WHERE document=${document} AND original=${id}`,
		}),
		undoBoundary: SqlSchema.findOneOption({
			Request: Schema.String,
			Result: Schema.Struct({ position: Schema.Natural }),
			execute: document =>
				sql`SELECT position FROM document_undo_boundaries WHERE document=${document}`,
		}),
		actorSubject: SqlSchema.findOneOption({
			Request: Schema.String,
			Result: Schema.Struct({
				subject: Schema.String,
				document: Schema.String,
			}),
			execute: actor =>
				sql`SELECT subject,document FROM document_actor_subjects WHERE actor=${actor}`,
		}),
		notice: SqlSchema.findOneOption({
			Request: Schema.String,
			Result: TipSchema,
			execute: document =>
				sql`SELECT log,position,version,fingerprint FROM document_tips WHERE document=${document}`,
		}),
		receipt: SqlSchema.findOneOption({
			Request: ActionIdentitySchema,
			Result: ReceiptSchema,
			execute: ({ document, id }) =>
				sql`SELECT position,fingerprint FROM document_actions WHERE document=${document} AND action=${id}`,
		}),
		owner: SqlSchema.findOneOption({
			Request: Schema.String,
			Result: Schema.Struct({ document: Schema.String }),
			execute: target =>
				sql`SELECT document FROM document_targets WHERE target=${target}`,
		}),
		operation: SqlSchema.findOneOption({
			Request: ActionIdentitySchema,
			Result: Schema.Struct({ id: Schema.String }),
			execute: ({ document, id }) =>
				sql`SELECT id FROM document_operation_ids WHERE document=${document} AND id=${id}`,
		}),
		history: SqlSchema.findAll({
			Request: Schema.Struct({
				document: Schema.String,
				after: Schema.Natural,
				limit: Schema.optional(Schema.Natural),
			}),
			Result: PayloadSchema,
			execute: ({ document, after, limit }) =>
				sql`SELECT a.position,a.action,j.payload FROM document_actions a LEFT JOIN effect_event_journal j ON j.id=a.entry WHERE a.document=${document} AND a.position>${after} ORDER BY a.position LIMIT ${limit ?? -1}`,
		}),
		checkpoint: (document: string) =>
			head(document).pipe(
				Effect.map(result =>
					Option.isSome(result) ? result.value : undefined,
				),
			),
		action: (document: string, id: string) =>
			payload({ document, id }).pipe(
				Effect.flatMap(row =>
					Option.isSome(row)
						? decodeRow(document, row.value).pipe(
								Effect.map(entry => entry.action),
							)
						: Effect.succeed(undefined),
				),
			),
	}
}
function initializeCompensations(sql: SqlClient.SqlClient) {
	return Migrator.make({})({
		table: "document_action_migrations",
		loader: Migrator.fromRecord({
			"001_compensation_chains": Effect.gen(function* () {
				yield* sql`CREATE TABLE document_compensations (document TEXT NOT NULL, original TEXT NOT NULL, action TEXT NOT NULL, PRIMARY KEY(document,original))`
				yield* sql`CREATE TABLE document_undo_boundaries (document TEXT PRIMARY KEY, position INTEGER NOT NULL)`
			}),
			"002_verified_compensation_chains": Effect.gen(function* () {
				yield* sql`INSERT INTO document_undo_boundaries SELECT a.document,MAX(a.position) FROM document_actions a LEFT JOIN effect_event_journal j ON j.id=a.entry WHERE j.payload IS NULL GROUP BY a.document ON CONFLICT(document) DO UPDATE SET position=MAX(document_undo_boundaries.position,excluded.position)`
				let edge = SqlSchema.findOneOption({
					Request: ActionIdentitySchema,
					Result: Schema.Struct({
						action: Schema.String,
						position: Schema.NullOr(Schema.Natural),
					}),
					execute: ({ document, id }) =>
						sql`SELECT edge.action,receipt.position FROM document_compensations edge LEFT JOIN document_actions receipt ON receipt.document=edge.document AND receipt.action=edge.action WHERE edge.document=${document} AND edge.original=${id}`,
				})
				let page = SqlSchema.findAll({
					Request: Schema.Natural,
					Result: Schema.Struct({
						document: Schema.String,
						position: Schema.Natural,
						action: Schema.String,
						payload: Schema.Unknown,
					}),
					execute: after =>
						sql`SELECT a.document,a.position,a.action,j.payload FROM document_actions a JOIN effect_event_journal j ON j.id=a.entry WHERE a.position>${after} ORDER BY a.position LIMIT 100`,
				})
				let position = 0
				while (true) {
					let retained = yield* page(position)
					if (!retained.length) break
					for (let row of retained) {
						position = row.position
						let result = yield* Schema.decodeUnknownEffect(PayloadSchema)(
							row,
						).pipe(
							Effect.flatMap(payload => decodeRow(row.document, payload)),
							Effect.result,
						)
						if (result._tag === "Failure") {
							yield* sql`INSERT INTO document_undo_boundaries VALUES (${row.document},${row.position}) ON CONFLICT(document) DO UPDATE SET position=MAX(document_undo_boundaries.position,excluded.position)`
							continue
						}
						let action = result.success.action
						if (!action.undoOf) continue
						let existing = yield* edge({
							document: row.document,
							id: action.undoOf,
						})
						if (Option.isSome(existing)) {
							if (existing.value.action !== action.id) {
								let boundary = Math.max(
									row.position,
									existing.value.position ?? row.position,
								)
								yield* sql`INSERT INTO document_undo_boundaries VALUES (${row.document},${boundary}) ON CONFLICT(document) DO UPDATE SET position=MAX(document_undo_boundaries.position,excluded.position)`
							}
						} else
							yield* sql`INSERT INTO document_compensations VALUES (${row.document},${action.undoOf},${action.id})`
					}
				}
			}),
		}),
	})
}
function decodeRow(document: string, row: typeof PayloadSchema.Type) {
	return Effect.gen(function* () {
		if (!row.payload)
			return yield* Effect.fail(
				new DocumentHistoryUnavailable({
					document,
					reason: "ActionPruned",
					position: row.position,
					action: row.action,
					message: "This action is outside retained history",
				}),
			)
		let action = yield* Schema.decodeUnknownEffect(binary)(row.payload)
		if (action.document !== document || action.id !== row.action)
			return yield* Effect.fail(
				new DocumentConflict({
					message: "History payload does not match its document receipt",
				}),
			)
		return { position: row.position, action }
	})
}
function hashProposal(
	crypto: Crypto.Crypto,
	action: DocumentAction | CommittedAction,
) {
	let json = proposalJson(
		Schema.decodeUnknownSync(DocumentActionSchema)({
			...action,
			guards: [],
			accessGuards: [],
		}),
	)
	return crypto
		.digest("SHA-256", new TextEncoder().encode(json))
		.pipe(Effect.map(encode))
}

function hashWithdrawal(crypto: Crypto.Crypto, action: DocumentAction) {
	return crypto
		.digest("SHA-256", new TextEncoder().encode(proposalJson(action)))
		.pipe(Effect.map(encode))
}
function hashWorkspace(crypto: Crypto.Crypto, fact: WorkspaceFact) {
	let json = Schema.encodeSync(Schema.fromJsonString(WorkspaceFactSchema))(fact)
	return crypto
		.digest("SHA-256", new TextEncoder().encode(json))
		.pipe(Effect.map(encode))
}
function conflict(message: string) {
	return Effect.fail(new DocumentConflict({ message }))
}

function decodeProposal(proposal: DocumentAction) {
	return Schema.decodeUnknownEffect(DocumentActionSchema)(proposal).pipe(
		Effect.mapError(
			() => new DocumentConflict({ message: "Invalid document action" }),
		),
	)
}

function unavailable() {
	return Effect.fail(
		new ResourceUnavailable({ message: "Resource unavailable" }),
	)
}

function forbidden() {
	return Effect.fail(new PermissionDenied({ message: "Permission denied" }))
}
function invitationUnavailable() {
	return Effect.fail(
		new ResourceUnavailable({ message: "This invitation link is invalid" }),
	)
}
function invitationTarget(record: {
	workspace: string
	document: string | null
}): InvitationTarget {
	return record.document
		? { document: record.document }
		: { workspace: record.workspace }
}
// Digests have a fixed length; comparing every character avoids revealing how
// much of a guessed secret matched.
function equalSecrets(left: string, right: string) {
	let difference = left.length ^ right.length
	for (let index = 0; index < left.length; index++)
		difference |= left.charCodeAt(index) ^ (right.charCodeAt(index) || 0)
	return difference === 0
}
function refuseManaged(
	document: string,
	lookup: ReturnType<typeof makeWorkspaceProjection>,
) {
	return lookup
		.document(document)
		.pipe(
			Effect.flatMap(result =>
				Option.isSome(result) ? forbidden() : Effect.void,
			),
		)
}
function authorizeWriting(role: "owner" | "writer" | "reader" | undefined) {
	return Effect.gen(function* () {
		if (!role) return yield* unavailable()
		if (role === "reader") return yield* forbidden()
	})
}

function blobObjectFailure(cause: unknown) {
	return new SqlError.SqlError({
		reason: new SqlError.UnknownError({
			operation: "blobObjects",
			message: "Attachment object storage unavailable",
			cause,
		}),
	})
}
