import { schema as s, migration as m } from "jazz-tools"

export default m.defineMigration({
	migrate: {
		documents: {
			path: m.add.string({ default: null }),
			frontmatterPinned: m.add.boolean({ default: null }),
		},
	},
	fromHash: "9864f7adaa62",
	toHash: "9e60aeadee67",
	from: {
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
				path: s.string().optional(),
				frontmatterPinned: s.boolean().optional(),
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
