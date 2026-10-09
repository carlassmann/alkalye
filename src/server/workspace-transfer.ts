import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Identity } from "../shared/workspace"
import {
	PermissionDenied,
	ResourceUnavailable,
} from "../shared/document-actions"
import { makeWorkspaceProjection } from "./workspace-projection"
import * as Schema from "effect/Schema"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlError from "effect/sql/SqlError"
import * as SqlSchema from "effect/sql/SqlSchema"
import { encode } from "../shared/base64"

let workspacesRow = Schema.Struct({
	workspace: Schema.String,
	name: Schema.String,
	owner: Schema.String,
	position: Schema.Natural,
	deleted: Schema.Natural,
})
let workspace_membersRow = Schema.Struct({
	workspace: Schema.String,
	member: Schema.String,
	role: Schema.Literals(["writer", "reader"]),
})
let workspace_documentsRow = Schema.Struct({
	document: Schema.String,
	workspace: Schema.String,
	owner: Schema.String,
})
let workspace_preferencesRow = Schema.Struct({
	workspace: Schema.String,
	field: Schema.String,
	value: Schema.String,
})
let workspace_avatarsRow = Schema.Struct({
	workspace: Schema.String,
	image: Schema.String,
})
let workspace_actionsRow = Schema.Struct({
	position: Schema.Natural,
	workspace: Schema.String,
	action: Schema.String,
	entry: Schema.Uint8Array,
	fingerprint: Schema.String,
})
let document_accessRow = Schema.Struct({
	document: Schema.String,
	member: Schema.String,
	role: Schema.Literals(["writer", "reader"]),
})
let document_summariesRow = Schema.Struct({
	document: Schema.String,
	log: Schema.String,
	position: Schema.Natural,
	deleted: Schema.Natural,
	metadata: Schema.String,
	kind: Schema.String,
	excerpt: Schema.String,
	updated: Schema.Natural,
	created: Schema.Natural,
	details_ready: Schema.Natural,
	links: Schema.String,
})
let invitationsRow = Schema.Struct({
	invitation: Schema.String,
	workspace: Schema.String,
	document: Schema.NullOr(Schema.String),
	role: Schema.Literals(["writer", "reader"]),
	digest: Schema.String,
	creator: Schema.String,
	revoked: Schema.Natural,
	position: Schema.Natural,
})
let invitation_membersRow = Schema.Struct({
	invitation: Schema.String,
	member: Schema.String,
})
let document_headsRow = Schema.Struct({
	document: Schema.String,
	log: Schema.String,
	position: Schema.Natural,
	version: Schema.Natural,
	state: Schema.String,
})
let document_tipsRow = Schema.Struct({
	document: Schema.String,
	log: Schema.String,
	position: Schema.Natural,
	version: Schema.Natural,
	fingerprint: Schema.String,
})
let document_actionsRow = Schema.Struct({
	position: Schema.Natural,
	document: Schema.String,
	action: Schema.String,
	entry: Schema.Uint8Array,
	fingerprint: Schema.String,
})
let document_targetsRow = Schema.Struct({
	target: Schema.String,
	document: Schema.String,
})
let document_operation_idsRow = Schema.Struct({
	document: Schema.String,
	id: Schema.String,
	action: Schema.String,
})
let document_actor_subjectsRow = Schema.Struct({
	actor: Schema.String,
	subject: Schema.String,
	document: Schema.String,
})
let document_withdrawalsRow = Schema.Struct({
	document: Schema.String,
	action: Schema.String,
	subject: Schema.String,
	fingerprint: Schema.String,
})
let document_clock_reservationsRow = Schema.Struct({
	document: Schema.String,
	subject: Schema.String,
	clock: Schema.Natural,
})
let document_compensationsRow = Schema.Struct({
	document: Schema.String,
	original: Schema.String,
	action: Schema.String,
})
let document_undo_boundariesRow = Schema.Struct({
	document: Schema.String,
	position: Schema.Natural,
})
let document_blobsRow = Schema.Struct({
	document: Schema.String,
	digest: Schema.String,
	bytes: Schema.Uint8Array,
	size: Schema.NullOr(Schema.Natural),
	external: Schema.Natural,
	object_key: Schema.NullOr(Schema.String),
	object_receipt: Schema.NullOr(Schema.String),
})
let effect_event_journalRow = Schema.Struct({
	id: Schema.Uint8Array,
	event: Schema.String,
	primary_key: Schema.String,
	payload: Schema.Uint8Array,
	timestamp: Schema.Natural,
})
let effect_event_remotesRow = Schema.Struct({
	remote_id: Schema.Uint8Array,
	entry_id: Schema.Uint8Array,
	sequence: Schema.Natural,
})
let document_transfer_fencesRow = Schema.Struct({
	document: Schema.String,
	request: Schema.String,
	destination: Schema.String,
	subject: Schema.String,
	phase: Schema.Literals(["staged", "imported", "retired"]),
})
let document_move_exportsRow = Schema.Struct({
	document: Schema.String,
	request: Schema.String,
	payload: Schema.Uint8Array,
})
let document_move_receiptsRow = Schema.Struct({
	document: Schema.String,
	request: Schema.String,
	subject: Schema.String,
	destination: Schema.String,
	fingerprint: Schema.String,
	log: Schema.String,
	position: Schema.Natural,
	source: Schema.String,
})
let document_move_abortsRow = Schema.Struct({
	document: Schema.String,
	request: Schema.String,
})
export let WorkspaceTransferSchema = Schema.Struct({
	workspace: Schema.String,
	generation: Schema.Natural,
	document_transfer_fences: Schema.Array(document_transfer_fencesRow),
	document_move_exports: Schema.Array(document_move_exportsRow),
	document_move_receipts: Schema.Array(document_move_receiptsRow),
	document_move_aborts: Schema.Array(document_move_abortsRow),

	workspaces: Schema.Array(workspacesRow),
	workspace_members: Schema.Array(workspace_membersRow),
	workspace_documents: Schema.Array(workspace_documentsRow),
	workspace_preferences: Schema.Array(workspace_preferencesRow),
	workspace_avatars: Schema.Array(workspace_avatarsRow),
	workspace_actions: Schema.Array(workspace_actionsRow),
	document_access: Schema.Array(document_accessRow),
	document_summaries: Schema.Array(document_summariesRow),
	invitations: Schema.Array(invitationsRow),
	invitation_members: Schema.Array(invitation_membersRow),
	document_heads: Schema.Array(document_headsRow),
	document_tips: Schema.Array(document_tipsRow),
	document_actions: Schema.Array(document_actionsRow),
	document_targets: Schema.Array(document_targetsRow),
	document_operation_ids: Schema.Array(document_operation_idsRow),
	document_actor_subjects: Schema.Array(document_actor_subjectsRow),
	document_withdrawals: Schema.Array(document_withdrawalsRow),
	document_clock_reservations: Schema.Array(document_clock_reservationsRow),
	document_compensations: Schema.Array(document_compensationsRow),
	document_undo_boundaries: Schema.Array(document_undo_boundariesRow),
	document_blobs: Schema.Array(document_blobsRow),
	effect_event_journal: Schema.Array(effect_event_journalRow),
	effect_event_remotes: Schema.Array(effect_event_remotesRow),
})
export type WorkspaceTransfer = typeof WorkspaceTransferSchema.Type
export let WorkspaceTransferCodec = SchemaBinary.toCodec(
	WorkspaceTransferSchema,
)
let workspaceExportChunkBytes = 256 * 1024
export let DocumentMoveSchema = Schema.Struct({
	document: Schema.String,
	from: Schema.String,
	destination: Schema.String,
	request: Schema.String,
	subject: Schema.String,
	workspace_documents: Schema.Array(workspace_documentsRow),
	document_access: Schema.Array(document_accessRow),
	document_summaries: Schema.Array(document_summariesRow),
	invitations: Schema.Array(invitationsRow),
	invitation_members: Schema.Array(invitation_membersRow),
	document_heads: Schema.Array(document_headsRow),
	document_tips: Schema.Array(document_tipsRow),
	document_actions: Schema.Array(document_actionsRow),
	document_targets: Schema.Array(document_targetsRow),
	document_operation_ids: Schema.Array(document_operation_idsRow),
	document_actor_subjects: Schema.Array(document_actor_subjectsRow),
	document_withdrawals: Schema.Array(document_withdrawalsRow),
	document_clock_reservations: Schema.Array(document_clock_reservationsRow),
	document_compensations: Schema.Array(document_compensationsRow),
	document_undo_boundaries: Schema.Array(document_undo_boundariesRow),
	document_blobs: Schema.Array(document_blobsRow),
	effect_event_journal: Schema.Array(effect_event_journalRow),
	effect_event_remotes: Schema.Array(effect_event_remotesRow),
})
export type DocumentMove = typeof DocumentMoveSchema.Type
let documentMoveBinary = SchemaBinary.toCodec(DocumentMoveSchema)

