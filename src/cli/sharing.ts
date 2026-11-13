import { createHash, randomBytes } from "node:crypto"
import { z } from "zod"
import type { Db } from "jazz-tools/backend"
import { app } from "@/jazz/schema"
import { jazz } from "@/jazz/server"

export {
	invitationCommand,
	createInvite,
	revokeInvite,
	moveDocument,
	leaveSpace,
	leaveDocument,
}

async function createInvite(
	db: Db,
	accountId: string,
	target: { documentId: string } | { spaceId: string },
	role: "reader" | "writer" | "manager" | "admin",
	baseUrl: string,
) {
	await requireAdmin(db, target)
	if ("documentId" in target && role === "manager")
		throw new Error("Invalid document role")
	let token = randomBytes(32).toString("base64url")
	let invite = await jazz.db
		.insert(app.invites, {
			...target,
			ownerId: accountId,
			tokenHash: hashToken(token),
			role,
			expiresAt: new Date(Date.now() + 7 * 86400_000),
		})
		.wait({ tier: "global" })
	let url = new URL("/app/invite", baseUrl)
	url.searchParams.set("invite", invite.id)
	url.hash = token
	return { ...target, inviteGroupId: invite.id, role, link: url.href }
}
async function revokeInvite(
	db: Db,
	target: { documentId: string } | { spaceId: string },
	inviteId: string,
) {
	await requireAdmin(db, target)
	let invite = await jazz.db.one(app.invites.where({ id: inviteId, ...target }))
	if (!invite) throw new Error("Invite not found")
	let write = await jazz.db.serializableTransaction(async tx => {
		tx.update(app.invites, invite.id, { revokedAt: new Date() })
		if (
			invite.documentId &&
			(await tx.one(
				app.documentGrants.where({
					id: invite.id,
					documentId: invite.documentId,
				}),
			))
		)
			tx.delete(app.documentGrants, invite.id)
		if (
			invite.spaceId &&
			(await tx.one(
				app.spaceMembers.where({ id: invite.id, spaceId: invite.spaceId }),
			))
		)
			tx.delete(app.spaceMembers, invite.id)
	})
	await write.wait()
	return { ...target, inviteGroupId: invite.id, revoked: true }
}
async function invitationCommand(
	accountId: string,
	command: string,
	link: string,
) {
	let url = new URL(link)
	let id = z.uuid().parse(url.searchParams.get("invite"))
	let token = url.hash.slice(1)
	let write = await jazz.db.serializableTransaction(async tx => {
		let invite = await tx.one(app.invites.where({ id }))
		if (
			!invite ||
			invite.revokedAt ||
			invite.redeemedAt ||
			(invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) ||
			hashToken(token) !== invite.tokenHash
		)
			throw new Error("Invite is unavailable")
		let result = {
			documentId: invite.documentId,
			spaceId: invite.spaceId,
			role: invite.role,
		}
		if (command === "invite.inspect") return result
		// Revoking an owner's access invalidates their outstanding invitations too.
		let grantor = await jazz.forUser(invite.ownerId)
		await requireAdmin(
			grantor,
			invite.documentId
				? { documentId: invite.documentId }
				: { spaceId: z.uuid().parse(invite.spaceId) },
		)
		if (invite.documentId) {
			let role = z.enum(["reader", "writer", "admin"]).parse(invite.role)
			tx.insert(
				app.documentGrants,
				{ documentId: invite.documentId, accountId, role },
				{ id: invite.id },
			)
			let entry = await tx.one(
				app.userDocuments.where({
					ownerId: accountId,
					documentId: invite.documentId,
				}),
			)
			if (!entry)
				tx.insert(app.userDocuments, {
					ownerId: accountId,
					documentId: invite.documentId,
					rank: Date.now(),
				})
		} else if (invite.spaceId) {
			tx.insert(
				app.spaceMembers,
				{ spaceId: invite.spaceId, accountId, role: invite.role },
				{ id: invite.id },
			)
		}
		tx.update(app.invites, id, { redeemedAt: new Date() })
		return { ...result, accepted: true }
	})
	await write.wait()
	return write.value
}
async function moveDocument(
	db: Db,
	accountId: string,
	documentId: string,
	scope: string,
) {
	let doc = await db.one(app.documents.where({ id: documentId }))
	if (!doc) throw new Error("Document not found")
	await requireAdmin(db, { documentId })
	let spaceId =
		scope === "personal" ? null : z.uuid().parse(scope.replace(/^space:/, ""))
	if (spaceId) {
		let space = await db.one(app.spaces.where({ id: spaceId }))
		if (!space) throw new Error("Space not found")
		let advice = await db.canInsert(app.documents, {
			ownerId: accountId,
			spaceId,
			content: doc.content,
			title: doc.title,
			createdAt: doc.createdAt,
			updatedAt: new Date(),
		})
		if (advice !== "allowed") throw new Error("You do not have write access")
	}
	let write = await jazz.db.transaction(async tx => {
		tx.update(app.documents, doc.id, { spaceId, updatedAt: new Date() })
		if (
			!spaceId &&
			!(await tx.one(
				app.userDocuments.where({ documentId: doc.id, ownerId: accountId }),
			))
		)
			tx.insert(app.userDocuments, {
				documentId: doc.id,
				ownerId: accountId,
				rank: Date.now(),
			})
	})
	await write.wait({ tier: "global" })
	return { documentId, spaceId }
}
async function leaveSpace(db: Db, accountId: string, spaceId: string) {
	let space = await db.one(app.spaces.where({ id: spaceId }))
	if (!space || space.ownerId === accountId)
		throw new Error("Cannot leave this space")
	let members = await db.all(app.spaceMembers.where({ spaceId, accountId }))
	for (let member of members)
		await jazz.db.delete(app.spaceMembers, member.id).wait({ tier: "global" })
	return { spaceId, left: true }
}
async function leaveDocument(db: Db, accountId: string, documentId: string) {
	let doc = await db.one(app.documents.where({ id: documentId }))
	if (!doc || doc.ownerId === accountId)
		throw new Error("Cannot leave this document")
	let write = await jazz.db.transaction(async tx => {
		for (let grant of await tx.all(
			app.documentGrants.where({ documentId, accountId }),
		))
			tx.delete(app.documentGrants, grant.id)
		for (let entry of await tx.all(
			app.userDocuments.where({ documentId, ownerId: accountId }),
		))
			tx.delete(app.userDocuments, entry.id)
	})
	await write.wait({ tier: "global" })
	return { documentId, left: true }
}
async function requireAdmin(
	db: Db,
	target: { documentId: string } | { spaceId: string },
) {
	let advice =
		"documentId" in target
			? await db.canDelete(app.documents, target.documentId)
			: await db.canDelete(app.spaces, target.spaceId)
	if (advice !== "allowed") throw new Error("You do not have admin access")
}

function hashToken(token: string) {
	return createHash("sha256").update(token).digest("hex")
}
