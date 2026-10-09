import * as Effect from "effect/Effect"
import * as HttpApi from "effect/http-api/HttpApi"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as HttpEffect from "effect/http/HttpEffect"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SchemaBinary from "effect/encoding/SchemaBinary"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlSchema from "effect/sql/SqlSchema"
import { AccountAuthentication } from "../shared/account-api"
import {
	AuthenticationRequired,
	RequestAccount,
} from "../shared/authentication"
import { DocumentApi, StoreUnavailable } from "../shared/document-api"
import { DocumentObservability } from "../shared/document-observability"
import {
	PermissionDenied,
	ResourceUnavailable,
	DocumentConflict,
	AccessConflict,
	DocumentHistoryUnavailable,
} from "../shared/document-actions"
import {
	BlobFailureSchema,
	CausalDependencyMissing,
	UndoUnavailable,
	StaleRevision,
} from "../shared/document-errors"
import {
	InvitationRevoked,
	InvitationDescriptionSchema,
	InvitationSecretSchema,
} from "../shared/invitations"
import { IdentifierSchema } from "../shared/model"
import {
	AccessRoleSchema,
	Identity,
	SidebarDocumentSchema,
	WorkspaceFactSchema,
	WorkspaceDeletionRefused,
} from "../shared/workspace"
import {
	asAccount,
	documentHandlers,
	invitationHandlers,
	workspaceHandlers,
} from "../server/document-api"
import { BlobChunkDescriptorSchema } from "../shared/document-blobs"
import { DocumentMaintenance, WorkspaceStore } from "../server/document-store"
import {
	DocumentMoveSchema,
	WorkspaceTransfers,
} from "../server/workspace-transfer"
import { RequestOrigin } from "../server/request-origin"

let errors = [
	StaleRevision.pipe(HttpApiSchema.status(409)),
	UndoUnavailable.pipe(HttpApiSchema.status(409)),
	CausalDependencyMissing.pipe(HttpApiSchema.status(409)),
	BlobFailureSchema.pipe(HttpApiSchema.status(409)),
	AccessConflict.pipe(HttpApiSchema.status(409)),
	DocumentHistoryUnavailable.pipe(HttpApiSchema.status(409)),
	InvitationRevoked.pipe(HttpApiSchema.status(410)),
	WorkspaceDeletionRefused.pipe(HttpApiSchema.status(409)),
	PermissionDenied.pipe(HttpApiSchema.status(403)),
	ResourceUnavailable.pipe(HttpApiSchema.status(404)),
	DocumentConflict.pipe(HttpApiSchema.status(409)),
	StoreUnavailable.pipe(HttpApiSchema.status(503)),
]

let documentMoveBody = SchemaBinary.toCodec(DocumentMoveSchema).pipe(
	HttpApiSchema.asUint8Array(),
)

export let WorkspaceApi = HttpApi.make("DocumentApi").add(
	DocumentApi.groups.documents,
	DocumentApi.groups.workspaces,
	DocumentApi.groups.invitations,
	HttpApiGroup.make("internal")
		.add(
			HttpApiEndpoint.post(
				"activateDocumentMove",
				"/internal/moves/activateDocumentMove",
				{
					payload: Schema.Struct({
						document: IdentifierSchema,
						request: IdentifierSchema,
					}),
					error: errors,
				},
			),
			HttpApiEndpoint.post(
				"retireDocumentMove",
				"/internal/moves/retireDocumentMove",
				{
					payload: Schema.Struct({
						document: IdentifierSchema,
						request: IdentifierSchema,
					}),
					error: errors,
				},
			),
			HttpApiEndpoint.post(
				"abortDocumentMove",
				"/internal/moves/abortDocumentMove",
				{
					payload: Schema.Struct({
						document: IdentifierSchema,
						request: IdentifierSchema,
					}),
					error: errors,
				},
			),
			HttpApiEndpoint.post(
				"authorizeDocumentDestination",
				"/internal/moves/authorize",
				{
					payload: Schema.Struct({ destination: IdentifierSchema }),
					error: errors,
				},
			),
			HttpApiEndpoint.post("stageDocumentMove", "/internal/moves/stage", {
				payload: Schema.Struct({
					document: IdentifierSchema,
					destination: IdentifierSchema,
					request: IdentifierSchema,
				}),
				success: documentMoveBody,
				error: errors,
			}),
			HttpApiEndpoint.post("importDocumentMove", "/internal/moves/import", {
				payload: documentMoveBody,
				success: Schema.Struct({
					log: IdentifierSchema,
					position: Schema.Natural,
				}),
				error: errors,
			}),
			HttpApiEndpoint.post("recordImportedMove", "/internal/moves/record", {
				payload: Schema.Struct({
					document: IdentifierSchema,
					from: IdentifierSchema,
					destination: IdentifierSchema,
					request: IdentifierSchema,
				}),
				success: Schema.Natural,
				error: errors,
			}),
			HttpApiEndpoint.post(
				"authorizeUpload",
				"/internal/documents/:document/upload-authorization",
				{
					params: { document: IdentifierSchema },
					payload: BlobChunkDescriptorSchema,
					success: Schema.Struct({
						owner: IdentifierSchema,
						missing: Schema.Boolean,
					}),
					error: errors,
				},
			),

			HttpApiEndpoint.post(
				"describeInvitation",
				"/internal/invitations/:invitation/description",
				{
					params: { invitation: IdentifierSchema },
					payload: Schema.Struct({ secret: InvitationSecretSchema }),
					success: Schema.Struct({
						description: InvitationDescriptionSchema,
						ownerSubject: IdentifierSchema,
					}),
					error: errors,
				},
			),
			HttpApiEndpoint.get(
				"workspaceHistory",
				"/internal/workspaces/:workspace/history",
				{
					params: { workspace: IdentifierSchema },
					query: {
						after: Schema.optional(
							Schema.NumberFromString.check(
								Schema.isInt(),
								Schema.isGreaterThanOrEqualTo(0),
							),
						),
					},
					success: Schema.Array(
						Schema.Struct({
							position: Schema.Natural,
							fact: WorkspaceFactSchema,
						}),
					),
					error: errors,
				},
			),
			HttpApiEndpoint.get(
				"accessRole",
				"/internal/documents/:document/access/:subject",
				{
					params: { document: IdentifierSchema, subject: IdentifierSchema },
					success: Schema.NullOr(AccessRoleSchema),
					error: errors,
				},
			),
			HttpApiEndpoint.get("sharedDocuments", "/internal/shared-documents", {
				success: Schema.Array(SidebarDocumentSchema),
				error: errors,
			}),
		)
		.middleware(AccountAuthentication),
)