export class WorkspaceTransfers extends Context.Service<
	WorkspaceTransfers,
	Effect.Success<ReturnType<typeof makeTransfers>>
>()("WorkspaceTransfers") {
	static get live() {
		return Layer.effect(WorkspaceTransfers, makeTransfers())
	}
}
export function initializeTransferFences(sql: SqlClient.SqlClient) {
	return Effect.gen(function* () {
		yield* sql`CREATE TABLE IF NOT EXISTS document_transfer_fences (document TEXT PRIMARY KEY,request TEXT NOT NULL,destination TEXT NOT NULL,subject TEXT NOT NULL,phase TEXT NOT NULL CHECK(phase IN ('staged','imported','retired')))`
		yield* sql`CREATE TABLE IF NOT EXISTS document_move_exports (document TEXT NOT NULL,request TEXT NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(document,request))`
		yield* sql`CREATE TABLE IF NOT EXISTS document_move_receipts (document TEXT NOT NULL,request TEXT NOT NULL,subject TEXT NOT NULL,destination TEXT NOT NULL,fingerprint TEXT NOT NULL,log TEXT NOT NULL,position INTEGER NOT NULL,source TEXT NOT NULL,PRIMARY KEY(document,request))`
		let columns = yield* sql<{
			name: string
		}>`PRAGMA table_info(document_move_receipts)`
		if (!columns.some(column => column.name === "source"))
			yield* sql`ALTER TABLE document_move_receipts ADD COLUMN source TEXT NOT NULL DEFAULT ''`
		yield* sql`CREATE TABLE IF NOT EXISTS document_move_aborts (document TEXT NOT NULL,request TEXT NOT NULL,PRIMARY KEY(document,request))`
		yield* sql`CREATE TABLE IF NOT EXISTS workspace_transfer_fences (workspace TEXT PRIMARY KEY, generation INTEGER NOT NULL)`
		yield* sql`CREATE TABLE IF NOT EXISTS workspace_transfer_exports (workspace TEXT NOT NULL,generation INTEGER NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(workspace,generation))`
		yield* sql`CREATE TABLE IF NOT EXISTS workspace_transfer_export_manifests (workspace TEXT NOT NULL,generation INTEGER NOT NULL,bytes INTEGER NOT NULL,chunks INTEGER NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(workspace,generation))`
		yield* sql`CREATE TABLE IF NOT EXISTS workspace_transfer_export_chunks (workspace TEXT NOT NULL,generation INTEGER NOT NULL,part INTEGER NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(workspace,generation,part))`
		yield* sql`CREATE TABLE IF NOT EXISTS workspace_transfer_receipts (workspace TEXT NOT NULL,generation INTEGER NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(workspace,generation))`
	})
}
export function ensureWorkspaceWritable(
	sql: SqlClient.SqlClient,
	workspace: string,
) {
	return sql<{
		generation: number
	}>`SELECT generation FROM workspace_transfer_fences WHERE workspace=${workspace}`.pipe(
		Effect.flatMap(rows =>
			rows.length ? failure("Workspace transfer is frozen", true) : Effect.void,
		),
	)
}
export function ensureDocumentReadable(
	sql: SqlClient.SqlClient,
	document: string,
) {
	return sql<{
		phase: string
	}>`SELECT phase FROM document_transfer_fences WHERE document=${document}`.pipe(
		Effect.flatMap(rows =>
			rows.length
				? failure("Document transfer is unavailable", true)
				: Effect.void,
		),
	)
}
export function ensureDocumentWritable(
	sql: SqlClient.SqlClient,
	document: string,
) {
	return ensureDocumentReadable(sql, document).pipe(
		Effect.andThen(
			sql<{
				generation: number
			}>`SELECT f.generation FROM workspace_transfer_fences f JOIN workspace_documents d ON d.workspace=f.workspace WHERE d.document=${document}`.pipe(
				Effect.flatMap(rows =>
					rows.length
						? failure("Workspace transfer is frozen", true)
						: Effect.void,
				),
			),
		),
	)
}
function makeTransfers() {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		let crypto = yield* Crypto.Crypto
		yield* initializeTransferFences(sql)
		function frozen(workspace: string, generation: number) {
			return sql<{
				generation: number
			}>`SELECT generation FROM workspace_transfer_fences WHERE workspace=${workspace}`.pipe(
				Effect.flatMap(rows =>
					rows[0]?.generation === generation
						? Effect.void
						: failure("Workspace transfer fence does not match"),
				),
			)
		}
		let read_workspaces = SqlSchema.findAll({
			Request: Schema.String,
			Result: workspacesRow,
			execute: workspace =>
				sql`SELECT * FROM workspaces WHERE workspace=${workspace}`,
		})
		let read_workspace_members = SqlSchema.findAll({
			Request: Schema.String,
			Result: workspace_membersRow,
			execute: workspace =>
				sql`SELECT * FROM workspace_members WHERE workspace=${workspace}`,
		})
		let read_workspace_documents = SqlSchema.findAll({
			Request: Schema.String,
			Result: workspace_documentsRow,
			execute: workspace =>
				sql`SELECT * FROM workspace_documents WHERE workspace=${workspace}`,
		})
		let read_workspace_preferences = SqlSchema.findAll({
			Request: Schema.String,
			Result: workspace_preferencesRow,
			execute: workspace =>
				sql`SELECT * FROM workspace_preferences WHERE workspace=${workspace}`,
		})
		let read_workspace_avatars = SqlSchema.findAll({
			Request: Schema.String,
			Result: workspace_avatarsRow,
			execute: workspace =>
				sql`SELECT * FROM workspace_avatars WHERE workspace=${workspace}`,
		})
		let read_workspace_actions = SqlSchema.findAll({
			Request: Schema.String,
			Result: workspace_actionsRow,
			execute: workspace =>
				sql`SELECT * FROM workspace_actions WHERE workspace=${workspace}`,
		})
		let read_document_access = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_accessRow,
			execute: workspace =>
				sql`SELECT * FROM document_access WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_summaries = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_summariesRow,
			execute: workspace =>
				sql`SELECT * FROM document_summaries WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_invitations = SqlSchema.findAll({
			Request: Schema.String,
			Result: invitationsRow,
			execute: workspace =>
				sql`SELECT * FROM invitations WHERE workspace=${workspace}`,
		})
		let read_invitation_members = SqlSchema.findAll({
			Request: Schema.String,
			Result: invitation_membersRow,
			execute: workspace =>
				sql`SELECT * FROM invitation_members WHERE invitation IN (SELECT invitation FROM invitations WHERE workspace=${workspace})`,
		})
		let read_document_heads = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_headsRow,
			execute: workspace =>
				sql`SELECT * FROM document_heads WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_tips = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_tipsRow,
			execute: workspace =>
				sql`SELECT * FROM document_tips WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_actions = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_actionsRow,
			execute: workspace =>
				sql`SELECT * FROM document_actions WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_targets = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_targetsRow,
			execute: workspace =>
				sql`SELECT * FROM document_targets WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_operation_ids = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_operation_idsRow,
			execute: workspace =>
				sql`SELECT * FROM document_operation_ids WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_actor_subjects = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_actor_subjectsRow,
			execute: workspace =>
				sql`SELECT * FROM document_actor_subjects WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_withdrawals = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_withdrawalsRow,
			execute: workspace =>
				sql`SELECT * FROM document_withdrawals WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_clock_reservations = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_clock_reservationsRow,
			execute: workspace =>
				sql`SELECT * FROM document_clock_reservations WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_compensations = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_compensationsRow,
			execute: workspace =>
				sql`SELECT * FROM document_compensations WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_undo_boundaries = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_undo_boundariesRow,
			execute: workspace =>
				sql`SELECT * FROM document_undo_boundaries WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_transfer_fences = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_transfer_fencesRow,
			execute: workspace =>
				sql`SELECT * FROM document_transfer_fences WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_move_exports = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_move_exportsRow,
			execute: workspace =>
				sql`SELECT * FROM document_move_exports WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_move_receipts = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_move_receiptsRow,
			execute: workspace =>
				sql`SELECT * FROM document_move_receipts WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_move_aborts = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_move_abortsRow,
			execute: workspace =>
				sql`SELECT * FROM document_move_aborts WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_document_blobs = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_blobsRow,
			execute: workspace =>
				sql`SELECT * FROM document_blobs WHERE document IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})`,
		})
		let read_effect_event_journal = SqlSchema.findAll({
			Request: Schema.String,
			Result: effect_event_journalRow,
			execute: workspace =>
				sql`SELECT * FROM effect_event_journal WHERE ((event='WorkspaceChanged' AND primary_key=${workspace}) OR (event IN ('DocumentChanged','DocumentWithdrawn') AND primary_key IN (SELECT document FROM workspace_documents WHERE workspace=${workspace})))`,
		})
		let read_effect_event_remotes = SqlSchema.findAll({
			Request: Schema.String,
			Result: effect_event_remotesRow,
			execute: workspace =>
				sql`SELECT * FROM effect_event_remotes WHERE entry_id IN (SELECT id FROM effect_event_journal WHERE ((event='WorkspaceChanged' AND primary_key=${workspace}) OR (event IN ('DocumentChanged','DocumentWithdrawn') AND primary_key IN (SELECT document FROM workspace_documents WHERE workspace=${workspace}))))`,
		})
		function freezeWorkspace(workspace: string, generation: number) {
			return sql.withTransaction(
				Effect.gen(function* () {
					let rows = yield* sql<{
						workspace: string
					}>`SELECT workspace FROM workspaces WHERE workspace=${workspace}`
					if (!rows.length) return yield* failure("Workspace is missing")
					yield* sql`INSERT INTO workspace_transfer_fences VALUES(${workspace},${generation}) ON CONFLICT DO NOTHING`
					yield* frozen(workspace, generation)
				}),
			)
		}
		function cacheWorkspaceExport(
			workspace: string,
			generation: number,
			payload: Uint8Array,
		) {
			return Effect.gen(function* () {
				let chunks = Math.ceil(payload.length / workspaceExportChunkBytes)
				for (let part = 0; part < chunks; part++) {
					let chunk = payload.subarray(
						part * workspaceExportChunkBytes,
						(part + 1) * workspaceExportChunkBytes,
					)
					yield* sql`INSERT INTO workspace_transfer_export_chunks VALUES(${workspace},${generation},${part},${chunk})`
				}
				let fingerprint = encode(yield* crypto.digest("SHA-256", payload))
				yield* sql`INSERT INTO workspace_transfer_export_manifests VALUES(${workspace},${generation},${payload.length},${chunks},${fingerprint})`
			})
		}
		function exportWorkspacePayload(workspace: string, generation: number) {
			return sql.withTransaction(
				Effect.gen(function* () {
					yield* frozen(workspace, generation)
					let manifests = yield* sql<{
						bytes: number
						chunks: number
						fingerprint: string
					}>`SELECT bytes,chunks,fingerprint FROM workspace_transfer_export_manifests WHERE workspace=${workspace} AND generation=${generation}`
					let manifest = manifests[0]
					if (manifest) {
						if (
							!Number.isSafeInteger(manifest.bytes) ||
							manifest.bytes <= 0 ||
							!Number.isSafeInteger(manifest.chunks) ||
							manifest.chunks !==
								Math.ceil(manifest.bytes / workspaceExportChunkBytes)
						)
							return yield* failure("Workspace export manifest is invalid")
						let chunks = yield* sql<{
							part: number
							payload: Uint8Array
						}>`SELECT part,payload FROM workspace_transfer_export_chunks WHERE workspace=${workspace} AND generation=${generation} ORDER BY part`
						if (chunks.length !== manifest.chunks)
							return yield* failure("Workspace export chunks are incomplete")
						let payload = new Uint8Array(manifest.bytes)
						for (let [part, chunk] of chunks.entries()) {
							let size = Math.min(
								workspaceExportChunkBytes,
								manifest.bytes - part * workspaceExportChunkBytes,
							)
							if (chunk.part !== part || chunk.payload.length !== size)
								return yield* failure("Workspace export chunk is invalid")
							payload.set(chunk.payload, part * workspaceExportChunkBytes)
						}
						if (
							encode(yield* crypto.digest("SHA-256", payload)) !==
							manifest.fingerprint
						)
							return yield* failure("Workspace export fingerprint differs")
						return payload
					}
					let previous = yield* sql<{
						payload: Uint8Array
					}>`SELECT payload FROM workspace_transfer_exports WHERE workspace=${workspace} AND generation=${generation}`
					if (previous[0]) {
						yield* Schema.decodeUnknownEffect(WorkspaceTransferCodec)(
							previous[0].payload,
						)
						yield* cacheWorkspaceExport(
							workspace,
							generation,
							previous[0].payload,
						)
						return previous[0].payload
					}
					let bundle = {
						workspace,
						generation,
						workspaces: yield* read_workspaces(workspace),
						workspace_members: yield* read_workspace_members(workspace),
						workspace_documents: yield* read_workspace_documents(workspace),
						workspace_preferences: yield* read_workspace_preferences(workspace),
						workspace_avatars: yield* read_workspace_avatars(workspace),
						workspace_actions: yield* read_workspace_actions(workspace),
						document_access: yield* read_document_access(workspace),
						document_summaries: yield* read_document_summaries(workspace),
						invitations: yield* read_invitations(workspace),
						invitation_members: yield* read_invitation_members(workspace),
						document_heads: yield* read_document_heads(workspace),
						document_tips: yield* read_document_tips(workspace),
						document_actions: yield* read_document_actions(workspace),
						document_targets: yield* read_document_targets(workspace),
						document_operation_ids:
							yield* read_document_operation_ids(workspace),
						document_actor_subjects:
							yield* read_document_actor_subjects(workspace),
						document_withdrawals: yield* read_document_withdrawals(workspace),
						document_clock_reservations:
							yield* read_document_clock_reservations(workspace),
						document_compensations:
							yield* read_document_compensations(workspace),
						document_undo_boundaries:
							yield* read_document_undo_boundaries(workspace),
						document_transfer_fences:
							yield* read_document_transfer_fences(workspace),
						document_move_exports: yield* read_document_move_exports(workspace),
						document_move_receipts:
							yield* read_document_move_receipts(workspace),
						document_move_aborts: yield* read_document_move_aborts(workspace),
						document_blobs: yield* read_document_blobs(workspace),
						effect_event_journal: yield* read_effect_event_journal(workspace),
						effect_event_remotes: yield* read_effect_event_remotes(workspace),
					}
					let payload = yield* Schema.encodeEffect(WorkspaceTransferCodec)(
						bundle,
					)
					yield* cacheWorkspaceExport(workspace, generation, payload)
					return payload
				}),
			)
		}
		function exportWorkspace(workspace: string, generation: number) {
			return exportWorkspacePayload(workspace, generation).pipe(
				Effect.flatMap(payload =>
					Schema.decodeUnknownEffect(WorkspaceTransferCodec)(payload),
				),
			)
		}
		function importWorkspace(input: WorkspaceTransfer) {
			return Effect.gen(function* () {
				let bundle = yield* Schema.decodeUnknownEffect(WorkspaceTransferSchema)(
					input,
				)
				if (
					bundle.workspaces.length !== 1 ||
					bundle.workspaces[0]?.workspace !== bundle.workspace
				)
					return yield* failure("Transfer must contain its exact workspace")
				let documents = new Set(
					bundle.workspace_documents.map(row => row.document),
				)
				let invitations = new Set(bundle.invitations.map(row => row.invitation))
				if (bundle.workspaces.some(row => row.workspace !== bundle.workspace))
					return yield* failure("Transfer contains a foreign workspace")
				if (
					bundle.workspace_members.some(
						row => row.workspace !== bundle.workspace,
					)
				)
					return yield* failure("Transfer contains a foreign workspace")
				if (
					bundle.workspace_documents.some(
						row => row.workspace !== bundle.workspace,
					)
				)
					return yield* failure("Transfer contains a foreign workspace")
				if (
					bundle.workspace_preferences.some(
						row => row.workspace !== bundle.workspace,
					)
				)
					return yield* failure("Transfer contains a foreign workspace")
				if (
					bundle.workspace_avatars.some(
						row => row.workspace !== bundle.workspace,
					)
				)
					return yield* failure("Transfer contains a foreign workspace")
				if (
					bundle.workspace_actions.some(
						row => row.workspace !== bundle.workspace,
					)
				)
					return yield* failure("Transfer contains a foreign workspace")
				if (bundle.document_access.some(row => !documents.has(row.document)))
					return yield* failure("Transfer contains a foreign document")
				if (bundle.document_summaries.some(row => !documents.has(row.document)))
					return yield* failure("Transfer contains a foreign document")
				if (bundle.invitations.some(row => row.workspace !== bundle.workspace))
					return yield* failure("Transfer contains a foreign workspace")
				if (
					bundle.invitation_members.some(
						row => !invitations.has(row.invitation),
					)
				)
					return yield* failure("Transfer contains a foreign invitation")
				if (bundle.document_heads.some(row => !documents.has(row.document)))
					return yield* failure("Transfer contains a foreign document")
				if (bundle.document_tips.some(row => !documents.has(row.document)))
					return yield* failure("Transfer contains a foreign document")
				if (bundle.document_actions.some(row => !documents.has(row.document)))
					return yield* failure("Transfer contains a foreign document")
				if (bundle.document_targets.some(row => !documents.has(row.document)))
					return yield* failure("Transfer contains a foreign document")
				if (
					bundle.document_operation_ids.some(
						row => !documents.has(row.document),
					)
				)
					return yield* failure("Transfer contains a foreign document")
				if (
					bundle.document_actor_subjects.some(
						row => !documents.has(row.document),
					)
				)
					return yield* failure("Transfer contains a foreign document")
				if (
					bundle.document_withdrawals.some(row => !documents.has(row.document))
				)
					return yield* failure("Transfer contains a foreign document")
				if (
					bundle.document_clock_reservations.some(
						row => !documents.has(row.document),
					)
				)
					return yield* failure("Transfer contains a foreign document")
				if (
					bundle.document_compensations.some(
						row => !documents.has(row.document),
					)
				)
					return yield* failure("Transfer contains a foreign document")
				if (
					bundle.document_undo_boundaries.some(
						row => !documents.has(row.document),
					)
				)
					return yield* failure("Transfer contains a foreign document")
				if (
					bundle.document_transfer_fences.some(
						row => !documents.has(row.document),
					)
				)
					return yield* failure("Transfer contains a foreign document")
				if (
					bundle.document_move_exports.some(row => !documents.has(row.document))
				)
					return yield* failure("Transfer contains a foreign document")
				if (
					bundle.document_move_receipts.some(
						row => !documents.has(row.document),
					)
				)
					return yield* failure("Transfer contains a foreign document")
				if (
					bundle.document_move_aborts.some(row => !documents.has(row.document))
				)
					return yield* failure("Transfer contains a foreign document")
				if (bundle.document_blobs.some(row => !documents.has(row.document)))
					return yield* failure("Transfer contains a foreign document")
				if (
					bundle.invitations.some(
						row => row.document !== null && !documents.has(row.document),
					)
				)
					return yield* failure(
						"Transfer contains a foreign invitation document",
					)
				if (
					bundle.effect_event_journal.some(row =>
						row.event === "WorkspaceChanged"
							? row.primary_key !== bundle.workspace
							: !["DocumentChanged", "DocumentWithdrawn"].includes(row.event) ||
								!documents.has(row.primary_key),
					)
				)
					return yield* failure("Transfer contains a foreign journal entry")
				let entries = new Set(
					bundle.effect_event_journal.map(row => encode(row.id)),
				)
				if (
					bundle.effect_event_remotes.some(
						row => !entries.has(encode(row.entry_id)),
					)
				)
					return yield* failure("Transfer contains a foreign remote receipt")

				let json = Schema.encodeSync(
					Schema.fromJsonString(WorkspaceTransferSchema),
				)(bundle)
				let fingerprint = encode(
					yield* crypto.digest("SHA-256", new TextEncoder().encode(json)),
				)

				return yield* sql.withTransaction(
					Effect.gen(function* () {
						let receipt = yield* sql<{
							fingerprint: string
						}>`SELECT fingerprint FROM workspace_transfer_receipts WHERE workspace=${bundle.workspace} AND generation=${bundle.generation}`
						if (receipt[0]) {
							if (receipt[0].fingerprint !== fingerprint)
								return yield* failure("Transfer receipt is immutable")
							return
						}
						let existing = yield* sql<{
							workspace: string
						}>`SELECT workspace FROM workspaces WHERE workspace=${bundle.workspace}`
						if (existing.length)
							return yield* failure("Transfer target workspace is already used")
						yield* sql`INSERT INTO workspace_transfer_fences VALUES(${bundle.workspace},${bundle.generation})`
						for (let row of bundle.workspaces)
							yield* sql`INSERT INTO workspaces ${sql.insert(row)}`

						for (let row of bundle.workspace_members)
							yield* sql`INSERT INTO workspace_members ${sql.insert(row)}`

						for (let row of bundle.workspace_documents)
							yield* sql`INSERT INTO workspace_documents ${sql.insert(row)}`

						for (let row of bundle.workspace_preferences)
							yield* sql`INSERT INTO workspace_preferences ${sql.insert(row)}`

						for (let row of bundle.workspace_avatars)
							yield* sql`INSERT INTO workspace_avatars ${sql.insert(row)}`

						for (let row of bundle.workspace_actions)
							yield* sql`INSERT INTO workspace_actions ${sql.insert(row)}`

						for (let row of bundle.document_access)
							yield* sql`INSERT INTO document_access ${sql.insert(row)}`

						for (let row of bundle.document_summaries)
							yield* sql`INSERT INTO document_summaries ${sql.insert(row)}`

						for (let row of bundle.invitations)
							yield* sql`INSERT INTO invitations ${sql.insert(row)}`

						for (let row of bundle.invitation_members)
							yield* sql`INSERT INTO invitation_members ${sql.insert(row)}`

						for (let row of bundle.document_heads)
							yield* sql`INSERT INTO document_heads ${sql.insert(row)}`

						for (let row of bundle.document_tips)
							yield* sql`INSERT INTO document_tips ${sql.insert(row)}`

						for (let row of bundle.document_actions)
							yield* sql`INSERT INTO document_actions ${sql.insert(row)}`

						for (let row of bundle.document_targets)
							yield* sql`INSERT INTO document_targets ${sql.insert(row)}`

						for (let row of bundle.document_operation_ids)
							yield* sql`INSERT INTO document_operation_ids ${sql.insert(row)}`

						for (let row of bundle.document_actor_subjects)
							yield* sql`INSERT INTO document_actor_subjects ${sql.insert(row)}`

						for (let row of bundle.document_withdrawals)
							yield* sql`INSERT INTO document_withdrawals ${sql.insert(row)}`

						for (let row of bundle.document_clock_reservations)
							yield* sql`INSERT INTO document_clock_reservations ${sql.insert(row)}`

						for (let row of bundle.document_compensations)
							yield* sql`INSERT INTO document_compensations ${sql.insert(row)}`

						for (let row of bundle.document_undo_boundaries)
							yield* sql`INSERT INTO document_undo_boundaries ${sql.insert(row)}`

						for (let row of bundle.document_blobs)
							yield* sql`INSERT INTO document_blobs ${sql.insert(row)}`

						for (let row of bundle.effect_event_journal)
							yield* sql`INSERT INTO effect_event_journal ${sql.insert(row)}`

						for (let row of bundle.effect_event_remotes)
							yield* sql`INSERT INTO effect_event_remotes ${sql.insert(row)}`

						for (let row of bundle.document_transfer_fences)
							yield* sql`INSERT INTO document_transfer_fences ${sql.insert(row)}`

						for (let row of bundle.document_move_exports)
							yield* sql`INSERT INTO document_move_exports ${sql.insert(row)}`

						for (let row of bundle.document_move_receipts)
							yield* sql`INSERT INTO document_move_receipts ${sql.insert(row)}`

						for (let row of bundle.document_move_aborts)
							yield* sql`INSERT INTO document_move_aborts ${sql.insert(row)}`

						yield* sql`INSERT INTO workspace_transfer_receipts VALUES(${bundle.workspace},${bundle.generation},${fingerprint})`
					}),
				)
			})
		}
		function activateImportedWorkspace(workspace: string, generation: number) {
			return sql.withTransaction(
				Effect.gen(function* () {
					let receipts = yield* sql<{
						generation: number
					}>`SELECT generation FROM workspace_transfer_receipts WHERE workspace=${workspace} AND generation=${generation}`
					if (!receipts.length)
						return yield* failure("Imported transfer receipt is missing")
					let fences = yield* sql<{
						generation: number
					}>`SELECT generation FROM workspace_transfer_fences WHERE workspace=${workspace}`
					if (fences[0] && fences[0].generation !== generation)
						return yield* failure("Workspace transfer fence does not match")
					yield* sql`DELETE FROM workspace_transfer_fences WHERE workspace=${workspace} AND generation=${generation}`
				}),
			)
		}
		let projection = makeWorkspaceProjection(sql)
		let move_workspace_documents = SqlSchema.findAll({
			Request: Schema.String,
			Result: workspace_documentsRow,
			execute: document =>
				sql`SELECT * FROM workspace_documents WHERE document=${document}`,
		})
		let move_document_access = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_accessRow,
			execute: document =>
				sql`SELECT * FROM document_access WHERE document=${document}`,
		})
		let move_document_summaries = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_summariesRow,
			execute: document =>
				sql`SELECT * FROM document_summaries WHERE document=${document}`,
		})
		let move_invitations = SqlSchema.findAll({
			Request: Schema.String,
			Result: invitationsRow,
			execute: document =>
				sql`SELECT * FROM invitations WHERE document=${document}`,
		})
		let move_invitation_members = SqlSchema.findAll({
			Request: Schema.String,
			Result: invitation_membersRow,
			execute: document =>
				sql`SELECT * FROM invitation_members WHERE invitation IN (SELECT invitation FROM invitations WHERE document=${document})`,
		})
		let move_document_heads = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_headsRow,
			execute: document =>
				sql`SELECT * FROM document_heads WHERE document=${document}`,
		})
		let move_document_tips = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_tipsRow,
			execute: document =>
				sql`SELECT * FROM document_tips WHERE document=${document}`,
		})
		let move_document_actions = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_actionsRow,
			execute: document =>
				sql`SELECT * FROM document_actions WHERE document=${document}`,
		})
		let move_document_targets = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_targetsRow,
			execute: document =>
				sql`SELECT * FROM document_targets WHERE document=${document}`,
		})
		let move_document_operation_ids = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_operation_idsRow,
			execute: document =>
				sql`SELECT * FROM document_operation_ids WHERE document=${document}`,
		})
		let move_document_actor_subjects = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_actor_subjectsRow,
			execute: document =>
				sql`SELECT * FROM document_actor_subjects WHERE document=${document}`,
		})
		let move_document_withdrawals = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_withdrawalsRow,
			execute: document =>
				sql`SELECT * FROM document_withdrawals WHERE document=${document}`,
		})
		let move_document_clock_reservations = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_clock_reservationsRow,
			execute: document =>
				sql`SELECT * FROM document_clock_reservations WHERE document=${document}`,
		})
		let move_document_compensations = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_compensationsRow,
			execute: document =>
				sql`SELECT * FROM document_compensations WHERE document=${document}`,
		})
		let move_document_undo_boundaries = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_undo_boundariesRow,
			execute: document =>
				sql`SELECT * FROM document_undo_boundaries WHERE document=${document}`,
		})
		let move_document_blobs = SqlSchema.findAll({
			Request: Schema.String,
			Result: document_blobsRow,
			execute: document =>
				sql`SELECT * FROM document_blobs WHERE document=${document}`,
		})
		let move_effect_event_journal = SqlSchema.findAll({
			Request: Schema.String,
			Result: effect_event_journalRow,
			execute: document =>
				sql`SELECT * FROM effect_event_journal WHERE event IN ('DocumentChanged','DocumentWithdrawn') AND primary_key=${document}`,
		})
		let move_effect_event_remotes = SqlSchema.findAll({
			Request: Schema.String,
			Result: effect_event_remotesRow,
			execute: document =>
				sql`SELECT * FROM effect_event_remotes WHERE entry_id IN (SELECT id FROM effect_event_journal WHERE event IN ('DocumentChanged','DocumentWithdrawn') AND primary_key=${document})`,
		})
		function authorizeDocumentDestination(destination: string) {
			return Effect.gen(function* () {
				let identity = yield* Identity
				if (identity.access)
					return yield* Effect.fail(
						new PermissionDenied({
							message: "Scoped access cannot move documents",
						}),
					)
				yield* ensureWorkspaceWritable(sql, destination)
				let role = yield* projection.workspaceRole(
					destination,
					identity.subject,
				)
				if (role !== "owner" && role !== "writer")
					return yield* Effect.fail(
						new PermissionDenied({
							message: "Destination workspace is not writable",
						}),
					)
				return identity
			})
		}
		function stageDocumentMove(
			document: string,
			destination: string,
			request: string,
		) {
			return sql.withTransaction(
				Effect.gen(function* () {
					let identity = yield* Identity
					if (identity.access)
						return yield* Effect.fail(
							new PermissionDenied({
								message: "Scoped access cannot move documents",
							}),
						)
					let association = yield* projection.document(document)
					if (Option.isNone(association))
						return yield* Effect.fail(
							new ResourceUnavailable({ message: "Document is unavailable" }),
						)
					if (
						(yield* projection.documentRole(document, identity.subject)) !==
						"owner"
					)
						return yield* Effect.fail(
							new PermissionDenied({
								message: "Only an owner can move documents",
							}),
						)
					if (association.value.workspace === destination)
						return yield* failure("Document already belongs to destination")
					yield* ensureWorkspaceWritable(sql, association.value.workspace)
					let aborted =
						yield* sql`SELECT request FROM document_move_aborts WHERE document=${document} AND request=${request}`
					if (aborted.length)
						return yield* failure("Aborted move request cannot be reused")
					let old = yield* sql<{
						request: string
						destination: string
						subject: string
					}>`SELECT request,destination,subject FROM document_transfer_fences WHERE document=${document}`
					if (
						old[0] &&
						(old[0].request !== request ||
							old[0].destination !== destination ||
							old[0].subject !== identity.subject)
					)
						return yield* failure("Document already has a different transfer")
					let cached = yield* sql<{
						payload: Uint8Array
					}>`SELECT payload FROM document_move_exports WHERE document=${document} AND request=${request}`
					if (cached[0])
						return yield* Schema.decodeUnknownEffect(documentMoveBinary)(
							cached[0].payload,
						)
					yield* sql`INSERT INTO document_transfer_fences VALUES(${document},${request},${destination},${identity.subject},'staged')`
					let bundle = {
						document,
						from: association.value.workspace,
						destination,
						request,
						subject: identity.subject,
						workspace_documents: yield* move_workspace_documents(document),
						document_access: yield* move_document_access(document),
						document_summaries: yield* move_document_summaries(document),
						invitations: yield* move_invitations(document),
						invitation_members: yield* move_invitation_members(document),
						document_heads: yield* move_document_heads(document),
						document_tips: yield* move_document_tips(document),
						document_actions: yield* move_document_actions(document),
						document_targets: yield* move_document_targets(document),
						document_operation_ids:
							yield* move_document_operation_ids(document),
						document_actor_subjects:
							yield* move_document_actor_subjects(document),
						document_withdrawals: yield* move_document_withdrawals(document),
						document_clock_reservations:
							yield* move_document_clock_reservations(document),
						document_compensations:
							yield* move_document_compensations(document),
						document_undo_boundaries:
							yield* move_document_undo_boundaries(document),
						document_blobs: yield* move_document_blobs(document),
						effect_event_journal: yield* move_effect_event_journal(document),
						effect_event_remotes: yield* move_effect_event_remotes(document),
					}
					let payload = yield* Schema.encodeEffect(documentMoveBinary)(bundle)
					yield* sql`INSERT INTO document_move_exports VALUES(${document},${request},${payload})`
					return bundle
				}),
			)
		}
		function importDocumentMove(input: DocumentMove) {
			return Effect.gen(function* () {
				let bundle =
					yield* Schema.decodeUnknownEffect(DocumentMoveSchema)(input)
				let identity = yield* Identity
				if (identity.access)
					return yield* Effect.fail(
						new PermissionDenied({
							message: "Scoped access cannot move documents",
						}),
					)
				if (identity.subject !== bundle.subject)
					return yield* Effect.fail(
						new PermissionDenied({
							message: "Move subject does not match authenticated identity",
						}),
					)
				if (
					bundle.workspace_documents.length !== 1 ||
					bundle.workspace_documents[0]?.document !== bundle.document ||
					bundle.workspace_documents[0].workspace !== bundle.from
				)
					return yield* failure("Move association does not match its source")
				if (
					bundle.workspace_documents.some(
						row => row.document !== bundle.document,
					)
				)
					return yield* failure("Move contains a foreign document")
				if (
					bundle.document_access.some(row => row.document !== bundle.document)
				)
					return yield* failure("Move contains a foreign document")
				if (
					bundle.document_summaries.some(
						row => row.document !== bundle.document,
					)
				)
					return yield* failure("Move contains a foreign document")
				if (
					bundle.invitations.some(
						row =>
							row.document !== bundle.document || row.workspace !== bundle.from,
					)
				)
					return yield* failure("Move contains a foreign invitation")
				if (bundle.document_heads.some(row => row.document !== bundle.document))
					return yield* failure("Move contains a foreign document")
				if (bundle.document_tips.some(row => row.document !== bundle.document))
					return yield* failure("Move contains a foreign document")
				if (
					bundle.document_actions.some(row => row.document !== bundle.document)
				)
					return yield* failure("Move contains a foreign document")
				if (
					bundle.document_targets.some(row => row.document !== bundle.document)
				)
					return yield* failure("Move contains a foreign document")
				if (
					bundle.document_operation_ids.some(
						row => row.document !== bundle.document,
					)
				)
					return yield* failure("Move contains a foreign document")
				if (
					bundle.document_actor_subjects.some(
						row => row.document !== bundle.document,
					)
				)
					return yield* failure("Move contains a foreign document")
				if (
					bundle.document_withdrawals.some(
						row => row.document !== bundle.document,
					)
				)
					return yield* failure("Move contains a foreign document")
				if (
					bundle.document_clock_reservations.some(
						row => row.document !== bundle.document,
					)
				)
					return yield* failure("Move contains a foreign document")
				if (
					bundle.document_compensations.some(
						row => row.document !== bundle.document,
					)
				)
					return yield* failure("Move contains a foreign document")
				if (
					bundle.document_undo_boundaries.some(
						row => row.document !== bundle.document,
					)
				)
					return yield* failure("Move contains a foreign document")
				if (bundle.document_blobs.some(row => row.document !== bundle.document))
					return yield* failure("Move contains a foreign document")
				let invitations = new Set(bundle.invitations.map(row => row.invitation))
				if (
					bundle.invitation_members.some(
						row => !invitations.has(row.invitation),
					)
				)
					return yield* failure("Move contains a foreign invitation member")
				if (
					bundle.effect_event_journal.some(
						row =>
							row.primary_key !== bundle.document ||
							!["DocumentChanged", "DocumentWithdrawn"].includes(row.event),
					)
				)
					return yield* failure("Move contains a foreign journal entry")
				let entries = new Set(
					bundle.effect_event_journal.map(row => encode(row.id)),
				)
				if (
					bundle.effect_event_remotes.some(
						row => !entries.has(encode(row.entry_id)),
					)
				)
					return yield* failure("Move contains a foreign remote receipt")
				let fingerprint = encode(
					yield* crypto.digest(
						"SHA-256",
						new TextEncoder().encode(
							Schema.encodeSync(Schema.fromJsonString(DocumentMoveSchema))(
								bundle,
							),
						),
					),
				)
				return yield* sql.withTransaction(
					Effect.gen(function* () {
						let old = yield* sql<{
							fingerprint: string
							log: string
							position: number
						}>`SELECT fingerprint,log,position FROM document_move_receipts WHERE document=${bundle.document} AND request=${bundle.request}`
						if (old[0]) {
							if (old[0].fingerprint !== fingerprint)
								return yield* failure("Move receipt is immutable")
							return { log: old[0].log, position: old[0].position }
						}
						yield* authorizeDocumentDestination(bundle.destination)
						let existingDocument = yield* projection.document(bundle.document)
						if (Option.isSome(existingDocument)) {
							let fences = yield* sql<{
								request: string
								phase: string
							}>`SELECT request,phase FROM document_transfer_fences WHERE document=${bundle.document}`
							let fence = fences[0]
							if (
								!fence ||
								fence.phase !== "retired" ||
								existingDocument.value.workspace !== bundle.destination
							)
								return yield* failure(
									"Move target document already exists without a retired receipt",
								)
							let exports =
								yield* sql`SELECT request FROM document_move_exports WHERE document=${bundle.document} AND request=${fence.request}`
							if (!exports.length)
								return yield* failure("Retired move export receipt is missing")
							yield* sql`DELETE FROM invitation_members WHERE invitation IN (SELECT invitation FROM invitations WHERE document=${bundle.document})`
							yield* sql`DELETE FROM invitations WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_access WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_summaries WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_heads WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_tips WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_actions WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_targets WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_operation_ids WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_actor_subjects WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_withdrawals WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_clock_reservations WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_compensations WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_undo_boundaries WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_blobs WHERE document=${bundle.document}`
							yield* sql`DELETE FROM workspace_documents WHERE document=${bundle.document}`
							yield* sql`DELETE FROM document_transfer_fences WHERE document=${bundle.document}`
						}
						let log = yield* crypto.randomUUIDv4
						yield* sql`INSERT INTO document_transfer_fences VALUES(${bundle.document},${bundle.request},${bundle.destination},${bundle.subject},'imported')`
						for (let row of bundle.workspace_documents)
							yield* sql`INSERT INTO workspace_documents ${sql.insert({ ...row, workspace: bundle.destination })}`
						let positions = new Map<number, number>()
						for (let row of [...bundle.document_actions].sort(
							(a, b) => a.position - b.position,
						)) {
							let { position, ...action } = row
							let inserted = yield* sql<{
								position: number
							}>`INSERT INTO document_actions ${sql.insert(action)} RETURNING position`
							let next = inserted[0]?.position
							if (next === undefined)
								return yield* failure("Move action receipt is missing")
							positions.set(position, next)
						}
						function mapped(position: number) {
							return position === 0
								? Effect.succeed(0)
								: positions.has(position)
									? Effect.succeed(positions.get(position) ?? 0)
									: failure("Move checkpoint position has no action receipt")
						}
						for (let row of bundle.document_heads) {
							let position = yield* mapped(row.position)
							yield* sql`INSERT INTO document_heads ${sql.insert({ ...row, log, position })}`
						}
						for (let row of bundle.document_tips) {
							let position = yield* mapped(row.position)
							yield* sql`INSERT INTO document_tips ${sql.insert({ ...row, log, position })}`
						}
						for (let row of bundle.document_summaries) {
							let position = yield* mapped(row.position)
							yield* sql`INSERT INTO document_summaries ${sql.insert({ ...row, log, position })}`
						}
						for (let row of bundle.document_access)
							yield* sql`INSERT INTO document_access ${sql.insert(row)}`
						for (let row of bundle.invitations)
							yield* sql`INSERT INTO invitations ${sql.insert({ ...row, workspace: bundle.destination })}`
						for (let row of bundle.invitation_members)
							yield* sql`INSERT INTO invitation_members ${sql.insert(row)}`
						for (let row of bundle.document_targets)
							yield* sql`INSERT INTO document_targets ${sql.insert(row)}`
						for (let row of bundle.document_operation_ids)
							yield* sql`INSERT INTO document_operation_ids ${sql.insert(row)}`
						for (let row of bundle.document_actor_subjects)
							yield* sql`INSERT INTO document_actor_subjects ${sql.insert(row)}`
						for (let row of bundle.document_withdrawals)
							yield* sql`INSERT INTO document_withdrawals ${sql.insert(row)}`
						for (let row of bundle.document_clock_reservations)
							yield* sql`INSERT INTO document_clock_reservations ${sql.insert(row)}`
						for (let row of bundle.document_compensations)
							yield* sql`INSERT INTO document_compensations ${sql.insert(row)}`
						for (let row of bundle.document_blobs)
							yield* sql`INSERT INTO document_blobs ${sql.insert(row)}`
						for (let row of bundle.effect_event_journal) {
							let previous = yield* SqlSchema.findOneOption({
								Request: Schema.Uint8Array,
								Result: effect_event_journalRow,
								execute: id =>
									sql`SELECT * FROM effect_event_journal WHERE id=${id}`,
							})(row.id)
							if (Option.isSome(previous)) {
								let entry = previous.value
								if (
									entry.event !== row.event ||
									entry.primary_key !== row.primary_key ||
									entry.timestamp !== row.timestamp ||
									encode(entry.payload) !== encode(row.payload)
								)
									return yield* failure("Move journal entry collision")
							} else
								yield* sql`INSERT INTO effect_event_journal ${sql.insert(row)}`
						}
						for (let row of bundle.effect_event_remotes) {
							let previous = yield* sql<{
								sequence: number
							}>`SELECT sequence FROM effect_event_remotes WHERE remote_id=${row.remote_id} AND entry_id=${row.entry_id}`
							if (previous[0]) {
								if (previous[0].sequence !== row.sequence)
									return yield* failure("Move remote receipt collision")
							} else
								yield* sql`INSERT INTO effect_event_remotes ${sql.insert(row)}`
						}
						for (let row of bundle.document_undo_boundaries) {
							let position = 0
							for (let [old, next] of positions)
								if (old <= row.position) position = Math.max(position, next)
							yield* sql`INSERT INTO document_undo_boundaries VALUES(${row.document},${position})`
						}
						let position = 0
						for (let next of positions.values())
							position = Math.max(position, next)
						yield* sql`INSERT INTO document_move_receipts VALUES(${bundle.document},${bundle.request},${bundle.subject},${bundle.destination},${fingerprint},${log},${position},${bundle.from})`
						return { log, position }
					}),
				)
			})
		}
		function activateDocumentMove(document: string, request: string) {
			return sql.withTransaction(
				Effect.gen(function* () {
					let identity = yield* Identity
					if (identity.access)
						return yield* Effect.fail(
							new PermissionDenied({
								message: "Scoped access cannot move documents",
							}),
						)
					let receipts = yield* sql<{
						subject: string
					}>`SELECT subject FROM document_move_receipts WHERE document=${document} AND request=${request}`
					if (receipts[0]?.subject !== identity.subject)
						return yield* failure(
							"Imported move receipt is missing or belongs to another subject",
						)
					let fence = yield* sql<{
						request: string
						phase: string
					}>`SELECT request,phase FROM document_transfer_fences WHERE document=${document}`
					if (
						fence[0] &&
						(fence[0].request !== request || fence[0].phase !== "imported")
					)
						return yield* failure("Move fence does not match imported receipt")
					yield* sql`DELETE FROM document_transfer_fences WHERE document=${document} AND request=${request}`
				}),
			)
		}
		function retireDocumentMove(document: string, request: string) {
			return sql.withTransaction(
				Effect.gen(function* () {
					let identity = yield* Identity
					if (identity.access)
						return yield* Effect.fail(
							new PermissionDenied({
								message: "Scoped access cannot move documents",
							}),
						)
					let fence = yield* sql<{
						request: string
						subject: string
						phase: string
					}>`SELECT request,subject,phase FROM document_transfer_fences WHERE document=${document}`
					if (
						fence[0]?.request !== request ||
						fence[0].subject !== identity.subject ||
						!["staged", "retired"].includes(fence[0].phase)
					)
						return yield* failure("Source move fence does not match")
					yield* sql`UPDATE document_transfer_fences SET phase='retired' WHERE document=${document}`
					yield* sql`DELETE FROM document_summaries WHERE document=${document}`
					yield* sql`DELETE FROM invitation_members WHERE invitation IN (SELECT invitation FROM invitations WHERE document=${document})`
					yield* sql`DELETE FROM invitations WHERE document=${document}`
				}),
			)
		}
		function abortDocumentMove(document: string, request: string) {
			return sql.withTransaction(
				Effect.gen(function* () {
					let identity = yield* Identity
					if (
						identity.access ||
						(yield* projection.documentRole(document, identity.subject)) !==
							"owner"
					)
						return yield* Effect.fail(
							new PermissionDenied({
								message: "Only the source owner can abort a move",
							}),
						)
					let aborted =
						yield* sql`SELECT request FROM document_move_aborts WHERE document=${document} AND request=${request}`
					if (aborted.length) return
					let fence = yield* sql<{
						request: string
						subject: string
						phase: string
					}>`SELECT request,subject,phase FROM document_transfer_fences WHERE document=${document}`
					if (
						fence[0]?.request !== request ||
						fence[0].subject !== identity.subject ||
						fence[0].phase !== "staged"
					)
						return yield* failure("Only a staged source move can be aborted")
					yield* sql`INSERT INTO document_move_aborts VALUES(${document},${request}) ON CONFLICT DO NOTHING`
					yield* sql`DELETE FROM document_transfer_fences WHERE document=${document} AND request=${request}`
				}),
			)
		}
		return {
			authorizeDocumentDestination,
			stageDocumentMove,
			importDocumentMove,
			activateDocumentMove,
			retireDocumentMove,
			abortDocumentMove,
			freezeWorkspace,
			exportWorkspace,
			exportWorkspacePayload,
			importWorkspace,
			activateImportedWorkspace,
		}
	})
}
function failure(message: string, retryable = false) {
	let reason = retryable
		? new SqlError.ConnectionError({
				cause: new Error(message),
				message,
				operation: "workspace-transfer",
			})
		: new SqlError.UnknownError({
				cause: new Error(message),
				message,
				operation: "workspace-transfer",
			})
	return Effect.fail(new SqlError.SqlError({ reason }))
}
