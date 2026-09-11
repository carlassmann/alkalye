import { createHash } from "node:crypto"
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server"
import { z } from "zod"
import {
	getDocumentTitle,
	replaceDocumentContent,
} from "@/app/features/documents"
import { createSpaceDocument, Space } from "@/schema"
import {
	addCommentReply,
	createCommentThreadFromQuote,
	getCommentRange,
	getVisibleCommentThreads,
	reopenCommentThread,
	resolveCommentThread,
} from "@/app/features/comments"
import { setDocumentTitle } from "@/cli/document-title"
import { agentCredentialsSchema } from "./credentials"
import { getMcpConfig } from "./config"
import { openAgentAccount, runWithAgentAccount } from "./jazz"
import { toolSecurityMetadata } from "./metadata"

export { createAlkalyeServer, mcpHandler }

let documentSummarySchema = z.object({
	documentId: z.string(),
	spaceId: z.string().optional(),
	title: z.string(),
	updatedAt: z.string(),
	revision: z.string(),
})
let commentReplySchema = z.object({
	replyId: z.string(),
	body: z.string(),
	authorName: z.string().nullable(),
	createdAt: z.string(),
})
let commentSchema = z.object({
	commentId: z.string(),
	quote: z.string(),
	from: z.number().nullable(),
	to: z.number().nullable(),
	orphaned: z.boolean(),
	resolved: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
	replies: z.array(commentReplySchema),
})

let mcpHandler = createMcpHandler(
	context => createAlkalyeServer(context.authInfo?.token),
	{ responseMode: "json" },
)

