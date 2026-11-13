import { createHash, randomBytes } from "node:crypto"
import { z } from "zod"
import type { Jazz } from "jazz-tools/backend"
import { app } from "../schema"

export { sharingOperation }

let inputSchema = z.object({
	documentId: z.string().uuid().optional(),
	spaceId: z.string().uuid().nullable().optional(),
	inviteId: z.string().uuid().optional(),
	secret: z.string().optional(),
	role: z.enum(["reader", "writer", "manager", "admin"]).optional(),
	singleUse: z.boolean().optional(),
	memberId: z.string().uuid().optional(),
})
async function sharingOperation(
	jazz: Jazz,
	accountId: string,
	action: string,
	input: unknown,
	origin: string,
) {
	let data = inputSchema.parse(input)
	let secret = randomBytes(32).toString("base64url")
	let result = await jazz.db.serializableTransaction(async tx => {
		async function documentAdmin(id: string) {
			let doc = await tx.one(app.documents.where({ id }))
			if (!doc || doc.deletedAt) throw new Error("Document not found")
			if (doc.ownerId === accountId) return doc
			let grant = await tx.one(
				app.documentGrants.where({ documentId: id, accountId, role: "admin" }),
			)
			if (grant) return doc
			if (doc.spaceId && (await spaceRole(doc.spaceId)) === "admin") return doc
			throw new Error("Document admin required")
		}
		async function spaceRole(id: string) {
			let space = await tx.one(app.spaces.where({ id }))
			if (!space) return null
			if (space.ownerId === accountId) return "admin"
			return (
				(await tx.one(app.spaceMembers.where({ spaceId: id, accountId })))
					?.role ?? null
			)
		}
		async function requireAdmin(
			documentId: string | null,
			spaceId: string | null,
		) {
			if (documentId) await documentAdmin(documentId)
			else if (!spaceId || (await spaceRole(spaceId)) !== "admin")
				throw new Error("Space admin required")
		}
		if (action === "create-invite") {
			if (Boolean(data.documentId) === Boolean(data.spaceId))
				throw new Error("One resource required")
			await requireAdmin(data.documentId ?? null, data.spaceId ?? null)
			let role = data.role ?? "reader"
			if (data.documentId && role === "manager")
				throw new Error("Invalid document role")
			let invite = tx.insert(app.invites, {
				ownerId: accountId,
				documentId: data.documentId,
				spaceId: data.spaceId,
				role,
				singleUse: data.singleUse ?? false,
				tokenHash: hash(secret),
			})
			return {
				id: invite.id,
				link: `${origin}/app/invite#/${data.documentId ? "doc/" + data.documentId : "space/" + data.spaceId}/invite/${invite.id}/${secret}`,
			}
		}
		if (action === "redeem") {
			let invite = data.inviteId
				? await tx.one(app.invites.where({ id: data.inviteId }))
				: null
			if (
				!invite ||
				invite.revokedAt ||
				!data.secret ||
				hash(data.secret) !== invite.tokenHash ||
				(invite.expiresAt && invite.expiresAt.getTime() < Date.now())
			)
				throw new Error("Invite revoked or invalid")
			if (invite.documentId) {
				let doc = await tx.one(app.documents.where({ id: invite.documentId }))
				if (!doc || doc.deletedAt) throw new Error("Document not found")
				let existing = await tx.one(
					app.documentGrants.where({ documentId: doc.id, accountId }),
				)
				if (!existing && doc.ownerId !== accountId) {
					if (invite.singleUse && invite.redeemedAt)
						throw new Error("Invite already used")
					if (invite.role === "manager") throw new Error("Invalid role")
					tx.insert(app.documentGrants, {
						documentId: doc.id,
						accountId,
						role: invite.role,
						inviteId: invite.id,
					})
				}
				if (
					!(await tx.one(
						app.userDocuments.where({ ownerId: accountId, documentId: doc.id }),
					))
				)
					tx.insert(app.userDocuments, {
						ownerId: accountId,
						documentId: doc.id,
						rank: Date.now(),
					})
			} else if (invite.spaceId) {
				let space = await tx.one(app.spaces.where({ id: invite.spaceId }))
				if (!space) throw new Error("Space not found")
				let existing = await tx.one(
					app.spaceMembers.where({ spaceId: space.id, accountId }),
				)
				if (!existing && space.ownerId !== accountId) {
					if (invite.singleUse && invite.redeemedAt)
						throw new Error("Invite already used")
					tx.insert(app.spaceMembers, {
						spaceId: space.id,
						accountId,
						role: invite.role,
						inviteId: invite.id,
					})
				}
			} else throw new Error("Invalid invite")
			if (!invite.redeemedAt)
				tx.update(app.invites, invite.id, { redeemedAt: new Date() })
			return {}
		}
		if (action === "revoke") {
			let invite = data.inviteId
				? await tx.one(app.invites.where({ id: data.inviteId }))
				: null
			if (!invite) throw new Error("Invite not found")
			await requireAdmin(invite.documentId, invite.spaceId)
			tx.update(app.invites, invite.id, { revokedAt: new Date() })
			for (let grant of await tx.all(
				app.documentGrants.where({ inviteId: invite.id }),
			))
				tx.delete(app.documentGrants, grant.id)
			for (let member of await tx.all(
				app.spaceMembers.where({ inviteId: invite.id }),
			))
				tx.delete(app.spaceMembers, member.id)
			return {}
		}
		if (
			(action === "member-role" || action === "remove-member") &&
			data.spaceId &&
			data.memberId
		) {
			let role = await spaceRole(data.spaceId)
			let member = await tx.one(
				app.spaceMembers.where({ id: data.memberId, spaceId: data.spaceId }),
			)
			if (!member || (role !== "admin" && role !== "manager"))
				throw new Error("Member management denied")
			if (
				role === "manager" &&
				(member.role === "admin" || data.role === "admin")
			)
				throw new Error("Admin role required")
			if (action === "remove-member") tx.delete(app.spaceMembers, member.id)
			else if (data.role)
				tx.update(app.spaceMembers, member.id, { role: data.role })
			return {}
		}
		if (action === "leave") {
			if (data.documentId) {
				for (let grant of await tx.all(
					app.documentGrants.where({ documentId: data.documentId, accountId }),
				))
					tx.delete(app.documentGrants, grant.id)
				for (let entry of await tx.all(
					app.userDocuments.where({
						documentId: data.documentId,
						ownerId: accountId,
					}),
				))
					tx.delete(app.userDocuments, entry.id)
			} else if (data.spaceId) {
				for (let member of await tx.all(
					app.spaceMembers.where({ spaceId: data.spaceId, accountId }),
				))
					tx.delete(app.spaceMembers, member.id)
			}
			return {}
		}
		if (action === "move" && data.documentId) {
			let doc = await documentAdmin(data.documentId)
			let ownerId = accountId
			if (data.spaceId) {
				let role = await spaceRole(data.spaceId)
				if (!role || role === "reader")
					throw new Error("Space write access required")
				let space = await tx.one(app.spaces.where({ id: data.spaceId }))
				if (!space) throw new Error("Space not found")
				ownerId = space.ownerId
			}
			tx.update(app.documents, doc.id, {
				ownerId,
				spaceId: data.spaceId ?? null,
				updatedAt: new Date(),
			})
			for (let entry of await tx.all(
				app.userDocuments.where({ documentId: doc.id }),
			))
				tx.delete(app.userDocuments, entry.id)
			if (!data.spaceId)
				tx.insert(app.userDocuments, {
					ownerId: accountId,
					documentId: doc.id,
					rank: Date.now(),
				})
			return {}
		}
		throw new Error("Unknown operation")
	})
	await result.wait()
	return result.value
}
function hash(secret: string) {
	return createHash("sha256").update(secret).digest("hex")
}
