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

test.each(["reader", "writer", "admin"])(
	"document %s grants stay scoped and protect administration",
	async role => {
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

test.each(["reader", "writer", "manager", "admin"])(
	"space %s inherits document access without granting access to other spaces",
	async role => {
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

test("public reads grant no writes; credentials, laser and imports stay private", async () => {
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
