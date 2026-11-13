import { schema as s, type RowContext } from "jazz-tools"
import { app, type DocumentRow } from "./schema"

export let permissions = s.definePermissions(
	app,
	({ policy, session, anyOf, allOf, allowedTo }) => {
		let owned = { ownerId: session.user }
		function spaceAdmin(space: RowContext<s.RowOf<typeof app.spaces>>) {
			return anyOf([
				owned,
				policy.spaceMembers.exists.where({
					spaceId: space.id,
					accountId: session.user,
					role: "admin",
				}),
			])
		}
		policy.spaces.allowRead.where(space =>
			anyOf([
				owned,
				{ publicRead: true },
				policy.spaceMembers.exists.where({
					spaceId: space.id,
					accountId: session.user,
				}),
			]),
		)
		policy.spaces.allowInsert.where(owned)
		policy.spaces.allowUpdate.where(space =>
			allOf([
				spaceAdmin(space),
				policy.spaces.exists.where({ id: space.id, ownerId: space.ownerId }),
			]),
		)
		policy.spaces.allowDelete.where(spaceAdmin)
		policy.spaceMembers.allowRead.where(allowedTo.read("space"))
		policy.spaceMembers.allowInsert.where(allowedTo.update("space"))
		policy.spaceMembers.allowUpdate.where(allowedTo.update("space"))
		policy.spaceMembers.allowDelete.where(allowedTo.update("space"))

		function documentAdmin(doc: RowContext<DocumentRow>) {
			return anyOf([
				owned,
				policy.documentGrants.exists.where({
					documentId: doc.id,
					accountId: session.user,
					role: "admin",
				}),
				policy.spaces.exists.where({ id: doc.spaceId, ownerId: session.user }),
				policy.spaceMembers.exists.where({
					spaceId: doc.spaceId,
					accountId: session.user,
					role: "admin",
				}),
			])
		}
		function documentWriter(doc: RowContext<DocumentRow>) {
			return anyOf([
				owned,
				policy.documentGrants.exists.where({
					documentId: doc.id,
					accountId: session.user,
					role: { in: ["writer", "admin"] },
				}),
				policy.spaces.exists.where({ id: doc.spaceId, ownerId: session.user }),
				policy.spaceMembers.exists.where({
					spaceId: doc.spaceId,
					accountId: session.user,
					role: { in: ["writer", "manager", "admin"] },
				}),
			])
		}
		policy.documents.allowRead.where(doc =>
			anyOf([
				owned,
				{ publicRead: true },
				allowedTo.read("space"),
				policy.documentGrants.exists.where({
					documentId: doc.id,
					accountId: session.user,
				}),
			]),
		)
		policy.documents.allowInsert.where(doc =>
			allOf([
				owned,
				anyOf([
					{ spaceId: null },
					policy.spaces.exists.where({
						id: doc.spaceId,
						ownerId: session.user,
					}),
					policy.spaceMembers.exists.where({
						spaceId: doc.spaceId,
						accountId: session.user,
						role: { in: ["writer", "manager", "admin"] },
					}),
				]),
			]),
		)
		policy.documents.allowUpdate.where(doc =>
			allOf([
				documentWriter(doc),
				policy.documents.exists.where({
					id: doc.id,
					ownerId: doc.ownerId,
					spaceId: doc.spaceId,
				}),
				anyOf([
					documentAdmin(doc),
					policy.documents.exists.where({
						id: doc.id,
						spaceId: doc.spaceId,
						publicRead: doc.publicRead,
						commentsDisabled: doc.commentsDisabled,
						deletedAt: doc.deletedAt,
					}),
				]),
			]),
		)
		policy.documents.allowDelete.where(documentAdmin)
		policy.documentGrants.allowRead.where(allowedTo.read("document"))
		for (let operation of [
			policy.documentGrants.allowInsert,
			policy.documentGrants.allowUpdate,
			policy.documentGrants.allowDelete,
		]) {
			operation.where(allowedTo.delete("document"))
		}

		policy.folders.allowRead.where(owned)
		policy.folders.allowInsert.where(owned)
		policy.folders.allowUpdate.where(owned)
		policy.folders.allowDelete.where(owned)
		policy.settings.allowRead.where(owned)
		policy.settings.allowInsert.where(owned)
		policy.settings.allowUpdate.where(owned)
		policy.settings.allowDelete.where(owned)
		policy.agentConnections.allowRead.where(owned)
		policy.agentConnections.allowInsert.never()
		policy.agentConnections.allowUpdate.never()
		policy.agentConnections.allowDelete.never()
		policy.mcpConnections.allowRead.where(owned)
		policy.mcpConnections.allowInsert.never()
		policy.mcpConnections.allowUpdate.never()
		policy.mcpConnections.allowDelete.never()
		policy.profiles.allowRead.always()
		policy.profiles.allowInsert.where(owned)
		policy.profiles.allowUpdate.where(owned)
		policy.profiles.allowDelete.where(owned)
		policy.userDocuments.allowRead.where(owned)
		policy.userDocuments.allowInsert.where(
			allOf([owned, allowedTo.read("document")]),
		)
		policy.userDocuments.allowUpdate.where(
			allOf([owned, allowedTo.read("document")]),
		)
		policy.userDocuments.allowDelete.where(owned)
		policy.themes.allowRead.where(owned)
		policy.themes.allowInsert.where(owned)
		policy.themes.allowUpdate.where(owned)
		policy.themes.allowDelete.where(owned)
		policy.themeAssets.allowRead.where(allowedTo.read("theme"))
		policy.themeAssets.allowInsert.where(allowedTo.update("theme"))
		policy.themeAssets.allowUpdate.where(allowedTo.update("theme"))
		policy.themeAssets.allowDelete.where(allowedTo.update("theme"))
		policy.assets.allowRead.where(allowedTo.read("document"))
		policy.assets.allowInsert.where(allowedTo.update("document"))
		policy.assets.allowUpdate.where(allowedTo.update("document"))
		policy.assets.allowDelete.where(allowedTo.update("document"))
		policy.tldrawRevisions.allowRead.where(allowedTo.read("document"))
		policy.tldrawRevisions.allowInsert.where(allowedTo.update("document"))
		policy.tldrawRevisions.allowUpdate.where(allowedTo.update("document"))
		policy.tldrawRevisions.allowDelete.where(allowedTo.update("document"))
		policy.commentThreads.allowRead.where(allowedTo.read("document"))
		policy.commentThreads.allowInsert.where(thread =>
			allOf([
				allowedTo.update("document"),
				{ authorId: session.user },
				policy.documents.exists.where({
					id: thread.documentId,
					commentsDisabled: false,
				}),
			]),
		)
		policy.commentThreads.allowUpdate.where(thread =>
			allOf([
				allowedTo.update("document"),
				policy.documents.exists.where({
					id: thread.documentId,
					commentsDisabled: false,
				}),
				policy.commentThreads.exists.where({
					id: thread.id,
					authorId: thread.authorId,
				}),
			]),
		)
		policy.commentThreads.allowDelete.where(allowedTo.update("document"))
		policy.commentReplies.allowRead.where(allowedTo.read("thread"))
		policy.commentReplies.allowInsert.where(
			allOf([allowedTo.update("thread"), { authorId: session.user }]),
		)
		policy.commentReplies.allowUpdate.where(
			allOf([allowedTo.update("thread"), { authorId: session.user }]),
		)
		policy.commentReplies.allowDelete.where(allowedTo.update("thread"))
		policy.presence.allowRead.where(allowedTo.read("document"))
		for (let operation of [
			policy.presence.allowInsert,
			policy.presence.allowUpdate,
			policy.presence.allowDelete,
		])
			operation.where(
				allOf([{ accountId: session.user }, allowedTo.read("document")]),
			)
		policy.laser.allowRead.where(owned)
		policy.laser.allowInsert.where(owned)
		policy.laser.allowUpdate.where(owned)
		policy.laser.allowDelete.where(owned)
		policy.documentVersions.allowRead.where(allowedTo.read("document"))
		policy.documentVersions.allowInsert.never()
		policy.documentVersions.allowUpdate.never()
		policy.documentVersions.allowDelete.never()
		// v2-todo(importer): only trusted backend code writes versions and the verified Classic identity map.
		policy.classicImports.allowRead.where(owned)
		policy.classicImports.allowInsert.never()
		policy.classicImports.allowUpdate.never()
		policy.classicImports.allowDelete.never()
		// v2-todo(sharing): invite creation/redemption goes through the backend, never a client-supplied membership claim.
		policy.invites.allowRead.where(owned)
		policy.invites.allowInsert.never()
		policy.invites.allowUpdate.never()
		policy.invites.allowDelete.never()
	},
)
