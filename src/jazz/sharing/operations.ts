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
		async function spaceRole(id: string, userId = accountId) {
			let space = await tx.one(app.spaces.where({ id }))
			if (!space) return null
			if (space.ownerId === userId) return "admin"
			return (
				(
					await tx.one(
						app.spaceMembers.where({ spaceId: id, accountId: userId }),
					)
				)?.role ?? null
			)
		}
		async function documentRole(id: string, userId: string) {
			let doc = await tx.one(app.documents.where({ id }))
			if (!doc || doc.deletedAt) return null
			if (doc.ownerId === userId) return "admin"
			let grant = await tx.one(
				app.documentGrants.where({ documentId: id, accountId: userId }),
			)
			let inherited = doc.spaceId ? await spaceRole(doc.spaceId, userId) : null
			return rank(grant?.role) >= rank(inherited) ? grant?.role : inherited
		}
		async function invalidateInvites(
			userId: string,
			documentId: string | null,
			spaceId: string | null,
		) {
			let documentIds = new Set(documentId ? [documentId] : [])
			if (spaceId)
				for (let doc of await tx.all(app.documents.where({ spaceId })))
					documentIds.add(doc.id)
			for (let invite of await tx.all(app.invites.where({ ownerId: userId }))) {
				if (
					!invite.revokedAt &&
					((spaceId && invite.spaceId === spaceId) ||
						(invite.documentId && documentIds.has(invite.documentId)))
				)
					tx.update(app.invites, invite.id, { revokedAt: new Date() })
			}
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
		if (action === "redeem" || action === "inspect-invite") {
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
			let grantorRole = invite.documentId
				? await documentRole(invite.documentId, invite.ownerId)
				: invite.spaceId
					? await spaceRole(invite.spaceId, invite.ownerId)
					: null
			if (!grantorRole || rank(grantorRole) < rank(invite.role))
				throw new Error("Invite creator no longer authorized")
			if (action === "inspect-invite") {
				if (invite.singleUse && invite.redeemedAt)
					throw new Error("Invite already used")
				return {
					documentId: invite.documentId,
					spaceId: invite.spaceId,
					role: invite.role,
				}
			}

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
			return {
				documentId: invite.documentId,
				spaceId: invite.spaceId,
				role: invite.role,
			}
		}
		if (action === "revoke") {
			let invite = data.inviteId
				? await tx.one(app.invites.where({ id: data.inviteId }))
				: null
			if (
				!invite ||
				(data.documentId && invite.documentId !== data.documentId) ||
				(data.spaceId && invite.spaceId !== data.spaceId)
			)
				throw new Error("Invite not found")
			await requireAdmin(invite.documentId, invite.spaceId)
			tx.update(app.invites, invite.id, { revokedAt: new Date() })
			for (let grant of await tx.all(
				app.documentGrants.where({ inviteId: invite.id }),
			)) {
				await invalidateInvites(grant.accountId, grant.documentId, null)
				tx.delete(app.documentGrants, grant.id)
			}
			for (let member of await tx.all(
				app.spaceMembers.where({ inviteId: invite.id }),
			)) {
				await invalidateInvites(member.accountId, null, member.spaceId)
				tx.delete(app.spaceMembers, member.id)
			}
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
			if (
				action === "remove-member" ||
				(data.role && rank(data.role) < rank(member.role))
			)
				await invalidateInvites(member.accountId, null, member.spaceId)
			if (action === "remove-member") tx.delete(app.spaceMembers, member.id)
			else if (data.role)
				tx.update(app.spaceMembers, member.id, { role: data.role })
			return {}
		}
		if (
			(action === "grant-role" || action === "remove-grant") &&
			data.documentId &&
			data.memberId
		) {
			await documentAdmin(data.documentId)
			let grant = await tx.one(
				app.documentGrants.where({
					id: data.memberId,
					documentId: data.documentId,
				}),
			)
			if (!grant) throw new Error("Collaborator not found")
			if (
				action === "remove-grant" ||
				(data.role && rank(data.role) < rank(grant.role))
			)
				await invalidateInvites(grant.accountId, grant.documentId, null)
			if (action === "remove-grant") tx.delete(app.documentGrants, grant.id)
			else if (data.role && data.role !== "manager")
				tx.update(app.documentGrants, grant.id, { role: data.role })
			else throw new Error("Invalid document role")
			return {}
		}

		if (action === "delete-space" && data.spaceId) {
			if ((await spaceRole(data.spaceId)) !== "admin")
				throw new Error("Space admin required")
			for (let doc of await tx.all(
				app.documents.where({ spaceId: data.spaceId }),
			)) {
				for (let entry of await tx.all(
					app.userDocuments.where({ documentId: doc.id }),
				))
					tx.delete(app.userDocuments, entry.id)
				for (let grant of await tx.all(
					app.documentGrants.where({ documentId: doc.id }),
				))
					tx.delete(app.documentGrants, grant.id)
				for (let asset of await tx.all(
					app.assets.where({ documentId: doc.id }),
				))
					tx.delete(app.assets, asset.id)
				tx.delete(app.documents, doc.id)
			}
			for (let member of await tx.all(
				app.spaceMembers.where({ spaceId: data.spaceId }),
			))
				tx.delete(app.spaceMembers, member.id)
			for (let invite of await tx.all(
				app.invites.where({ spaceId: data.spaceId }),
			))
				tx.delete(app.invites, invite.id)
			tx.delete(app.spaces, data.spaceId)
			return {}
		}
		if (action === "leave") {
			await invalidateInvites(
				accountId,
				data.documentId ?? null,
				data.spaceId ?? null,
			)
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
				let space = await tx.one(app.spaces.where({ id: data.spaceId }))
				if (space?.ownerId === accountId) {
					let successor = await tx.one(
						app.spaceMembers.where({ spaceId: space.id, role: "admin" }),
					)
					if (!successor) throw new Error("The last admin cannot leave")
					tx.update(app.spaces, space.id, {
						ownerId: successor.accountId,
						updatedAt: new Date(),
					})
					for (let doc of await tx.all(
						app.documents.where({ spaceId: space.id, ownerId: accountId }),
					))
						tx.update(app.documents, doc.id, { ownerId: successor.accountId })
				}

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

function rank(role: string | null | undefined) {
	return role === "admin"
		? 4
		: role === "manager"
			? 3
			: role === "writer"
				? 2
				: role === "reader"
					? 1
					: 0
}
