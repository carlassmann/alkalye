import { Command } from "@effect/cli"
import * as Option from "effect/Option"
import {
	addCommentReply,
	areCommentsEnabled,
	createCommentThread,
	createCommentThreadFromQuote,
	deleteCommentThread,
	getCommentRange,
	getVisibleCommentThreads,
	reopenCommentThread,
	resolveCommentThread,
	setCommentsEnabled,
} from "@/app/features/comments"
import { canEdit } from "@/app/features/sharing"
import { CliUsageError, PermissionError } from "@/cli/errors"
import { descriptions } from "@/cli/help"
import { createAuthenticatedJazz } from "@/cli/jazz"
import {
	bodyOption,
	commentIdArg,
	docIdArg,
	fromOption,
	globalOptions,
	quoteOption,
	toOption,
} from "@/cli/options"
import {
	findDocument,
	loadAccount,
	runCommand,
	syncMutation,
} from "@/cli/runtime"

export { docCommentCommand }

let docCommentList = Command.make(
	"list",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.comment.list", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			let data = {
				docId: located.doc.$jazz.id,
				commentsEnabled: areCommentsEnabled(located.doc),
				comments: getVisibleCommentThreads(located.doc).map(thread =>
					summarizeCommentThread(located.doc, thread),
				),
			}
			await jazz.done()
			return data
		}),
)

let docCommentAdd = Command.make(
	"add",
	{
		...globalOptions,
		docId: docIdArg,
		body: bodyOption,
		quote: quoteOption,
		from: fromOption,
		to: toOption,
	},
	args =>
		runCommand("doc.comment.add", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			requireDocumentEdit(located.doc)
			if (!areCommentsEnabled(located.doc)) {
				throw new PermissionError({
					message: "Comments are disabled for this document",
				})
			}
			if (!args.body.trim()) {
				throw new CliUsageError({ message: "Comment body cannot be empty" })
			}

			let thread =
				Option.isSome(args.from) || Option.isSome(args.to)
					? createCommentThread(
							located.doc,
							readCommentRange(
								args.from,
								args.to,
								located.doc.content.toString().length,
							),
							args.body,
							account.profile.name,
						)
					: Option.isSome(args.quote)
						? createCommentThreadFromQuote(
								located.doc,
								args.quote.value,
								args.body,
								account.profile.name,
							)
						: null
			if (!thread) {
				if (Option.isSome(args.quote)) {
					throw new CliUsageError({
						message: `Quote not found: ${args.quote.value}`,
					})
				}
				throw new CliUsageError({
					message: "Provide --quote or both --from and --to for comment add",
				})
			}

			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return summarizeCommentThread(located.doc, thread)
		}),
)

let docCommentReply = Command.make(
	"reply",
	{
		...globalOptions,
		docId: docIdArg,
		commentId: commentIdArg,
		body: bodyOption,
	},
	args =>
		runCommand("doc.comment.reply", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			requireDocumentEdit(located.doc)
			if (!args.body.trim()) {
				throw new CliUsageError({ message: "Reply body cannot be empty" })
			}
			let thread = findCommentThread(located.doc, args.commentId)
			addCommentReply(thread, args.body, account.profile.name)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return summarizeCommentThread(located.doc, thread)
		}),
)

let docCommentResolve = Command.make(
	"resolve",
	{
		...globalOptions,
		docId: docIdArg,
		commentId: commentIdArg,
	},
	args =>
		runCommand("doc.comment.resolve", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			requireDocumentEdit(located.doc)
			let thread = findCommentThread(located.doc, args.commentId)
			resolveCommentThread(thread)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return summarizeCommentThread(located.doc, thread)
		}),
)

let docCommentReopen = Command.make(
	"reopen",
	{
		...globalOptions,
		docId: docIdArg,
		commentId: commentIdArg,
	},
	args =>
		runCommand("doc.comment.reopen", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			requireDocumentEdit(located.doc)
			let thread = findCommentThread(located.doc, args.commentId)
			reopenCommentThread(thread)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return summarizeCommentThread(located.doc, thread)
		}),
)

