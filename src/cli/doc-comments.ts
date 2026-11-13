import { runCommand, executeCommand } from "@/cli/runtime"
import { Command } from "@effect/cli"

import { descriptions } from "@/cli/help"

import {
	bodyOption,
	commentIdArg,
	docIdArg,
	fromOption,
	globalOptions,
	quoteOption,
	toOption,
} from "@/cli/options"

export { docCommentCommand }

let docCommentList = Command.make(
	"list",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.comment.list", args, config =>
			executeCommand("doc.comment.list", args, config),
		),
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
		runCommand("doc.comment.add", args, config =>
			executeCommand("doc.comment.add", args, config),
		),
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
		runCommand("doc.comment.reply", args, config =>
			executeCommand("doc.comment.reply", args, config),
		),
)

let docCommentResolve = Command.make(
	"resolve",
	{
		...globalOptions,
		docId: docIdArg,
		commentId: commentIdArg,
	},
	args =>
		runCommand("doc.comment.resolve", args, config =>
			executeCommand("doc.comment.resolve", args, config),
		),
)

let docCommentReopen = Command.make(
	"reopen",
	{
		...globalOptions,
		docId: docIdArg,
		commentId: commentIdArg,
	},
	args =>
		runCommand("doc.comment.reopen", args, config =>
			executeCommand("doc.comment.reopen", args, config),
		),
)

let docCommentDelete = Command.make(
	"delete",
	{
		...globalOptions,
		docId: docIdArg,
		commentId: commentIdArg,
	},
	args =>
		runCommand("doc.comment.delete", args, config =>
			executeCommand("doc.comment.delete", args, config),
		),
)

let docCommentEnable = Command.make(
	"enable",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.comment.enable", args, config =>
			executeCommand("doc.comment.enable", args, config),
		),
)

let docCommentDisable = Command.make(
	"disable",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.comment.disable", args, config =>
			executeCommand("doc.comment.disable", args, config),
		),
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
