import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
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
export let WorkspaceTransferSchema = Schema.Struct({
	workspace: Schema.String,
	generation: Schema.Natural,
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
let transferBinary = SchemaBinary.toCodec(WorkspaceTransferSchema)
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
		yield* sql`CREATE TABLE IF NOT EXISTS workspace_transfer_fences (workspace TEXT PRIMARY KEY, generation INTEGER NOT NULL)`
		yield* sql`CREATE TABLE IF NOT EXISTS workspace_transfer_exports (workspace TEXT NOT NULL,generation INTEGER NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(workspace,generation))`
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
export function ensureDocumentWritable(
	sql: SqlClient.SqlClient,
	document: string,
) {
	return sql<{
		generation: number
	}>`SELECT f.generation FROM workspace_transfer_fences f JOIN workspace_documents d ON d.workspace=f.workspace WHERE d.document=${document}`.pipe(
		Effect.flatMap(rows =>
			rows.length ? failure("Workspace transfer is frozen", true) : Effect.void,
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
		function exportWorkspace(workspace: string, generation: number) {
			return sql.withTransaction(
				Effect.gen(function* () {
					yield* frozen(workspace, generation)
					let previous = yield* sql<{
						payload: Uint8Array
					}>`SELECT payload FROM workspace_transfer_exports WHERE workspace=${workspace} AND generation=${generation}`
					if (previous[0])
						return yield* Schema.decodeUnknownEffect(transferBinary)(
							previous[0].payload,
						)
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
						document_blobs: yield* read_document_blobs(workspace),
						effect_event_journal: yield* read_effect_event_journal(workspace),
						effect_event_remotes: yield* read_effect_event_remotes(workspace),
					}
					let payload = yield* Schema.encodeEffect(transferBinary)(bundle)
					yield* sql`INSERT INTO workspace_transfer_exports VALUES (${workspace},${generation},${payload})`
					return bundle
				}),
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
						if (bundle.workspaces.length)
							yield* sql`INSERT INTO workspaces ${sql.insert(bundle.workspaces)}`
						if (bundle.workspace_members.length)
							yield* sql`INSERT INTO workspace_members ${sql.insert(bundle.workspace_members)}`
						if (bundle.workspace_documents.length)
							yield* sql`INSERT INTO workspace_documents ${sql.insert(bundle.workspace_documents)}`
						if (bundle.workspace_preferences.length)
							yield* sql`INSERT INTO workspace_preferences ${sql.insert(bundle.workspace_preferences)}`
						if (bundle.workspace_avatars.length)
							yield* sql`INSERT INTO workspace_avatars ${sql.insert(bundle.workspace_avatars)}`
						if (bundle.workspace_actions.length)
							yield* sql`INSERT INTO workspace_actions ${sql.insert(bundle.workspace_actions)}`
						if (bundle.document_access.length)
							yield* sql`INSERT INTO document_access ${sql.insert(bundle.document_access)}`
						if (bundle.document_summaries.length)
							yield* sql`INSERT INTO document_summaries ${sql.insert(bundle.document_summaries)}`
						if (bundle.invitations.length)
							yield* sql`INSERT INTO invitations ${sql.insert(bundle.invitations)}`
						if (bundle.invitation_members.length)
							yield* sql`INSERT INTO invitation_members ${sql.insert(bundle.invitation_members)}`
						if (bundle.document_heads.length)
							yield* sql`INSERT INTO document_heads ${sql.insert(bundle.document_heads)}`
						if (bundle.document_tips.length)
							yield* sql`INSERT INTO document_tips ${sql.insert(bundle.document_tips)}`
						if (bundle.document_actions.length)
							yield* sql`INSERT INTO document_actions ${sql.insert(bundle.document_actions)}`
						if (bundle.document_targets.length)
							yield* sql`INSERT INTO document_targets ${sql.insert(bundle.document_targets)}`
						if (bundle.document_operation_ids.length)
							yield* sql`INSERT INTO document_operation_ids ${sql.insert(bundle.document_operation_ids)}`
						if (bundle.document_actor_subjects.length)
							yield* sql`INSERT INTO document_actor_subjects ${sql.insert(bundle.document_actor_subjects)}`
						if (bundle.document_withdrawals.length)
							yield* sql`INSERT INTO document_withdrawals ${sql.insert(bundle.document_withdrawals)}`
						if (bundle.document_clock_reservations.length)
							yield* sql`INSERT INTO document_clock_reservations ${sql.insert(bundle.document_clock_reservations)}`
						if (bundle.document_compensations.length)
							yield* sql`INSERT INTO document_compensations ${sql.insert(bundle.document_compensations)}`
						if (bundle.document_undo_boundaries.length)
							yield* sql`INSERT INTO document_undo_boundaries ${sql.insert(bundle.document_undo_boundaries)}`
						if (bundle.document_blobs.length)
							yield* sql`INSERT INTO document_blobs ${sql.insert(bundle.document_blobs)}`
						if (bundle.effect_event_journal.length)
							yield* sql`INSERT INTO effect_event_journal ${sql.insert(bundle.effect_event_journal)}`
						if (bundle.effect_event_remotes.length)
							yield* sql`INSERT INTO effect_event_remotes ${sql.insert(bundle.effect_event_remotes)}`
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
		return {
			freezeWorkspace,
			exportWorkspace,
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
