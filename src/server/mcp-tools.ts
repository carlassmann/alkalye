import * as Context from "effect/Context"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as McpServer from "effect/ai/McpServer"
import * as Tool from "effect/ai/Tool"
import * as Toolkit from "effect/ai/Toolkit"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import { isInfrastructureFailure } from "./failures"
import { AgentDocuments } from "./agent-documents"

class AgentToolFailure extends Schema.TaggedError<AgentToolFailure>()(
	"AgentToolFailure",
	{ message: Schema.String },
) {}
let document = Schema.Struct({
	documentId: Schema.String,
	spaceId: Schema.String,
	title: Schema.String,
	updatedAt: Schema.NullOr(Schema.String),
	revision: Schema.String,
})
let listing = Schema.Struct({
	personal: Schema.Array(document),
	spaces: Schema.Array(
		Schema.Struct({
			spaceId: Schema.String,
			name: Schema.String,
			documents: Schema.Array(document),
		}),
	),
})
let reading = Schema.Struct({
	documentId: Schema.String,
	spaceId: Schema.String,
	title: Schema.optionalKey(Schema.String),
	content: Schema.String,
	revision: Schema.String,
})
let comments = Schema.Struct({
	comments: Schema.Array(Schema.Record(Schema.String, Schema.String)),
})
let mutation = Schema.Struct({
	documentId: Schema.String,
	revision: Schema.String,
	success: Schema.Literal(true),
})
let tools = Toolkit.make(
	agentTool("list_documents", "List documents and spaces", {}, listing),
	agentTool(
		"get_document",
		"Read content and revision before editing",
		{ documentId: Schema.String, spaceId: Schema.optionalKey(Schema.String) },
		reading,
	),
	agentTool(
		"create_document",
		"Create a Markdown document",
		{
			title: Schema.String,
			content: Schema.String,
			spaceId: Schema.optionalKey(Schema.String),
		},
		mutation,
	),
	agentTool(
		"update_document",
		"Replace content if revision still matches",
		{
			documentId: Schema.String,
			spaceId: Schema.optionalKey(Schema.String),
			content: Schema.String,
			expectedRevision: Schema.String,
		},
		mutation,
	),
	agentTool(
		"rename_document",
		"Rename a document",
		{
			documentId: Schema.String,
			spaceId: Schema.optionalKey(Schema.String),
			title: Schema.String,
			expectedRevision: Schema.String,
		},
		mutation,
	),
	agentTool(
		"archive_document",
		"Archive a document",
		{
			documentId: Schema.String,
			spaceId: Schema.optionalKey(Schema.String),
			expectedRevision: Schema.String,
		},
		mutation,
	),
	agentTool(
		"list_comments",
		"List anchored comments and replies",
		{ documentId: Schema.String, spaceId: Schema.optionalKey(Schema.String) },
		comments,
	),
	agentTool(
		"add_comment",
		"Comment on a quote",
		{
			documentId: Schema.String,
			spaceId: Schema.optionalKey(Schema.String),
			quote: Schema.optionalKey(Schema.String),
			body: Schema.String,
		},
		mutation,
	),
	agentTool(
		"reply_to_comment",
		"Reply to a comment",
		{
			documentId: Schema.String,
			spaceId: Schema.optionalKey(Schema.String),
			commentId: Schema.String,
			body: Schema.String,
		},
		mutation,
	),
	agentTool(
		"set_comment_resolved",
		"Resolve or reopen a comment",
		{
			documentId: Schema.String,
			spaceId: Schema.optionalKey(Schema.String),
			commentId: Schema.String,
			resolved: Schema.Boolean,
		},
		mutation,
	),
	agentTool(
		"rename_space",
		"Rename a workspace",
		{ spaceId: Schema.String, name: Schema.String },
		Schema.Struct({
			spaceId: Schema.String,
			name: Schema.String,
			revision: Schema.String,
			success: Schema.Literal(true),
		}),
	),
)

