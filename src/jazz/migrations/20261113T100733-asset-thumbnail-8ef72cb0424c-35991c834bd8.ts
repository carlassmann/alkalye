import { schema as s, migration as m } from "jazz-tools"

export { migration }
let migration = m.defineMigration({
	migrate: {
		assets: {
			thumbnail: m.add.bytes({ default: null }),
		},
	},
	fromHash: "8ef72cb0424c",
	toHash: "35991c834bd8",
	from: {
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
		documentGrants: s.table(
			{
				documentId: s.uuid(),
				accountId: s.uuid(),
				role: s.enum("reader", "writer", "admin"),
			},
			{
				document: s.rel("documents", "documentId"),
			},
		),
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
		spaceMembers: s.table(
			{
				spaceId: s.uuid(),
				accountId: s.uuid(),
				role: s.enum("reader", "writer", "manager", "admin"),
			},
			{
				space: s.rel("spaces", "spaceId"),
			},
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
			{
				members: s.reverse("spaceMembers", "space"),
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
			{
				document: s.rel("documents", "documentId"),
			},
		),
	},
	to: {
		assets: s.table(
			{
				documentId: s.uuid(),
				type: s.enum("image", "video", "tldraw"),
				name: s.string(),
				data: s.bytes().optional(),
				thumbnail: s.bytes().optional(),
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
		documentGrants: s.table(
			{
				documentId: s.uuid(),
				accountId: s.uuid(),
				role: s.enum("reader", "writer", "admin"),
			},
			{
				document: s.rel("documents", "documentId"),
			},
		),
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
		spaceMembers: s.table(
			{
				spaceId: s.uuid(),
				accountId: s.uuid(),
				role: s.enum("reader", "writer", "manager", "admin"),
			},
			{
				space: s.rel("spaces", "spaceId"),
			},
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
			{
				members: s.reverse("spaceMembers", "space"),
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
			{
				document: s.rel("documents", "documentId"),
			},
		),
	},
})