let delegatedAuthentication = Layer.succeed(AccountAuthentication, httpEffect =>
	Effect.gen(function* () {
		let identity = yield* Effect.serviceOption(Identity)
		if (Option.isNone(identity))
			return yield* Effect.fail(
				new AuthenticationRequired({ message: "Missing delegated identity" }),
			)
		return yield* Effect.provideService(httpEffect, RequestAccount, {
			subject: identity.value.subject,
			session: "workspace-binding",
			expires: Number.MAX_SAFE_INTEGER,
		})
	}),
)

export function makeWorkspaceHandler() {
	return Effect.gen(function* () {
		let store = yield* WorkspaceStore
		let transfers = yield* WorkspaceTransfers
		let maintenance = yield* DocumentMaintenance
		let sql = yield* SqlClient.SqlClient
		let invitationOwner = SqlSchema.findOne({
			Request: IdentifierSchema,
			Result: Schema.Struct({ creator: IdentifierSchema }),
			execute: invitation =>
				sql`SELECT creator FROM invitations WHERE invitation=${invitation}`,
		})
		let internal = HttpApiBuilder.group(WorkspaceApi, "internal", handlers =>
			handlers
				.handle("activateDocumentMove", ({ payload }) =>
					asAccount(
						transfers.activateDocumentMove(payload.document, payload.request),
					),
				)
				.handle("retireDocumentMove", ({ payload }) =>
					asAccount(
						transfers
							.retireDocumentMove(payload.document, payload.request)
							.pipe(
								Effect.andThen(
									maintenance.notifyRetiredMove(
										payload.document,
										payload.request,
									),
								),
							),
					),
				)
				.handle("abortDocumentMove", ({ payload }) =>
					asAccount(
						transfers.abortDocumentMove(payload.document, payload.request),
					),
				)
				.handle("authorizeDocumentDestination", ({ payload }) =>
					asAccount(
						transfers
							.authorizeDocumentDestination(payload.destination)
							.pipe(Effect.asVoid),
					),
				)
				.handle("stageDocumentMove", ({ payload }) =>
					asAccount(
						transfers.stageDocumentMove(
							payload.document,
							payload.destination,
							payload.request,
						),
					),
				)
				.handle("importDocumentMove", ({ payload }) =>
					asAccount(transfers.importDocumentMove(payload)),
				)
				.handle("recordImportedMove", ({ payload }) =>
					asAccount(
						maintenance.recordImportedMove(
							payload.document,
							payload.from,
							payload.destination,
							payload.request,
						),
					),
				)
				.handle("describeInvitation", ({ params, payload }) =>
					asAccount(
						Effect.gen(function* () {
							let description = yield* store.describeInvitation(
								params.invitation,
								payload.secret,
							)
							let owner = yield* invitationOwner(params.invitation)
							return { description, ownerSubject: owner.creator }
						}),
					),
				)
				.handle("workspaceHistory", ({ params, query }) =>
					asAccount(store.workspaceHistory(params.workspace, query.after ?? 0)),
				)
				.handle("authorizeUpload", ({ params, payload }) =>
					asAccount(
						sql.withTransaction(
							Effect.gen(function* () {
								let missing = yield* store.missingBlobs(params.document, [
									payload,
								])
								let rows = yield* sql<{
									owner: string
								}>`SELECT w.owner FROM workspace_documents d JOIN workspaces w ON w.workspace=d.workspace WHERE d.document=${params.document}`
								let owner = rows[0]?.owner
								if (!owner)
									return yield* Effect.fail(
										new ResourceUnavailable({
											message: "Document workspace is unavailable",
										}),
									)
								return { owner, missing: missing.includes(payload.digest) }
							}),
						),
					),
				)

				.handle("accessRole", ({ params }) =>
					asAccount(
						store
							.accessRole(params.document, params.subject)
							.pipe(Effect.map(role => role ?? null)),
					),
				)
				.handle("sharedDocuments", () => asAccount(store.sharedDocuments())),
		)
		let context = yield* Effect.context<
			| RequestOrigin
			| DocumentObservability
			| Layer.Success<typeof HttpServer.layerServices>
		>()
		let routes = HttpApiBuilder.layer(WorkspaceApi).pipe(
			Layer.provide(
				Layer.mergeAll(
					documentHandlers,
					workspaceHandlers,
					invitationHandlers,
					internal,
				),
			),
			Layer.provide(Layer.succeed(WorkspaceStore, store)),
			Layer.provide(delegatedAuthentication),
			Layer.provide(Layer.succeedContext(context)),
		)
		let app = yield* HttpRouter.toHttpEffect(routes)
		return HttpEffect.toWebHandlerWith<
			| RequestOrigin
			| DocumentObservability
			| Layer.Success<typeof HttpServer.layerServices>,
			Effect.Services<typeof app>,
			Identity
		>(context)(app)
	})
}
