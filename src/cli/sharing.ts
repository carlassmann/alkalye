import { z } from "zod"
import type { Db } from "jazz-tools/backend"
import { jazz } from "@/jazz/server"
import { sharingOperation } from "@/jazz/sharing/operations"

export {
	invitationCommand,
	createInvite,
	revokeInvite,
	moveDocument,
	leaveSpace,
	leaveDocument,
}

async function createInvite(
	_db: Db,
	accountId: string,
	target: { documentId: string } | { spaceId: string },
	role: "reader" | "writer" | "manager" | "admin",
	baseUrl: string,
) {
	let result = await sharingOperation(
		jazz,
		accountId,
		"create-invite",
		{ ...target, role },
		baseUrl,
	)
	return { ...target, inviteGroupId: result.id, role, link: result.link }
}
async function revokeInvite(
	db: Db,
	target: { documentId: string } | { spaceId: string },
	inviteId: string,
) {
	await sharingOperation(
		jazz,
		userId(db),
		"revoke",
		{ ...target, inviteId },
		"",
	)
	return { ...target, inviteGroupId: inviteId, revoked: true }
}
async function invitationCommand(
	accountId: string,
	command: string,
	link: string,
) {
	let url = new URL(link)
	let parts = url.hash.match(
		/^#\/(?:doc|space)\/[^/]+\/invite\/([^/]+)\/([^/]+)$/,
	)
	let inviteId = z.uuid().parse(parts?.[1] ?? url.searchParams.get("invite"))
	let secret = parts?.[2] ?? url.hash.slice(1)
	let result = await sharingOperation(
		jazz,
		accountId,
		command === "invite.inspect" ? "inspect-invite" : "redeem",
		{ inviteId, secret },
		"",
	)
	return {
		...result,
		...(command === "invite.inspect" ? {} : { accepted: true }),
	}
}
async function moveDocument(
	_db: Db,
	accountId: string,
	documentId: string,
	scope: string,
) {
	let spaceId =
		scope === "personal" ? null : z.uuid().parse(scope.replace(/^space:/, ""))
	await sharingOperation(jazz, accountId, "move", { documentId, spaceId }, "")
	return { documentId, spaceId }
}
async function leaveSpace(_db: Db, accountId: string, spaceId: string) {
	await sharingOperation(jazz, accountId, "leave", { spaceId }, "")
	return { spaceId, left: true }
}
async function leaveDocument(_db: Db, accountId: string, documentId: string) {
	await sharingOperation(jazz, accountId, "leave", { documentId }, "")
	return { documentId, left: true }
}
function userId(db: Db) {
	let user = db.getAuthState().session?.user
	if (!user) throw new Error("Account required")
	return user
}
