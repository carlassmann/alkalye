import { findComment, summarizeComment } from "./comments"
import { createHash } from "node:crypto"
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server"
import { z } from "zod"
import { app, type DocumentRow } from "@/jazz/schema"
import type { Db } from "jazz-tools/backend"
import { getDocumentTitle } from "@/app/features/documents"
import { getTags } from "@/app/features/editor"
import { setDocumentTitle } from "@/cli/document-title"
import { getMcpConfig } from "./config"
import { runWithUserAccount } from "./jazz"
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
	{ legacy: "reject", responseMode: "json" },
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
				"Act as the connected user, with their existing Jazz permissions. Read before editing and pass the returned revision to every update.",
		},
	)

	server.registerTool(
		"list_documents",
		{
			title: "List documents",
			description: "List the connected user’s documents and spaces.",
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
			withUser(credential, async (db, accountId) => {
				let [documents, entries, spaces] = await Promise.all([
					db.all(app.documents),
					db.all(app.userDocuments.where({ ownerId: accountId })),
					db.all(app.spaces),
				])
				let personal = documents
					.filter(
						doc =>
							!doc.deletedAt &&
							!doc.spaceId &&
							entries.some(entry => entry.documentId === doc.id),
					)
					.map(doc => documentSummary(doc, undefined))
				return toolResult({
					personal,
					spaces: spaces.map(space => ({
						spaceId: space.id,
						name: space.name,
						documents: documents
							.filter(doc => !doc.deletedAt && doc.spaceId === space.id)
							.map(doc => documentSummary(doc, space.id)),
					})),
				})
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
			withUser(credential, async db => {
				let document = await findUserDocument(db, documentId)
				return toolResult({
					documentId,
					title: getDocumentTitle(document.content),
					content: document.content,
					revision: documentRevision(document.content),
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
			withUser(credential, async db => {
				let document = await findUserDocument(db, documentId)
				if (documentRevision(document.content) !== expectedRevision)
					return toolError(
						"Document changed since it was read. Read it again before editing.",
					)
				let updatedAt = await replaceContent(db, document, content)
				return toolResult({
					documentId,
					revision: documentRevision(content),
					updatedAt: updatedAt.toISOString(),
				})
			}),
	)

	server.registerTool(
		"create_document",
		{
			title: "Create document",
			description:
				"Create a personal document, or pass spaceId to create in one of the user’s spaces.",
			inputSchema: z.object({
				spaceId: z.string().optional(),
				content: z.string(),
			}),
			...toolMetadata(
				z.object({
					documentId: z.string(),
					spaceId: z.string().optional(),
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
			withUser(credential, async (db, accountId) => {
				if (spaceId && !(await db.one(app.spaces.where({ id: spaceId }))))
					throw new Error("Space not found")
				let write = await db.transaction(tx => {
					let now = new Date()
					let doc = tx.insert(app.documents, {
						ownerId: accountId,
						spaceId,
						content,
						title: getDocumentTitle(content),
						tags: getTags(content),
						createdAt: now,
						updatedAt: now,
					})
					if (!spaceId)
						tx.insert(app.userDocuments, {
							ownerId: accountId,
							documentId: doc.id,
							rank: now.getTime(),
						})
					return doc
				})
				await write.wait({ tier: "global" })
				return toolResult({
					documentId: write.value.id,
					...(spaceId ? { spaceId } : {}),
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
			withUser(credential, async db => {
				let document = await findUserDocument(db, documentId)
				if (documentRevision(document.content) !== expectedRevision)
					return toolError(
						"Document changed since it was read. Read it again before renaming.",
					)
				let content = setDocumentTitle(document.content, title)
				await replaceContent(db, document, content)
				return toolResult({
					documentId,
					title,
					revision: documentRevision(content),
				})
			}),
	)

	server.registerTool(
		"archive_document",
		{
			title: "Archive document",
			description: "Archive a document you administer. It remains recoverable.",
			inputSchema: z.object({ documentId: z.string() }),
			...toolMetadata(
				z.object({ documentId: z.string(), archived: z.literal(true) }),
			),
			annotations: writeAnnotations(true),
		},
		async ({ documentId }) =>
			withUser(credential, async db => {
				let document = await findUserDocument(db, documentId)
				await db
					.update(app.documents, document.id, { deletedAt: new Date() })
					.wait({ tier: "global" })
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
			withUser(credential, async db => {
				let document = await findUserDocument(db, documentId)
				let threads = await db.all(
					app.commentThreads.where({ documentId, deletedAt: null }),
				)
				return toolResult({
					documentId,
					comments: await Promise.all(
						threads.map(thread => summarizeComment(db, document, thread)),
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
			withUser(credential, async (db, accountId) => {
				let document = await findUserDocument(db, documentId)
				let start = document.content.indexOf(quote)
				if (start < 0) return toolError("Quote not found in document")
				let anchor = db
					.textAnchors()
					.captureRange(document.content, start, start + quote.length)
				let profile = await db.one(app.profiles.where({ ownerId: accountId }))
				let write = await db.transaction(tx => {
					let now = new Date()
					let thread = tx.insert(app.commentThreads, {
						documentId,
						authorId: accountId,
						anchor,
						createdAt: now,
						updatedAt: now,
					})
					tx.insert(app.commentReplies, {
						threadId: thread.id,
						authorId: accountId,
						authorName: profile?.name,
						body,
						createdAt: now,
					})
					return thread
				})
				await write.wait({ tier: "global" })
				return toolResult(
					await summarizeComment(
						db,
						document,
						await findComment(db, documentId, write.value.id),
					),
				)
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
			withUser(credential, async (db, accountId) => {
				let document = await findUserDocument(db, documentId)
				let thread = await findComment(db, documentId, commentId)
				let profile = await db.one(app.profiles.where({ ownerId: accountId }))
				let now = new Date()
				let write = await db.transaction(tx => {
					tx.insert(app.commentReplies, {
						threadId: thread.id,
						authorId: accountId,
						authorName: profile?.name,
						body,
						createdAt: now,
					})
					tx.update(app.commentThreads, thread.id, { updatedAt: now })
					return { ...thread, updatedAt: now }
				})
				await write.wait({ tier: "global" })
				return toolResult(await summarizeComment(db, document, write.value))
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
			withUser(credential, async db => {
				let document = await findUserDocument(db, documentId)
				let thread = await findComment(db, documentId, commentId)
				let next = {
					...thread,
					resolvedAt: resolved ? new Date() : null,
					updatedAt: new Date(),
				}
				await db
					.update(app.commentThreads, thread.id, {
						resolvedAt: next.resolvedAt,
						updatedAt: next.updatedAt,
					})
					.wait({ tier: "global" })
				return toolResult(await summarizeComment(db, document, next))
			}),
	)

	server.registerTool(
		"rename_space",
		{
			title: "Rename space",
			description: "Rename a space when you have write access.",
			inputSchema: z.object({
				spaceId: z.string(),
				name: z.string().min(1).max(100),
			}),
			...toolMetadata(z.object({ spaceId: z.string(), name: z.string() })),
			annotations: writeAnnotations(false),
		},
		async ({ spaceId, name }) =>
			withUser(credential, async db => {
				let space = await db.one(app.spaces.where({ id: spaceId }))
				if (!space) throw new Error("Space not found")
				await db
					.update(app.spaces, space.id, { name, updatedAt: new Date() })
					.wait({ tier: "global" })
				return toolResult({ spaceId, name })
			}),
	)

	return server
}

async function withUser(
	credential: string | undefined,
	operation: (
		db: Db,
		accountId: string,
	) => Promise<ReturnType<typeof toolResult> | ReturnType<typeof toolError>>,
) {
	if (!credential) return authenticationRequired()
	try {
		return await runWithUserAccount(
			credential,
			getMcpConfig().tokens,
			operation,
		)
	} catch (error) {
		if (!isPublicToolError(error)) console.error("[mcp] tool failed", error)
		return toolError(publicToolError(error))
	}
}

async function findUserDocument(db: Db, documentId: string) {
	let document = await db.one(app.documents.where({ id: documentId }))
	if (!document) throw new Error("Document not found")
	if (document.deletedAt) throw new Error("Document is archived")
	return document
}

async function replaceContent(db: Db, document: DocumentRow, content: string) {
	let updatedAt = new Date()
	let write = await db.serializableTransaction(async tx => {
		let current = await tx.one(app.documents.where({ id: document.id }))
		if (
			!current ||
			documentRevision(current.content) !== documentRevision(document.content)
		)
			throw new Error(
				"Document changed since it was read. Read it again before editing.",
			)
		tx.update(
			app.documents,
			document.id,
			{
				content,
				title: getDocumentTitle(content),
				tags: getTags(content),
				updatedAt,
			},
			{ editedFrom: { content: document.content } },
		)
	})
	await write.wait()
	return updatedAt
}

function documentSummary(document: DocumentRow, spaceId: string | undefined) {
	return {
		documentId: document.id,
		...(spaceId ? { spaceId } : {}),
		title: getDocumentTitle(document.content),
		updatedAt: document.updatedAt.toISOString(),
		revision: documentRevision(document.content),
	}
}

function publicToolError(error: unknown) {
	if (!isPublicToolError(error)) {
		return "The requested action could not be completed. Check your permissions and try again."
	}
	return error.message
}

function isPublicToolError(error: unknown): error is Error {
	if (!(error instanceof Error)) return false
	let safeMessages = new Set([
		"You do not have write access",
		"MCP connection is disconnected",
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
