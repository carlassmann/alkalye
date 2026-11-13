import { decodeLocalDrawing } from "./local-drawing-copy"
import { getDocumentTitle } from "@/app/features/documents/lib/title"
import { getTags } from "@/app/features/editor/lib/frontmatter"
import { schema } from "jazz-tools"
import { useLibrary, type Database } from "@/app/features/documents"
import { app } from "@/jazz/schema"
import { sharingRequest } from "@/app/features/sharing"

export {
	useSpaces,
	createSpace,
	createSpaceDocument,
	getSpaceGroup,
	isSpaceMember,
	leaveSpace,
	changeSpaceCollaboratorRole,
	revokeSpaceInvite,
	listSpaceMembers,
	listSpaceCollaborators,
	getSpaceOwner,
	permanentlyDeleteSpace,
	createSpaceInvite,
	isSpacePublic,
	makeSpacePublic,
	makeSpacePrivate,
	getSpacePublicLink,
	acceptSpaceInvite,
}
export type { Space, SpaceMember, SpaceInviteData }

type Space = schema.RowOf<typeof app.spaces> & {
	role: "reader" | "writer" | "manager" | "admin" | null
	members: SpaceMember[]
}
type SpaceMember = {
	id: string
	name: string
	role: "reader" | "writer" | "manager" | "admin"
	inviteGroupId?: string
}
type SpaceInviteData = {
	spaceId: string
	inviteGroupId: string
	inviteSecret: string
}
function useSpaces() {
	let { spaces, members, ownerId, profiles } = useLibrary()
	return spaces
		.map(
			space =>
				({
					...space,
					role:
						space.ownerId === ownerId
							? "admin"
							: (members.find(
									member =>
										member.spaceId === space.id && member.accountId === ownerId,
								)?.role ?? null),
					members: [
						{
							id: space.ownerId,
							name:
								profiles.find(profile => profile.ownerId === space.ownerId)
									?.name ?? "Anonymous",
							role: "admin",
							inviteGroupId: undefined,
						},
						...members
							.filter(
								member =>
									member.spaceId === space.id &&
									member.accountId !== space.ownerId,
							)
							.map(member => ({
								id: member.accountId,
								name:
									profiles.find(profile => profile.ownerId === member.accountId)
										?.name ?? "Anonymous",
								role: member.role,
								inviteGroupId: member.id,
							})),
					],
				}) satisfies Space,
		)
		.sort((a, b) => a.name.localeCompare(b.name))
}
async function createSpace(db: Database, ownerId: string, name: string) {
	let write = await db.transaction(tx => {
		let space = tx.insert(app.spaces, {
			ownerId,
			name,
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		let content = `# Welcome to ${name}

This is your new shared space. Documents here are shared with all space members.

**Get started:** Edit this document or create a new one.
`
		tx.insert(app.documents, {
			ownerId,
			spaceId: space.id,
			content,
			title: getDocumentTitle(content),
			tags: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		return space
	})
	await write.wait({ tier: "local" })
	return write.value
}
async function createSpaceDocument(
	db: Database,
	_ownerId: string,
	spaceId: string,
	content = "",
) {
	let space = await db.one(app.spaces.where({ id: spaceId }))
	if (!space) throw new Error("Space not found")
	let write = db.insert(app.documents, {
		ownerId: space.ownerId,
		spaceId,
		content,
		title: getDocumentTitle(content),
		tags: getTags(content),
		createdAt: new Date(),
		updatedAt: new Date(),
	})
	await write.wait({ tier: "local" })
	return write.value
}
function getSpaceGroup(space: Space) {
	return { myRole: () => space.role, members: space.members }
}
function isSpaceMember(space: Space) {
	return space.role !== null
}
async function leaveSpace(db: Database, space: Space) {
	await sharingRequest(db, "leave", { spaceId: space.id })
}
async function changeSpaceCollaboratorRole(
	db: Database,
	space: Space,
	memberId: string,
	role: SpaceMember["role"],
) {
	await sharingRequest(db, "member-role", { spaceId: space.id, memberId, role })
}
async function revokeSpaceInvite(db: Database, space: Space, id: string) {
	let member = await db.one(app.spaceMembers.where({ id, spaceId: space.id }), {
		tier: "remote",
	})
	if (member?.inviteId && space.role === "admin")
		await sharingRequest(db, "revoke", { inviteId: member.inviteId })
	else if (member)
		await sharingRequest(db, "remove-member", {
			spaceId: space.id,
			memberId: id,
		})
	else await sharingRequest(db, "revoke", { inviteId: id })
}
async function listSpaceMembers(_db: Database, space: Space) {
	return space.members
}
async function listSpaceCollaborators(db: Database, space: Space) {
	let invites = await db.all(app.invites.where({ spaceId: space.id }), {
		tier: "remote",
	})
	return {
		collaborators: space.members
			.filter(member => member.id !== space.ownerId)
			.map(member => ({
				...member,
				inviteGroupId: member.inviteGroupId ?? member.id,
			})),
		pendingInvites: invites
			.filter(invite => !invite.revokedAt && !invite.redeemedAt)
			.map(invite => ({ inviteGroupId: invite.id })),
	}
}
async function getSpaceOwner(_db: Database, space: Space) {
	return { id: space.ownerId, name: space.ownerId }
}
async function permanentlyDeleteSpace(db: Database, space: Space) {
	await sharingRequest(db, "delete-space", { spaceId: space.id })
}
async function createSpaceInvite(
	db: Database,
	space: Space,
	role: "reader" | "writer",
) {
	await db
		.update(app.spaces, space.id, { updatedAt: new Date() })
		.wait({ tier: "global" })
	return sharingRequest(db, "create-invite", { spaceId: space.id, role })
}
function isSpacePublic(space: Space) {
	return space.publicRead
}
function makeSpacePublic(db: Database, space: Space) {
	return db
		.update(app.spaces, space.id, { publicRead: true })
		.wait({ tier: "global" })
}
function makeSpacePrivate(db: Database, space: Space) {
	return db
		.update(app.spaces, space.id, { publicRead: false })
		.wait({ tier: "global" })
}
function getSpacePublicLink(space: Space) {
	return window.location.origin + "/app/spaces/" + space.id
}
function acceptSpaceInvite(db: Database, data: SpaceInviteData) {
	return sharingRequest(db, "redeem", {
		inviteId: data.inviteGroupId,
		secret: data.inviteSecret,
	})
}

export type { LocalCopyAsset }
export { copyToSynced }
type LocalCopyAsset = {
	id: string
	name: string
	type: "image" | "video" | "tldraw"
	blob: Blob
	lastModified?: number
	lightPreview?: Blob
	darkPreview?: Blob
}
async function copyToSynced(
	db: Database,
	ownerId: string,
	spaceId: string | null,
	content: string,
	files: LocalCopyAsset[],
) {
	let space = spaceId ? await db.one(app.spaces.where({ id: spaceId })) : null
	if (spaceId && !space) throw new Error("Space not found")
	let references = [
		...content.matchAll(/!\[[^\]]*\]\((?:asset:|(?:\.\/)?assets\/)([^)]+)\)/g),
	]
	let ids = new Map<string, string>()
	let assets = []
	for (let reference of references) {
		let id = reference[1]
		if (ids.has(id)) continue
		let file = files.find(file => file.id === id)
		if (!file)
			throw new Error(`Local asset ${id} is unavailable; restore it first`)
		let newId = crypto.randomUUID()
		ids.set(id, newId)
		assets.push({
			id: newId,
			type: file.type,
			name: file.name,
			data: new Uint8Array(await file.blob.arrayBuffer()),
			mimeType: file.blob.type,
			drawing:
				file.type === "tldraw" ? await decodeLocalDrawing(file.blob) : null,
		})
	}
	let copiedContent = content.replace(
		/!\[([^\]]*)\]\((?:asset:|(?:\.\/)?assets\/)([^)]+)\)/g,
		(match, alt: string, id: string) =>
			ids.has(id) ? `![${alt}](asset:${ids.get(id)})` : match,
	)
	let write = await db.transaction(tx => {
		let doc = tx.insert(app.documents, {
			ownerId: space?.ownerId ?? ownerId,
			spaceId,
			content: copiedContent,
			title: getDocumentTitle(copiedContent),
			tags: getTags(copiedContent),
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		if (!spaceId)
			tx.insert(app.userDocuments, {
				ownerId,
				documentId: doc.id,
				rank: Date.now(),
			})
		for (let asset of assets) {
			let { id, drawing, ...data } = asset
			let revision = drawing
				? tx.insert(app.tldrawRevisions, {
						documentId: doc.id,
						...drawing,
						createdAt: new Date(),
					})
				: null
			tx.insert(
				app.assets,
				{
					...data,
					data: drawing ? null : data.data,
					revisionId: revision?.id,
					documentId: doc.id,
					createdAt: new Date(),
				},
				{ id },
			)
		}
		return doc
	})
	await write.wait({ tier: "local" })
	return write.value
}
