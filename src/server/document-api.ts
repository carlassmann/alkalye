import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import { DocumentObservability } from "../shared/document-observability"
import type { DocumentOperation } from "../shared/document-observability"
import { RequestAccount } from "../shared/authentication"
import { DocumentApi, StoreUnavailable } from "../shared/document-api"
import {
	AccessConflict,
	DocumentConflict,
	DocumentHistoryUnavailable,
	PermissionDenied,
	ResourceUnavailable,
} from "../shared/document-actions"
import { Identity, WorkspaceDeletionRefused } from "../shared/workspace"
import { InvitationRevoked } from "../shared/invitations"
import { WorkspaceStore } from "./document-store"
import {
	isBlobFailure,
	CausalDependencyMissing,
	UndoUnavailable,
	StaleRevision,
} from "../shared/document-errors"

export let documentHandlers = HttpApiBuilder.group(
	DocumentApi,
	"documents",
	handlers =>
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			return handlers
				.handle("missingBlobs", ({ params, payload }) =>
					asAccount(store.missingBlobs(params.document, payload)),
				)
				.handle("putBlob", ({ params, payload }) =>
					asAccount(store.putBlob(params.document, params.digest, payload)),
				)
				.handle("getBlob", ({ params }) =>
					asAccount(store.getBlob(params.document, params.digest)),
				)
				.handle("create", ({ payload }) =>
					asAccount(
						store.createDocument(payload.workspace, payload.action),
						[payload.action.actor],
						"create",
					),
				)
				.handle("commit", ({ params, payload }) =>
					params.document === payload.document
						? asAccount(store.commit(payload), [payload.actor], "commit")
						: Effect.fail(
								new DocumentConflict({
									message: "The action belongs to another document",
								}),
							),
				)
				.handle("withdraw", ({ params, payload }) =>
					params.document === payload.document
						? asAccount(store.withdraw(payload), [payload.actor], "withdraw")
						: Effect.fail(
								new DocumentConflict({
									message: "The action belongs to another document",
								}),
							),
				)
				.handle("snapshot", ({ params }) =>
					asAccount(
						store
							.snapshot(params.document)
							.pipe(
								Effect.flatMap(snapshot =>
									snapshot ? Effect.succeed(snapshot) : missing(),
								),
							),
						[],
						"snapshot",
					),
				)
				.handle("move", ({ params, payload }) =>
					asAccount(
						store.moveDocument(
							params.document,
							payload.workspace,
							payload.request,
						),
					),
				)
				.handle("history", ({ params, query }) =>
					asAccount(
						store.history(
							params.document,
							query.after ?? 0,
							query.log,
							query.limit ?? 100,
						),
						[],
						"history",
					),
				)
				.handle("chain", ({ params }) =>
					asAccount(
						store.chain(params.document, params.action).pipe(
							Effect.flatMap(value =>
								value
									? Effect.succeed(value)
									: Effect.fail(
											new ResourceUnavailable({
												message: "This action is unavailable",
											}),
										),
							),
						),
						[],
						"chain",
					),
				)
				.handle("action", ({ params }) =>
					asAccount(
						store.action(params.document, params.action).pipe(
							Effect.flatMap(value =>
								value
									? Effect.succeed(value)
									: Effect.fail(
											new ResourceUnavailable({
												message: "This action is unavailable",
											}),
										),
							),
						),
						[],
						"action",
					),
				)
		}),
)
export let workspaceHandlers = HttpApiBuilder.group(
	DocumentApi,
	"workspaces",
	handlers =>
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			return handlers
				.handle("library", () => asAccount(store.library()))
				.handle("rename", ({ params, payload }) =>
					asAccount(
						store.rename(params.workspace, payload.name, payload.request),
					),
				)
				.handle("create", ({ payload }) =>
					asAccount(
						store.create(payload.workspace, payload.name, payload.request),
					),
				)
				.handle("avatar", ({ params, payload }) =>
					asAccount(
						store.avatar(params.workspace, payload.image, payload.request),
					),
				)
				.handle("remove", ({ params, payload }) =>
					asAccount(
						store.remove(params.workspace, payload.name, payload.request),
					),
				)
				.handle("snapshot", ({ params }) =>
					asAccount(store.workspaceSnapshot(params.workspace)).pipe(
						Effect.flatMap(snapshot =>
							snapshot ? Effect.succeed(snapshot) : missing(),
						),
					),
				)
				.handle("membership", ({ params, payload }) =>
					asAccount(
						store.membership(
							params.workspace,
							params.member,
							payload.role,
							payload.request,
						),
					),
				)
		}),
)
let invitationHandlers = HttpApiBuilder.group(
	DocumentApi,
	"invitations",
	handlers =>
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			return handlers
				.handle("create", ({ payload }) =>
					asAccount(
						store.createInvitation(
							payload.invitation,
							payload.target,
							payload.role,
							payload.digest,
						),
					),
				)
				.handle("list", ({ query }) =>
					query.document
						? asAccount(store.invitations({ document: query.document }))
						: query.workspace
							? asAccount(store.invitations({ workspace: query.workspace }))
							: Effect.fail(
									new DocumentConflict({
										message: "Choose a document or workspace",
									}),
								),
				)
				.handle("revoke", ({ params }) =>
					asAccount(store.revokeInvitation(params.invitation)),
				)
				.handle("describe", ({ params, payload }) =>
					asAccount(
						store.describeInvitation(params.invitation, payload.secret),
					),
				)
				.handle("accept", ({ params, payload }) =>
					asAccount(
						store.acceptInvitation(
							params.invitation,
							payload.secret,
							payload.request,
						),
					),
				)
				.handle("leaveTarget", ({ payload }) =>
					asAccount(store.leave(payload.target, payload.request)),
				)
				.handle("leave", ({ params, payload }) =>
					asAccount(
						store.leaveInvitation(
							params.invitation,
							params.member,
							payload.request,
						),
					),
				)
		}),
)
let preferenceHandlers = HttpApiBuilder.group(
	DocumentApi,
	"preferences",
	handlers =>
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			return handlers
				.handle("get", () => asAccount(store.preferences()))
				.handle("save", ({ payload }) =>
					asAccount(store.savePreferences(payload.patch, payload.request)),
				)
		}),
)
export let documentApiHandlers = Layer.mergeAll(
	documentHandlers,
	workspaceHandlers,
	invitationHandlers,
	preferenceHandlers,
)
function asAccount<A, E>(
	effect: Effect.Effect<A, E, Identity>,
	actors: ReadonlyArray<string> = [],
	operation: DocumentOperation = "other",
) {
	return Effect.gen(function* () {
		let observability = yield* DocumentObservability
		return yield* Effect.gen(function* () {
			let account = yield* RequestAccount
			if (actors.some(actor => !actor.startsWith(account.subject + "-")))
				return yield* Effect.fail(
					new DocumentConflict({
						message: "Document actors must belong to the authenticated account",
					}),
				)
			return yield* effect.pipe(
				Effect.provideService(Identity, { subject: account.subject, actors }),
				Effect.mapError(error =>
					expected(error)
						? error
						: new StoreUnavailable({
								message: "Document storage is temporarily unavailable",
							}),
				),
			)
		}).pipe(observability.observe(operation))
	})
}
function expected<E>(error: E) {
	return (
		error instanceof UndoUnavailable ||
		error instanceof StaleRevision ||
		error instanceof CausalDependencyMissing ||
		isBlobFailure(error) ||
		error instanceof AccessConflict ||
		error instanceof DocumentConflict ||
		error instanceof DocumentHistoryUnavailable ||
		error instanceof PermissionDenied ||
		error instanceof ResourceUnavailable ||
		error instanceof InvitationRevoked ||
		error instanceof WorkspaceDeletionRefused
	)
}
function missing() {
	return Effect.fail(
		new ResourceUnavailable({ message: "This document is unavailable" }),
	)
}
