import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as Schema from "effect/Schema"
import * as SqlError from "effect/sql/SqlError"
import type { DocumentAction } from "../shared/document-actions"
import { allowsWorkspace } from "../server/workspace-projection"
import { WorkspaceStore } from "../server/document-store"
import {
	AccessConflict,
	DocumentConflict,
	DocumentHistoryUnavailable,
	PermissionDenied,
	ResourceUnavailable,
} from "../shared/document-actions"
import {
	BlobBytesMissing,
	BlobCorrupt,
	BlobQuotaExceeded,
	CausalDependencyMissing,
	StaleRevision,
	UndoUnavailable,
} from "../shared/document-errors"
import { InvitationRevoked } from "../shared/invitations"
import { Identity, WorkspaceDeletionRefused } from "../shared/workspace"
import { WorkspaceApi } from "./workspace-api"
import { WorkspaceDirectory } from "./workspace-directory"
import type { WorkspaceRoute } from "./workspace-directory"

export interface FederatedWorkspaceOptions {
	local: WorkspaceStore["Service"]
	directory: WorkspaceDirectory["Service"]
	changes?: WorkspaceStore["Service"]["changes"]
	resolveRoute?(
		route: WorkspaceRoute,
	): Effect.Effect<WorkspaceRoute, SqlError.SqlError>
	request(
		workspace: string,
		identity: Identity["Service"],
		request: Request,
	): Promise<Response>
}
let readErrors = Schema.Union([PermissionDenied, ResourceUnavailable])
let writeErrors = Schema.Union([
	PermissionDenied,
	ResourceUnavailable,
	DocumentConflict,
])
let actionErrors = Schema.Union([
	PermissionDenied,
	ResourceUnavailable,
	DocumentConflict,
	AccessConflict,
	DocumentHistoryUnavailable,
	CausalDependencyMissing,
	StaleRevision,
	UndoUnavailable,
	BlobBytesMissing,
])
let withdrawalErrors = Schema.Union([
	PermissionDenied,
	ResourceUnavailable,
	DocumentConflict,
	UndoUnavailable,
	DocumentHistoryUnavailable,
])
let invitationErrors = Schema.Union([
	PermissionDenied,
	ResourceUnavailable,
	DocumentConflict,
	InvitationRevoked,
])

function makeClient() {
	return HttpApiClient.make(WorkspaceApi, {
		baseUrl: "https://workspace.internal",
	}).pipe(Effect.provide(FetchHttpClient.layer))
}
function privateFetch(
	options: FederatedWorkspaceOptions,
	workspace: string,
	identity: Identity["Service"],
) {
	return Object.assign(
		(input: RequestInfo | URL, init?: RequestInit) => {
			// RPC cannot transfer an AbortSignal; interrupted callers retain unknown receipts.
			let { signal: _signal, ...requestInit } = init ?? {}
			return options.request(
				workspace,
				identity,
				new Request(input, requestInit),
			)
		},
		{ preconnect() {} },
	)
}
type Client = Effect.Success<ReturnType<typeof makeClient>>