export function agentToolsLayer() {
	let handlers = tools.toLayer({
		list_documents: () =>
			invoke((documents, token) => documents.listDocuments(token)),
		get_document: args =>
			invoke((documents, token) =>
				documents.getDocument(token, args.documentId, args.spaceId),
			),
		create_document: args =>
			invoke((documents, token) =>
				documents.createDocument(token, args.title, args.content, args.spaceId),
			),
		update_document: args =>
			invoke((documents, token) =>
				documents.updateDocument(
					token,
					args.documentId,
					args.content,
					args.expectedRevision,
					args.spaceId,
				),
			),
		rename_document: args =>
			invoke((documents, token) =>
				documents.renameDocument(
					token,
					args.documentId,
					args.title,
					args.expectedRevision,
					args.spaceId,
				),
			),
		archive_document: args =>
			invoke((documents, token) =>
				documents.archiveDocument(
					token,
					args.documentId,
					args.expectedRevision,
					args.spaceId,
				),
			),
		list_comments: args =>
			invoke((documents, token) =>
				documents.listComments(token, args.documentId, args.spaceId),
			),
		add_comment: args =>
			invoke((documents, token) =>
				documents.addComment(token, args.documentId, args.body, {
					quote: args.quote,
					spaceId: args.spaceId,
				}),
			),
		reply_to_comment: args =>
			invoke((documents, token) =>
				documents.replyToComment(
					token,
					args.documentId,
					args.commentId,
					args.body,
					args.spaceId,
				),
			),
		set_comment_resolved: args =>
			invoke((documents, token) =>
				documents.setCommentResolved(
					token,
					args.documentId,
					args.commentId,
					args.resolved,
					args.spaceId,
				),
			),
		rename_space: args =>
			invoke((documents, token) =>
				documents.renameSpace(token, args.spaceId, args.name),
			),
	})
	return McpServer.toolkit(tools).pipe(Layer.provide(handlers))
}
function invoke<A, E>(
	work: (
		documents: Context.Service.Shape<typeof AgentDocuments>,
		token: string,
	) => Effect.Effect<A, E>,
) {
	return Effect.gen(function* () {
		let request = yield* HttpServerRequest.HttpServerRequest
		let documents = yield* AgentDocuments
		let token = request.headers.authorization?.replace(/^Bearer /i, "") ?? ""
		return yield* work(documents, token)
	}).pipe(
		Effect.catchCause(cause =>
			Effect.gen(function* () {
				if (Cause.hasInterrupts(cause))
					return yield* Effect.failCause(
						Cause.fromReasons<never>(
							cause.reasons.filter(Cause.isInterruptReason),
						),
					)
				let defect = Cause.hasDies(cause)
				let storage = isInfrastructureFailure(cause)
				if (defect || storage)
					yield* Effect.logError("Agent tool failed", { defect, storage })
				return yield* new AgentToolFailure({
					message: defect
						? "Server request failed"
						: storage
							? "Server storage is unavailable"
							: message(cause),
				})
			}),
		),
	)
}

function agentTool<
	Name extends string,
	Fields extends Schema.Struct.Fields,
	Success extends Schema.Top,
>(name: Name, description: string, fields: Fields, success: Success) {
	return Tool.make(name, {
		description,
		parameters: Object.keys(fields).length
			? Schema.Struct(fields)
			: Tool.EmptyParams,
		success,
		failure: AgentToolFailure,
	})
		.addDependency(HttpServerRequest.HttpServerRequest)
		.addDependency(AgentDocuments)
		.annotate(Tool.Strict, true)
		.annotate(
			Tool.Readonly,
			name.startsWith("list_") || name === "get_document",
		)
		.annotate(Tool.Destructive, name === "archive_document")
		.annotate(
			Tool.Idempotent,
			!["create_document", "add_comment", "reply_to_comment"].includes(name),
		)
		.annotate(Tool.OpenWorld, false)
}
function message(cause: Cause.Cause<unknown>) {
	let error = Cause.squash(cause)
	return error instanceof Error ? error.message : "Request failed"
}
