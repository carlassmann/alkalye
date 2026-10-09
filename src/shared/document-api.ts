import {
	emailAuthenticationGroup,
	accountEmailGroup,
} from "./email-authentication"
import * as HttpApi from "effect/http-api/HttpApi"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"
import { AccountAuthentication } from "./account-api"
import { AccountApi } from "./account-api"
import { AgentScopeSchema, AgentConnectionRejected } from "./agent-access"
import { AccessRoleSchema } from "./workspace"
import { AccountPreferencesSchema, PreferencePatchSchema } from "./preferences"
import {
	AccessConflict,
	ActionIdSchema,
	ActionChainSchema,
	CommittedActionSchema,
	DocumentActionSchema,
	DocumentConflict,
	DocumentHistoryUnavailable,
	DocumentSnapshotSchema,
	PermissionDenied,
	ResourceUnavailable,
} from "./document-actions"
import { IdentifierSchema } from "./model"
import {
	InvitationDigestSchema,
	LibrarySnapshotSchema,
	WorkspaceDeletionRefused,
	WorkspaceAvatarSchema,
	WorkspaceSnapshotSchema,
} from "./workspace"
import {
	InvitationAcceptanceSchema,
	InvitationDescriptionSchema,
	InvitationRevoked,
	InvitationRoleSchema,
	InvitationSecretSchema,
	InvitationSummarySchema,
	InvitationTargetSchema,
} from "./invitations"
import {
	BlobChunkSchema,
	BlobDigestSchema,
	BlobChunkDescriptorSchema,
} from "./document-blobs"
import {
	BlobFailureSchema,
	CausalDependencyMissing,
	UndoUnavailable,
	StaleRevision,
} from "./document-errors"

