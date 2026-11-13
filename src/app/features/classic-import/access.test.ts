// @vitest-environment node
import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { createJazz, memory, type Jazz } from "jazz-tools/backend"
import { app } from "@/jazz/schema"
import { permissions } from "@/jazz/permissions"
import { stableId } from "./conversion"
let state: { jazz?: Jazz; members: { id: string; role: string }[] } =
	vi.hoisted(() => ({ members: [] }))
vi.mock("@/jazz/server", () => ({
	get jazz() {
		return state.jazz
	},
}))
vi.mock("./verification", () => ({
	readClassicAccess: async (_id: string, accountId: string) => {
		let role = state.members.find(member => member.id === accountId)?.role
		if (!role) throw new Error("Classic read access denied")
		return {
			groupId: "source",
			groupIds: ["source"],
			createdBy: "co_zOwner",
			role,
			ownerClassicId: "co_zOwner",
			publicRead: false,
			members: state.members,
			directMembers: state.members,
		}
	},
}))
let owner = "00000000-0000-4000-8000-000000000001"
let member = "00000000-0000-4000-8000-000000000002"
let challengeId: string
beforeEach(async () => {
	state.jazz = await createJazz({ app, permissions, store: memory() }).ready()
	state.members = [
		{ id: "co_zOwner", role: "admin" },
		{ id: "co_zMember", role: "writer" },
	]
	for (let [classicId, ownerId] of [
		["co_zOwner", owner],
		["co_zMember", member],
	]) {
		await state.jazz.db
			.insert(app.classicAccounts, { classicId, ownerId })
			.wait({ tier: "global" })
	}
	challengeId = (
		await state.jazz.db
			.insert(app.classicChallenges, {
				ownerId: owner,
				classicId: "co_zOwner",
				nonce: "test",
				expiresAt: new Date(Date.now() + 60000),
			})
			.wait({ tier: "global" })
	).id
})
afterEach(async () => {
	await state.jazz?.close()
})
function documentFixture(classicId: string) {
	return {
		kind: "document",
		classicId,
		content: "# Private",
		title: "Private",
		tags: [],
		pinned: false,
		archived: false,
		isPresentation: false,
		commentsDisabled: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		versions: [],
		comments: [],
		assets: [],
	}
}
test.each(["document", "space"])(
	"activated %s membership is revoked after Classic removal and owner replay",
	async kind => {
		let { importClassicItem } = await import("./server")
		let item =
			kind === "document"
				? documentFixture("co_zReviewDoc")
				: {
						kind: "space",
						classicId: "co_zReviewSpace",
						name: "Team",
						createdAt: new Date(),
						updatedAt: new Date(),
					}
		let { id } = await importClassicItem(owner, { challengeId, item })
		let db = await state.jazz!.forUser(member)
		expect(
			kind === "document"
				? await db.one(app.documents.where({ id }))
				: await db.one(app.spaces.where({ id })),
		).not.toBeNull()
		state.members = [{ id: "co_zOwner", role: "admin" }]
		await importClassicItem(owner, { challengeId, item })
		expect(
			await state.jazz!.db.all(
				app.classicAccess.where({ resourceId: id, classicId: "co_zMember" }),
			),
		).toHaveLength(0)
		expect(
			kind === "document"
				? await db.one(app.documents.where({ id }))
				: await db.one(app.spaces.where({ id })),
		).toBeNull()
	},
)
test("activated Classic writer demotion removes v2 write access", async () => {
	let { importClassicItem } = await import("./server")
	let item = documentFixture("co_zReviewDemotion")
	let { id } = await importClassicItem(owner, { challengeId, item })
	state.members = [
		{ id: "co_zOwner", role: "admin" },
		{ id: "co_zMember", role: "reader" },
	]
	await importClassicItem(owner, { challengeId, item })
	expect(
		await state.jazz!.db.one(
			app.documentGrants.where({ documentId: id, accountId: member }),
		),
	).toMatchObject({ role: "reader" })
})

function resourceFixture(kind: string) {
	return kind === "document"
		? documentFixture("co_zAccessDoc")
		: {
				kind: "space",
				classicId: "co_zAccessSpace",
				name: "Team",
				createdAt: new Date(),
				updatedAt: new Date(),
			}
}