export function makeFederatedWorkspaceStore(
	options: FederatedWorkspaceOptions,
): Effect.Effect<WorkspaceStore["Service"]> {
	let { local, directory } = options
	function resolve(
		route: WorkspaceRoute | undefined,
	): Effect.Effect<WorkspaceRoute | undefined, SqlError.SqlError> {
		return route && route.state !== "active" && options.resolveRoute
			? options.resolveRoute(route)
			: Effect.succeed(route)
	}
	function remote<A, S extends Schema.Top>(
		workspace: string,
		send: (client: Client) => Effect.Effect<A, unknown>,
		errors: S,
	): Effect.Effect<A, S["Type"] | SqlError.SqlError, Identity> {
		return Identity.use(identity =>
			makeClient().pipe(
				Effect.flatMap(send),
				Effect.provideService(
					FetchHttpClient.Fetch,
					privateFetch(options, workspace, identity),
				),
				Effect.catch(error =>
					Effect.fail<S["Type"] | SqlError.SqlError>(
						Schema.is(errors)(error) ? error : storageFailure(error),
					),
				),
			),
		)
	}
	function routed<A, E, F>(
		route: Effect.Effect<WorkspaceRoute | undefined, SqlError.SqlError>,
		fallback: Effect.Effect<A, E, Identity>,
		send: (workspace: string) => Effect.Effect<A, F, Identity>,
	): Effect.Effect<A, E | F | SqlError.SqlError, Identity> {
		return route.pipe(
			Effect.flatMap(resolve),
			Effect.flatMap(
				(value): Effect.Effect<A, E | F | SqlError.SqlError, Identity> =>
					!value || value.state === "legacy"
						? fallback
						: value.state === "frozen"
							? Effect.fail(storageFailure("Workspace migration in progress"))
							: send(value.workspace),
			),
		)
	}
	function profile(subject: string) {
		return local
			.preferences()
			.pipe(Effect.provideService(Identity, { subject, actors: [] }))
	}
	function rememberAccess(
		workspace: string,
		actions: readonly DocumentAction[],
	) {
		let members = new Set<string>()
		for (let action of actions)
			for (let change of action.changes) {
				if (change.field.startsWith("access:") && change.value) {
					let member = change.field.slice(7)
					if (member && member !== "public") members.add(member)
				}
			}
		return Effect.forEach(
			members,
			member => directory.rememberMember(workspace, member),
			{ discard: true },
		)
	}
	function reserveLegacyDocument(workspace: string, document: string) {
		return Effect.gen(function* () {
			let route = yield* directory.workspace(workspace)
			if (!route) {
				let space = yield* local.workspaceSnapshot(workspace)
				if (!space) return
				// Local profile containers can be created after the startup directory scan.
				yield* directory.registerWorkspace(workspace, space.owner, "legacy")
			}
			yield* directory.registerDocument(document, workspace)
		})
	}
	function discoveryRoute(
		route: WorkspaceRoute | undefined,
	): Effect.Effect<WorkspaceRoute | undefined> {
		let unavailable: WorkspaceRoute | undefined = route
			? { ...route, state: "frozen" }
			: undefined
		return resolve(route).pipe(Effect.catch(() => Effect.succeed(unavailable)))
	}
	function creationRoute(
		workspace: string,
		identity: Identity["Service"],
	): Effect.Effect<
		WorkspaceRoute | undefined,
		PermissionDenied | SqlError.SqlError
	> {
		return Effect.gen(function* () {
			if (
				(workspace.startsWith("personal-") &&
					workspace !== "personal-" + identity.subject) ||
				!allowsWorkspace(workspace, identity.access) ||
				identity.access?.ceiling === "reader"
			)
				return yield* Effect.fail(
					new PermissionDenied({
						message: "Workspace creation is not permitted",
					}),
				)
			return yield* directory.workspace(workspace)
		})
	}
	function activeWorkspaces(knownWorkspaces: readonly string[] = []) {
		return Identity.use(identity =>
			directory.subjectWorkspaces(identity.subject).pipe(
				Effect.flatMap(ids =>
					Effect.forEach(new Set([...ids, ...knownWorkspaces]), id =>
						directory.workspace(id).pipe(Effect.flatMap(discoveryRoute)),
					),
				),
				Effect.map(routes =>
					routes.filter(route => route && route.state !== "legacy"),
				),
			),
		)
	}
	return Effect.succeed({
		...local,
		changes: options.changes ?? local.changes,
		library: () =>
			Effect.gen(function* () {
				let original = yield* local.library()
				let routes = yield* activeWorkspaces([
					...original.workspaces.map(row => row.workspace),
					...original.documents.map(row => row.workspace),
				])
				let workspaces = new Map(
					original.workspaces.map(row => [row.workspace, row]),
				)
				let documents = new Map(
					original.documents.map(row => [row.document, row]),
				)
				for (let route of routes) {
					if (!route) continue
					workspaces.delete(route.workspace)
					for (let [id, row] of documents)
						if (row.workspace === route.workspace) documents.delete(id)
					if (route.state === "frozen") continue
					let result = yield* remote(
						route.workspace,
						client => client.workspaces.library(),
						Schema.Never,
					).pipe(Effect.catch(() => Effect.succeed(undefined)))
					if (!result) continue
					workspaces.delete(route.workspace)
					for (let [id, row] of documents)
						if (row.workspace === route.workspace) documents.delete(id)
					for (let row of result.workspaces) workspaces.set(row.workspace, row)
					for (let row of result.documents)
						documents.set(row.document, { ...row, links: row.links ?? [] })
				}
				return {
					workspaces: [...workspaces.values()],
					documents: [...documents.values()],
				}
			}),
		sharedDocuments: () =>
			Effect.gen(function* () {
				let original = yield* local.sharedDocuments()
				let routes = yield* activeWorkspaces(original.map(row => row.workspace))
				let documents = new Map(original.map(row => [row.document, row]))
				for (let route of routes) {
					if (!route) continue
					for (let [id, row] of documents)
						if (row.workspace === route.workspace) documents.delete(id)
					if (route.state === "frozen") continue
					let rows = yield* remote(
						route.workspace,
						client => client.internal.sharedDocuments(),
						Schema.Never,
					).pipe(Effect.catch(() => Effect.succeed(undefined)))
					if (!rows) continue
					for (let [id, row] of documents)
						if (row.workspace === route.workspace) documents.delete(id)
					for (let row of rows) documents.set(row.document, row)
				}
				return [...documents.values()]
			}),
		create: (workspace, name, request) =>
			Identity.use(identity =>
				creationRoute(workspace, identity).pipe(
					Effect.flatMap(resolve),
					Effect.flatMap(route =>
						route?.state === "legacy"
							? local.create(workspace, name, request)
							: route?.state === "frozen"
								? Effect.fail(storageFailure("Workspace migration in progress"))
								: (route
										? directory.rememberMember(workspace, identity.subject)
										: directory.registerWorkspace(workspace, identity.subject)
									).pipe(
										Effect.andThen(
											remote(
												workspace,
												client =>
													client.workspaces.create({
														payload: { workspace, name, request },
													}),
												writeErrors,
											),
										),
									),
					),
				),
			),
		missingBlobs: (document, chunks) =>
			routed(
				directory.document(document),
				local.missingBlobs(document, chunks),
				id =>
					remote(
						id,
						client =>
							client.documents
								.missingBlobs({
									params: { document },
									payload: [...chunks],
								})
								.pipe(Effect.map(rows => [...rows])),
						writeErrors,
					),
			),
		putBlob: (document, digest, bytes) =>
			routed(
				directory.document(document),
				local.putBlob(document, digest, bytes),
				id =>
					remote(
						id,
						client =>
							client.documents.putBlob({
								params: { document, digest },
								payload: bytes,
							}),
						Schema.Union([
							PermissionDenied,
							ResourceUnavailable,
							BlobCorrupt,
							BlobQuotaExceeded,
						]),
					),
			),
		getBlob: (document, digest) =>
			routed(
				directory.document(document),
				local.getBlob(document, digest),
				id =>
					remote(
						id,
						client =>
							client.documents.getBlob({ params: { document, digest } }),
						Schema.Union([ResourceUnavailable, BlobCorrupt]),
					),
			),
		snapshot: document =>
			routed(directory.document(document), local.snapshot(document), id =>
				remote(
					id,
					client =>
						client.documents.snapshot({
							params: { document },
							query: { encoding: "compact" },
						}),
					readErrors,
				).pipe(
					Effect.catchTag("ResourceUnavailable", () =>
						Effect.succeed(undefined),
					),
				),
			),
		history: (document, after = 0, log, limit) =>
			routed(
				directory.document(document),
				local.history(document, after, log, limit),
				id =>
					remote(
						id,
						client =>
							client.documents
								.history({
									params: { document },
									query: { after, log, limit },
								})
								.pipe(Effect.map(rows => [...rows])),
						Schema.Union([
							PermissionDenied,
							ResourceUnavailable,
							DocumentConflict,
							DocumentHistoryUnavailable,
						]),
					),
			),
		action: (document, action) =>
			routed(directory.document(document), local.action(document, action), id =>
				remote(
					id,
					client => client.documents.action({ params: { document, action } }),
					readErrors,
				).pipe(
					Effect.catchTag("ResourceUnavailable", () =>
						Effect.succeed(undefined),
					),
				),
			),
		chain: (document, action) =>
			routed(directory.document(document), local.chain(document, action), id =>
				remote(
					id,
					client => client.documents.chain({ params: { document, action } }),
					readErrors,
				).pipe(
					Effect.catchTag("ResourceUnavailable", () =>
						Effect.succeed(undefined),
					),
				),
			),
		accessRole: (document, subject) =>
			routed(
				directory.document(document),
				local.accessRole(document, subject),
				id =>
					remote(
						id,
						client =>
							client.internal
								.accessRole({ params: { document, subject } })
								.pipe(Effect.map(role => role ?? undefined)),
						ResourceUnavailable,
					),
			),
		moveDocument: (document, workspace, request) =>
			Effect.gen(function* () {
				let from = yield* directory.document(document)
				let to = yield* directory.workspace(workspace)
				if (
					(!from || from.state === "legacy") &&
					(!to || to.state === "legacy")
				)
					return yield* local.moveDocument(document, workspace, request)
				return yield* Effect.fail(
					storageFailure(
						"Cross-workspace transfer requires the migration kernel",
					),
				)
			}),
		createInvitation: (invitation, target, role, digest) => {
			let route =
				"workspace" in target
					? directory.workspace(target.workspace)
					: directory.document(target.document)
			return routed(
				route,
				route.pipe(
					Effect.flatMap(value =>
						value
							? directory.registerInvitation(invitation, value.workspace)
							: Effect.void,
					),
					Effect.andThen(
						local.createInvitation(invitation, target, role, digest),
					),
				),
				id =>
					directory.registerInvitation(invitation, id).pipe(
						Effect.andThen(
							remote(
								id,
								client =>
									client.invitations.create({
										payload: { invitation, target, role, digest },
									}),
								writeErrors,
							),
						),
					),
			)
		},
		invitations: target =>
			routed(
				"workspace" in target
					? directory.workspace(target.workspace)
					: directory.document(target.document),
				local.invitations(target),
				id =>
					remote(
						id,
						client =>
							client.invitations.list({ query: target }).pipe(
								Effect.flatMap(rows =>
									Effect.forEach(rows, row =>
										Effect.forEach(row.members, member =>
											profile(member.member).pipe(
												Effect.map(preferences => ({
													...member,
													name: preferences.name,
												})),
											),
										).pipe(Effect.map(members => ({ ...row, members }))),
									),
								),
							),
						readErrors,
					),
			),
		revokeInvitation: invitation =>
			routed(
				directory.invitation(invitation),
				local.revokeInvitation(invitation),
				id =>
					remote(
						id,
						client => client.invitations.revoke({ params: { invitation } }),
						writeErrors,
					),
			),
		describeInvitation: (invitation, secret) =>
			routed(
				directory.invitation(invitation),
				local.describeInvitation(invitation, secret),
				id =>
					remote(
						id,
						client =>
							client.internal
								.describeInvitation({
									params: { invitation },
									payload: { secret },
								})
								.pipe(
									Effect.flatMap(value =>
										profile(value.ownerSubject).pipe(
											Effect.map(preferences => ({
												...value.description,
												owner: preferences.name,
											})),
										),
									),
								),
						Schema.Union([ResourceUnavailable, InvitationRevoked]),
					),
			).pipe(
				Effect.provideService(Identity, {
					subject: "invitation-preview",
					actors: [],
					access: { workspaces: [], ceiling: "reader" },
				}),
			),
		acceptInvitation: (invitation, secret, request) =>
			routed(
				directory.invitation(invitation),
				local.acceptInvitation(invitation, secret, request),
				id =>
					Identity.use(identity =>
						directory.rememberMember(id, identity.subject).pipe(
							Effect.andThen(
								remote(
									id,
									client =>
										client.invitations.accept({
											params: { invitation },
											payload: { secret, request },
										}),
									invitationErrors,
								),
							),
						),
					),
			),
		leaveInvitation: (invitation, member, request) =>
			routed(
				directory.invitation(invitation),
				local.leaveInvitation(invitation, member, request),
				id =>
					remote(
						id,
						client =>
							client.invitations.leave({
								params: { invitation, member },
								payload: { request },
							}),
						writeErrors,
					),
			),
		leave: (target, request) =>
			routed(
				"workspace" in target
					? directory.workspace(target.workspace)
					: directory.document(target.document),
				local.leave(target, request),
				id =>
					remote(
						id,
						client =>
							client.invitations.leaveTarget({ payload: { target, request } }),
						writeErrors,
					),
			),
		createDocument: (workspace, action) =>
			routed(
				directory.workspace(workspace),
				reserveLegacyDocument(workspace, action.document).pipe(
					Effect.andThen(local.createDocument(workspace, action)),
				),
				id =>
					directory
						.registerDocument(action.document, id)
						.pipe(
							Effect.andThen(rememberAccess(id, [action])),
							Effect.andThen(
								remote(
									id,
									client =>
										client.documents.create({ payload: { workspace, action } }),
									actionErrors,
								),
							),
						),
			),
		commit: action =>
			routed(directory.document(action.document), local.commit(action), id =>
				rememberAccess(id, [action]).pipe(
					Effect.andThen(
						remote(
							id,
							client =>
								client.documents.commit({
									params: { document: action.document },
									payload: action,
								}),
							actionErrors,
						),
					),
				),
			),
		commitBatch: actions => {
			let first = actions[0]
			if (!first) return local.commitBatch(actions)
			return routed(
				directory.document(first.document),
				local.commitBatch(actions),
				id =>
					rememberAccess(id, actions).pipe(
						Effect.andThen(
							remote(
								id,
								client =>
									client.documents
										.commitBatch({
											params: { document: first.document },
											payload: { actions: [...actions] },
										})
										.pipe(Effect.map(rows => [...rows])),
								actionErrors,
							),
						),
					),
			)
		},
		withdraw: action =>
			routed(directory.document(action.document), local.withdraw(action), id =>
				remote(
					id,
					client =>
						client.documents.withdraw({
							params: { document: action.document },
							payload: action,
						}),
					withdrawalErrors,
				),
			),
		workspaceSnapshot: workspace =>
			routed(
				directory.workspace(workspace),
				local.workspaceSnapshot(workspace),
				id =>
					remote(
						id,
						client =>
							client.workspaces.snapshot({ params: { workspace } }).pipe(
								Effect.flatMap(value =>
									Effect.gen(function* () {
										let ownerProfile = yield* profile(value.owner)
										let members = yield* Effect.forEach(value.members, member =>
											profile(member.member).pipe(
												Effect.map(preferences => ({
													...member,
													name: preferences.name,
													source: member.source ?? "direct",
												})),
											),
										)
										return {
											...value,
											ownerName: ownerProfile.name,
											members,
											documents: [...value.documents],
										}
									}),
								),
							),
						ResourceUnavailable,
					),
			),
		workspaceHistory: (workspace, after = 0) =>
			routed(
				directory.workspace(workspace),
				local.workspaceHistory(workspace, after),
				id =>
					remote(
						id,
						client =>
							client.internal
								.workspaceHistory({
									params: { workspace },
									query: { after },
								})
								.pipe(Effect.map(rows => [...rows])),
						Schema.Union([PermissionDenied, DocumentConflict]),
					),
			),
		rename: (workspace, name, request) =>
			routed(
				directory.workspace(workspace),
				local.rename(workspace, name, request),
				id =>
					remote(
						id,
						client =>
							client.workspaces.rename({
								params: { workspace },
								payload: { name, request },
							}),
						writeErrors,
					),
			),
		avatar: (workspace, image, request) =>
			routed(
				directory.workspace(workspace),
				local.avatar(workspace, image, request),
				id =>
					remote(
						id,
						client =>
							client.workspaces.avatar({
								params: { workspace },
								payload: { image, request },
							}),
						writeErrors,
					),
			),
		remove: (workspace, name, request) =>
			routed(
				directory.workspace(workspace),
				local.remove(workspace, name, request),
				id =>
					remote(
						id,
						client =>
							client.workspaces.remove({
								params: { workspace },
								payload: { name, request },
							}),
						Schema.Union([
							PermissionDenied,
							ResourceUnavailable,
							DocumentConflict,
							WorkspaceDeletionRefused,
						]),
					),
			),
		membership: (workspace, member, role, request) =>
			routed(
				directory.workspace(workspace),
				local.membership(workspace, member, role, request),
				id =>
					(role ? directory.rememberMember(id, member) : Effect.void).pipe(
						Effect.andThen(
							remote(
								id,
								client =>
									client.workspaces.membership({
										params: { workspace, member },
										payload: { role, request },
									}),
								writeErrors,
							),
						),
					),
			),
	} satisfies WorkspaceStore["Service"])
}
function storageFailure(cause: unknown) {
	return new SqlError.SqlError({
		reason: new SqlError.UnknownError({
			cause,
			message: "Workspace storage binding unavailable",
		}),
	})
}
