import { schema as s } from "jazz-tools"
import { EditorSettings } from "./value-types"

export { app }
export type { DocumentRow, UserDocumentRow }

let schema = {
	documents: s.table(
		{
			ownerId: s.uuid(),
			spaceId: s.uuid().optional(),
			title: s.string(),
			content: s.string().merge("markdown"),
			tags: s.array(s.string()).default([]),
			isPresentation: s.boolean().default(false),
			publicRead: s.boolean().default(false),
			commentsDisabled: s.boolean().default(false),
			presentationLine: s.int().optional(),
			highlightRange: s.json().optional(),
			createdAt: s.timestamp(),
			updatedAt: s.timestamp(),
			deletedAt: s.timestamp().optional(),
		},
		{
			space: s.rel("spaces", "spaceId"),
			grants: s.reverse("documentGrants", "document"),
		},
	),
	userDocuments: s.table(
		{
			ownerId: s.uuid(),
			documentId: s.uuid(),
			folderId: s.uuid().optional(),
			rank: s.float(),
			pinned: s.boolean().default(false),
			archived: s.boolean().default(false),
		},
		{
			document: s.rel("documents", "documentId"),
			folder: s.rel("folders", "folderId"),
		},
	),
	folders: s.table(
		{
			ownerId: s.uuid(),
			parentId: s.uuid().optional(),
			name: s.string(),
			rank: s.float(),
		},
		{ parent: s.rel("folders", "parentId") },
	),
	spaces: s.table(
		{
			ownerId: s.uuid(),
			name: s.string(),
			avatar: s.bytes().optional(),
			publicRead: s.boolean().default(false),
			createdAt: s.timestamp(),
			updatedAt: s.timestamp(),
		},
		{ members: s.reverse("spaceMembers", "space") },
	),
	spaceMembers: s.table(
		{
			spaceId: s.uuid(),
			accountId: s.uuid(),
			inviteId: s.uuid().optional(),
			role: s.enum("reader", "writer", "manager", "admin"),
		},
		{ space: s.rel("spaces", "spaceId") },
	),
	documentGrants: s.table(
		{
			documentId: s.uuid(),
			accountId: s.uuid(),
			inviteId: s.uuid().optional(),
			role: s.enum("reader", "writer", "admin"),
		},
		{ document: s.rel("documents", "documentId") },
	),
	invites: s.table(
		{
			ownerId: s.uuid(),
			documentId: s.uuid().optional(),
			spaceId: s.uuid().optional(),
			tokenHash: s.string(),
			singleUse: s.boolean().default(false),
			role: s.enum("reader", "writer", "manager", "admin"),
			expiresAt: s.timestamp().optional(),
			redeemedAt: s.timestamp().optional(),
			revokedAt: s.timestamp().optional(),
		},
		{
			document: s.rel("documents", "documentId"),
			space: s.rel("spaces", "spaceId"),
		},
	),
	commentThreads: s.table(
		{
			documentId: s.uuid(),
			authorId: s.uuid(),
			anchor: s.json(),
			resolvedAt: s.timestamp().optional(),
			deletedAt: s.timestamp().optional(),
			createdAt: s.timestamp(),
			updatedAt: s.timestamp(),
		},
		{ document: s.rel("documents", "documentId") },
	),
	commentReplies: s.table(
		{
			threadId: s.uuid(),
			authorId: s.uuid(),
			authorName: s.string().optional(),
			body: s.string().merge("markdown"),
			createdAt: s.timestamp(),
			updatedAt: s.timestamp().optional(),
			deletedAt: s.timestamp().optional(),
		},
		{ thread: s.rel("commentThreads", "threadId") },
	),
	presence: s
		.table(
			{
				documentId: s.uuid(),
				accountId: s.uuid(),
				deviceId: s.string(),
				cursor: s.json().optional(),
				selection: s.json().optional(),
				whiteboardOpen: s.boolean().default(false),
				updatedAt: s.timestamp(),
			},
			{ document: s.rel("documents", "documentId") },
		)
		.history("latest"),
	laser: s
		.table(
			{
				ownerId: s.uuid(),
				documentId: s.uuid(),
				senderId: s.string(),
				sequence: s.int(),
				message: s.json(),
				updatedAt: s.timestamp(),
			},
			{ document: s.rel("documents", "documentId") },
		)
		.history("latest"),
	assets: s.table(
		{
			documentId: s.uuid(),
			type: s.enum("image", "video", "tldraw"),
			name: s.string(),
			data: s.bytes().optional(),
			mimeType: s.string().optional(),
			muteAudio: s.boolean().default(false),
			width: s.int().optional(),
			height: s.int().optional(),
			revisionId: s.uuid().optional(),
			createdAt: s.timestamp(),
		},
		{
			document: s.rel("documents", "documentId"),
			revision: s.rel("tldrawRevisions", "revisionId"),
		},
	),
	tldrawRevisions: s.table(
		{
			documentId: s.uuid(),
			snapshot: s.bytes(),
			lightPreview: s.bytes(),
			darkPreview: s.bytes(),
			createdAt: s.timestamp(),
		},
		{ document: s.rel("documents", "documentId") },
	),
	themes: s.table(
		{
			ownerId: s.uuid(),
			name: s.string(),
			author: s.string().optional(),
			description: s.string().optional(),
			type: s.enum("preview", "slideshow", "both"),
			css: s.string().merge("text"),
			template: s.string().optional(),
			slideTemplate: s.string().optional(),
			sourceDocId: s.uuid().optional(),
			presets: s.json().optional(),
			thumbnail: s.bytes().optional(),
			thumbnailDataUrl: s.string().optional(),
			createdAt: s.timestamp(),
			updatedAt: s.timestamp(),
		},
		{ sourceDocument: s.rel("documents", "sourceDocId") },
	),
	themeAssets: s.table(
		{
			themeId: s.uuid(),
			name: s.string(),
			mimeType: s.string(),
			data: s.bytes(),
			createdAt: s.timestamp(),
		},
		{ theme: s.rel("themes", "themeId") },
	),
	settings: s.table(
		{
			ownerId: s.uuid(),
			editor: s.json(EditorSettings),
			defaultPreviewTheme: s.uuid().optional(),
			defaultSlideshowTheme: s.uuid().optional(),
			syntaxTheme: s.string().optional(),
			language: s.enum("de", "en").default("en"),
		},
		{
			previewTheme: s.rel("themes", "defaultPreviewTheme"),
			slideshowTheme: s.rel("themes", "defaultSlideshowTheme"),
		},
	),
	profiles: s.table({ ownerId: s.uuid(), name: s.string() }, {}),
	agentConnections: s.table(
		{
			ownerId: s.uuid(),
			provider: s.enum("openai", "anthropic"),
			accountId: s.string(),
			credential: s.string(),
			personalDocumentsRole: s.enum("reader", "writer").optional(),
			createdAt: s.timestamp(),
			revokedAt: s.timestamp().optional(),
		},
		{},
	),
	mcpConnections: s.table(
		{
			ownerId: s.uuid(),
			clientId: s.string(),
			clientName: s.string(),
			credential: s.string(),
			createdAt: s.timestamp(),
			revokedAt: s.timestamp().optional(),
		},
		{},
	),
	classicImports: s.table(
		{
			ownerId: s.uuid(),
			classicId: s.string(),
			v2Id: s.uuid(),
			kind: s.string(),
			status: s.enum("pending", "complete", "failed"),
			importedAt: s.timestamp().optional(),
			error: s.string().optional(),
		},
		{},
	),
	documentVersions: s.table(
		{
			documentId: s.uuid(),
			content: s.string(),
			authorId: s.string(),
			authorName: s.string().optional(),
			createdAt: s.timestamp(),
			classicId: s.string().optional(),
		},
		{ document: s.rel("documents", "documentId") },
	),
}

type AppSchema = s.Schema<typeof schema>
let app: s.App<AppSchema> = s.defineApp(schema, { migrations: "none" })
type DocumentRow = s.RowOf<typeof app.documents>
type UserDocumentRow = s.RowOf<typeof app.userDocuments>
