// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import { app } from "./schema"
import { permissions } from "./permissions"

let fixture: PolicyTestApp
let aliceId = "00000000-0000-4000-8000-000000000001"
let bobId = "00000000-0000-4000-8000-000000000002"

beforeEach(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterEach(async () => {
	await fixture?.shutdown()
})

function actor(accountId: string) {
	return fixture.as({
		issuer: "https://alkalye.test",
		user_id: accountId,
		account_id: accountId,
		claims: {},
		authMode: "external",
	})
}
function note(ownerId = aliceId) {
	return {
		ownerId,
		title: "Private",
		content: "First line\nLast line",
		createdAt: new Date(),
		updatedAt: new Date(),
	}
}

test("owners create; outsiders cannot read, edit, delete or forge ownership", async () => {
	let alice = actor(aliceId),
		bob = actor(bobId)
	let doc = await alice.insert(app.documents, note()).wait({ tier: "global" })
	await expect(bob.all(app.documents.where({ id: doc.id }))).resolves.toEqual(
		[],
	)
	await bob.expectDenied(db =>
		db.update(app.documents, doc.id, { title: "Stolen" }),
	)
	await bob.expectDenied(db => db.delete(app.documents, doc.id))
	await bob.expectDenied(db => db.insert(app.documents, note()))
	await alice.expectDenied(db =>
		db.update(app.documents, doc.id, { ownerId: bobId }),
	)
})

test.each(["reader", "writer", "admin"] as const)(
	"document %s grants stay scoped and protect administration",
	async (role: "reader" | "writer" | "admin") => {
		let doc = await fixture.seed(db => db.insert(app.documents, note()))
		let other = await fixture.seed(db => db.insert(app.documents, note()))
		await fixture.seed(db =>
			db.insert(app.documentGrants, {
				documentId: doc.id,
				accountId: bobId,
				role,
			}),
		)
		let bob = actor(bobId)
		expect(await bob.all(app.documents.where({ id: doc.id }))).toHaveLength(1)
		expect(await bob.all(app.documents.where({ id: other.id }))).toHaveLength(0)
		await bob.expectDenied(db =>
			db.update(app.documents, other.id, { title: "Unrelated" }),
		)
		if (role === "reader")
			await bob.expectDenied(db =>
				db.update(app.documents, doc.id, { content: "Changed" }),
			)
		else
			await bob
				.update(app.documents, doc.id, { content: "Changed" })
				.wait({ tier: "global" })
		if (role !== "admin") {
			await bob.expectDenied(db =>
				db.update(app.documents, doc.id, { publicRead: true }),
			)
			await bob.expectDenied(db =>
				db.insert(app.documentGrants, {
					documentId: doc.id,
					accountId: bobId,
					role: "admin",
				}),
			)
		} else
			await bob
				.update(app.documents, doc.id, { publicRead: true })
				.wait({ tier: "global" })
	},
)

test.each(["reader", "writer", "manager", "admin"] as const)(
	"space %s inherits document access without granting access to other spaces",
	async (role: "reader" | "writer" | "manager" | "admin") => {
		let space = await fixture.seed(db =>
			db.insert(app.spaces, {
				ownerId: aliceId,
				name: "Space",
				createdAt: new Date(),
				updatedAt: new Date(),
			}),
		)
		await fixture.seed(db =>
			db.insert(app.spaceMembers, {
				spaceId: space.id,
				accountId: bobId,
				role,
			}),
		)
		let doc = await fixture.seed(db =>
			db.insert(app.documents, { ...note(), spaceId: space.id }),
		)
		let bob = actor(bobId)
		expect(await bob.all(app.documents.where({ id: doc.id }))).toHaveLength(1)
		if (role === "reader")
			await bob.expectDenied(db =>
				db.update(app.documents, doc.id, { content: "Changed" }),
			)
		else
			await bob
				.update(app.documents, doc.id, { content: "Changed" })
				.wait({ tier: "global" })
		if (role !== "admin")
			await bob.expectDenied(db =>
				db.insert(app.spaceMembers, {
					spaceId: space.id,
					accountId: bobId,
					role: "admin",
				}),
			)
		else
			await bob
				.update(app.spaces, space.id, { name: "Renamed" })
				.wait({ tier: "global" })
	},
)

test("public reads grant no document writes; credentials and imports stay private", async () => {
	let doc = await fixture.seed(db =>
		db.insert(app.documents, { ...note(), publicRead: true }),
	)
	let bob = actor(bobId)
	expect(await bob.all(app.documents.where({ id: doc.id }))).toHaveLength(1)
	await bob.expectDenied(db =>
		db.update(app.documents, doc.id, { content: "Public vandalism" }),
	)
	await bob.expectDenied(db =>
		db.insert(app.classicImports, {
			ownerId: bobId,
			classicId: "spoof",
			v2Id: doc.id,
			kind: "document",
			status: "complete",
		}),
	)
})

test.each(["reader", "writer", "manager", "admin"] as const)(
	"only writing members can create documents in their space (%s)",
	async (role: "reader" | "writer" | "manager" | "admin") => {
		let space = await fixture.seed(db =>
			db.insert(app.spaces, {
				ownerId: aliceId,
				name: "Team",
				createdAt: new Date(),
				updatedAt: new Date(),
			}),
		)
		let unrelated = await fixture.seed(db =>
			db.insert(app.spaces, {
				ownerId: aliceId,
				name: "Other",
				createdAt: new Date(),
				updatedAt: new Date(),
			}),
		)
		await fixture.seed(db =>
			db.insert(app.spaceMembers, {
				spaceId: space.id,
				accountId: bobId,
				role,
			}),
		)
		let bob = actor(bobId)
		let data = { ...note(bobId), spaceId: space.id }
		if (role === "reader")
			await bob.expectDenied(db => db.insert(app.documents, data))
		else await bob.insert(app.documents, data).wait({ tier: "global" })
		await bob.expectDenied(db =>
			db.insert(app.documents, { ...data, spaceId: unrelated.id }),
		)
	},
)

test("a document writer cannot move it, delete it or grant access", async () => {
	let doc = await fixture.seed(db => db.insert(app.documents, note()))
	let space = await fixture.seed(db =>
		db.insert(app.spaces, {
			ownerId: bobId,
			name: "Mine",
			createdAt: new Date(),
			updatedAt: new Date(),
		}),
	)
	await fixture.seed(db =>
		db.insert(app.documentGrants, {
			documentId: doc.id,
			accountId: bobId,
			role: "writer",
		}),
	)
	let bob = actor(bobId)
	await bob.expectDenied(db =>
		db.update(app.documents, doc.id, { spaceId: space.id }),
	)
	await bob.expectDenied(db =>
		db.update(app.documents, doc.id, { deletedAt: new Date() }),
	)
	await bob.expectDenied(db => db.delete(app.documents, doc.id))
})

test("document blobs inherit access; public access exposes no private account data", async () => {
	let doc = await fixture.seed(db =>
		db.insert(app.documents, { ...note(), publicRead: true }),
	)
	let alice = actor(aliceId),
		bob = actor(bobId)
	let asset = await alice
		.insert(app.assets, {
			documentId: doc.id,
			name: "Image",
			type: "image",
			data: new Uint8Array([1, 2, 3]),
			createdAt: new Date(),
		})
		.wait({ tier: "global" })
	expect((await bob.all(app.assets.where({ id: asset.id })))[0]?.data).toEqual(
		new Uint8Array([1, 2, 3]),
	)
	await bob.expectDenied(db =>
		db.update(app.assets, asset.id, { name: "Changed" }),
	)
	await fixture.seed(db =>
		db.insert(app.mcpConnections, {
			ownerId: aliceId,
			clientId: "test",
			clientName: "Test",
			credential: "test credential",
			createdAt: new Date(),
		}),
	)
	await fixture.seed(db =>
		db.insert(app.laser, {
			ownerId: aliceId,
			documentId: doc.id,
			senderId: "test",
			sequence: 1,
			message: {},
			updatedAt: new Date(),
		}),
	)
	expect(await bob.all(app.mcpConnections.where({}))).toEqual([])
	expect(await bob.all(app.laser.where({ documentId: doc.id }))).toHaveLength(1)
})

test("presence is readable with the document but only the publishing account can update it", async () => {
	let doc = await fixture.seed(db =>
		db.insert(app.documents, { ...note(), publicRead: true }),
	)
	let alice = actor(aliceId),
		bob = actor(bobId)
	let presence = await alice
		.insert(app.presence, {
			documentId: doc.id,
			accountId: aliceId,
			deviceId: "laptop",
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	expect(await bob.all(app.presence.where({ id: presence.id }))).toHaveLength(1)
	await bob.expectDenied(db =>
		db.update(app.presence, presence.id, { deviceId: "stolen" }),
	)
	await bob.expectDenied(db =>
		db.insert(app.presence, {
			documentId: doc.id,
			accountId: aliceId,
			deviceId: "forged",
			updatedAt: new Date(),
		}),
	)
})

test("personal library entries cannot grant access to unreadable documents", async () => {
	let doc = await fixture.seed(db => db.insert(app.documents, note()))
	let bob = actor(bobId)
	await bob.expectDenied(db =>
		db.insert(app.userDocuments, {
			ownerId: bobId,
			documentId: doc.id,
			rank: 0,
		}),
	)
	await bob.expectDenied(db =>
		db.insert(app.folders, { ownerId: aliceId, name: "forged", rank: 0 }),
	)
})

test("individual document grants work without space membership", async () => {
	let space = await fixture.seed(db =>
		db.insert(app.spaces, {
			ownerId: aliceId,
			name: "Private team",
			createdAt: new Date(),
			updatedAt: new Date(),
		}),
	)
	let doc = await fixture.seed(db =>
		db.insert(app.documents, { ...note(), spaceId: space.id }),
	)
	await fixture.seed(db =>
		db.insert(app.documentGrants, {
			documentId: doc.id,
			accountId: bobId,
			role: "writer",
		}),
	)
	await actor(bobId)
		.update(app.documents, doc.id, { content: "Shared directly" })
		.wait({ tier: "global" })
})

test("comments inherit document permissions and honor the disabled flag", async () => {
	let doc = await fixture.seed(db => db.insert(app.documents, note()))
	let alice = actor(aliceId),
		bob = actor(bobId)
	let comment = {
		documentId: doc.id,
		authorId: aliceId,
		anchor: { matched: "First line" },
		createdAt: new Date(),
		updatedAt: new Date(),
	}
	let thread = await alice
		.insert(app.commentThreads, comment)
		.wait({ tier: "global" })
	expect(await bob.all(app.commentThreads.where({ id: thread.id }))).toEqual([])
	await alice
		.update(app.documents, doc.id, { commentsDisabled: true })
		.wait({ tier: "global" })
	await alice.expectDenied(db => db.insert(app.commentThreads, comment))
	await alice.expectDenied(db =>
		db.insert(app.commentReplies, {
			threadId: thread.id,
			authorId: aliceId,
			body: "Disabled",
			createdAt: new Date(),
		}),
	)
})

test("presence updates cannot take another device row or move between documents", async () => {
	let doc = await fixture.seed(db =>
		db.insert(app.documents, { ...note(), publicRead: true }),
	)
	let other = await fixture.seed(db =>
		db.insert(app.documents, { ...note(), publicRead: true }),
	)
	let presence = await fixture.seed(db =>
		db.insert(app.presence, {
			documentId: doc.id,
			accountId: aliceId,
			deviceId: "alice-device",
			updatedAt: new Date(),
		}),
	)
	await actor(bobId).expectDenied(db =>
		db.update(app.presence, presence.id, { accountId: bobId }),
	)
	await actor(aliceId).expectDenied(db =>
		db.update(app.presence, presence.id, { documentId: other.id }),
	)
	await actor(aliceId)
		.update(app.presence, presence.id, {
			cursor: { position: 2 },
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
})

test("documents created for a space owner stop being readable when membership ends", async () => {
	let space = await fixture.seed(db =>
		db.insert(app.spaces, {
			ownerId: aliceId,
			name: "Team",
			createdAt: new Date(),
			updatedAt: new Date(),
		}),
	)
	let membership = await fixture.seed(db =>
		db.insert(app.spaceMembers, {
			spaceId: space.id,
			accountId: bobId,
			role: "writer",
		}),
	)
	let bob = actor(bobId)
	let doc = await bob
		.insert(app.documents, { ...note(aliceId), spaceId: space.id })
		.wait({ tier: "global" })
	await fixture.seed(db => db.delete(app.spaceMembers, membership.id))
	expect(await bob.all(app.documents.where({ id: doc.id }))).toHaveLength(0)
})

test("Classic merge bases stay hidden from the importer after document revocation", async () => {
	let doc = await fixture.seed(db => db.insert(app.documents, note(bobId)))
	let grant = await fixture.seed(db =>
		db.insert(app.documentGrants, {
			documentId: doc.id,
			accountId: aliceId,
			role: "writer",
		}),
	)
	let mapping = await fixture.seed(db =>
		db.insert(app.classicImports, {
			ownerId: aliceId,
			classicId: "co_zPrivate",
			v2Id: doc.id,
			kind: "document",
			baseContent: "first snapshot",
			status: "complete",
		}),
	)
	expect(await actor(aliceId).all(app.documents)).toHaveLength(1)
	await fixture.seed(db => db.delete(app.documentGrants, grant.id))
	await fixture.seed(db =>
		db.update(app.classicImports, mapping.id, {
			baseContent: "later private snapshot",
		}),
	)
	expect(await actor(aliceId).all(app.documents)).toHaveLength(0)
	expect(await actor(aliceId).all(app.classicImports)).toEqual([])
})

test("import status rows contain no content and belong only to the requesting account", async () => {
	await fixture.seed(db =>
		db.insert(app.classicImportStatus, {
			ownerId: aliceId,
			classicId: "co_z123",
			v2Id: crypto.randomUUID(),
			kind: "document",
			status: "waiting",
		}),
	)
	let rows = await actor(aliceId).all(app.classicImportStatus)
	expect(rows).toHaveLength(1)
	expect(rows[0]).not.toHaveProperty("baseContent")
	expect(await actor(bobId).all(app.classicImportStatus)).toHaveLength(0)
	await actor(aliceId).expectDenied(db =>
		db.update(app.classicImportStatus, rows[0]!.id, { status: "complete" }),
	)
})
