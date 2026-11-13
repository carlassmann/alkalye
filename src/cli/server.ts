import { sharingOperation } from "@/jazz/sharing/operations"
import { jazz } from "@/jazz/server"
import { summarizeComment } from "@/mcp/comments"
import { stripAssetReference } from "./asset-references"
import {
	invitationCommand,
	createInvite,
	revokeInvite,
	moveDocument,
	leaveSpace,
	leaveDocument,
} from "./sharing"
import { compileThemeSource } from "./theme-source"
import { Buffer } from "node:buffer"
import { basename, extname } from "node:path"
import { z } from "zod"
import type { Db } from "jazz-tools/backend"
import { app, type DocumentRow } from "@/jazz/schema"
import { getDocumentTitle } from "@/app/features/documents/lib/title"
import { getTags } from "@/app/features/editor/lib/frontmatter"
import { setDocumentTitle } from "./document-title"

export { executeServerCommand }

let argsSchema = z.object({
	docId: z.uuid().optional(),
	spaceId: z.uuid().optional(),
	commentId: z.uuid().optional(),
	name: z.string().min(1).optional(),
	title: z.string().min(1).optional(),
	content: z.string().optional(),
	scope: z.string().optional(),
	deleted: z.boolean().optional(),
	body: z.string().min(1).optional(),
	quote: z.string().min(1).optional(),
	from: z.number().int().nonnegative().optional(),
	to: z.number().int().nonnegative().optional(),
	assetId: z.uuid().optional(),
	file: z.string().optional(),
	data: z.string().optional(),
	themeId: z.uuid().optional(),
	sourceContent: z.string().optional(),
	role: z.enum(["reader", "writer", "manager", "admin"]).optional(),
	inviteGroupId: z.uuid().optional(),
	link: z.url().optional(),
})
type Args = z.infer<typeof argsSchema>

