import { beforeEach, describe, expect, test } from "vitest"
import {
	createJazzTestAccount,
	setActiveAccount,
	setupJazzTestSync,
} from "jazz-tools/testing"
import { Document, UserAccount } from "@/schema"
import {
	createPersonalDocument,
	deletePersonalDocument,
	permanentlyDeletePersonalDocument,
} from "./documents"
import {
	createDocumentInvite,
	acceptDocumentInvite,
	revokeDocumentInvite,
	listCollaborators,
	leavePersonalDocument,
	parseInviteLink,
	changeCollaboratorRole,
	getDocumentGroup,
	canEdit,
	getMyRole,
	isDocumentPublic,
	makeDocumentPublic,
	makeDocumentPrivate,
	getSharingStatus,
	hasIndividualShares,
	getDocumentOwner,
} from "@/app/features/sharing/lib/document-sharing"
import type { co } from "jazz-tools"
import { homeLoader } from "../screens/home-screen"

describe("Document Collaboration", () => {
	let adminAccount: co.loaded<typeof UserAccount>
	let otherAccount: co.loaded<typeof UserAccount>
	let doc: co.loaded<typeof Document>

	beforeEach(async () => {
		await setupJazzTestSync()

		adminAccount = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})

		otherAccount = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})

		doc = await createPersonalDocument(adminAccount, "Test content")
	})

	test("admin can access their own document", async () => {
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		expect(loadedDoc.$isLoaded).toBe(true)
	})

	test("other user cannot access document they are not invited to", async () => {
		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})

		expect(loadedDoc.$jazz.loadingState).toEqual("unauthorized")
	})

	test("admin can find document in personal docs", async () => {
		let { root } = await adminAccount.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		expect(root.documents.some(d => d.$jazz.id === doc.$jazz.id)).toBe(true)
	})

	test("document invites use explicit base URL when provided", async () => {
		let { link } = await createDocumentInvite(
			doc,
			"writer",
			"http://localhost:4321",
		)
		expect(link).toMatch(/^http:\/\/localhost:4321\/invite#\/doc\//)
	})

	test("document removed from personal docs after permanent delete", async () => {
		await permanentlyDeletePersonalDocument(doc, adminAccount)

		let { root } = await adminAccount.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})

		expect(root.documents.some(d => d.$jazz.id === doc.$jazz.id)).toBe(false)
	})

	test("invited user can find document in personal docs after accepting invite", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)

		await acceptDocumentInvite(otherAccount, inviteData)

		let { root } = await otherAccount.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		expect(root.documents.some(d => d.$jazz.id === doc.$jazz.id)).toBe(true)
	})

	test("revoked user cannot access document", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)

		await acceptDocumentInvite(otherAccount, inviteData)

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id)
		expect(loadedDoc.$isLoaded).toBe(true)

		setActiveAccount(adminAccount)
		revokeDocumentInvite(doc, inviteData.inviteGroupId)

		await otherAccount.$jazz.waitForAllCoValuesSync()

		setActiveAccount(otherAccount)
		let loadedDocAfterRevoke = await Document.load(doc.$jazz.id)
		expect(loadedDocAfterRevoke.$jazz.loadingState).toEqual("unauthorized")
	})

	describe("Personal after access revocation", () => {
		beforeEach(async () => {
			let { root } = await otherAccount.$jazz.ensureLoaded({
				resolve: { root: { documents: true } },
			})
			root.documents.$jazz.splice(0, root.documents.length)
			let { link } = await createDocumentInvite(doc, "reader")
			let invite = parseInviteLink(link)
			await acceptDocumentInvite(otherAccount, invite)
			revokeDocumentInvite(doc, invite.inviteGroupId)
			await otherAccount.$jazz.waitForAllCoValuesSync()
			setActiveAccount(otherAccount)
		})

		test("opens an accessible document despite a revoked entry", async () => {
			let personalDoc = await createPersonalDocument(otherAccount, "Personal")

			await expect(
				homeLoader({ context: { me: otherAccount }, deps: { personal: true } }),
			).rejects.toMatchObject({
				options: { to: "/doc/$id", params: { id: personalDoc.$jazz.id } },
			})

			let { root } = await otherAccount.$jazz.ensureLoaded({
				resolve: { root: { documents: true } },
			})
			expect(root.documents.map(item => item.$jazz.id)).toEqual([
				doc.$jazz.id,
				personalDoc.$jazz.id,
			])
			let ownerDoc = await Document.load(doc.$jazz.id, {
				loadAs: adminAccount,
				resolve: { content: true },
			})
			if (!ownerDoc.$isLoaded) throw new Error("Owner lost document access")
			expect(ownerDoc.content.toString()).toBe("Test content")
		})

		test("creates an accessible document when only revoked entries remain", async () => {
			await expect(
				homeLoader({ context: { me: otherAccount }, deps: { personal: true } }),
			).rejects.toMatchObject({ options: { to: "/doc/$id" } })

			let { root } = await otherAccount.$jazz.ensureLoaded({
				resolve: { root: { documents: true } },
			})
			expect(root.documents.length).toBe(2)
			expect(root.documents[0]?.$jazz.id).toBe(doc.$jazz.id)
			let newId = root.documents[1]?.$jazz.id
			if (!newId) throw new Error("No replacement document was created")
			let newDoc = await Document.load(newId, { resolve: { content: true } })
			if (!newDoc.$isLoaded) throw new Error("New document is inaccessible")
			expect(newDoc.content.toString()).toBe("")
		})
	})

	test("accepting a revoked invite should throw", async () => {
		setActiveAccount(adminAccount)
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)

		revokeDocumentInvite(doc, inviteData.inviteGroupId)

		await adminAccount.$jazz.waitForAllCoValuesSync()
		await otherAccount.$jazz.waitForAllCoValuesSync()

		setActiveAccount(otherAccount)
		await expect(
			acceptDocumentInvite(otherAccount, inviteData),
		).rejects.toThrow()
	})

	test("list collaborators returns all invited users with their roles", async () => {
		let writerAccount = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})

		let readerAccount = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})

		let { link: writerInvite } = await createDocumentInvite(doc, "writer")
		let { link: readerInvite } = await createDocumentInvite(doc, "reader")

		let writerData = parseInviteLink(writerInvite)
		let readerData = parseInviteLink(readerInvite)

		await acceptDocumentInvite(writerAccount, writerData)
		await acceptDocumentInvite(readerAccount, readerData)

		let result = await listCollaborators(doc, undefined, false)
		expect(result.collaborators.length).toBe(2)

		let writerCollabs = result.collaborators.filter(c => c.role === "writer")
		let readerCollabs = result.collaborators.filter(c => c.role === "reader")

		expect(writerCollabs.length).toBe(1)
		expect(readerCollabs.length).toBe(1)
		expect(writerCollabs[0].id).toBe(writerAccount.$jazz.id)
		expect(readerCollabs[0].id).toBe(readerAccount.$jazz.id)
	}, 30000)

	test("leaving document removes it from personal docs and collaborator list", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)

		await acceptDocumentInvite(otherAccount, inviteData)
		await otherAccount.$jazz.waitForAllCoValuesSync()

		setActiveAccount(otherAccount)

		let { root: beforeRoot } = await otherAccount.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		expect(beforeRoot.documents.some(d => d.$jazz.id === doc.$jazz.id)).toBe(
			true,
		)

		setActiveAccount(adminAccount)
		let collaboratorsBefore = await listCollaborators(doc, undefined, false)
		expect(
			collaboratorsBefore.collaborators.some(
				c => c.id === otherAccount.$jazz.id,
			),
		).toBe(true)
		expect(
			collaboratorsBefore.collaborators.find(
				c => c.id === otherAccount.$jazz.id,
			)?.role,
		).toBe("writer")

		setActiveAccount(otherAccount)
		let docAsOther = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		if (!docAsOther.$isLoaded) throw new Error("Doc not loaded")
		await leavePersonalDocument(docAsOther, otherAccount)
		await otherAccount.$jazz.waitForAllCoValuesSync()

		let { root: afterRoot } = await otherAccount.$jazz.ensureLoaded({
			resolve: { root: { documents: true } },
		})
		expect(afterRoot.documents.some(d => d.$jazz.id === doc.$jazz.id)).toBe(
			false,
		)

		setActiveAccount(adminAccount)
		let collaboratorsAfter = await listCollaborators(doc, undefined, false)
		expect(
			collaboratorsAfter.collaborators.some(
				c => c.id === otherAccount.$jazz.id,
			),
		).toBe(false)
	}, 30000)

	test("changing collaborator role is reflected in listCollaborators", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "reader")
		let inviteData = parseInviteLink(inviteLink)

		await acceptDocumentInvite(otherAccount, inviteData)
		await otherAccount.$jazz.waitForAllCoValuesSync()

		let collaboratorsBefore = await listCollaborators(doc, undefined, false)
		let otherCollabsBefore = collaboratorsBefore.collaborators.filter(
			c => c.id === otherAccount.$jazz.id,
		)
		expect(otherCollabsBefore.length).toBe(1)
		expect(otherCollabsBefore[0].role).toBe("reader")

		await changeCollaboratorRole(doc, inviteData.inviteGroupId, "writer")

		let collaboratorsAfter = await listCollaborators(doc, undefined, false)
		let otherCollabsAfter = collaboratorsAfter.collaborators.filter(
			c => c.id === otherAccount.$jazz.id,
		)
		expect(otherCollabsAfter.length).toBe(1)
		expect(otherCollabsAfter[0].role).toBe("writer")
	}, 30000)

	test("listCollaborators returns pending invites for empty invite groups", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)

		let result = await listCollaborators(doc)
		expect(result.pendingInvites.length).toBe(1)
		expect(result.pendingInvites[0].inviteGroupId).toBe(
			inviteData.inviteGroupId,
		)
		expect(result.collaborators.length).toBe(0)
	})

	test("listCollaborators excludes space group from collaborators", async () => {
		let writerAccount = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})

		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)

		await acceptDocumentInvite(writerAccount, inviteData)

		let result = await listCollaborators(doc, "space-group-id", false)
		expect(result.collaborators.length).toBe(1)
		expect(result.pendingInvites.length).toBe(0)
	})

	test("listCollaborators returns empty when doc uses space group directly", async () => {
		let result = await listCollaborators(doc, doc.$jazz.id)
		expect(result.collaborators.length).toBe(0)
		expect(result.pendingInvites.length).toBe(0)
	})

	test("soft delete sets deletedAt but doc remains accessible to admin", async () => {
		let result = await deletePersonalDocument(doc)
		expect(result.type).toBe("success")
		expect(doc.deletedAt).toBeInstanceOf(Date)

		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		expect(loadedDoc.$isLoaded).toBe(true)
	})

	test("non-admin cannot soft delete document", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)
		await otherAccount.$jazz.waitForAllCoValuesSync()

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		if (!loadedDoc.$isLoaded) throw new Error("Doc not loaded")

		let result = await deletePersonalDocument(loadedDoc)
		expect(result.type).toBe("error")
		expect(loadedDoc.deletedAt).toBeUndefined()
	})

	test("non-admin cannot permanently delete document", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)
		await otherAccount.$jazz.waitForAllCoValuesSync()

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		if (!loadedDoc.$isLoaded) throw new Error("Doc not loaded")

		let result = await permanentlyDeletePersonalDocument(
			loadedDoc,
			otherAccount,
		)
		expect(result.type).toBe("error")
	})

	test("non-admin cannot create invite links", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)
		await otherAccount.$jazz.waitForAllCoValuesSync()

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		if (!loadedDoc.$isLoaded) throw new Error("Doc not loaded")

		await expect(createDocumentInvite(loadedDoc, "reader")).rejects.toThrow(
			"Only admins can create invite links",
		)
	})

	test("reader cannot edit document content", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "reader")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)
		await otherAccount.$jazz.waitForAllCoValuesSync()

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		expect(loadedDoc.$isLoaded).toBe(true)
		if (!loadedDoc.$isLoaded) return

		let docGroup = loadedDoc.$jazz.owner
		let role = docGroup.myRole()
		expect(role).toBe("reader")
	})

	test("writer can edit document but cannot delete", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)
		await otherAccount.$jazz.waitForAllCoValuesSync()

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		if (!loadedDoc.$isLoaded) throw new Error("Doc not loaded")

		let docGroup = loadedDoc.$jazz.owner
		let role = docGroup.myRole()
		expect(role).toBe("writer")

		let result = await deletePersonalDocument(loadedDoc)
		expect(result.type).toBe("error")
	})

	test("admin cannot leave their own document", async () => {
		await expect(leavePersonalDocument(doc, adminAccount)).rejects.toThrow()
	})

	test("multiple invites create separate access paths", async () => {
		let thirdAccount = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})

		let { link: invite1 } = await createDocumentInvite(doc, "writer")
		let { link: invite2 } = await createDocumentInvite(doc, "reader")

		let data1 = parseInviteLink(invite1)
		let data2 = parseInviteLink(invite2)

		await acceptDocumentInvite(otherAccount, data1)
		await acceptDocumentInvite(thirdAccount, data2)

		// Revoke first invite - otherAccount loses access
		revokeDocumentInvite(doc, data1.inviteGroupId)
		await adminAccount.$jazz.waitForAllCoValuesSync()

		// thirdAccount should still have access
		setActiveAccount(thirdAccount)
		let loadedDoc = await Document.load(doc.$jazz.id)
		expect(loadedDoc.$isLoaded).toBe(true)

		// otherAccount should not
		setActiveAccount(otherAccount)
		let loadedDoc2 = await Document.load(doc.$jazz.id)
		expect(loadedDoc2.$jazz.loadingState).toBe("unauthorized")
	})

	test("parseInviteLink throws on invalid format", () => {
		expect(() => parseInviteLink("invalid")).toThrow("Invalid invite link")
		expect(() => parseInviteLink("http://example.com/wrong")).toThrow(
			"Invalid invite link",
		)
	})
})