export class StoreUnavailable extends Schema.TaggedError<StoreUnavailable>()(
	"StoreUnavailable",
	{ message: Schema.String },
) {}
let errors = [
	StaleRevision.pipe(HttpApiSchema.status(409)),
	UndoUnavailable.pipe(HttpApiSchema.status(409)),
	CausalDependencyMissing.pipe(HttpApiSchema.status(409)),
	BlobFailureSchema.pipe(HttpApiSchema.status(409)),
	DocumentConflict.pipe(HttpApiSchema.status(409)),
	AccessConflict.pipe(HttpApiSchema.status(409)),
	DocumentHistoryUnavailable.pipe(HttpApiSchema.status(409)),
	PermissionDenied.pipe(HttpApiSchema.status(403)),
	ResourceUnavailable.pipe(HttpApiSchema.status(404)),
	StoreUnavailable.pipe(HttpApiSchema.status(503)),
]
let invitationErrors = [
	...errors,
	InvitationRevoked.pipe(HttpApiSchema.status(410)),
]
let documentParams = { document: IdentifierSchema }
export let DocumentApi = HttpApi.make("DocumentApi").add(
	AccountApi.groups.authentication,
	AccountApi.groups.account,
	emailAuthenticationGroup,
	accountEmailGroup,
	HttpApiGroup.make("preferences")
		.add(
			HttpApiEndpoint.get("get", "/api/accounts/preferences", {
				success: AccountPreferencesSchema,
				error: errors,
			}),
			HttpApiEndpoint.put("save", "/api/accounts/preferences", {
				payload: Schema.Struct({
					request: Schema.NonEmptyString,
					patch: PreferencePatchSchema,
				}),
				success: Schema.Natural,
				error: errors,
			}),
		)
		.middleware(AccountAuthentication),
	HttpApiGroup.make("agents")
		.add(
			HttpApiEndpoint.get("describeConsent", "/api/accounts/agents/consent", {
				query: { request: Schema.NonEmptyString },
				success: Schema.Struct({
					name: Schema.String,
					redirect: Schema.String,
				}),
				error: [
					...errors,
					AgentConnectionRejected.pipe(HttpApiSchema.status(403)),
				],
			}),
			HttpApiEndpoint.post("consent", "/api/accounts/agents/consent", {
				payload: Schema.Struct({
					request: Schema.NonEmptyString,
					approve: Schema.Boolean,
					workspaces: AgentScopeSchema,
					ceiling: AccessRoleSchema,
				}),
				success: Schema.Struct({ redirect: Schema.String }),
				error: [
					...errors,
					AgentConnectionRejected.pipe(HttpApiSchema.status(403)),
				],
			}),
			HttpApiEndpoint.get("list", "/api/accounts/agents", {
				success: Schema.Array(
					Schema.Struct({
						id: Schema.String,
						name: Schema.String,
						created: Schema.Natural,
					}),
				),
				error: [
					...errors,
					AgentConnectionRejected.pipe(HttpApiSchema.status(403)),
				],
			}),
			HttpApiEndpoint.post("create", "/api/accounts/agents", {
				payload: Schema.Struct({
					name: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
					workspaces: AgentScopeSchema,
					ceiling: AccessRoleSchema,
				}),
				success: Schema.Struct({ token: Schema.String }),
				error: [
					...errors,
					AgentConnectionRejected.pipe(HttpApiSchema.status(403)),
				],
			}),
			HttpApiEndpoint.delete("revoke", "/api/accounts/agents/:id", {
				params: { id: Schema.String },
				success: Schema.Void,
				error: [
					...errors,
					AgentConnectionRejected.pipe(HttpApiSchema.status(403)),
				],
			}),
		)
		.middleware(AccountAuthentication),
	HttpApiGroup.make("documents")
		.add(
			HttpApiEndpoint.post(
				"missingBlobs",
				"/api/documents/:document/blobs/missing",
				{
					params: documentParams,
					payload: Schema.Array(BlobChunkDescriptorSchema).check(
						Schema.isMaxLength(4096),
					),
					success: Schema.Array(BlobDigestSchema),
					error: errors,
				},
			),
			HttpApiEndpoint.put("putBlob", "/api/documents/:document/blobs/:digest", {
				params: { ...documentParams, digest: BlobDigestSchema },
				payload: BlobChunkSchema.pipe(HttpApiSchema.asUint8Array()),
				success: Schema.Void,
				error: errors,
			}),
			HttpApiEndpoint.get("getBlob", "/api/documents/:document/blobs/:digest", {
				params: { ...documentParams, digest: BlobDigestSchema },
				success: BlobChunkSchema.pipe(HttpApiSchema.asUint8Array()),
				error: errors,
			}),
			HttpApiEndpoint.post("create", "/api/documents", {
				payload: Schema.Struct({
					workspace: IdentifierSchema,
					action: DocumentActionSchema,
				}),
				success: Schema.Natural,
				error: errors,
			}),
			HttpApiEndpoint.post("commit", "/api/documents/:document/actions", {
				params: documentParams,
				payload: DocumentActionSchema,
				success: Schema.Natural,
				error: errors,
			}),
			HttpApiEndpoint.post(
				"commitBatch",
				"/api/documents/:document/actions/batch",
				{
					params: documentParams,
					payload: Schema.Struct({
						actions: Schema.Array(DocumentActionSchema).check(
							Schema.isMinLength(1),
							Schema.isMaxLength(64),
						),
					}),
					success: Schema.Array(Schema.Natural),
					error: errors,
				},
			),
			HttpApiEndpoint.post("withdraw", "/api/documents/:document/withdrawals", {
				params: documentParams,
				payload: DocumentActionSchema,
				success: Schema.Void,
				error: errors,
			}),
			HttpApiEndpoint.get("snapshot", "/api/documents/:document/snapshot", {
				params: documentParams,
				query: { encoding: Schema.optional(Schema.Literal("compact")) },
				success: DocumentSnapshotSchema,
				error: errors,
			}),
			HttpApiEndpoint.get(
				"action",
				"/api/documents/:document/actions/:action",
				{
					params: {
						...documentParams,
						action: ActionIdSchema,
					},
					success: CommittedActionSchema,
					error: errors,
				},
			),
			HttpApiEndpoint.get(
				"chain",
				"/api/documents/:document/actions/:action/chain",
				{
					params: { ...documentParams, action: ActionIdSchema },
					success: ActionChainSchema,
					error: errors,
				},
			),
			HttpApiEndpoint.put("move", "/api/documents/:document/workspace", {
				params: documentParams,
				payload: Schema.Struct({
					workspace: IdentifierSchema,
					request: IdentifierSchema,
				}),
				success: Schema.Natural,
				error: errors,
			}),
			HttpApiEndpoint.get("history", "/api/documents/:document/history", {
				params: documentParams,
				query: {
					after: Schema.optional(
						Schema.NumberFromString.check(
							Schema.isInt(),
							Schema.isGreaterThanOrEqualTo(0),
						),
					),
					log: Schema.optional(IdentifierSchema),
					limit: Schema.optional(
						Schema.NumberFromString.check(
							Schema.isInt(),
							Schema.isBetween({ minimum: 1, maximum: 1000 }),
						),
					),
				},
				success: Schema.Array(
					Schema.Struct({
						position: Schema.Natural,
						action: CommittedActionSchema,
					}),
				),
				error: errors,
			}),
		)
		.middleware(AccountAuthentication),
	HttpApiGroup.make("invitations")
		.add(
			HttpApiEndpoint.post("create", "/api/invitations", {
				payload: Schema.Struct({
					invitation: IdentifierSchema,
					target: InvitationTargetSchema,
					role: InvitationRoleSchema,
					digest: InvitationDigestSchema,
				}),
				success: Schema.Natural,
				error: errors,
			}),
			HttpApiEndpoint.get("list", "/api/invitations", {
				query: {
					workspace: Schema.optional(IdentifierSchema),
					document: Schema.optional(IdentifierSchema),
				},
				success: Schema.Array(InvitationSummarySchema),
				error: errors,
			}),
			HttpApiEndpoint.post(
				"revoke",
				"/api/invitations/:invitation/revocation",
				{
					params: { invitation: IdentifierSchema },
					success: Schema.Natural,
					error: errors,
				},
			),
			HttpApiEndpoint.post(
				"describe",
				"/api/invitations/:invitation/description",
				{
					params: { invitation: IdentifierSchema },
					payload: Schema.Struct({ secret: InvitationSecretSchema }),
					success: InvitationDescriptionSchema,
					error: invitationErrors,
				},
			),
			HttpApiEndpoint.post(
				"accept",
				"/api/invitations/:invitation/acceptance",
				{
					params: { invitation: IdentifierSchema },
					payload: Schema.Struct({
						secret: InvitationSecretSchema,
						request: IdentifierSchema,
					}),
					success: InvitationAcceptanceSchema,
					error: invitationErrors,
				},
			),
			HttpApiEndpoint.post("leaveTarget", "/api/invitations/departures", {
				payload: Schema.Struct({
					target: InvitationTargetSchema,
					request: IdentifierSchema,
				}),
				success: Schema.Natural,
				error: errors,
			}),
			HttpApiEndpoint.post(
				"leave",
				"/api/invitations/:invitation/members/:member/departure",
				{
					params: { invitation: IdentifierSchema, member: IdentifierSchema },
					payload: Schema.Struct({ request: IdentifierSchema }),
					success: Schema.Natural,
					error: errors,
				},
			),
		)
		.middleware(AccountAuthentication),
	HttpApiGroup.make("workspaces")
		.add(
			HttpApiEndpoint.get("library", "/api/library", {
				success: LibrarySnapshotSchema,
				error: errors,
			}),
			HttpApiEndpoint.post("create", "/api/workspaces", {
				payload: Schema.Struct({
					workspace: IdentifierSchema,
					name: Schema.NonEmptyString,
					request: Schema.NonEmptyString,
				}),
				success: Schema.Natural,
				error: errors,
			}),
			HttpApiEndpoint.get("snapshot", "/api/workspaces/:workspace/snapshot", {
				params: { workspace: IdentifierSchema },
				success: WorkspaceSnapshotSchema,
				error: errors,
			}),
			HttpApiEndpoint.put("rename", "/api/workspaces/:workspace/name", {
				params: { workspace: IdentifierSchema },
				payload: Schema.Struct({
					name: Schema.NonEmptyString,
					request: Schema.NonEmptyString,
				}),
				success: Schema.Natural,
				error: errors,
			}),
			HttpApiEndpoint.put("avatar", "/api/workspaces/:workspace/avatar", {
				params: { workspace: IdentifierSchema },
				payload: Schema.Struct({
					image: Schema.NullOr(WorkspaceAvatarSchema),
					request: Schema.NonEmptyString,
				}),
				success: Schema.Natural,
				error: errors,
			}),
			HttpApiEndpoint.post("remove", "/api/workspaces/:workspace/deletion", {
				params: { workspace: IdentifierSchema },
				payload: Schema.Struct({
					name: Schema.String,
					request: IdentifierSchema,
				}),
				success: Schema.Natural,
				error: [
					...errors,
					WorkspaceDeletionRefused.pipe(HttpApiSchema.status(409)),
				],
			}),
			HttpApiEndpoint.put(
				"membership",
				"/api/workspaces/:workspace/members/:member",
				{
					params: { workspace: IdentifierSchema, member: IdentifierSchema },
					payload: Schema.Struct({
						role: Schema.NullOr(Schema.Literals(["writer", "reader"])),
						request: Schema.NonEmptyString,
					}),
					success: Schema.Natural,
					error: errors,
				},
			),
		)
		.middleware(AccountAuthentication),
)