async function executeServerCommand(
	db: Db,
	command: string,
	raw: unknown,
	baseUrl: string,
) {
	let args = argsSchema.parse(raw)
	let accountId = db.getAuthState().session?.user
	if (!accountId) throw new Error("Authentication required")
	let now = new Date()
	if (command === "auth.signup" || command === "auth.login") {
		let profiles = await db.all(app.profiles.where({ ownerId: accountId }))
		if (!profiles.length)
			await db
				.insert(app.profiles, {
					ownerId: accountId,
					name: args.name ?? "Writer",
				})
				.wait({ tier: "global" })
		return { accountId, name: profiles[0]?.name ?? args.name ?? "Writer" }
	}
	if (command === "auth.whoami" || command === "account.show") {
		let [profiles, documents, spaces] = await Promise.all([
			db.all(app.profiles.where({ ownerId: accountId })),
			db.all(app.userDocuments.where({ ownerId: accountId })),
			db.all(app.spaces),
		])
		return {
			accountId,
			name: profiles[0]?.name ?? "Writer",
			documents: documents.length,
			spaces: spaces.length,
		}
	}
	if (command === "account.rename") {
		let profile = await db.one(app.profiles.where({ ownerId: accountId }))
		let name = required(args.name, "name")
		if (profile)
			await db
				.update(app.profiles, profile.id, { name })
				.wait({ tier: "global" })
		else
			await db
				.insert(app.profiles, { ownerId: accountId, name })
				.wait({ tier: "global" })
		return { accountId, name }
	}
	if (command.startsWith("sync."))
		return { accountId, connected: true, synced: true, serverUrl: baseUrl }
	if (command === "doc.list") {
		let [documents, entries] = await Promise.all([
			db.all(app.documents),
			db.all(app.userDocuments.where({ ownerId: accountId })),
		])
		return documents
			.filter(
				doc =>
					Boolean(doc.deletedAt) === Boolean(args.deleted) &&
					(args.scope === "all" || args.scope?.startsWith("space:")
						? args.scope === "all" || doc.spaceId === args.scope.slice(6)
						: !doc.spaceId &&
							entries.some(entry => entry.documentId === doc.id)),
			)
			.map(summarizeDocument)
	}
	if (command === "doc.create") {
		let content = required(args.content, "content")
		let spaceId = args.scope?.startsWith("space:")
			? args.scope.slice(6)
			: undefined
		let space = spaceId ? await db.one(app.spaces.where({ id: spaceId })) : null
		if (spaceId && !space) throw new Error("Space not found")
		let write = await db.transaction(tx => {
			let doc = tx.insert(app.documents, {
				ownerId: space?.ownerId ?? accountId,
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
		return summarizeDocument(write.value)
	}
	if (command.startsWith("invite."))
		return invitationCommand(accountId, command, required(args.link, "link"))
	if (command.startsWith("doc."))
		return documentCommand(db, accountId, command, args, baseUrl)
	if (command === "space.list")
		return (await db.all(app.spaces)).map(space => ({
			spaceId: space.id,
			name: space.name,
			createdAt: space.createdAt,
			updatedAt: space.updatedAt,
		}))
	if (command === "space.create") {
		let space = await db
			.insert(app.spaces, {
				ownerId: accountId,
				name: required(args.name, "name"),
				createdAt: now,
				updatedAt: now,
			})
			.wait({ tier: "global" })
		return { spaceId: space.id, name: space.name }
	}
	if (command.startsWith("space."))
		return spaceCommand(db, accountId, command, args, baseUrl)
	if (command.startsWith("theme."))
		return themeCommand(db, accountId, command, args, baseUrl)
	throw new Error(`Unknown command: ${command}`)
}

async function documentCommand(
	db: Db,
	accountId: string,
	command: string,
	args: Args,
	baseUrl: string,
): Promise<unknown> {
	let id = required(args.docId, "doc-id")
	let doc = await db.one(app.documents.where({ id }))
	if (!doc) throw new Error("Document not found")
	if (command === "doc.export") {
		let assets = await db.all(app.assets.where({ documentId: id }))
		return {
			content: doc.content,
			assets: assets.map(asset => ({
				id: asset.id,
				type: asset.type,
				mimeType: asset.mimeType,
				data: asset.data ? Buffer.from(asset.data).toString("base64") : null,
			})),
		}
	}
	if (command === "doc.get") return summarizeDocument(doc)
	if (command === "doc.content") return doc.content
	if (command === "doc.update" || command === "doc.rename") {
		let content =
			command === "doc.rename"
				? setDocumentTitle(doc.content, required(args.title, "title"))
				: required(args.content, "content")
		let updatedAt = new Date()
		let write = await db.transaction(tx =>
			tx.update(
				app.documents,
				id,
				{
					content,
					title: getDocumentTitle(content),
					tags: getTags(content),
					updatedAt,
				},
				{ editedFrom: { content: doc.content } },
			),
		)
		await write.wait({ tier: "global" })
		return summarizeDocument({ ...doc, content, updatedAt })
	}
	if (command === "doc.delete" || command === "doc.restore") {
		await db
			.update(app.documents, id, {
				deletedAt: command === "doc.delete" ? new Date() : null,
			})
			.wait({ tier: "global" })
		return { documentId: id, deleted: command === "doc.delete" }
	}
	if (command === "doc.purge") {
		await db.delete(app.documents, id).wait({ tier: "global" })
		return { documentId: id, purged: true }
	}
	if (command === "doc.move")
		return moveDocument(db, accountId, id, args.scope ?? "personal")
	if (command === "doc.share.create")
		return createInvite(
			db,
			accountId,
			{ documentId: id },
			args.role ?? "writer",
			baseUrl,
		)
	if (command === "doc.share.revoke")
		return revokeInvite(
			db,
			{ documentId: id },
			required(args.inviteGroupId, "invite-group-id"),
		)
	if (command === "doc.leave") {
		return leaveDocument(db, accountId, id)
	}
	if (command.startsWith("doc.public.")) {
		if (command !== "doc.public.link")
			await db
				.update(app.documents, id, {
					publicRead: command === "doc.public.enable",
				})
				.wait({ tier: "global" })
		return {
			documentId: id,
			public:
				command === "doc.public.link"
					? doc.publicRead
					: command === "doc.public.enable",
			link: `${baseUrl}/app/doc/${id}`,
		}
	}
	if (command.startsWith("doc.comment."))
		return commentCommand(db, accountId, command, args, doc)
	if (command === "doc.asset.list")
		return (await db.all(app.assets.where({ documentId: id }))).map(asset => ({
			assetId: asset.id,
			name: asset.name,
			type: asset.type,
			reference: `![${asset.name}](asset:${asset.id})`,
			inContent: doc.content.includes(asset.id),
			createdAt: asset.createdAt,
		}))
	if (command === "doc.asset.add") {
		let file = required(args.file, "file")
		let mimeTypes: Record<string, string> = {
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".webp": "image/webp",
			".mp4": "video/mp4",
			".webm": "video/webm",
			".mov": "video/quicktime",
		}
		let mimeType = mimeTypes[extname(file).toLowerCase()]
		if (!mimeType) throw new Error("Unsupported asset type")
		let asset = await db
			.insert(app.assets, {
				documentId: id,
				type: mimeType.startsWith("image/") ? "image" : "video",
				mimeType,
				name: args.name ?? basename(file, extname(file)),
				data: new Uint8Array(
					Buffer.from(required(args.data, "data"), "base64"),
				),
				createdAt: new Date(),
			})
			.wait({ tier: "global" })
		return {
			assetId: asset.id,
			name: asset.name,
			type: asset.type,
			reference: `![${asset.name}](asset:${asset.id})`,
		}
	}
	if (command === "doc.asset.remove") {
		let asset = await db.one(
			app.assets.where({
				id: required(args.assetId, "asset-id"),
				documentId: id,
			}),
		)
		if (!asset) throw new Error("Asset not found")
		let content = stripAssetReference(doc.content, asset.id)
		let write = await db.transaction(tx => {
			tx.delete(app.assets, asset.id)
			tx.update(
				app.documents,
				doc.id,
				{ content, updatedAt: new Date() },
				{ editedFrom: { content: doc.content } },
			)
		})
		await write.wait({ tier: "global" })
		return { assetId: asset.id, removedFromContent: content !== doc.content }
	}
	if (command.startsWith("doc.share."))
		return documentSharing(db, command, args, doc)
	throw new Error(`Unknown command: ${command}`)
}

async function spaceCommand(
	db: Db,
	accountId: string,
	command: string,
	args: Args,
	baseUrl: string,
) {
	let id = required(args.spaceId, "space-id")
	let space = await db.one(app.spaces.where({ id }))
	if (!space) throw new Error("Space not found")
	if (command === "space.get")
		return { spaceId: id, name: space.name, public: space.publicRead }
	if (command === "space.docs")
		return (
			await db.all(app.documents.where({ spaceId: id, deletedAt: null }))
		).map(summarizeDocument)
	if (command === "space.members" || command === "space.share.list")
		return db.all(app.spaceMembers.where({ spaceId: id }))
	if (command === "space.rename") {
		let name = required(args.name, "name")
		await db
			.update(app.spaces, id, { name, updatedAt: new Date() })
			.wait({ tier: "global" })
		return { spaceId: id, name }
	}
	if (command === "space.delete") {
		await db.delete(app.spaces, id).wait({ tier: "global" })
		return { spaceId: id, deleted: true }
	}
	if (command === "space.share.create")
		return createInvite(
			db,
			accountId,
			{ spaceId: id },
			args.role ?? "writer",
			baseUrl,
		)
	if (command === "space.share.revoke")
		return revokeInvite(
			db,
			{ spaceId: id },
			required(args.inviteGroupId, "invite-group-id"),
		)
	if (command === "space.leave") {
		return leaveSpace(db, accountId, id)
	}
	if (command.startsWith("space.public.")) {
		if (command !== "space.public.link")
			await db
				.update(app.spaces, id, {
					publicRead: command === "space.public.enable",
				})
				.wait({ tier: "global" })
		return {
			spaceId: id,
			public:
				command === "space.public.link"
					? space.publicRead
					: command === "space.public.enable",
			link: `${baseUrl}/app/space/${id}`,
		}
	}
	if (command === "space.share.role") {
		let member = await db.one(
			app.spaceMembers.where({
				id: required(args.inviteGroupId, "invite-group-id"),
				spaceId: id,
			}),
		)
		if (!member) throw new Error("Collaborator not found")
		await sharingOperation(
			jazz,
			accountId,
			"member-role",
			{ spaceId: id, memberId: member.id, role: required(args.role, "role") },
			"",
		)
		return { spaceId: id, accountId: member.accountId, role: args.role }
	}
	throw new Error(`Unknown command: ${command}`)
}

async function documentSharing(
	db: Db,
	command: string,
	args: Args,
	doc: DocumentRow,
) {
	if (command === "doc.share.list")
		return db.all(app.documentGrants.where({ documentId: doc.id }))
	if (command === "doc.share.role") {
		let grant = await db.one(
			app.documentGrants.where({
				id: required(args.inviteGroupId, "invite-group-id"),
				documentId: doc.id,
			}),
		)
		if (!grant) throw new Error("Collaborator not found")
		let role = z.enum(["reader", "writer"]).parse(args.role)
		await sharingOperation(
			jazz,
			db.getAuthState().session?.user ?? "",
			"grant-role",
			{ documentId: doc.id, memberId: grant.id, role },
			"",
		)
		return { documentId: doc.id, accountId: grant.accountId, role }
	}
	throw new Error(`Unknown command: ${command}`)
}

async function commentCommand(
	db: Db,
	accountId: string,
	command: string,
	args: Args,
	doc: DocumentRow,
) {
	if (command === "doc.comment.list") {
		let threads = await db.all(
			app.commentThreads.where({ documentId: doc.id, deletedAt: null }),
		)
		return Promise.all(
			threads.map(async thread => ({
				...(await summarizeComment(db, doc, thread)),
				originalQuote: z.object({ matched: z.string() }).parse(thread.anchor)
					.matched,
				deleted: false,
			})),
		)
	}
	if (command === "doc.comment.enable" || command === "doc.comment.disable") {
		await db
			.update(app.documents, doc.id, {
				commentsDisabled: command === "doc.comment.disable",
			})
			.wait({ tier: "global" })
		return { documentId: doc.id, enabled: command === "doc.comment.enable" }
	}
	let now = new Date()
	if (command === "doc.comment.add") {
		let from = args.from ?? doc.content.indexOf(required(args.quote, "quote"))
		let to = args.to ?? from + (args.quote?.length ?? 0)
		if (from < 0 || to <= from || to > doc.content.length)
			throw new Error("Quote not found in document")
		let profile = await db.one(app.profiles.where({ ownerId: accountId }))
		let write = await db.transaction(tx => {
			let thread = tx.insert(app.commentThreads, {
				documentId: doc.id,
				authorId: accountId,
				anchor: db.textAnchors().captureRange(doc.content, from, to),
				createdAt: now,
				updatedAt: now,
			})
			tx.insert(app.commentReplies, {
				threadId: thread.id,
				authorId: accountId,
				authorName: profile?.name,
				body: required(args.body, "body"),
				createdAt: now,
			})
			return thread
		})
		await write.wait({ tier: "global" })
		return summarizeComment(db, doc, write.value)
	}
	let thread = await db.one(
		app.commentThreads.where({
			id: required(args.commentId, "comment-id"),
			documentId: doc.id,
			deletedAt: null,
		}),
	)
	if (!thread) throw new Error("Comment not found")
	if (command === "doc.comment.reply") {
		let profile = await db.one(app.profiles.where({ ownerId: accountId }))
		let reply = await db
			.insert(app.commentReplies, {
				threadId: thread.id,
				authorId: accountId,
				authorName: profile?.name,
				body: required(args.body, "body"),
				createdAt: now,
			})
			.wait({ tier: "global" })
		return { ...(await summarizeComment(db, doc, thread)), replyId: reply.id }
	}
	await db
		.update(
			app.commentThreads,
			thread.id,
			command === "doc.comment.delete"
				? { deletedAt: now, updatedAt: now }
				: {
						resolvedAt: command === "doc.comment.resolve" ? now : null,
						updatedAt: now,
					},
		)
		.wait({ tier: "global" })
	return {
		...(await summarizeComment(db, doc, {
			...thread,
			resolvedAt: command === "doc.comment.resolve" ? now : null,
			updatedAt: now,
		})),
		deleted: command === "doc.comment.delete",
	}
}

async function themeCommand(
	db: Db,
	accountId: string,
	command: string,
	args: Args,
	baseUrl: string,
) {
	if (command === "theme.list")
		return db.all(app.themes.where({ ownerId: accountId }))
	if (command === "theme.resolve") {
		let themes = await db.all(app.themes.where({ ownerId: accountId }))
		let theme = themes.find(
			theme => theme.name === args.name || theme.id === args.name,
		)
		if (!theme) throw new Error("Theme not found")
		return theme
	}
	if (command === "theme.get") {
		let theme = await db.one(
			app.themes.where({
				id: required(args.themeId, "theme-id"),
				ownerId: accountId,
			}),
		)
		if (!theme) throw new Error("Theme not found")
		let source = theme.sourceDocId
			? await db.one(app.documents.where({ id: theme.sourceDocId }))
			: null
		return {
			...theme,
			themeId: theme.id,
			source: source?.content,
			workbenchUrl: `${baseUrl}/app/themes/${theme.id}`,
		}
	}
	if (command === "theme.delete") {
		await db
			.delete(app.themes, required(args.themeId, "theme-id"))
			.wait({ tier: "global" })
		return { themeId: args.themeId, deleted: true }
	}
	if (command === "theme.create" || command === "theme.update") {
		let source = required(args.sourceContent, "source")
		let compiled = compileThemeSource(source)
		let name = args.name ?? compiled.metadata?.name ?? getDocumentTitle(source)
		let now = new Date()
		let write = await db.transaction(async tx => {
			let existing =
				command === "theme.update"
					? await tx.one(
							app.themes.where({
								id: required(args.themeId, "theme-id"),
								ownerId: accountId,
							}),
						)
					: null
			if (command === "theme.update" && !existing)
				throw new Error("Theme not found")
			let content = source
			let sourceDoc = existing?.sourceDocId
				? await tx.one(app.documents.where({ id: existing.sourceDocId }))
				: null
			if (sourceDoc)
				tx.update(
					app.documents,
					sourceDoc.id,
					{ content, title: getDocumentTitle(content), updatedAt: now },
					{ editedFrom: { content: sourceDoc.content } },
				)
			else {
				sourceDoc = tx.insert(app.documents, {
					ownerId: accountId,
					content,
					title: getDocumentTitle(content),
					createdAt: now,
					updatedAt: now,
				})
				tx.insert(app.userDocuments, {
					ownerId: accountId,
					documentId: sourceDoc.id,
					rank: now.getTime(),
				})
			}
			let values = {
				name,
				css: compiled.css,
				template: compiled.template ?? null,
				slideTemplate: compiled.slideTemplate ?? null,
				author: compiled.metadata?.author ?? null,
				description: compiled.metadata?.description ?? null,
				type: compiled.metadata?.type ?? "both",
				presets: compiled.metadata?.presets ?? null,
				thumbnailDataUrl: compiled.metadata?.thumbnail ?? null,
				sourceDocId: sourceDoc.id,
				updatedAt: now,
			}
			if (existing) {
				tx.update(app.themes, existing.id, values)
				return { ...existing, ...values }
			}
			return tx.insert(app.themes, {
				...values,
				ownerId: accountId,
				createdAt: now,
			})
		})
		await write.wait({ tier: "global" })
		return {
			...write.value,
			themeId: write.value.id,
			workbenchUrl: `${baseUrl}/app/themes/${write.value.id}`,
		}
	}

	throw new Error(`Unknown command: ${command}`)
}
function required<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Missing ${label}`)
	return value
}
function summarizeDocument(doc: DocumentRow) {
	return {
		documentId: doc.id,
		title: getDocumentTitle(doc.content),
		spaceId: doc.spaceId,
		createdAt: doc.createdAt,
		updatedAt: doc.updatedAt,
		deletedAt: doc.deletedAt,
	}
}