describe("Document Helpers", () => {
	let adminAccount: co.loaded<typeof UserAccount>
	let otherAccount: co.loaded<typeof UserAccount>
	let doc: co.loaded<typeof Document, { content: true }>

	beforeEach(async () => {
		await setupJazzTestSync()

		adminAccount = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})

		otherAccount = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})

		let createdDoc = await createPersonalDocument(adminAccount, "Test content")
		let loaded = await Document.load(createdDoc.$jazz.id, {
			resolve: { content: true },
		})
		if (!loaded.$isLoaded) throw new Error("Doc not loaded")
		doc = loaded
	})

	test("getDocumentGroup returns Group for group-owned docs", async () => {
		let group = getDocumentGroup(doc)
		expect(group).not.toBeNull()
	})

	test("canEdit returns true for admin", async () => {
		expect(canEdit(doc)).toBe(true)
	})

	test("canEdit returns true for writer, false for reader", async () => {
		let { link: writerInvite } = await createDocumentInvite(doc, "writer")
		let writerData = parseInviteLink(writerInvite)
		await acceptDocumentInvite(otherAccount, writerData)

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		if (!loadedDoc.$isLoaded) throw new Error("Doc not loaded")
		expect(canEdit(loadedDoc)).toBe(true)

		setActiveAccount(adminAccount)
		revokeDocumentInvite(doc, writerData.inviteGroupId)

		let { link: readerInvite } = await createDocumentInvite(doc, "reader")
		let readerData = parseInviteLink(readerInvite)

		let thirdAccount = await createJazzTestAccount({
			AccountSchema: UserAccount,
		})
		await acceptDocumentInvite(thirdAccount, readerData)

		setActiveAccount(thirdAccount)
		let readerDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		if (!readerDoc.$isLoaded) throw new Error("Doc not loaded")
		expect(canEdit(readerDoc)).toBe(false)
	})

	test("getMyRole returns correct role", async () => {
		expect(getMyRole(doc)).toBe("admin")

		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		if (!loadedDoc.$isLoaded) throw new Error("Doc not loaded")
		expect(getMyRole(loadedDoc)).toBe("writer")
	})

	test("isDocumentPublic returns false for private docs", async () => {
		expect(isDocumentPublic(doc)).toBe(false)
	})

	test("makeDocumentPublic makes doc readable by everyone", async () => {
		let updatedDoc = await makeDocumentPublic(doc, adminAccount.$jazz.id)
		expect(isDocumentPublic(updatedDoc)).toBe(true)
	})

	test("makeDocumentPrivate removes public access", async () => {
		let publicDoc = await makeDocumentPublic(doc, adminAccount.$jazz.id)
		expect(isDocumentPublic(publicDoc)).toBe(true)

		await makeDocumentPrivate(publicDoc)
		expect(isDocumentPublic(publicDoc)).toBe(false)
	})

	test("getSharingStatus returns none for unshared doc", async () => {
		expect(getSharingStatus(doc)).toBe("none")
	})

	test("getSharingStatus returns owner when doc has collaborators", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)

		expect(getSharingStatus(doc)).toBe("owner")
	})

	test("getSharingStatus returns collaborator for non-admin", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		if (!loadedDoc.$isLoaded) throw new Error("Doc not loaded")
		expect(getSharingStatus(loadedDoc)).toBe("collaborator")
	})

	test("hasIndividualShares returns false for unshared doc", async () => {
		expect(hasIndividualShares(doc)).toBe(false)
	})

	test("hasIndividualShares returns true when doc has invite groups", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)

		expect(hasIndividualShares(doc)).toBe(true)
	})

	test("getDocumentOwner returns admin info", async () => {
		let owner = await getDocumentOwner(doc)
		expect(owner).not.toBeNull()
		expect(owner?.id).toBe(adminAccount.$jazz.id)
	})

	test("reader has read-only role and canEdit returns false", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "reader")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		expect(loadedDoc.$isLoaded).toBe(true)
		if (!loadedDoc.$isLoaded) return

		// Verify reader role - Jazz doesn't throw locally on write,
		// but rejects at sync time. canEdit() is used to prevent UI writes.
		expect(getMyRole(loadedDoc)).toBe("reader")
		expect(canEdit(loadedDoc)).toBe(false)
	})

	test("writer can write to document", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		expect(loadedDoc.$isLoaded).toBe(true)
		if (!loadedDoc.$isLoaded) return

		// Writer should be able to modify content without throwing
		expect(() => {
			loadedDoc.content!.$jazz.applyDiff("Modified by writer")
		}).not.toThrow()
	})

	test("writer cannot create invite links", async () => {
		let { link: inviteLink } = await createDocumentInvite(doc, "writer")
		let inviteData = parseInviteLink(inviteLink)
		await acceptDocumentInvite(otherAccount, inviteData)

		setActiveAccount(otherAccount)
		let loadedDoc = await Document.load(doc.$jazz.id, {
			resolve: { content: true },
		})
		expect(loadedDoc.$isLoaded).toBe(true)
		if (!loadedDoc.$isLoaded) return

		await expect(createDocumentInvite(loadedDoc, "reader")).rejects.toThrow(
			"Only admins can create invite links",
		)
	})
})
