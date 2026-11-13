import {
	useLibrary,
	type Database,
	type LibraryDocument,
} from "@/app/features/documents"
import { app } from "@/jazz/schema"
import { sharingRequest } from "./backend"

export {
	useCollaborators,
	getSharingStatus,
	isDocumentPublic,
	hasIndividualShares,
	getDocumentGroup,
	createDocumentInvite,
	revokeDocumentInvite,
	leavePersonalDocument,
	listCollaborators,
	getDocumentOwner,
	makeDocumentPublic,
	makeDocumentPrivate,
	getPublicLink,
	acceptDocumentInvite,
}
export type { Collaborator, DocInviteData }
type Collaborator = {
	id: string
	name: string
	role: string
	inviteGroupId: string
}
type DocInviteData = {
	docId: string
	inviteGroupId: string
	inviteSecret: string
}
function useCollaborators(doc: LibraryDocument) {
	let { grants, members, profiles } = useLibrary()
	return [
		...grants
			.filter(grant => grant.documentId === doc.id)
			.map(grant => ({
				id: grant.accountId,
				name:
					profiles.find(profile => profile.ownerId === grant.accountId)?.name ??
					"Anonymous",
				role: grant.role,
				inviteGroupId: grant.id,
			})),
		...members
			.filter(member => member.spaceId === doc.spaceId)
			.map(member => ({
				id: member.accountId,
				name:
					profiles.find(profile => profile.ownerId === member.accountId)
						?.name ?? "Anonymous",
				role: member.role,
				inviteGroupId: member.id,
			})),
	]
}
function isDocumentPublic(doc: LibraryDocument) {
	return doc.publicRead
}
function hasIndividualShares(doc: LibraryDocument, _spaceId?: string) {
	return doc.shared
}
function getSharingStatus(doc: LibraryDocument) {
	return doc.publicRead ? "public" : doc.shared ? "shared" : "none"
}
function getDocumentGroup(doc: LibraryDocument) {
	return {
		myRole: () => (doc.canAdmin ? "admin" : doc.canEdit ? "writer" : "reader"),
	}
}
async function createDocumentInvite(
	db: Database,
	doc: LibraryDocument,
	role: "reader" | "writer",
) {
	await db
		.update(app.documents, doc.id, { updatedAt: new Date() })
		.wait({ tier: "global" })
	return sharingRequest(db, "create-invite", { documentId: doc.id, role })
}
async function revokeDocumentInvite(
	db: Database,
	doc: LibraryDocument,
	id: string,
) {
	let grant = await db.one(
		app.documentGrants.where({ id, documentId: doc.id }),
		{ tier: "remote" },
	)
	if (grant?.inviteId)
		await sharingRequest(db, "revoke", { inviteId: grant.inviteId })
	else if (grant)
		await db.delete(app.documentGrants, id).wait({ tier: "global" })
	else await sharingRequest(db, "revoke", { inviteId: id })
}
async function leavePersonalDocument(db: Database, doc: LibraryDocument) {
	await sharingRequest(db, "leave", { documentId: doc.id })
}
async function listCollaborators(
	db: Database,
	doc: LibraryDocument,
	_spaceId?: string,
) {
	let grants = await db.all(app.documentGrants.where({ documentId: doc.id }), {
		tier: "remote",
	})
	let profiles = await db.all(app.profiles)
	let invites = await db.all(app.invites.where({ documentId: doc.id }), {
		tier: "remote",
	})
	return {
		collaborators: grants.map(grant => ({
			id: grant.accountId,
			name:
				profiles.find(profile => profile.ownerId === grant.accountId)?.name ??
				"Anonymous",
			role: grant.role,
			inviteGroupId: grant.id,
		})),
		pendingInvites: invites
			.filter(invite => !invite.revokedAt && !invite.redeemedAt)
			.map(invite => ({ inviteGroupId: invite.id })),
	}
}
async function getDocumentOwner(_db: Database, doc: LibraryDocument) {
	let profile = await _db.one(app.profiles.where({ ownerId: doc.ownerId }))
	return { id: doc.ownerId, name: profile?.name ?? "Anonymous" }
}
function makeDocumentPublic(db: Database, doc: LibraryDocument) {
	return db
		.update(app.documents, doc.id, { publicRead: true })
		.wait({ tier: "global" })
}
function makeDocumentPrivate(db: Database, doc: LibraryDocument) {
	return db
		.update(app.documents, doc.id, { publicRead: false })
		.wait({ tier: "global" })
}
function getPublicLink(doc: LibraryDocument) {
	return window.location.origin + "/app/doc/" + doc.id
}
function acceptDocumentInvite(db: Database, data: DocInviteData) {
	return sharingRequest(db, "redeem", {
		inviteId: data.inviteGroupId,
		secret: data.inviteSecret,
	})
}
