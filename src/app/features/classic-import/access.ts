import { z } from "zod"
import { app } from "@/jazz/schema"
import { jazz } from "@/jazz/server"
import { invalidateInvites, rank } from "@/jazz/sharing/operations"
import { stableId } from "./conversion"
import { readClassicAccess } from "./verification"

export { reconcileClassicAccess, activateVerifiedAccess }

type ClassicRole = "reader" | "writer" | "manager" | "admin"
type ClassicAccess = {
	classicId: string
	resourceId: string
	kind: "document" | "space"
	role: ClassicRole
}
type Transaction = Parameters<
	Parameters<typeof jazz.db.serializableTransaction>[0]
>[0]
let roleSchema = z.enum(["reader", "writer", "manager", "admin"])

async function reconcileClassicAccess(
	classicId: string,
	resourceId: string,
	kind: "document" | "space",
	members: { id: string; role: string }[],
) {
	let roles = new Map(
		members.map(member => [member.id, roleSchema.parse(member.role)]),
	)
	let write = await jazz.db.serializableTransaction(async tx => {
		// Include earlier removals so replay also repairs grants activated before ACL reconciliation existed.
		for (let previous of await tx.all(
			app.classicAccess
				.where({ resourceId })
				.includeDeleted()
				.select("*", "$deletedAt"),
		)) {
			let account = await tx.one(
				app.classicAccounts.where({ classicId: previous.classicId }),
			)
			if (account)
				await restrictClassicGrant(
					tx,
					account.ownerId,
					previous,
					roles.get(previous.classicId),
				)
			if (!roles.has(previous.classicId) && !previous.$deletedAt)
				tx.delete(app.classicAccess, previous.id)
		}
		for (let [memberId, role] of roles) {
			let id = await stableId(`pending:${classicId}:${memberId}`)
			let previous = await tx.one(
				app.classicAccess
					.where({ id })
					.includeDeleted()
					.select("*", "$deletedAt"),
			)
			let values = { classicId: memberId, resourceId, kind, role }
			if (previous?.$deletedAt) tx.restore(app.classicAccess, id, values)
			else if (previous) tx.update(app.classicAccess, id, values)
			else tx.insert(app.classicAccess, values, { id })
		}
	})
	await write.wait()
}

async function activateVerifiedAccess(
	accountId: string,
	classicId: string,
	pending: ClassicAccess,
) {
	try {
		let access = await readClassicAccess(classicId, pending.classicId)
		if (!access.members.some(member => member.id === pending.classicId)) return
		let verifiedRole = roleSchema.parse(access.role)
		let id = await stableId(`grant:${pending.resourceId}:${accountId}`)
		let activationId = await stableId(`membership:${id}`)
		let write = await jazz.db.serializableTransaction(async tx => {
			let current = await tx.one(
				app.classicAccess.where({
					classicId: pending.classicId,
					resourceId: pending.resourceId,
				}),
			)
			if (!current) return
			// A document's direct Classic grant must not absorb a stronger inherited space role.
			let role =
				rank(verifiedRole) < rank(current.role) ? verifiedRole : current.role
			await restrictClassicGrant(tx, accountId, current, role)
			if (await tx.one(app.classicImports.where({ id: activationId }))) return
			if (current.kind === "space") {
				if (!(await tx.one(app.spaceMembers.where({ id }).includeDeleted())))
					tx.insert(
						app.spaceMembers,
						{ accountId, spaceId: current.resourceId, role },
						{ id },
					)
			} else {
				if (!(await tx.one(app.documentGrants.where({ id }).includeDeleted())))
					tx.insert(
						app.documentGrants,
						{
							accountId,
							documentId: current.resourceId,
							role: role === "manager" ? "writer" : role,
						},
						{ id },
					)
			}
			tx.insert(
				app.classicImports,
				{
					ownerId: accountId,
					classicId: `membership:${current.resourceId}:${accountId}`,
					v2Id: id,
					kind: "membership",
					status: "complete",
					importedAt: new Date(),
				},
				{ id: activationId },
			)
		})
		await write.wait()
	} catch (error) {
		if (
			!(error instanceof Error) ||
			error.message !== "Classic read access denied"
		)
			throw error
	}
}

async function restrictClassicGrant(
	tx: Transaction,
	accountId: string,
	access: ClassicAccess,
	role: ClassicRole | undefined,
) {
	let id = await stableId(`grant:${access.resourceId}:${accountId}`)
	let activation = await tx.one(
		app.classicImports.where({ id: await stableId(`membership:${id}`) }),
	)
	if (
		!activation ||
		activation.kind !== "membership" ||
		activation.v2Id !== id ||
		activation.ownerId !== accountId
	)
		return
	if (access.kind === "space") {
		let member = await tx.one(
			app.spaceMembers.where({ id, accountId, spaceId: access.resourceId }),
		)
		if (!member || member.inviteId || (role && rank(role) >= rank(member.role)))
			return
		await invalidateInvites(tx, accountId, null, access.resourceId)
		if (!role) tx.delete(app.spaceMembers, id)
		else tx.update(app.spaceMembers, id, { role })
	} else {
		let grant = await tx.one(
			app.documentGrants.where({
				id,
				accountId,
				documentId: access.resourceId,
			}),
		)
		let documentRole = role === "manager" ? "writer" : role
		if (
			!grant ||
			grant.inviteId ||
			(documentRole && rank(documentRole) >= rank(grant.role))
		)
			return
		await invalidateInvites(tx, accountId, access.resourceId, null)
		if (!documentRole) tx.delete(app.documentGrants, id)
		else tx.update(app.documentGrants, id, { role: documentRole })
	}
}
