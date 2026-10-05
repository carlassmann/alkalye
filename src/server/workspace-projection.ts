import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrator from "effect/sql/Migrator"
import * as SqlSchema from "effect/sql/SqlSchema"
import {
	documentMetadata,
	DocumentMetadataSchema,
} from "../shared/document-metadata"
import { IdentifierSchema } from "../shared/model"
import { frontmatter } from "../shared/markdown"
import { wikiTargets } from "../shared/portable-links"
import type { Replica } from "../shared/crdt"
import type { CommittedAction } from "../shared/document-actions"
import { DocumentConflict } from "../shared/document-actions"
import {
	accountPreferences,
	preferencesFromFields,
	preferenceChanges,
} from "../shared/preferences"

import {
	WorkspaceFactSchema,
	MembershipSchema,
	LibraryWorkspaceSchema,
	WorkspaceAvatarSchema,
	AccessRoleSchema,
} from "../shared/workspace"
import { publicMember } from "../shared/workspace"
import type {
	AccessRole,
	AccessAuthority,
	WorkspaceFact,
} from "../shared/workspace"
let WorkspaceSchema = Schema.Struct({
	name: Schema.String,
	owner: IdentifierSchema,
	position: Schema.Natural,
})
let WorkspaceRecordSchema = Schema.Struct({
	...WorkspaceSchema.fields,
	deleted: Schema.Natural,
})
let DocumentSchema = Schema.Struct({
	workspace: IdentifierSchema,
	owner: IdentifierSchema,
})
let SummaryRowSchema = Schema.Struct({
	document: Schema.String,
	workspace: Schema.String,
	owner: Schema.String,
	log: Schema.String,
	position: Schema.Natural,
	deleted: Schema.Natural,
	metadata: Schema.fromJsonString(DocumentMetadataSchema),
})
let ReceiptSchema = Schema.Struct({
	position: Schema.Natural,
	fingerprint: Schema.String,
})
let InvitationSchema = Schema.Struct({
	invitation: IdentifierSchema,
	workspace: IdentifierSchema,
	document: Schema.NullOr(IdentifierSchema),
	role: Schema.Literals(["writer", "reader"]),
	digest: Schema.String,
	creator: IdentifierSchema,
	revoked: Schema.Natural,
})
let FactRowSchema = Schema.Struct({
	position: Schema.Natural,
	payload: Schema.NullOr(Schema.Uint8Array),
})
let binary = SchemaBinary.toCodec(WorkspaceFactSchema)

