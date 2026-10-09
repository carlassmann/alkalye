import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlError from "effect/sql/SqlError"
import { Identity } from "../shared/workspace"
import { BlobQuotaExceeded } from "../shared/document-errors"
import {
	PermissionDenied,
	ResourceUnavailable,
} from "../shared/document-actions"
import { workspaceRpc } from "./workspace-rpc"
import { makeWorkspaceMoves } from "./workspace-moves"
import * as SqlSchema from "effect/sql/SqlSchema"
import { CloudflareBlobBudget } from "./blob-budget"
import { makeWorkspaceUploads } from "./workspace-uploads"
import type { WorkspaceRequest } from "./workspace-rpc"
import { WorkspaceStore } from "../server/document-store"
import { WorkspaceDirectory } from "./workspace-directory"
import { WorkspaceNotices } from "./workspace-notices"
import { makeFederatedWorkspaceStore } from "./workspace-store"
import type { DeploymentEnvironment } from "./settings"
import { makeWorkspaceMigrations } from "./workspace-migrations"

export function federatedWorkspaceLayer(environment: DeploymentEnvironment) {
	return Layer.effect(
		WorkspaceStore,
		Effect.gen(function* () {
			let local = yield* WorkspaceStore
			let directory = yield* WorkspaceDirectory
			let sql = yield* SqlClient.SqlClient
			let notices = yield* WorkspaceNotices
			let resolveRoute = yield* makeWorkspaceMigrations(environment)
			let budget = yield* CloudflareBlobBudget
			let workspaces = yield* SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({
					workspace: Schema.String,
					owner: Schema.String,
				}),
				execute: () => sql`SELECT workspace,owner FROM workspaces`,
			})(undefined)
			for (let workspace of workspaces)
				yield* directory.registerWorkspace(
					workspace.workspace,
					workspace.owner,
					"legacy",
				)
			let documents = yield* SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({
					document: Schema.String,
					workspace: Schema.String,
				}),
				execute: () =>
					sql`SELECT d.document,d.workspace FROM workspace_documents d WHERE NOT EXISTS (SELECT 1 FROM document_transfer_fences f WHERE f.document=d.document AND f.phase='retired')`,
			})(undefined)
			for (let document of documents) {
				if (yield* directory.document(document.document)) continue
				yield* directory.registerDocument(document.document, document.workspace)
			}
			let invitations = yield* SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({
					invitation: Schema.String,
					workspace: Schema.String,
				}),
				execute: () =>
					sql`SELECT i.invitation,i.workspace FROM invitations i WHERE NOT EXISTS (SELECT 1 FROM document_transfer_fences f WHERE f.document=i.document AND f.phase='retired')`,
			})(undefined)
			for (let invitation of invitations) {
				if (yield* directory.invitation(invitation.invitation)) continue
				yield* directory.registerInvitation(
					invitation.invitation,
					invitation.workspace,
				)
			}
			let members = yield* SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({
					workspace: Schema.String,
					subject: Schema.String,
				}),
				execute: () =>
					sql`SELECT workspace,member AS subject FROM workspace_grants WHERE member<>'public' UNION SELECT d.workspace,g.member AS subject FROM document_grants g JOIN workspace_documents d ON d.document=g.document WHERE g.member<>'public'`,
			})(undefined)
			for (let member of members)
				yield* directory.rememberMember(member.workspace, member.subject)

			let legacyUsage = yield* SqlSchema.findAll({
				Request: Schema.Void,
				Result: Schema.Struct({
					document: Schema.String,
					digest: Schema.String,
					owner: Schema.String,
					size: Schema.Natural,
				}),
				execute: () =>
					sql`SELECT b.document,b.digest,w.owner,CASE WHEN b.external=1 THEN b.size ELSE length(b.bytes) END AS size FROM document_blobs b JOIN workspace_documents d ON d.document=b.document JOIN workspaces w ON w.workspace=d.workspace JOIN directory_workspaces r ON r.workspace=w.workspace WHERE r.state!='active' AND NOT EXISTS(SELECT 1 FROM document_transfer_fences f WHERE f.document=b.document AND f.phase='retired')`,
			})(undefined)
			for (let usage of legacyUsage) yield* budget.importUsage(usage)

			let localChanges = yield* local.changes
			let remoteChanges = yield* notices.subscribe
			type Notice =
				typeof localChanges extends PubSub.Subscription<infer Message>
					? Message
					: never
			let changes = yield* PubSub.sliding<Notice>(64)
			yield* Effect.addFinalizer(() => PubSub.shutdown(changes))
			yield* Effect.forkScoped(
				Effect.forever(
					PubSub.take(localChanges).pipe(
						Effect.flatMap(notice => PubSub.publish(changes, notice)),
					),
				),
			)
			yield* Effect.forkScoped(
				Effect.forever(
					PubSub.take(remoteChanges).pipe(
						Effect.flatMap(notice =>
							PubSub.publish(
								changes,
								notice.kind === "workspace"
									? {
											...notice,
											subjects: new Set(notice.subjects),
											documents: new Set(notice.documents),
										}
									: { ...notice, subjects: new Set(notice.subjects) },
							),
						),
					),
				),
			)
			let request: WorkspaceRequest = (workspace, identity, request) =>
				environment.WORKSPACES.get(
					environment.WORKSPACES.idFromName(workspace),
				).handle(workspace, identity, request)
			let moveDocument = yield* makeWorkspaceMoves(
				request,
				resolveRoute,
				(document, source, destination) =>
					Identity.use(identity =>
						Effect.gen(function* () {
							function owner(workspace: string) {
								return workspaceRpc(
									request,
									workspace,
									identity,
									client =>
										client.workspaces.snapshot({ params: { workspace } }),
									Schema.Union([PermissionDenied, ResourceUnavailable]),
								).pipe(Effect.map(snapshot => snapshot.owner))
							}
							let previousOwner = yield* owner(source)
							let nextOwner = yield* owner(destination)
							yield* budget.reassignDocument(document, previousOwner, nextOwner)
							return budget.restoreDocumentOwner(
								document,
								nextOwner,
								previousOwner,
							)
						}).pipe(
							Effect.mapError(cause =>
								cause instanceof BlobQuotaExceeded
									? cause
									: new SqlError.SqlError({
											reason: new SqlError.UnknownError({
												cause,
												message: "Attachment ownership transfer unavailable",
											}),
										}),
							),
						),
					),
			)
			let store = yield* makeFederatedWorkspaceStore({
				local,
				moveDocument,
				directory,
				resolveRoute,
				changes: PubSub.subscribe(changes),
				request,
			})
			let putBlob = yield* makeWorkspaceUploads(
				request,
				store.putBlob,
				resolveRoute,
			)
			return { ...store, putBlob }
		}),
	).pipe(Layer.provide(CloudflareBlobBudget.live))
}
