import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SynchronizedRef from "effect/SynchronizedRef"
import { DocumentConflict, PermissionDenied } from "../shared/document-actions"
import { metadataSource } from "../shared/document-metadata"
import { commentRanges, newComment, replyToComment } from "../shared/documents"
import type { CommentSelection } from "../shared/documents"
import type { Operation } from "../shared/model"
import type { Replica } from "../shared/crdt"
import { LocalDocumentFailure } from "./document-failures"
import { DocumentSession } from "./document-session"

interface DiscussionOptions {
	document: string
	author: string
	canWrite(): boolean
}
type SessionCommand = ReturnType<
	Context.Service.Shape<typeof DocumentSession>["change"]
>
type Command = Effect.Effect<
	Effect.Success<SessionCommand>,
	Effect.Error<SessionCommand> | PermissionDenied
>
type Thread = {
	id: string
	fields: Record<string, string>
	range?: { start: number; end: number }
	orphaned: boolean
}

export class DocumentDiscussion extends Context.Service<
	DocumentDiscussion,
	Effect.Success<ReturnType<typeof makeDiscussion>>
>()("alkalye/DocumentDiscussion") {
	static layer(options: DiscussionOptions) {
		return Layer.effect(DocumentDiscussion, makeDiscussion(options))
	}
}

function makeDiscussion(options: DiscussionOptions) {
	return Effect.gen(function* () {
		let session = yield* DocumentSession
		let crypto = yield* Crypto.Crypto
		let document = options.document
		let memo: { version: number; threads: readonly Thread[] } | undefined
		return Object.freeze({
			canWrite: options.canWrite,
			current() {
				let version = session.version()
				if (memo?.version === version) return memo.threads
				let comments = session.replica
					.records("comment")
					.filter(comment => comment.fields.document === document)
				let ranges = commentRanges(
					session.replica,
					document,
					comments.map(comment => comment.fields),
				)
				let threads = comments.map((comment, index) => {
					let range = ranges[index]
					return Object.freeze({
						...comment,
						fields: Object.freeze(comment.fields),
						range: range && Object.freeze(range),
						orphaned: Boolean(comment.fields.quote) && !range,
					})
				})
				memo = { version, threads: Object.freeze(threads) }
				return memo.threads
			},
			prepareComment(selection: CommentSelection) {
				let captured = Object.freeze({ ...selection })
				return Effect.gen(function* () {
					let id = yield* crypto.randomUUIDv4
					return composer(body =>
						write("Add comment", staged => {
							let fields = staged.fields(id)
							if (fields.type) {
								requireComment(staged, id)
								return [staged.set(id, "body", commentBody(body))]
							}
							return newComment(
								staged,
								id,
								document,
								captured.quote,
								commentBody(body),
								options.author,
								undefined,
								captured,
							)
						}),
					)
				})
			},
			prepareReply(id: string) {
				return Effect.gen(function* () {
					let identity = {
						id: yield* crypto.randomUUIDv4,
						time: yield* Clock.currentTimeMillis,
					}
					return composer(body =>
						write("Reply to comment", staged => {
							requireComment(staged, id)
							return [
								replyToComment(
									staged,
									id,
									commentBody(body),
									options.author,
									identity,
								),
							]
						}),
					)
				})
			},
			resolve(id: string, resolved: boolean) {
				return write(
					resolved ? "Resolve comment" : "Reopen comment",
					staged => {
						requireComment(staged, id)
						return [staged.set(id, "resolved", String(resolved))]
					},
				)
			},
			delete(id: string) {
				return write("Delete comment", staged => {
					requireComment(staged, id)
					return [staged.set(id, "type", "deleted")]
				})
			},
			setEnabled(enabled: boolean) {
				return write(
					enabled ? "Enable comments" : "Disable comments",
					staged => [
						staged.edit(
							document,
							metadataSource(staged.text(document), {
								commentsDisabled: !enabled,
							}),
						),
					],
				)
			},
		})
		function composer(make: (body: string) => Command) {
			let prepared = SynchronizedRef.makeUnsafe<
				{ body: string; command: Command } | undefined
			>(undefined)
			return Object.freeze({
				submit(body: string) {
					return SynchronizedRef.updateAndGetEffect(prepared, current =>
						Effect.sync(() =>
							current?.body === body ? current : { body, command: make(body) },
						),
					).pipe(
						Effect.flatMap(current =>
							current
								? current.command.pipe(
										Effect.tapError(error =>
											error instanceof LocalDocumentFailure && error.retryable
												? Effect.void
												: SynchronizedRef.update(prepared, latest =>
														latest === current ? undefined : latest,
													),
										),
									)
								: Effect.die("Comment command was not prepared"),
						),
					)
				},
			})
		}
		function write(
			label: string,
			build: (staged: Replica) => (Operation | null)[],
		) {
			let command = session.change(label, staged => {
				if (!options.canWrite())
					throw new PermissionDenied({ message: "This document is read-only" })
				return build(staged)
			})
			return Effect.gen(function* () {
				if (!options.canWrite())
					return yield* Effect.fail(
						new PermissionDenied({ message: "This document is read-only" }),
					)
				return yield* command
			})
		}
		function requireComment(replica: Replica, id: string) {
			let fields = replica.fields(id)
			if (fields.type !== "comment" || fields.document !== document)
				throw new DocumentConflict({
					message: "This comment is no longer available",
				})
		}
	})
}
function commentBody(value: string) {
	let body = value.trim()
	if (!body)
		throw new DocumentConflict({ message: "Write a comment before saving" })
	return body
}
