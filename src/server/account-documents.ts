import * as Clock from "effect/Clock"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { ApplicationError } from "../platform/errors"
import { Replica } from "../shared/crdt"
import {
	buildAction,
	buildOptionalAction,
	restoreSnapshot,
} from "../shared/document-actions"
import { StaleRevision } from "../shared/document-errors"
import type { DocumentRevision } from "../shared/document-errors"
import { agentWorkspace } from "../shared/agent-access"
import type { AgentAccess } from "../shared/agent-access"
import {
	changeMetadata,
	replaceDocumentSource,
} from "../shared/document-metadata"
import { newDocument, newComment, replyToComment } from "../shared/documents"
import type { Operation } from "../shared/model"
import { Identity, personalWorkspaceRequest } from "../shared/workspace"
import { WorkspaceStore } from "./document-store"

export function makeAccountDocuments() {
	return Effect.gen(function* () {
		let store = yield* WorkspaceStore
		let random = yield* Crypto.Crypto
		return {
			listDocuments,
			getDocument,
			createDocument,
			updateDocument: (
				access: AgentAccess,
				document: string,
				content: string,
				expectedRevision: string,
				workspace?: string,
			) =>
				mutate(
					access,
					document,
					"Agent edit",
					staged => replaceDocumentSource(staged, document, content),
					expectedRevision,
					workspace,
				),
			renameDocument: (
				access: AgentAccess,
				document: string,
				title: string,
				expectedRevision: string,
				workspace?: string,
			) =>
				mutate(
					access,
					document,
					"Agent rename",
					staged => changeMetadata(staged, document, { title }),
					expectedRevision,
					workspace,
				),
			archiveDocument: (
				access: AgentAccess,
				document: string,
				expectedRevision: string,
				workspace?: string,
			) =>
				mutate(
					access,
					document,
					"Agent archive",
					staged => changeMetadata(staged, document, { archived: true }),
					expectedRevision,
					workspace,
				),
			listComments,
			addComment,
			replyToComment: reply,
			setCommentResolved: (
				access: AgentAccess,
				document: string,
				comment: string,
				resolved: boolean,
				workspace?: string,
			) =>
				mutate(
					access,
					document,
					resolved ? "Agent resolve comment" : "Agent reopen comment",
					staged => {
						requireComment(staged, document, comment)
						return [staged.set(comment, "resolved", String(resolved))]
					},
					undefined,
					workspace,
				),
			renameSpace,
		}

		function listDocuments(access: AgentAccess) {
			return asAccount(
				access,
				[],
				Effect.gen(function* () {
					let library = yield* store.library()
					let documents = library.documents.filter(
						document =>
							!document.deleted &&
							!document.metadata.archived &&
							agentWorkspace(access, document.workspace),
					)
					let personal = "personal-" + access.subject
					let spaces = [
						...new Set([
							...library.workspaces.map(workspace => workspace.workspace),
							...documents.map(document => document.workspace),
						]),
					].filter(
						workspace =>
							workspace !== personal && agentWorkspace(access, workspace),
					)
					let summaries = documents.map(document => ({
						documentId: document.document,
						spaceId: document.workspace,
						title: document.metadata.title,
						updatedAt: document.updated
							? new Date(document.updated).toISOString()
							: null,
						revision: revision(document),
					}))
					return {
						personal: summaries.filter(
							document => document.spaceId === personal,
						),
						spaces: spaces.map(workspace => ({
							spaceId: workspace,
							name:
								library.workspaces.find(space => space.workspace === workspace)
									?.name ?? "Shared documents",
							documents: summaries.filter(
								document => document.spaceId === workspace,
							),
						})),
					}
				}),
			)
		}
		function getDocument(
			access: AgentAccess,
			document: string,
			workspace?: string,
		) {
			return asAccount(
				access,
				[],
				Effect.gen(function* () {
					let entry = yield* select(access, document, workspace)
					let snapshot = yield* store.snapshot(document)
					if (!snapshot) return yield* unavailable()
					let replica = yield* restoreSnapshot(snapshot, "reading")
					return {
						documentId: document,
						spaceId: entry.workspace,
						title: replica.metadata(document).title,
						content: replica.text(document),
						revision: revision(snapshot),
					}
				}),
			)
		}
		function createDocument(
			access: AgentAccess,
			title: string,
			content: string,
			workspace?: string,
		) {
			return Effect.gen(function* () {
				if (access.ceiling === "reader")
					return yield* denied("Read-only agent connection")
				let target = workspace ?? "personal-" + access.subject
				if (!agentWorkspace(access, target)) return yield* unavailable()
				let actor = access.subject + "-" + (yield* random.randomUUIDv4)
				let document = yield* random.randomUUIDv4
				return yield* asAccount(
					access,
					[actor],
					Effect.gen(function* () {
						if (target === "personal-" + access.subject)
							yield* store.create(target, "Personal", personalWorkspaceRequest)
						let action = yield* buildAction(
							new Replica(actor, "Agent"),
							document,
							"Agent create",
							staged => newDocument(staged, document, title, content),
						)
						yield* store.createDocument(target, action)
						let snapshot = yield* store.snapshot(document)
						if (!snapshot) return yield* unavailable()
						return mutation(document, snapshot)
					}),
				)
			})
		}
		function listComments(
			access: AgentAccess,
			document: string,
			workspace?: string,
		) {
			return asAccount(
				access,
				[],
				Effect.gen(function* () {
					yield* select(access, document, workspace)
					let snapshot = yield* store.snapshot(document)
					if (!snapshot) return yield* unavailable()
					let replica = yield* restoreSnapshot(snapshot, "reading")
					return {
						comments: replica
							.records("comment")
							.filter(comment => comment.fields.document === document)
							.map(comment => ({ commentId: comment.id, ...comment.fields })),
					}
				}),
			)
		}
		function addComment(
			access: AgentAccess,
			document: string,
			body: string,
			options: { quote?: string; spaceId?: string } = {},
		) {
			return Effect.gen(function* () {
				let id = yield* random.randomUUIDv4
				return yield* mutate(
					access,
					document,
					"Agent comment",
					staged =>
						newComment(
							staged,
							id,
							document,
							options.quote ?? "",
							body,
							"Agent",
						),
					undefined,
					options.spaceId,
				)
			})
		}
		function reply(
			access: AgentAccess,
			document: string,
			comment: string,
			body: string,
			workspace?: string,
		) {
			return Effect.gen(function* () {
				let id = yield* random.randomUUIDv4
				let time = yield* Clock.currentTimeMillis
				return yield* mutate(
					access,
					document,
					"Agent reply",
					staged => {
						requireComment(staged, document, comment)
						return [
							replyToComment(staged, comment, body, "Agent", { id, time }),
						]
					},
					undefined,
					workspace,
				)
			})
		}
		function renameSpace(access: AgentAccess, workspace: string, name: string) {
			return Effect.gen(function* () {
				if (access.ceiling !== "owner")
					return yield* denied("Owner permission required")
				if (!agentWorkspace(access, workspace)) return yield* unavailable()
				let request = yield* random.randomUUIDv4
				let position = yield* asAccount(
					access,
					[],
					store.rename(workspace, name, request),
				)
				let result: {
					spaceId: string
					name: string
					revision: string
					success: true
				} = {
					spaceId: workspace,
					name,
					revision: String(position),
					success: true,
				}
				return result
			})
		}
		function mutate(
			access: AgentAccess,
			document: string,
			label: string,
			change: (staged: Replica) => (Operation | null)[],
			expectedRevision?: string,
			workspace?: string,
		) {
			return Effect.gen(function* () {
				if (access.ceiling === "reader")
					return yield* denied("Read-only agent connection")
				let actor = access.subject + "-" + (yield* random.randomUUIDv4)
				let attempt = asAccount(
					access,
					[actor],
					Effect.gen(function* () {
						yield* select(access, document, workspace)
						let snapshot = yield* store.snapshot(document)
						if (!snapshot) return yield* unavailable()
						if (
							expectedRevision !== undefined &&
							expectedRevision !== revision(snapshot)
						)
							return yield* denied(
								"Revision conflict: read the document again before editing",
							)
						let replica = yield* restoreSnapshot(snapshot, actor)
						let action = yield* buildOptionalAction(
							replica,
							document,
							label,
							change,
						)
						if (Option.isNone(action)) return mutation(document, snapshot)
						let position = yield* store.commit(
							action.value,
							expectedRevision === undefined ? undefined : snapshot,
						)
						return mutation(document, { log: snapshot.log, position })
					}),
				)
				return yield* expectedRevision === undefined
					? attempt.pipe(
							Effect.retry({
								times: 3,
								while: error => error instanceof StaleRevision,
							}),
						)
					: attempt
			})
		}
		function select(access: AgentAccess, document: string, workspace?: string) {
			return store.library().pipe(
				Effect.flatMap(library => {
					let entry = library.documents.find(
						entry =>
							entry.document === document &&
							!entry.deleted &&
							(workspace === undefined || entry.workspace === workspace) &&
							agentWorkspace(access, entry.workspace),
					)
					return entry ? Effect.succeed(entry) : unavailable()
				}),
			)
		}
	})
}
function asAccount<A, E>(
	access: AgentAccess,
	actors: ReadonlyArray<string>,
	work: Effect.Effect<A, E, Identity>,
) {
	return work.pipe(
		Effect.provideService(Identity, {
			subject: access.subject,
			actors,
			access,
		}),
	)
}
function revision(value: DocumentRevision) {
	return value.log + ":" + value.position
}
function mutation(
	documentId: string,
	value: DocumentRevision,
): { documentId: string; revision: string; success: true } {
	return { documentId, revision: revision(value), success: true }
}
function requireComment(replica: Replica, document: string, comment: string) {
	let fields = replica.fields(comment)
	if (fields.type !== "comment" || fields.document !== document)
		throw new ApplicationError({
			operation: "mcp",
			cause: new Error("Comment unavailable"),
		})
}
function unavailable() {
	return denied("Document or workspace unavailable")
}
function denied(message: string) {
	return Effect.fail(
		new ApplicationError({ operation: "mcp", cause: new Error(message) }),
	)
}
