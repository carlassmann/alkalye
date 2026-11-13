import { schema as s, migration as m } from "jazz-tools"

export { migration }
let migration = m.defineMigration({
	migrate: {
		spaceMembers: {
			inviteId: m.add.uuid({ default: null }),
		},

		documentGrants: {
			inviteId: m.add.uuid({ default: null }),
		},

		invites: {
			singleUse: m.add.boolean({ default: false }),
		},
	},
	fromHash: "35991c834bd8",
	toHash: "9864f7adaa62",
	from: {
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
		invites: s.table(
			{
				ownerId: s.uuid(),
				documentId: s.uuid().optional(),
				spaceId: s.uuid().optional(),
				tokenHash: s.string(),
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
	},
	to: {
		documentGrants: s.table(
			{
				documentId: s.uuid(),
				accountId: s.uuid(),
				inviteId: s.uuid().optional(),
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
		spaceMembers: s.table(
			{
				spaceId: s.uuid(),
				accountId: s.uuid(),
				inviteId: s.uuid().optional(),
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
	},
})
