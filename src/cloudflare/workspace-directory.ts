import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlError from "effect/sql/SqlError"

export interface WorkspaceRoute {
	workspace: string
	generation: number
	state: "active" | "frozen" | "legacy"
}
export class WorkspaceDirectory extends Context.Service<
	WorkspaceDirectory,
	Effect.Success<ReturnType<typeof makeDirectory>>
>()("alkalye/WorkspaceDirectory") {
	static get live() {
		return Layer.effect(WorkspaceDirectory, makeDirectory())
	}
}
function makeDirectory() {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		yield* sql`CREATE TABLE IF NOT EXISTS directory_workspaces (workspace TEXT PRIMARY KEY, owner TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL CHECK(state IN ('active','frozen','legacy')))`
		yield* sql`CREATE TABLE IF NOT EXISTS directory_documents (document TEXT PRIMARY KEY, workspace TEXT NOT NULL)`
		yield* sql`CREATE TABLE IF NOT EXISTS directory_invitations (invitation TEXT PRIMARY KEY, workspace TEXT NOT NULL)`
		yield* sql`CREATE TABLE IF NOT EXISTS directory_members (workspace TEXT NOT NULL, subject TEXT NOT NULL, PRIMARY KEY(workspace,subject))`
		yield* sql`CREATE INDEX IF NOT EXISTS directory_members_subject ON directory_members(subject)`

		function workspace(id: string) {
			return sql<WorkspaceRoute>`SELECT workspace,generation,state FROM directory_workspaces WHERE workspace=${id}`.pipe(
				Effect.map(rows => rows[0]),
			)
		}
		function document(id: string) {
			return sql<WorkspaceRoute>`SELECT w.workspace,w.generation,w.state FROM directory_workspaces w JOIN directory_documents d ON d.workspace=w.workspace WHERE d.document=${id}`.pipe(
				Effect.map(rows => rows[0]),
			)
		}
		function invitation(id: string) {
			return sql<WorkspaceRoute>`SELECT w.workspace,w.generation,w.state FROM directory_workspaces w JOIN directory_invitations i ON i.workspace=w.workspace WHERE i.invitation=${id}`.pipe(
				Effect.map(rows => rows[0]),
			)
		}
		function rememberMember(workspace: string, subject: string) {
			return sql`INSERT INTO directory_members (workspace,subject) VALUES (${workspace},${subject}) ON CONFLICT DO NOTHING`.pipe(
				Effect.asVoid,
			)
		}
		function registerWorkspace(
			id: string,
			owner: string,
			state: WorkspaceRoute["state"] = "active",
		) {
			return sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`INSERT INTO directory_workspaces (workspace,owner,state) VALUES (${id},${owner},${state}) ON CONFLICT DO NOTHING`
					let rows = yield* sql<{
						owner: string
					}>`SELECT owner FROM directory_workspaces WHERE workspace=${id}`
					if (rows[0]?.owner !== owner)
						return yield* conflict("Workspace owner mapping conflicts")
					yield* rememberMember(id, owner)
				}),
			)
		}
		function registerDocument(id: string, target: string) {
			return sql.withTransaction(
				Effect.gen(function* () {
					yield* requireWorkspace(target)
					yield* sql`INSERT INTO directory_documents (document,workspace) VALUES (${id},${target}) ON CONFLICT DO NOTHING`
					let rows = yield* sql<{
						workspace: string
					}>`SELECT workspace FROM directory_documents WHERE document=${id}`
					if (rows[0]?.workspace !== target)
						return yield* conflict("Document routing mapping conflicts")
				}),
			)
		}
		function registerInvitation(id: string, target: string) {
			return sql.withTransaction(
				Effect.gen(function* () {
					yield* requireWorkspace(target)
					yield* sql`INSERT INTO directory_invitations (invitation,workspace) VALUES (${id},${target}) ON CONFLICT DO NOTHING`
					let rows = yield* sql<{
						workspace: string
					}>`SELECT workspace FROM directory_invitations WHERE invitation=${id}`
					if (rows[0]?.workspace !== target)
						return yield* conflict("Invitation routing mapping conflicts")
				}),
			)
		}
		function requireWorkspace(id: string) {
			return Effect.gen(function* () {
				let route = yield* workspace(id)
				if (!route)
					return yield* conflict("Workspace routing mapping is missing")
				return route
			})
		}
		function transition(
			id: string,
			generation: number,
			state: "active" | "frozen",
		) {
			let previous = state === "frozen" ? "active" : "frozen"
			return sql.withTransaction(
				Effect.gen(function* () {
					let rows =
						yield* sql<WorkspaceRoute>`UPDATE directory_workspaces SET state=${state},generation=generation+1 WHERE workspace=${id} AND generation=${generation} AND (state=${previous} OR (${state}='frozen' AND state='legacy')) RETURNING workspace,generation,state`
					let route = rows[0]
					if (!route)
						return yield* conflict(
							"Workspace routing generation or state changed",
						)
					return route
				}),
			)
		}
		return {
			workspace,
			document,
			invitation,
			registerWorkspace,
			registerDocument,
			registerInvitation,
			rememberMember,
			subjectWorkspaces: (subject: string) =>
				sql<{
					workspace: string
				}>`SELECT workspace FROM directory_members WHERE subject=${subject} ORDER BY workspace`.pipe(
					Effect.map(rows => rows.map(row => row.workspace)),
				),
			freezeWorkspace: (id: string, generation: number) =>
				transition(id, generation, "frozen"),
			activateWorkspace: (id: string, generation: number) =>
				transition(id, generation, "active"),
		}
	})
}
function conflict(message: string) {
	return Effect.fail(
		new SqlError.SqlError({
			reason: SqlError.classifySqliteError(new Error(message), {
				operation: "workspace-directory",
				message,
			}),
		}),
	)
}