function createAlkalyeServer(credential: string | undefined) {
	let server = new McpServer(
		{
			name: "alkalye",
			version: "0.1.0",
			websiteUrl: "https://www.alkalye.com",
		},
		{
			instructions:
				"Collaborate only in documents and spaces explicitly shared with this agent. Read before editing and pass the returned revision to every update.",
		},
	)

	server.registerTool(
		"list_documents",
		{
			title: "List documents",
			description:
				"List documents and spaces the user explicitly shared with this Alkalye agent.",
			inputSchema: z.object({}),
			...toolMetadata(
				z.object({
					personal: z.array(documentSummarySchema),
					spaces: z.array(
						z.object({
							spaceId: z.string(),
							name: z.string(),
							documents: z.array(documentSummarySchema),
						}),
					),
				}),
			),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async () =>
			withAgent(credential, async account => {
				let loaded = await account.$jazz.ensureLoaded({
					resolve: {
						root: {
							documents: { $each: { content: true } },
							spaces: {
								$each: { documents: { $each: { content: true } } },
							},
						},
					},
				})
				let personal = loaded.root.documents.flatMap(document =>
					document?.$isLoaded && !document.deletedAt
						? [documentSummary(document, undefined)]
						: [],
				)
				let spaces = (loaded.root.spaces ?? []).flatMap(space =>
					space?.$isLoaded
						? [
								{
									spaceId: space.$jazz.id,
									name: space.name,
									documents: space.documents.flatMap(document =>
										document?.$isLoaded && !document.deletedAt
											? [documentSummary(document, space.$jazz.id)]
											: [],
									),
								},
							]
						: [],
				)
				return toolResult({ personal, spaces })
			}),
	)

	server.registerTool(
		"get_document",
		{
			title: "Read document",
			description:
				"Read a shared Alkalye document, including its current revision for conflict-safe editing.",
			inputSchema: z.object({ documentId: z.string() }),
			...toolMetadata(
				z.object({
					documentId: z.string(),
					title: z.string(),
					content: z.string(),
					revision: z.string(),
					updatedAt: z.string(),
				}),
			),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ documentId }) =>
			withAgent(credential, async account => {
				let document = await findAgentDocument(account, documentId)
				let content = document.content.toString()
				return toolResult({
					documentId,
					title: getDocumentTitle(content),
					content,
					revision: documentRevision(content),
					updatedAt: document.updatedAt.toISOString(),
				})
			}),
	)

	server.registerTool(
		"update_document",
		{
			title: "Update document",
			description:
				"Replace a shared document only if its revision still matches the last read. Preserves anchored comments.",
			inputSchema: z.object({
				documentId: z.string(),
				content: z.string(),
				expectedRevision: z.string(),
			}),
			...toolMetadata(
				z.object({
					documentId: z.string(),
					revision: z.string(),
					updatedAt: z.string(),
				}),
			),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		async ({ documentId, content, expectedRevision }) =>
			withAgent(credential, async (account, sync) => {
				let document = await findAgentDocument(account, documentId)
				let currentContent = document.content.toString()
				if (documentRevision(currentContent) !== expectedRevision) {
					return toolError(
						"Document changed since it was read. Read it again before editing.",
					)
				}
				if (!(await replaceDocumentContent(document, content))) {
					return toolError("Document is being edited. Try again shortly.")
				}
				document.$jazz.set("updatedAt", new Date())
				await sync()
				return toolResult({
					documentId,
					revision: documentRevision(content),
					updatedAt: document.updatedAt.toISOString(),
				})
			}),
	)

	server.registerTool(
		"create_document",
		{
			title: "Create document",
			description:
				"Create a document in a shared space. The agent cannot create outside spaces the user granted.",
			inputSchema: z.object({
				spaceId: z.string(),
				content: z.string(),
			}),
			...toolMetadata(
				z.object({
					documentId: z.string(),
					spaceId: z.string(),
					title: z.string(),
					revision: z.string(),
				}),
			),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		async ({ spaceId, content }) =>
			withAgent(credential, async (account, sync) => {
				let loaded = await account.$jazz.ensureLoaded({
					resolve: { root: { spaces: { $each: { documents: true } } } },
				})
				let space = (loaded.root.spaces ?? []).find(
					candidate => candidate?.$jazz.id === spaceId,
				)
				if (!space?.$isLoaded) throw new Error("Space not found")
				let writableSpace = await Space.load(spaceId, {
					resolve: { documents: true },
					loadAs: account,
				})
				if (!writableSpace.$isLoaded) throw new Error("Space is unavailable")
				let document = createSpaceDocument(
					writableSpace.$jazz.owner,
					writableSpace.$jazz.id,
					content,
				)
				writableSpace.documents.$jazz.push(document)
				await sync()
				return toolResult({
					documentId: document.$jazz.id,
					spaceId,
					title: getDocumentTitle(content),
					revision: documentRevision(content),
				})
			}),
	)

	server.registerTool(
		"rename_document",
		{
			title: "Rename document",
			description:
				"Change a shared document's Markdown title using a conflict-safe revision check.",
			inputSchema: z.object({
				documentId: z.string(),
				title: z.string().min(1).max(200),
				expectedRevision: z.string(),
			}),
			...toolMetadata(
				z.object({
					documentId: z.string(),
					title: z.string(),
					revision: z.string(),
				}),
			),
			annotations: writeAnnotations(false),
		},
		async ({ documentId, title, expectedRevision }) =>
			withAgent(credential, async (account, sync) => {
				let document = await findAgentDocument(account, documentId)
				let content = document.content.toString()
				if (documentRevision(content) !== expectedRevision) {
					return toolError(
						"Document changed since it was read. Read it again before renaming.",
					)
				}
				let nextContent = setDocumentTitle(content, title)
				if (!(await replaceDocumentContent(document, nextContent))) {
					return toolError("Document is being edited. Try again shortly.")
				}
				document.$jazz.set("updatedAt", new Date())
				await sync()
				return toolResult({
					documentId,
					title,
					revision: documentRevision(nextContent),
				})
			}),
	)

	server.registerTool(
		"archive_document",
		{
			title: "Archive document",
			description:
				"Archive a shared document. The document remains recoverable by an administrator.",
			inputSchema: z.object({ documentId: z.string() }),
			...toolMetadata(
				z.object({ documentId: z.string(), archived: z.literal(true) }),
			),
			annotations: writeAnnotations(true),
		},
		async ({ documentId }) =>
			withAgent(credential, async (account, sync) => {
				let document = await findAgentDocument(account, documentId)
				document.$jazz.set("deletedAt", new Date())
				document.$jazz.set("updatedAt", new Date())
				await sync()
				return toolResult({ documentId, archived: true })
			}),
	)

	server.registerTool(
		"list_comments",
		{
			title: "List comments",
			description:
				"List visible comment threads and replies on a shared document.",
			inputSchema: z.object({ documentId: z.string() }),
			...toolMetadata(
				z.object({
					documentId: z.string(),
					comments: z.array(commentSchema),
				}),
			),
			annotations: readAnnotations(),
		},
		async ({ documentId }) =>
			withAgent(credential, async account => {
				let document = await findAgentDocument(account, documentId)
				return toolResult({
					documentId,
					comments: getVisibleCommentThreads(document).map(thread =>
						summarizeComment(document, thread),
					),
				})
			}),
	)

	server.registerTool(
		"add_comment",
		{
			title: "Add comment",
			description:
				"Add a comment anchored to an exact quote in a shared document.",
			inputSchema: z.object({
				documentId: z.string(),
				quote: z.string().min(1),
				body: z.string().min(1),
			}),
			...toolMetadata(commentSchema),
			annotations: writeAnnotations(false),
		},
		async ({ documentId, quote, body }) =>
			withAgent(credential, async (account, sync) => {
				let document = await findAgentDocument(account, documentId)
				let profile = await account.$jazz.ensureLoaded({
					resolve: { profile: true },
				})
				let thread = createCommentThreadFromQuote(
					document,
					quote,
					body,
					profile.profile.name,
				)
				if (!thread) return toolError("Quote not found in document")
				await sync()
				return toolResult(summarizeComment(document, thread))
			}),
	)

	server.registerTool(
		"reply_to_comment",
		{
			title: "Reply to comment",
			description: "Reply to a visible comment thread on a shared document.",
			inputSchema: z.object({
				documentId: z.string(),
				commentId: z.string(),
				body: z.string().min(1),
			}),
			...toolMetadata(commentSchema),
			annotations: writeAnnotations(false),
		},
		async ({ documentId, commentId, body }) =>
			withAgent(credential, async (account, sync) => {
				let document = await findAgentDocument(account, documentId)
				let thread = findComment(document, commentId)
				let profile = await account.$jazz.ensureLoaded({
					resolve: { profile: true },
				})
				addCommentReply(thread, body, profile.profile.name)
				await sync()
				return toolResult(summarizeComment(document, thread))
			}),
	)

	server.registerTool(
		"set_comment_resolved",
		{
			title: "Resolve or reopen comment",
			description: "Resolve or reopen a visible comment thread.",
			inputSchema: z.object({
				documentId: z.string(),
				commentId: z.string(),
				resolved: z.boolean(),
			}),
			...toolMetadata(commentSchema),
			annotations: writeAnnotations(false),
		},
		async ({ documentId, commentId, resolved }) =>
			withAgent(credential, async (account, sync) => {
				let document = await findAgentDocument(account, documentId)
				let thread = findComment(document, commentId)
				if (resolved) resolveCommentThread(thread)
				else reopenCommentThread(thread)
				await sync()
				return toolResult(summarizeComment(document, thread))
			}),
	)

	server.registerTool(
		"rename_space",
		{
			title: "Rename space",
			description: "Rename a shared space when the agent has write access.",
			inputSchema: z.object({
				spaceId: z.string(),
				name: z.string().min(1).max(100),
			}),
			...toolMetadata(z.object({ spaceId: z.string(), name: z.string() })),
			annotations: writeAnnotations(false),
		},
		async ({ spaceId, name }) =>
			withAgent(credential, async (account, sync) => {
				let loaded = await account.$jazz.ensureLoaded({
					resolve: { root: { spaces: true } },
				})
				let reference = (loaded.root.spaces ?? []).find(
					space => space?.$jazz.id === spaceId,
				)
				if (!reference) throw new Error("Space not found")
				let space = await Space.load(spaceId, { loadAs: account })
				if (!space.$isLoaded) throw new Error("Space is unavailable")
				space.$jazz.set("name", name)
				space.$jazz.set("updatedAt", new Date())
				await sync()
				return toolResult({ spaceId, name })
			}),
	)

	return server
}

async function withAgent(
	credential: string | undefined,
	operation: (
		account: Awaited<ReturnType<typeof openAgentAccount>>["account"],
		sync: () => Promise<void>,
	) => Promise<ReturnType<typeof toolResult> | ReturnType<typeof toolError>>,
) {
	if (!credential) return authenticationRequired()
	let config = getMcpConfig()
	try {
		let credentials = await config.tokens.open(
			"connection",
			credential,
			agentCredentialsSchema,
		)
		return await runWithAgentAccount(
			config.syncServer,
			credentials,
			async agent => {
				await agent.account.$jazz.waitForAllCoValuesSync({ timeout: 10_000 })
				return operation(agent.account, async () => {
					await agent.account.$jazz.waitForAllCoValuesSync({ timeout: 10_000 })
				})
			},
		)
	} catch (error) {
		if (!isPublicToolError(error)) console.error("[mcp] tool failed", error)
		return toolError(publicToolError(error))
	}
}

async function findAgentDocument(
	account: Awaited<ReturnType<typeof openAgentAccount>>["account"],
	documentId: string,
) {
	let loaded = await account.$jazz.ensureLoaded({
		resolve: {
			root: {
				documents: true,
				spaces: { $each: { documents: true } },
			},
		},
	})
	let candidates = [
		...loaded.root.documents,
		...(loaded.root.spaces ?? []).flatMap(space =>
			space?.$isLoaded ? [...space.documents] : [],
		),
	]
	let reference = candidates.find(document => document?.$jazz.id === documentId)
	if (!reference) throw new Error("Document not found")
	let document = await reference.$jazz.ensureLoaded({
		resolve: { content: true, comments: { $each: { replies: true } } },
	})
	if (!document.$isLoaded) throw new Error("Document is unavailable")
	if (document.deletedAt) throw new Error("Document is archived")
	return document
}

function documentSummary(
	document: {
		$jazz: { id: string }
		content: { toString(): string }
		updatedAt: Date
	},
	spaceId: string | undefined,
) {
	let content = document.content.toString()
	let summary = {
		documentId: document.$jazz.id,
		title: getDocumentTitle(content),
		updatedAt: document.updatedAt.toISOString(),
		revision: documentRevision(content),
	}
	return spaceId ? { ...summary, spaceId } : summary
}

function publicToolError(error: unknown) {
	if (!isPublicToolError(error)) {
		return "The requested action could not be completed. Check the agent's access and try again."
	}
	return error.message
}

function isPublicToolError(error: unknown): error is Error {
	if (!(error instanceof Error)) return false
	let safeMessages = new Set([
		"Space not found",
		"Space is unavailable",
		"Document not found",
		"Document is unavailable",
		"Document is archived",
		"Comment not found",
	])
	return safeMessages.has(error.message)
}

function documentRevision(content: string) {
	return createHash("sha256").update(content).digest("base64url")
}

function findComment(
	document: Awaited<ReturnType<typeof findAgentDocument>>,
	commentId: string,
) {
	let thread = getVisibleCommentThreads(document).find(
		candidate => candidate.$jazz.id === commentId,
	)
	if (!thread) throw new Error("Comment not found")
	return thread
}

function summarizeComment(
	document: Awaited<ReturnType<typeof findAgentDocument>>,
	thread: ReturnType<typeof getVisibleCommentThreads>[number],
) {
	let range = getCommentRange(document, thread.anchor)
	let replies = Array.from(thread.replies.values()).flatMap(reply =>
		reply?.$isLoaded && !reply.deletedAt
			? [
					{
						replyId: reply.$jazz.id,
						body: reply.body,
						authorName: reply.authorName ?? null,
						createdAt: reply.createdAt.toISOString(),
					},
				]
			: [],
	)
	return {
		commentId: thread.$jazz.id,
		quote: thread.anchor.quote,
		from: range.orphaned ? null : range.from,
		to: range.orphaned ? null : range.to,
		orphaned: range.orphaned,
		resolved: Boolean(thread.resolvedAt),
		createdAt: thread.createdAt.toISOString(),
		updatedAt: thread.updatedAt.toISOString(),
		replies,
	}
}

function readAnnotations() {
	return {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	}
}

function writeAnnotations(destructive: boolean) {
	return {
		readOnlyHint: false,
		destructiveHint: destructive,
		idempotentHint: false,
		openWorldHint: false,
	}
}

function toolMetadata<Output extends z.ZodType>(outputSchema: Output) {
	return {
		outputSchema,
		_meta: toolSecurityMetadata(),
	}
}

function toolResult(data: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data) }],
		structuredContent: data,
	}
}

function toolError(message: string) {
	return {
		isError: true,
		content: [{ type: "text" as const, text: message }],
	}
}

function authenticationRequired() {
	let { baseUrl } = getMcpConfig()
	let metadata = new URL(
		"/.well-known/oauth-protected-resource",
		baseUrl,
	).toString()
	return {
		...toolError("Authentication required"),
		_meta: { "mcp/www_authenticate": `Bearer resource_metadata="${metadata}"` },
	}
}