export function makeWorkspaceProjection(sql: SqlClient.SqlClient) {
	let workspace = SqlSchema.findOneOption({
		Request: Schema.String,
		Result: WorkspaceSchema,
		execute: id =>
			sql`SELECT name,owner,position FROM workspaces WHERE workspace=${id} AND deleted=0`,
	})
	// Includes tombstones, so deleted identities are never reused or rewritten.
	let workspaceRecord = SqlSchema.findOneOption({
		Request: Schema.String,
		Result: WorkspaceRecordSchema,
		execute: id =>
			sql`SELECT name,owner,position,deleted FROM workspaces WHERE workspace=${id}`,
	})
	let workspaceAvatar = SqlSchema.findOneOption({
		Request: Schema.String,
		Result: Schema.Struct({ image: WorkspaceAvatarSchema }),
		execute: id =>
			sql`SELECT image FROM workspace_avatars WHERE workspace=${id}`,
	})
	let document = SqlSchema.findOneOption({
		Request: Schema.String,
		Result: DocumentSchema,
		execute: id =>
			sql`SELECT workspace,owner FROM workspace_documents WHERE document=${id}`,
	})
	let workspaceGrant = SqlSchema.findOneOption({
		Request: Schema.Struct({ workspace: Schema.String, member: Schema.String }),
		Result: MembershipSchema,
		execute: ({ workspace, member }) =>
			sql`SELECT member,role FROM workspace_grants WHERE workspace=${workspace} AND member=${member}`,
	})
	let documentGrant = SqlSchema.findOneOption({
		Request: Schema.Struct({ document: Schema.String, member: Schema.String }),
		Result: MembershipSchema,
		execute: ({ document, member }) =>
			sql`SELECT member,role FROM document_grants WHERE document=${document} AND member=${member}`,
	})
	let receipt = SqlSchema.findOneOption({
		Request: Schema.Struct({ workspace: Schema.String, id: Schema.String }),
		Result: ReceiptSchema,
		execute: ({ workspace, id }) =>
			sql`SELECT position,fingerprint FROM workspace_actions WHERE workspace=${workspace} AND action=${id}`,
	})
	let invitation = SqlSchema.findOneOption({
		Request: Schema.String,
		Result: InvitationSchema,
		execute: id =>
			sql`SELECT invitation,workspace,document,role,digest,creator,revoked FROM invitations WHERE invitation=${id}`,
	})
	return {
		initialize,
		project,
		invitation: (id: string) =>
			invitation(id).pipe(
				Effect.map(Option.map(row => ({ ...row, revoked: row.revoked === 1 }))),
			),
		invitations,
		memberships: (member: string, workspace: string, document: string | null) =>
			SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({ invitation: IdentifierSchema }),
				execute: () =>
					sql`SELECT m.invitation FROM invitation_members m JOIN invitations i ON i.invitation=m.invitation WHERE m.member=${member} AND i.workspace=${workspace} AND i.document IS ${document} ORDER BY m.invitation`,
			})(undefined),
		workspace,
		workspaceRecord: (id: string) =>
			workspaceRecord(id).pipe(
				Effect.map(Option.map(row => ({ ...row, deleted: row.deleted === 1 }))),
			),
		document,
		receipt,
		workspaceRole,
		documentRole,
		summary,
		snapshot,
		history,
		projectDocument,
		uninitializedSummaries: SqlSchema.findAll({
			Request: Schema.Void,
			Result: Schema.Struct({ document: IdentifierSchema }),
			execute: () =>
				sql`SELECT document FROM document_summaries WHERE details_ready=0 ORDER BY document`,
		}),
		rebuildSummary,
		sharedDocuments,
		library,
		preferences,
	}

	function initialize() {
		let initial = Effect.gen(function* () {
			yield* sql`CREATE TABLE IF NOT EXISTS workspaces (workspace TEXT PRIMARY KEY,name TEXT NOT NULL,owner TEXT NOT NULL,position INTEGER NOT NULL)`
			yield* sql`CREATE TABLE IF NOT EXISTS workspace_members (workspace TEXT NOT NULL,member TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('writer','reader')),PRIMARY KEY(workspace,member),FOREIGN KEY(workspace) REFERENCES workspaces(workspace))`
			yield* sql`CREATE TABLE IF NOT EXISTS workspace_documents (document TEXT PRIMARY KEY,workspace TEXT NOT NULL,owner TEXT NOT NULL,FOREIGN KEY(workspace) REFERENCES workspaces(workspace))`
			yield* sql`CREATE INDEX IF NOT EXISTS workspace_document_list ON workspace_documents(workspace,document)`
			yield* sql`CREATE INDEX IF NOT EXISTS workspace_document_owner ON workspace_documents(owner,document)`
			yield* sql`CREATE TABLE IF NOT EXISTS document_access (document TEXT NOT NULL,member TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('writer','reader')),PRIMARY KEY(document,member),FOREIGN KEY(document) REFERENCES workspace_documents(document))`
			yield* sql`CREATE INDEX IF NOT EXISTS document_access_member ON document_access(member,document)`
			yield* sql`CREATE TABLE IF NOT EXISTS document_summaries (document TEXT PRIMARY KEY,log TEXT NOT NULL,position INTEGER NOT NULL,deleted INTEGER NOT NULL,metadata TEXT NOT NULL,FOREIGN KEY(document) REFERENCES workspace_documents(document))`
			yield* sql`CREATE TABLE IF NOT EXISTS workspace_actions (position INTEGER PRIMARY KEY AUTOINCREMENT,workspace TEXT NOT NULL,action TEXT NOT NULL,entry BLOB NOT NULL,fingerprint TEXT NOT NULL,UNIQUE(workspace,action))`
		})
		return Migrator.make({})({
			table: "document_projection_migrations",
			loader: Migrator.fromRecord({
				"001_workspace_projection": initial,
				"002_workspace_document_ownership": sql`UPDATE workspace_documents SET owner=(SELECT owner FROM workspaces WHERE workspaces.workspace=workspace_documents.workspace)`,
				"003_library_summaries": Effect.gen(function* () {
					yield* sql`ALTER TABLE document_summaries ADD COLUMN kind TEXT NOT NULL DEFAULT 'document'`
					yield* sql`ALTER TABLE document_summaries ADD COLUMN excerpt TEXT NOT NULL DEFAULT ''`
					yield* sql`ALTER TABLE document_summaries ADD COLUMN updated INTEGER NOT NULL DEFAULT 0`
					yield* sql`ALTER TABLE document_summaries ADD COLUMN created INTEGER NOT NULL DEFAULT 0`
				}),
				"004_library_summary_repair": sql`ALTER TABLE document_summaries ADD COLUMN details_ready INTEGER NOT NULL DEFAULT 0`,
				"005_account_preferences": sql`CREATE TABLE IF NOT EXISTS workspace_preferences(workspace TEXT NOT NULL,field TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(workspace,field),FOREIGN KEY(workspace) REFERENCES workspaces(workspace))`,
				// Grants through invitation links stay separate from direct grants so
				// revoking a link removes exactly the access it conferred.
				"006_invitations": Effect.gen(function* () {
					yield* sql`CREATE TABLE IF NOT EXISTS invitations (invitation TEXT PRIMARY KEY,workspace TEXT NOT NULL,document TEXT,role TEXT NOT NULL CHECK(role IN ('writer','reader')),digest TEXT NOT NULL,creator TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL,FOREIGN KEY(workspace) REFERENCES workspaces(workspace))`
					yield* sql`CREATE INDEX IF NOT EXISTS invitation_targets ON invitations(workspace,document)`
					yield* sql`CREATE TABLE IF NOT EXISTS invitation_members (invitation TEXT NOT NULL,member TEXT NOT NULL,PRIMARY KEY(invitation,member),FOREIGN KEY(invitation) REFERENCES invitations(invitation))`
					yield* sql`CREATE INDEX IF NOT EXISTS invitation_member_lookup ON invitation_members(member,invitation)`
					yield* sql`CREATE VIEW IF NOT EXISTS workspace_grants AS SELECT workspace,member,CASE WHEN max(role='writer') THEN 'writer' ELSE 'reader' END AS role FROM (SELECT workspace,member,role FROM workspace_members UNION ALL SELECT i.workspace,m.member,i.role FROM invitation_members m JOIN invitations i ON i.invitation=m.invitation WHERE i.document IS NULL AND i.revoked=0) GROUP BY workspace,member`
					yield* sql`CREATE VIEW IF NOT EXISTS document_grants AS SELECT document,member,CASE WHEN max(role='writer') THEN 'writer' ELSE 'reader' END AS role FROM (SELECT document,member,role FROM document_access UNION ALL SELECT i.document,m.member,i.role FROM invitation_members m JOIN invitations i ON i.invitation=m.invitation WHERE i.document IS NOT NULL AND i.revoked=0) GROUP BY document,member`
				}),
				// Summaries gain wiki link targets; existing rows rebuild at startup.
				"007_document_links": Effect.gen(function* () {
					let columns = yield* sql<{
						name: string
					}>`SELECT name FROM pragma_table_info('document_summaries') WHERE name='links'`
					if (!columns.length)
						yield* sql`ALTER TABLE document_summaries ADD COLUMN links TEXT NOT NULL DEFAULT '[]'`
					yield* sql`UPDATE document_summaries SET details_ready=0`
				}),
				"008_workspace_tombstones": Effect.gen(function* () {
					let columns = yield* sql<{
						name: string
					}>`SELECT name FROM pragma_table_info('workspaces') WHERE name='deleted'`
					if (!columns.length)
						yield* sql`ALTER TABLE workspaces ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`
				}),
				"009_workspace_avatars": sql`CREATE TABLE IF NOT EXISTS workspace_avatars(workspace TEXT PRIMARY KEY,image TEXT NOT NULL,FOREIGN KEY(workspace) REFERENCES workspaces(workspace))`,
			}),
		}).pipe(Effect.provideService(SqlClient.SqlClient, sql))
	}

	function project(
		fact: WorkspaceFact,
		entry: Uint8Array,
		fingerprint: string,
	) {
		return Effect.gen(function* () {
			yield* sql`INSERT INTO workspace_actions(workspace,action,entry,fingerprint) VALUES (${fact.workspace},${fact.id},${entry},${fingerprint})`
			let stored = yield* receipt(fact)
			if (Option.isNone(stored))
				return yield* conflict("Missing workspace receipt")
			let existing = yield* workspaceRecord(fact.workspace)
			if (Option.isSome(existing) && existing.value.deleted === 1)
				return yield* conflict("Workspace was deleted")
			let change = fact.change
			switch (change.kind) {
				case "preferences":
					for (let [field, value] of Object.entries(
						preferenceChanges(change.patch),
					))
						yield* sql`INSERT INTO workspace_preferences VALUES (${fact.workspace},${field},${value}) ON CONFLICT(workspace,field) DO UPDATE SET value=excluded.value`
					break
				case "renamed":
					yield* sql`UPDATE workspaces SET name=${change.name} WHERE workspace=${fact.workspace}`
					break
				case "avatar":
					if (change.image === null)
						yield* sql`DELETE FROM workspace_avatars WHERE workspace=${fact.workspace}`
					else
						yield* sql`INSERT INTO workspace_avatars VALUES (${fact.workspace},${change.image}) ON CONFLICT(workspace) DO UPDATE SET image=excluded.image`
					break
				case "created":
					yield* sql`INSERT INTO workspaces(workspace,name,owner,position) VALUES (${fact.workspace},${change.name},${fact.subject},${stored.value.position})`
					break
				case "membership":
					if (change.role === null)
						yield* sql`DELETE FROM workspace_members WHERE workspace=${fact.workspace} AND member=${change.member}`
					else
						yield* sql`INSERT INTO workspace_members VALUES (${fact.workspace},${change.member},${change.role}) ON CONFLICT(workspace,member) DO UPDATE SET role=excluded.role`
					break
				case "invitationCreated":
					yield* sql`INSERT INTO invitations VALUES (${change.invitation},${fact.workspace},${change.document},${change.role},${change.digest},${fact.subject},0,${stored.value.position})`
					break
				case "invitationAccepted":
					yield* sql`INSERT INTO invitation_members VALUES (${change.invitation},${change.member}) ON CONFLICT DO NOTHING`
					break
				case "invitationRevoked":
					yield* sql`UPDATE invitations SET revoked=1 WHERE invitation=${change.invitation}`
					break
				case "documentMoved": {
					let target = yield* workspace(fact.workspace)
					if (Option.isNone(target))
						return yield* conflict("Workspace is unavailable")
					yield* sql`UPDATE workspace_documents SET workspace=${fact.workspace},owner=${target.value.owner} WHERE document=${change.document} AND workspace=${change.from}`
					yield* sql`UPDATE invitations SET workspace=${fact.workspace} WHERE document=${change.document}`
					break
				}
				case "deleted":
					yield* sql`UPDATE workspaces SET deleted=1 WHERE workspace=${fact.workspace}`
					break
				case "invitationLeft":
					yield* sql`DELETE FROM invitation_members WHERE invitation=${change.invitation} AND member=${change.member}`
					break
				case "documentAdded": {
					let parent = yield* workspace(fact.workspace)
					if (Option.isNone(parent))
						return yield* conflict("Workspace is unavailable")
					yield* sql`INSERT INTO workspace_documents VALUES (${change.document},${fact.workspace},${parent.value.owner})`
					break
				}
			}
			yield* sql`UPDATE workspaces SET position=${stored.value.position} WHERE workspace=${fact.workspace}`
			return stored.value.position
		})
	}
	function invitations(workspace: string, document: string | null) {
		return Effect.gen(function* () {
			let rows = yield* SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({
					invitation: IdentifierSchema,
					role: Schema.Literals(["writer", "reader"]),
					revoked: Schema.Natural,
					member: Schema.NullOr(IdentifierSchema),
					name: Schema.NullOr(Schema.String),
				}),
				execute: () =>
					sql`SELECT i.invitation,i.role,i.revoked,m.member,p.value AS name FROM invitations i LEFT JOIN invitation_members m ON m.invitation=i.invitation LEFT JOIN workspace_preferences p ON p.workspace='personal-'||m.member AND p.field='preference:name' WHERE i.workspace=${workspace} AND i.document IS ${document} AND i.revoked=0 ORDER BY i.position,m.member`,
			})(undefined)
			let summaries = new Map<
				string,
				{
					invitation: string
					role: "writer" | "reader"
					revoked: boolean
					members: { member: string; name: string }[]
				}
			>()
			for (let row of rows) {
				let summary = summaries.get(row.invitation) ?? {
					invitation: row.invitation,
					role: row.role,
					revoked: row.revoked === 1,
					members: [],
				}
				summaries.set(row.invitation, summary)
				if (row.member)
					summary.members.push({
						member: row.member,
						name: displayName(row.name),
					})
			}
			return [...summaries.values()]
		})
	}
	function preferences(subject: string) {
		return SqlSchema.findAll({
			Request: Schema.String,
			Result: Schema.Struct({ field: Schema.String, value: Schema.String }),
			execute: workspace =>
				sql`SELECT field,value FROM workspace_preferences WHERE workspace=${workspace}`,
		})("personal-" + subject).pipe(
			Effect.map(rows =>
				preferencesFromFields(
					Object.fromEntries(rows.map(row => [row.field, row.value])),
					accountPreferences(undefined),
				),
			),
		)
	}
	function workspaceRole(
		id: string,
		subject: string,
		access?: AccessAuthority,
	) {
		return Effect.gen(function* () {
			if (!allowsWorkspace(id, access)) return undefined
			let record = yield* workspace(id)
			if (Option.isNone(record)) return undefined
			if (record.value.owner === subject) return attenuateRole("owner", access)
			return attenuateRole(
				Option.getOrUndefined(
					yield* workspaceGrant({ workspace: id, member: subject }),
				)?.role,
				access,
			)
		})
	}
	function documentRole(id: string, subject: string, access?: AccessAuthority) {
		return Effect.gen(function* () {
			let record = yield* document(id)
			if (Option.isNone(record)) return undefined
			if (!allowsWorkspace(record.value.workspace, access)) return undefined
			if (Option.isNone(yield* workspace(record.value.workspace)))
				return undefined
			if (record.value.owner === subject) return attenuateRole("owner", access)
			let inherited = yield* workspaceRole(record.value.workspace, subject)
			if (inherited === "owner" || inherited === "writer")
				return attenuateRole(inherited, access)
			let granted = Option.getOrUndefined(
				yield* documentGrant({ document: id, member: subject }),
			)?.role
			if (granted || inherited)
				return attenuateRole(granted ?? inherited, access)
			let published = Option.getOrUndefined(
				yield* documentGrant({ document: id, member: publicMember }),
			)?.role
			return attenuateRole(published && "reader", access)
		})
	}
	function projectDocument(
		replica: Replica,
		fact: CommittedAction,
		log: string,
		position: number,
	) {
		return Effect.gen(function* () {
			let previous = yield* summary(fact.document)
			let sourceChanged = fact.changes.some(
				change =>
					change.target === fact.document &&
					(change.kind === "text" || change.kind === "cancel"),
			)
			let metadata =
				sourceChanged || Option.isNone(previous)
					? documentMetadata(replica.text(fact.document))
					: previous.value.metadata
			let deleted = replica.fields(fact.document).type === "deleted" ? 1 : 0
			let sourceDetailsChanged =
				sourceChanged ||
				Option.isNone(previous) ||
				fact.changes.some(
					change =>
						change.target === fact.document && change.field === "whiteboard",
				)
			let { kind, excerpt, links } = sourceDetailsChanged
				? sourceDetails(replica, fact.document)
				: { kind: "document", excerpt: "", links: [] }
			let times = fact.changes
				.filter(change => change.target === fact.document)
				.map(change => change.time)
			let updated = Math.max(0, ...times)
			let created = times.length ? Math.min(...times) : 0
			yield* sql`INSERT INTO document_summaries(document,log,position,deleted,metadata,kind,excerpt,links,updated,created,details_ready) VALUES (${fact.document},${log},${position},${deleted},${JSON.stringify(metadata)},${kind},${excerpt},${JSON.stringify(links)},${updated},${created},1) ON CONFLICT(document) DO UPDATE SET log=excluded.log,position=excluded.position,deleted=excluded.deleted,metadata=excluded.metadata,kind=CASE WHEN ${sourceDetailsChanged} THEN excluded.kind ELSE document_summaries.kind END,excerpt=CASE WHEN ${sourceDetailsChanged} THEN excluded.excerpt ELSE document_summaries.excerpt END,links=CASE WHEN ${sourceDetailsChanged} THEN excluded.links ELSE document_summaries.links END,updated=max(document_summaries.updated,excluded.updated),created=CASE WHEN document_summaries.created=0 THEN excluded.created WHEN excluded.created=0 THEN document_summaries.created ELSE min(document_summaries.created,excluded.created) END WHERE excluded.position>document_summaries.position OR excluded.log<>document_summaries.log`
			for (let field of new Set(
				fact.changes
					.filter(
						change =>
							change.target === fact.document &&
							change.field.startsWith("access:"),
					)
					.map(change => change.field),
			)) {
				let member = field.slice("access:".length)
				let role = replica.register(fact.document, field)?.value
				if (role === "writer" || role === "reader")
					yield* sql`INSERT INTO document_access VALUES (${fact.document},${member},${role}) ON CONFLICT(document,member) DO UPDATE SET role=excluded.role`
				else
					yield* sql`DELETE FROM document_access WHERE document=${fact.document} AND member=${member}`
			}
		})
	}
	function rebuildSummary(
		replica: Replica,
		document: string,
		log: string,
		position: number,
	) {
		return Effect.gen(function* () {
			let checkpoint = replica
				.checkpoint()
				.targets.find(target => target.id === document)
			if (!checkpoint) return yield* conflict("Document summary has no root")
			let { kind, excerpt, links } = sourceDetails(replica, document)
			let metadata = documentMetadata(replica.text(document))
			let deleted = replica.fields(document).type === "deleted" ? 1 : 0
			yield* sql`UPDATE document_summaries SET log=${log},position=${position},deleted=${deleted},metadata=${JSON.stringify(metadata)},kind=${kind},excerpt=${excerpt},links=${JSON.stringify(links)},created=${checkpoint.created},updated=${checkpoint.updated},details_ready=1 WHERE document=${document} AND details_ready=0`
		})
	}
	function sourceDetails(replica: Replica, document: string) {
		let header = frontmatter(replica.text(document))
		let mode = header.values.mode ?? ""
		return {
			kind:
				replica.fields(document).whiteboard ||
				replica
					.records("whiteboard")
					.some(board => board.fields.document === document)
					? "whiteboard"
					: mode.startsWith("present") || mode === "slideshow"
						? "slides"
						: "document",
			excerpt: header.body
				.replace(/[#*`>\n]/g, " ")
				.trim()
				.slice(0, 72),
			links: wikiTargets(header.body),
		}
	}
	function summary(id: string) {
		return SqlSchema.findOneOption({
			Request: Schema.String,
			Result: SummaryRowSchema,
			execute: id =>
				sql`SELECT d.document,d.workspace,d.owner,s.log,s.position,s.deleted,s.metadata FROM workspace_documents d JOIN workspaces w ON w.workspace=d.workspace AND w.deleted=0 JOIN document_summaries s ON s.document=d.document WHERE d.document=${id}`,
		})(id).pipe(
			Effect.map(result =>
				Option.map(result, row => ({ ...row, deleted: row.deleted === 1 })),
			),
		)
	}
	function snapshot(id: string) {
		return Effect.gen(function* () {
			let record = yield* workspace(id)
			if (Option.isNone(record)) return undefined
			let members = yield* SqlSchema.findAll({
				Request: Schema.String,
				Result: MembershipSchema,
				execute: id =>
					sql`SELECT member,role FROM workspace_members WHERE workspace=${id} ORDER BY member`,
			})(id)
			let documents = yield* SqlSchema.findAll({
				Request: Schema.String,
				Result: SummaryRowSchema,
				execute: id =>
					sql`SELECT d.document,d.workspace,d.owner,s.log,s.position,s.deleted,s.metadata FROM workspace_documents d JOIN document_summaries s ON s.document=d.document WHERE d.workspace=${id} ORDER BY d.document`,
			})(id)
			let avatar = yield* workspaceAvatar(id)

			return {
				workspace: id,
				...record.value,
				...(Option.isSome(avatar) ? { avatar: avatar.value.image } : {}),
				members,
				documents: documents.map(row => ({
					...row,
					deleted: row.deleted === 1,
				})),
			}
		})
	}
	function sharedDocuments(subject: string) {
		return SqlSchema.findAll({
			Request: Schema.String,
			Result: SummaryRowSchema,
			execute: subject =>
				sql`SELECT d.document,d.workspace,d.owner,s.log,s.position,s.deleted,s.metadata FROM workspace_documents d JOIN workspaces w ON w.workspace=d.workspace AND w.deleted=0 JOIN document_summaries s ON s.document=d.document WHERE (d.owner=${subject} OR EXISTS (SELECT 1 FROM document_grants a WHERE a.document=d.document AND a.member=${subject})) ORDER BY d.document`,
		})(subject).pipe(
			Effect.map(rows =>
				rows.map(row => ({ ...row, deleted: row.deleted === 1 })),
			),
		)
	}
	function library(subject: string) {
		return Effect.gen(function* () {
			let workspaces = yield* SqlSchema.findAll({
				Request: Schema.String,
				Result: Schema.Struct({
					...LibraryWorkspaceSchema.fields,
					avatar: Schema.NullOr(WorkspaceAvatarSchema),
				}),
				execute: subject =>
					sql`SELECT w.workspace,w.name,w.owner,w.position,CASE WHEN w.owner=${subject} THEN 'owner' ELSE m.role END AS role,v.image AS avatar FROM workspaces w LEFT JOIN workspace_grants m ON m.workspace=w.workspace AND m.member=${subject} LEFT JOIN workspace_avatars v ON v.workspace=w.workspace WHERE w.deleted=0 AND (w.owner=${subject} OR m.role IS NOT NULL) ORDER BY w.workspace`,
			})(subject).pipe(
				Effect.map(rows =>
					rows.map(({ avatar, ...row }) => (avatar ? { ...row, avatar } : row)),
				),
			)
			let documents = yield* SqlSchema.findAll({
				Request: Schema.String,
				Result: Schema.Struct({
					...SummaryRowSchema.fields,
					role: AccessRoleSchema,
					kind: Schema.Literals(["document", "slides", "whiteboard"]),
					excerpt: Schema.String,
					links: Schema.fromJsonString(Schema.Array(Schema.String)),
					updated: Schema.Natural,
					created: Schema.Natural,
				}),
				execute: subject =>
					sql`SELECT d.document,d.workspace,d.owner,s.log,s.position,s.deleted,s.metadata,s.kind,s.excerpt,s.links,s.updated,s.created,CASE WHEN d.owner=${subject} OR w.owner=${subject} THEN 'owner' WHEN m.role='writer' OR a.role='writer' THEN 'writer' WHEN m.role='reader' OR a.role='reader' THEN 'reader' END AS role FROM workspace_documents d JOIN workspaces w ON w.workspace=d.workspace JOIN document_summaries s ON s.document=d.document LEFT JOIN workspace_grants m ON m.workspace=d.workspace AND m.member=${subject} LEFT JOIN document_grants a ON a.document=d.document AND a.member=${subject} WHERE w.deleted=0 AND (d.owner=${subject} OR w.owner=${subject} OR m.role IS NOT NULL OR a.role IS NOT NULL) ORDER BY d.workspace,d.document`,
			})(subject)
			return {
				workspaces,
				documents: documents.map(row => ({
					...row,
					deleted: row.deleted === 1,
				})),
			}
		})
	}
	function history(id: string, after = 0) {
		return SqlSchema.findAll({
			Request: Schema.Struct({
				workspace: Schema.String,
				after: Schema.Natural,
			}),
			Result: FactRowSchema,
			execute: ({ workspace, after }) =>
				sql`SELECT a.position,j.payload FROM workspace_actions a LEFT JOIN effect_event_journal j ON j.id=a.entry WHERE a.workspace=${workspace} AND a.position>${after} ORDER BY a.position`,
		})({ workspace: id, after }).pipe(
			Effect.flatMap(rows =>
				Effect.forEach(rows, row =>
					Effect.gen(function* () {
						if (!row.payload)
							return yield* conflict("Workspace history is outside retention")
						let fact = yield* Schema.decodeUnknownEffect(binary)(row.payload)
						if (fact.workspace !== id)
							return yield* conflict("Workspace history identity mismatch")
						return { position: row.position, fact }
					}),
				),
			),
		)
	}
}
export function allowsWorkspace(workspace: string, access?: AccessAuthority) {
	return (
		!access ||
		access.workspaces === "all" ||
		access.workspaces.includes(workspace)
	)
}
export function attenuateRole(
	role: AccessRole | undefined,
	access?: AccessAuthority,
): AccessRole | undefined {
	if (!role || !access) return role
	if (role === "reader" || access.ceiling === "reader") return "reader"
	if (role === "writer" || access.ceiling === "writer") return "writer"
	return "owner"
}
function displayName(value: string | null) {
	if (!value) return "Anonymous writer"
	try {
		let parsed: unknown = JSON.parse(value)
		return typeof parsed === "string" && parsed ? parsed : "Anonymous writer"
	} catch {
		return "Anonymous writer"
	}
}
function conflict(message: string) {
	return Effect.fail(new DocumentConflict({ message }))
}
