// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest"
import {
	createJazz,
	memory,
	acceptDeviceAccounts,
	type Jazz,
} from "jazz-tools/backend"
import { app } from "../schema"
import { permissions } from "../permissions"
import { sharingOperation } from "./operations"
let jazz: Jazz
let alice = "00000000-0000-4000-8000-000000000001"
let bob = "00000000-0000-4000-8000-000000000002"
let carol = "00000000-0000-4000-8000-000000000003"
beforeEach(async () => {
	jazz = createJazz({
		app,
		permissions,
		store: memory(),
		authenticate: acceptDeviceAccounts,
	})
	await jazz.ready()
})
afterEach(async () => {
	await jazz.close()
})
async function document() {
	return jazz.db
		.insert(app.documents, {
			ownerId: alice,
			title: "Private",
			content: "Body",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
}
async function invite(documentId: string, singleUse = false) {
	let result = await sharingOperation(
		jazz,
		alice,
		"create-invite",
		{ documentId, role: "writer", singleUse },
		"https://app.test",
	)
	if (!result.link || !result.id) throw new Error("Missing invite")
	let secret = result.link.split("/").at(-1)
	return { inviteId: result.id, secret }
}
test("multi-use links are hashed, idempotent, revocable; nonadmins cannot create them", async () => {
	let doc = await document()
	await expect(
		sharingOperation(
			jazz,
			bob,
			"create-invite",
			{ documentId: doc.id },
			"https://app.test",
		),
	).rejects.toThrow("admin")
	let data = await invite(doc.id)
	let stored = await jazz.db.one(app.invites.where({ id: data.inviteId }))
	expect(stored?.tokenHash).not.toBe(data.secret)
	await expect(
		sharingOperation(jazz, bob, "redeem", { ...data, secret: "wrong" }, ""),
	).rejects.toThrow("invalid")
	await sharingOperation(jazz, bob, "redeem", data, "")
	await sharingOperation(jazz, bob, "redeem", data, "")
	await sharingOperation(jazz, carol, "redeem", data, "")
	expect(
		await jazz.db.all(app.documentGrants.where({ documentId: doc.id })),
	).toHaveLength(2)
	await sharingOperation(jazz, alice, "revoke", data, "")
	expect(
		await jazz.db.all(app.documentGrants.where({ documentId: doc.id })),
	).toHaveLength(0)
	await expect(sharingOperation(jazz, bob, "redeem", data, "")).rejects.toThrow(
		"revoked",
	)
})
test("one serializable transaction consumes a single-use link", async () => {
	let doc = await document()
	let data = await invite(doc.id, true)
	let results = await Promise.allSettled([
		sharingOperation(jazz, bob, "redeem", data, ""),
		sharingOperation(jazz, carol, "redeem", data, ""),
	])
	expect(results.filter(result => result.status === "fulfilled")).toHaveLength(
		1,
	)
	expect(
		await jazz.db.all(app.documentGrants.where({ documentId: doc.id })),
	).toHaveLength(1)
})
test("trusted moves change ownership and personal entries without changing document ID", async () => {
	let doc = await document()
	let space = await jazz.db
		.insert(app.spaces, {
			ownerId: carol,
			name: "Team",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	await expect(
		sharingOperation(
			jazz,
			alice,
			"move",
			{ documentId: doc.id, spaceId: space.id },
			"",
		),
	).rejects.toThrow("write")
	await jazz.db
		.insert(app.spaceMembers, {
			spaceId: space.id,
			accountId: alice,
			role: "writer",
		})
		.wait({ tier: "global" })
	await sharingOperation(
		jazz,
		alice,
		"move",
		{ documentId: doc.id, spaceId: space.id },
		"",
	)
	expect(await jazz.db.one(app.documents.where({ id: doc.id }))).toMatchObject({
		ownerId: carol,
		spaceId: space.id,
		content: "Body",
	})
	await sharingOperation(
		jazz,
		carol,
		"move",
		{ documentId: doc.id, spaceId: null },
		"",
	)
	expect(
		await jazz.db.one(app.userDocuments.where({ documentId: doc.id })),
	).toMatchObject({ ownerId: carol })
})

test("managers change nonadmin roles without promoting or removing admins", async () => {
	let space = await jazz.db
		.insert(app.spaces, {
			ownerId: alice,
			name: "Team",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	await jazz.db
		.insert(app.spaceMembers, {
			spaceId: space.id,
			accountId: bob,
			role: "manager",
		})
		.wait({ tier: "global" })
	let member = await jazz.db
		.insert(app.spaceMembers, {
			spaceId: space.id,
			accountId: carol,
			role: "reader",
		})
		.wait({ tier: "global" })
	await sharingOperation(
		jazz,
		bob,
		"member-role",
		{ spaceId: space.id, memberId: member.id, role: "writer" },
		"",
	)
	expect(
		await jazz.db.one(app.spaceMembers.where({ id: member.id })),
	).toMatchObject({ role: "writer" })
	await expect(
		sharingOperation(
			jazz,
			bob,
			"member-role",
			{ spaceId: space.id, memberId: member.id, role: "admin" },
			"",
		),
	).rejects.toThrow("Admin")
	await sharingOperation(
		jazz,
		alice,
		"member-role",
		{ spaceId: space.id, memberId: member.id, role: "admin" },
		"",
	)
	await expect(
		sharingOperation(
			jazz,
			bob,
			"remove-member",
			{ spaceId: space.id, memberId: member.id },
			"",
		),
	).rejects.toThrow("Admin")
})

test("the departing owner transfers the space and its documents to another admin", async () => {
	let space = await jazz.db
		.insert(app.spaces, {
			ownerId: alice,
			name: "Team",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	let doc = await jazz.db
		.insert(app.documents, {
			ownerId: alice,
			spaceId: space.id,
			title: "Team",
			content: "Team notes",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	await expect(
		sharingOperation(jazz, alice, "leave", { spaceId: space.id }, ""),
	).rejects.toThrow("last admin")
	await jazz.db
		.insert(app.spaceMembers, {
			spaceId: space.id,
			accountId: bob,
			role: "admin",
		})
		.wait({ tier: "global" })
	await sharingOperation(jazz, alice, "leave", { spaceId: space.id }, "")
	expect(await jazz.db.one(app.spaces.where({ id: space.id }))).toMatchObject({
		ownerId: bob,
	})
	expect(await jazz.db.one(app.documents.where({ id: doc.id }))).toMatchObject({
		ownerId: bob,
	})
})

test("space deletion removes its documents and memberships atomically", async () => {
	let space = await jazz.db
		.insert(app.spaces, {
			ownerId: alice,
			name: "Team",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	await jazz.db
		.insert(app.documents, {
			ownerId: alice,
			spaceId: space.id,
			title: "Team",
			content: "Team notes",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	await jazz.db
		.insert(app.spaceMembers, {
			spaceId: space.id,
			accountId: bob,
			role: "writer",
		})
		.wait({ tier: "global" })
	await expect(
		sharingOperation(jazz, bob, "delete-space", { spaceId: space.id }, ""),
	).rejects.toThrow("admin")
	await sharingOperation(jazz, alice, "delete-space", { spaceId: space.id }, "")
	expect(await jazz.db.one(app.spaces.where({ id: space.id }))).toBeNull()
	expect(
		await jazz.db.all(app.documents.where({ spaceId: space.id })),
	).toHaveLength(0)
	expect(
		await jazz.db.all(app.spaceMembers.where({ spaceId: space.id })),
	).toHaveLength(0)
})

test.each(["remove-member", "member-role"])(
	"%s invalidates the member's space and document invites",
	async action => {
		let space = await jazz.db
			.insert(app.spaces, {
				ownerId: alice,
				name: "Team",
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.wait({ tier: "global" })
		let member = await jazz.db
			.insert(app.spaceMembers, {
				spaceId: space.id,
				accountId: bob,
				role: "admin",
			})
			.wait({ tier: "global" })
		let doc = await document()
		await jazz.db
			.update(app.documents, doc.id, { spaceId: space.id })
			.wait({ tier: "global" })
		let invites = []
		for (let target of [{ spaceId: space.id }, { documentId: doc.id }]) {
			let result = await sharingOperation(
				jazz,
				bob,
				"create-invite",
				{ ...target, role: "admin" },
				"https://app.test",
			)
			invites.push({
				inviteId: result.id,
				secret: result.link?.split("/").at(-1),
			})
		}
		await sharingOperation(
			jazz,
			alice,
			action,
			{ spaceId: space.id, memberId: member.id, role: "writer" },
			"",
		)
		for (let data of invites) {
			await expect(
				sharingOperation(jazz, bob, "redeem", data, ""),
			).rejects.toThrow()
			expect(
				await jazz.db.one(app.invites.where({ id: data.inviteId })),
			).toMatchObject({ revokedAt: expect.any(Date) })
		}
	},
)
test("redemption rechecks current grantor authority within the transaction", async () => {
	let doc = await document()
	let grant = await jazz.db
		.insert(app.documentGrants, {
			documentId: doc.id,
			accountId: bob,
			role: "admin",
		})
		.wait({ tier: "global" })
	let result = await sharingOperation(
		jazz,
		bob,
		"create-invite",
		{ documentId: doc.id, role: "admin" },
		"https://app.test",
	)
	await jazz.db
		.update(app.documentGrants, grant.id, { role: "writer" })
		.wait({ tier: "global" })
	await expect(
		sharingOperation(
			jazz,
			carol,
			"redeem",
			{ inviteId: result.id, secret: result.link?.split("/").at(-1) },
			"",
		),
	).rejects.toThrow()
})

test.each(["remove-grant", "grant-role"])(
	"%s permanently invalidates the grantor's outstanding document invites",
	async action => {
		let doc = await document()
		let grant = await jazz.db
			.insert(app.documentGrants, {
				documentId: doc.id,
				accountId: bob,
				role: "admin",
			})
			.wait({ tier: "global" })
		let result = await sharingOperation(
			jazz,
			bob,
			"create-invite",
			{ documentId: doc.id, role: "reader" },
			"https://app.test",
		)
		await sharingOperation(
			jazz,
			alice,
			action,
			{ documentId: doc.id, memberId: grant.id, role: "writer" },
			"",
		)
		await jazz.db
			.insert(app.documentGrants, {
				documentId: doc.id,
				accountId: bob,
				role: "admin",
			})
			.wait({ tier: "global" })
		await expect(
			sharingOperation(
				jazz,
				carol,
				"redeem",
				{ inviteId: result.id, secret: result.link?.split("/").at(-1) },
				"",
			),
		).rejects.toThrow("revoked")
	},
)
