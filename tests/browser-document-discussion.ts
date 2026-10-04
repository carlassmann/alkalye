import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import { DocumentDiscussion } from "../src/client/document-discussion"
import { LocalDocumentFailure } from "../src/client/document-failures"
import { makeDocumentTransport } from "../src/client/document-transport"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { Replica } from "../src/shared/crdt"
import {
	buildAction,
	DocumentConflict,
	PermissionDenied,
	restoreSnapshot,
} from "../src/shared/document-actions"
import { newDocument, selectionAnchor } from "../src/shared/documents"

type Check = (value: unknown, message: string) => void

export function verifyDocumentDiscussion(subject: string, check: Check) {
	return Effect.scoped(
		Effect.gen(function* () {
			let document = "native-discussion"
			let remote = yield* makeDocumentTransport(location.origin, subject)
			let creation = {
				subject,
				workspace: "personal-" + subject,
				action: yield* buildAction(
					new Replica(subject + "-discussion-create"),
					document,
					"Create document",
					staged =>
						newDocument(staged, document, "Untitled", "quoted and quoted"),
				),
			}
			let context = yield* Layer.build(
				browserDocumentSessionLayer({
					document,
					subject,
					initialCreation: creation,
					transport: remote,
				}),
			)
			let session = Context.get(context, DocumentSession)
			let writable = true
			let discussion = Context.get(
				yield* Layer.build(
					DocumentDiscussion.layer({
						document,
						author: "Writer",
						canWrite: () => writable,
					}).pipe(
						Layer.provide(Layer.succeed(DocumentSession, session)),
						Layer.provide(webCryptoLayer),
					),
				),
				DocumentDiscussion,
			)
			let captured = selectionAnchor(
				session.replica.visible(document),
				session.replica.text(document),
				"quoted",
				11,
			)
			let composer = yield* discussion.prepareComment(captured)
			yield* session.edit("Prefix quoted and quoted").saved
			let create = composer.submit("Initial comment")
			let accepted = yield* create
			let duplicate = yield* create
			check(
				accepted.id === duplicate.id && discussion.current().length === 1,
				"discussion submit retries preserve the exact action and one comment identity",
			)
			let thread = discussion.current()[0]
			if (!thread) throw new Error("Missing created thread")
			let id = thread.id
			check(
				thread.range?.start === 18 &&
					thread.range.end === 24 &&
					session.replica.text(document) === "Prefix quoted and quoted",
				"discussion captures the chosen occurrence before intervening source edits",
			)
			check(
				discussion.current() === discussion.current(),
				"discussion rendering reuses its immutable projection until the session changes",
			)
			let reply = yield* discussion.prepareReply(id)
			let original = IDBObjectStore.prototype.add
			IDBObjectStore.prototype.add = function (...args) {
				if (this.name === "entries")
					throw new DOMException(
						"Discussion quota exceeded",
						"QuotaExceededError",
					)
				return Reflect.apply(original, this, args)
			}
			try {
				let failed = yield* reply
					.submit("First failed body")
					.pipe(Effect.result)
				check(
					failed._tag === "Failure" &&
						failed.failure instanceof LocalDocumentFailure &&
						failed.failure.retryable,
					"discussion exposes failed durable saves without reporting a successful reply",
				)
			} finally {
				IDBObjectStore.prototype.add = original
			}
			let changed = yield* reply.submit("Corrected body")
			let repeated = yield* reply.submit("Corrected body")
			let replies = Object.entries(session.replica.fields(id)).filter(([key]) =>
				key.startsWith("reply:"),
			)
			check(
				changed.id === repeated.id &&
					replies.length === 1 &&
					replies[0]?.[1].includes("Corrected body"),
				"editing a failed reply rebuilds the action while retaining one reply identity",
			)
			yield* composer.submit("Updated original comment")
			check(
				discussion.current().length === 1 &&
					session.replica.fields(id).body === "Updated original comment" &&
					Object.keys(session.replica.fields(id)).filter(key =>
						key.startsWith("reply:"),
					).length === 1 &&
					discussion.current()[0]?.range?.start === 18,
				"resubmitting a saved comment edits only its body while preserving anchors and peer replies",
			)
			let peerContext = yield* Layer.build(
				browserDocumentSessionLayer({
					document,
					subject,
					initialCreation: creation,
					transport: remote,
				}),
			)
			let peerSession = Context.get(peerContext, DocumentSession)
			let peerDiscussion = Context.get(
				yield* Layer.build(
					DocumentDiscussion.layer({
						document,
						author: "Peer",
						canWrite: () => writable,
					}).pipe(
						Layer.provide(Layer.succeed(DocumentSession, peerSession)),
						Layer.provide(webCryptoLayer),
					),
				),
				DocumentDiscussion,
			)
			yield* Effect.all(
				[discussion.resolve(id, true), peerDiscussion.resolve(id, true)],
				{ concurrency: 2 },
			)
			check(
				session.replica.fields(id).resolved === "true" &&
					peerSession.replica.fields(id).resolved === "true",
				"concurrent resolve intents set an explicit state instead of toggling a thread open",
			)
			yield* discussion.resolve(id, false)
			check(
				session.replica.fields(id).resolved === "false",
				"discussion reopens a resolved thread with an explicit action",
			)
			writable = false
			let denied = yield* discussion.resolve(id, true).pipe(Effect.result)
			check(
				denied._tag === "Failure" &&
					denied.failure instanceof PermissionDenied &&
					session.replica.fields(id).resolved === "false",
				"reader and revoked discussion commands fail before changing local state",
			)
			writable = true
			let checks = 0
			let flipping = Context.get(
				yield* Layer.build(
					DocumentDiscussion.layer({
						document,
						author: "Writer",
						canWrite: () => ++checks === 1,
					}).pipe(
						Layer.provide(Layer.succeed(DocumentSession, session)),
						Layer.provide(webCryptoLayer),
					),
				),
				DocumentDiscussion,
			)
			let pending = session.pending().length
			let stagedDenial = yield* flipping.resolve(id, true).pipe(Effect.result)
			check(
				stagedDenial._tag === "Failure" &&
					session.pending().length === pending &&
					session.replica.fields(id).resolved === "false",
				"a permission change before staging prevents a discussion action from entering the journal",
			)
			yield* session.edit(
				"Prefix quoted and quoted\n\nQueued source before settings",
			).saved
			yield* discussion.setEnabled(false)
			check(
				session.replica.metadata(document).commentsDisabled &&
					session.replica
						.text(document)
						.includes("Queued source before settings"),
				"comments settings edit authoritative frontmatter without discarding queued source",
			)
			let disabled = yield* reply
				.submit("Forbidden while disabled")
				.pipe(Effect.result)
			check(
				disabled._tag === "Failure" &&
					replies[0]?.[1] ===
						Object.entries(session.replica.fields(id)).find(([key]) =>
							key.startsWith("reply:"),
						)?.[1],
				"disabled comments reject new replies while retaining existing discussion",
			)
			yield* discussion.setEnabled(true)
			yield* session.sync
			yield* session.save
			let snapshot = yield* remote.snapshot(document)
			let restored = yield* restoreSnapshot(
				snapshot,
				"discussion-checkpoint-reader",
			)
			check(
				restored.records("comment").length === 1 &&
					restored.fields(id).body === "Updated original comment",
				"a current server snapshot restores discussion without downloading old action bodies",
			)
			let previous = discussion.current()
			yield* session.edit("Prefix quoted and \n\nQueued source before settings")
				.saved
			check(
				discussion.current() !== previous && discussion.current()[0]?.orphaned,
				"discussion marks a deleted anchored occurrence orphaned without selecting an identical earlier quote",
			)
			let stale = yield* discussion.prepareReply(id)
			yield* discussion.delete(id)
			let deleted = yield* stale.submit("After deletion").pipe(Effect.result)
			check(
				deleted._tag === "Failure" && discussion.current().length === 0,
				"a reply prepared before deletion cannot resurrect its thread",
			)
			let foreign = yield* discussion.prepareReply(document)
			let invalid = yield* foreign.submit("Wrong target").pipe(Effect.result)
			check(
				invalid._tag === "Failure" &&
					invalid.failure instanceof DocumentConflict,
				"discussion refuses a non-comment target even when it belongs to the document",
			)
			yield* session.sync
			let history = yield* remote.history(document, 0, snapshot.log)
			check(
				history.some(fact => fact.action.label === "Reply to comment") &&
					history.some(fact => fact.action.label === "Delete comment"),
				"source, comments, replies, settings and deletion appear in one document history",
			)
		}),
	)
}