let docCommentDelete = Command.make(
	"delete",
	{
		...globalOptions,
		docId: docIdArg,
		commentId: commentIdArg,
	},
	args =>
		runCommand("doc.comment.delete", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			requireDocumentEdit(located.doc)
			let thread = findCommentThread(located.doc, args.commentId)
			deleteCommentThread(thread)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return {
				docId: located.doc.$jazz.id,
				commentId: args.commentId,
				deleted: true,
			}
		}),
)

let docCommentEnable = Command.make(
	"enable",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.comment.enable", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			requireDocumentEdit(located.doc)
			setCommentsEnabled(located.doc, true)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { docId: located.doc.$jazz.id, commentsEnabled: true }
		}),
)

let docCommentDisable = Command.make(
	"disable",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.comment.disable", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			requireDocumentEdit(located.doc)
			setCommentsEnabled(located.doc, false)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { docId: located.doc.$jazz.id, commentsEnabled: false }
		}),
)

let docCommentCommand = Command.make("comment").pipe(
	Command.withDescription(descriptions.docComment),
	Command.withSubcommands([
		docCommentList,
		docCommentAdd,
		docCommentReply,
		docCommentResolve,
		docCommentReopen,
		docCommentDelete,
		docCommentEnable,
		docCommentDisable,
	]),
)

function readCommentRange(
	from: Option.Option<number>,
	to: Option.Option<number>,
	contentLength: number,
) {
	if (Option.isNone(from) || Option.isNone(to)) {
		throw new CliUsageError({
			message: "Provide both --from and --to, or use --quote",
		})
	}
	if (from.value < 0 || to.value <= from.value) {
		throw new CliUsageError({
			message: "--from must be >= 0 and --to must be greater than --from",
		})
	}
	if (from.value >= contentLength || to.value > contentLength) {
		throw new CliUsageError({
			message: `Comment range must be within document length ${contentLength}`,
		})
	}
	return { from: from.value, to: to.value }
}

function requireDocumentEdit(doc: Parameters<typeof canEdit>[0]) {
	if (!canEdit(doc)) {
		throw new PermissionError({ message: "Document edit access required" })
	}
}

function findCommentThread(
	doc: Parameters<typeof getVisibleCommentThreads>[0],
	commentId: string,
) {
	let thread = getVisibleCommentThreads(doc).find(
		thread => thread.$jazz.id === commentId,
	)
	if (!thread) {
		throw new CliUsageError({ message: `Comment not found: ${commentId}` })
	}
	return thread
}

function summarizeCommentThread(
	doc: Parameters<typeof getVisibleCommentThreads>[0],
	thread: ReturnType<typeof getVisibleCommentThreads>[number],
) {
	let range = getCommentRange(doc, thread.anchor)
	let replies = []
	for (let reply of thread.replies.values()) {
		if (!reply?.$isLoaded || reply.deletedAt) continue
		replies.push({
			replyId: reply.$jazz.id,
			body: reply.body,
			authorName: reply.authorName ?? null,
			createdAt: reply.createdAt.toISOString(),
			updatedAt: reply.updatedAt?.toISOString() ?? null,
		})
	}
	return {
		commentId: thread.$jazz.id,
		quote: thread.anchor.quote,
		originalQuote: thread.anchor.originalQuote ?? thread.anchor.quote,
		from: range.orphaned ? null : range.from,
		to: range.orphaned ? null : range.to,
		orphaned: range.orphaned,
		resolved: Boolean(thread.resolvedAt),
		deleted: Boolean(thread.deletedAt),
		createdAt: thread.createdAt.toISOString(),
		updatedAt: thread.updatedAt.toISOString(),
		replies,
	}
}