test.each(["document", "space"])(
	"%s replay preserves v2 downgrades, removals and independent grants",
	async kind => {
		let { importClassicItem, prepareClassicItem } = await import("./server")
		let { sharingOperation } = await import("@/jazz/sharing/operations")
		let item = resourceFixture(kind)
		let { id } = await importClassicItem(owner, { challengeId, item })
		let db = state.jazz!.db
		let grantId = await stableId(`grant:${id}:${member}`)
		let scope = kind === "document" ? { documentId: id } : { spaceId: id }
		await sharingOperation(
			state.jazz!,
			owner,
			kind === "document" ? "grant-role" : "member-role",
			{
				...scope,
				memberId: grantId,
				role: "reader",
			},
			"",
		)
		state.members[1].role = "admin"
		await importClassicItem(owner, { challengeId, item })
		expect(
			kind === "document"
				? await db.one(app.documentGrants.where({ id: grantId }))
				: await db.one(app.spaceMembers.where({ id: grantId })),
		).toMatchObject({ role: "reader" })
		await sharingOperation(
			state.jazz!,
			owner,
			kind === "document" ? "remove-grant" : "remove-member",
			{
				...scope,
				memberId: grantId,
			},
			"",
		)
		let independentId = crypto.randomUUID()
		if (kind === "document")
			await db
				.insert(
					app.documentGrants,
					{ documentId: id, accountId: member, role: "writer" },
					{ id: independentId },
				)
				.wait({ tier: "global" })
		else
			await db
				.insert(
					app.spaceMembers,
					{ spaceId: id, accountId: member, role: "writer" },
					{ id: independentId },
				)
				.wait({ tier: "global" })
		state.members.pop()
		await importClassicItem(owner, { challengeId, item })
		state.members.push({ id: "co_zMember", role: "reader" })
		await importClassicItem(owner, { challengeId, item })
		let proof = await db
			.insert(app.classicChallenges, {
				ownerId: member,
				classicId: "co_zMember",
				nonce: "test",
				expiresAt: new Date(Date.now() + 60000),
			})
			.wait({ tier: "global" })
		await prepareClassicItem(member, {
			challengeId: proof.id,
			classicId: item.classicId,
			kind,
		})
		expect(
			kind === "document"
				? await db.one(app.documentGrants.where({ id: grantId }))
				: await db.one(app.spaceMembers.where({ id: grantId })),
		).toBeNull()
		expect(
			kind === "document"
				? await db.one(app.documentGrants.where({ id: independentId }))
				: await db.one(app.spaceMembers.where({ id: independentId })),
		).toMatchObject({ role: "writer" })
	},
)

test.each(["document", "space"])(
	"%s removal repairs previously deleted pending access and never resurrects after rejoining Classic",
	async kind => {
		let { importClassicItem, prepareClassicItem } = await import("./server")
		let item = resourceFixture(kind)
		let { id } = await importClassicItem(owner, { challengeId, item })
		let db = state.jazz!.db
		await db
			.delete(
				app.classicAccess,
				await stableId(`pending:${item.classicId}:co_zMember`),
			)
			.wait({ tier: "global" })
		state.members.pop()
		await importClassicItem(owner, { challengeId, item })
		state.members.push({ id: "co_zMember", role: "reader" })
		await importClassicItem(owner, { challengeId, item })
		let proof = await db
			.insert(app.classicChallenges, {
				ownerId: member,
				classicId: "co_zMember",
				nonce: "test",
				expiresAt: new Date(Date.now() + 60000),
			})
			.wait({ tier: "global" })
		await expect(
			prepareClassicItem(member, {
				challengeId: proof.id,
				classicId: item.classicId,
				kind,
			}),
		).rejects.toThrow("revoked")
		let scoped = await state.jazz!.forUser(member)
		expect(
			kind === "document"
				? await scoped.one(app.documents.where({ id }))
				: await scoped.one(app.spaces.where({ id })),
		).toBeNull()
	},
)

test.each([
	{ kind: "document", change: "remove" },
	{ kind: "document", change: "demote" },
	{ kind: "space", change: "remove" },
	{ kind: "space", change: "demote" },
])(
	"$kind Classic $change invalidates scoped invites, including space document invites",
	async ({ kind, change }) => {
		let { importClassicItem } = await import("./server")
		let { sharingOperation } = await import("@/jazz/sharing/operations")
		state.members[1].role = "admin"
		let item = resourceFixture(kind)
		let { id } = await importClassicItem(owner, { challengeId, item })
		let db = state.jazz!.db
		let invitation = await sharingOperation(
			state.jazz!,
			member,
			"create-invite",
			{
				...(kind === "document" ? { documentId: id } : { spaceId: id }),
				role: "reader",
			},
			"https://app.test",
		)
		let childInvite
		if (kind === "space") {
			let child = await importClassicItem(owner, {
				challengeId,
				item: { ...documentFixture("co_zC123"), spaceId: item.classicId },
			})
			childInvite = await sharingOperation(
				state.jazz!,
				member,
				"create-invite",
				{ documentId: child.id, role: "reader" },
				"https://app.test",
			)
		}
		let otherDoc = await db
			.insert(app.documents, {
				ownerId: member,
				title: "Other",
				content: "Other",
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.wait({ tier: "global" })
		let unrelated = await sharingOperation(
			state.jazz!,
			member,
			"create-invite",
			{ documentId: otherDoc.id, role: "reader" },
			"https://app.test",
		)
		if (change === "remove") state.members.pop()
		else state.members[1].role = "reader"
		await importClassicItem(owner, { challengeId, item })
		for (let invite of [invitation, childInvite]) {
			if (!invite) continue
			expect(
				(await db.one(app.invites.where({ id: invite.id })))?.revokedAt,
			).toBeInstanceOf(Date)
			await expect(
				sharingOperation(
					state.jazz!,
					"00000000-0000-4000-8000-000000000003",
					"redeem",
					{ inviteId: invite.id, secret: invite.link?.split("/").at(-1) },
					"",
				),
			).rejects.toThrow("revoked")
		}
		expect(
			(await db.one(app.invites.where({ id: unrelated.id })))?.revokedAt,
		).toBeNull()
		if (kind === "space") {
			let scoped = await state.jazz!.forUser(member)
			let childId = await stableId("co_zC123")
			if (change === "remove")
				expect(
					await scoped.one(app.documents.where({ id: childId })),
				).toBeNull()
			else {
				expect(
					await scoped.one(app.documents.where({ id: childId })),
				).not.toBeNull()
				await expect(
					scoped
						.update(app.documents, childId, { content: "denied" })
						.wait({ tier: "global" }),
				).rejects.toThrow()
			}
		}
	},
)
