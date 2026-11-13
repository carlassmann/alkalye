// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing"
import { app } from "@/jazz/schema"
import { permissions } from "@/jazz/permissions"
import { createLaserChannel } from "./laser-channel"
import type { LaserMessage } from "./laser-schema"

let fixture: PolicyTestApp,
	channels: ReturnType<typeof createLaserChannel>[] = []
let aliceId = "00000000-0000-4000-8000-000000000001",
	bobId = "00000000-0000-4000-8000-000000000002"
beforeEach(async () => {
	vi.stubGlobal("window", new EventTarget())
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterEach(async () => {
	for (let channel of channels) channel.close()
	channels = []
	await fixture.shutdown()
	vi.unstubAllGlobals()
})
function actor(id: string) {
	return fixture.as({
		issuer: "https://alkalye.test",
		user_id: id,
		account_id: id,
		claims: {},
		authMode: "external",
	})
}
async function document() {
	let db = actor(aliceId)
	return db
		.insert(app.documents, {
			ownerId: aliceId,
			title: "Slides",
			content: "# Slide",
			publicRead: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
}
test("cross-author channels receive latest samples once, scoped to their document", async () => {
	let doc = await document(),
		alice = actor(aliceId),
		bob = actor(bobId)
	let received: LaserMessage[] = [],
		other: LaserMessage[] = []
	let otherDoc = await document()
	let receiver = createLaserChannel(bob, doc.id, message =>
			received.push(message),
		),
		unrelated = createLaserChannel(bob, otherDoc.id, message =>
			other.push(message),
		),
		sender = createLaserChannel(alice, doc.id, () => {})
	channels.push(receiver, unrelated, sender)
	sender.postMessage({ type: "discover", request: "one" })
	await expect.poll(() => received.length).toBe(1)
	expect(received[0]).toEqual({ type: "discover", request: "one" })
	sender.postMessage({ type: "discover", request: "two" })
	await expect.poll(() => received.length).toBe(2)
	expect(other).toEqual([])
	await alice.waitForSync()
	expect(await bob.all(app.laser.where({ documentId: doc.id }))).toHaveLength(1)
})
test("stale rows are ignored; pagehide suspends writes and pageshow resumes", async () => {
	let doc = await document(),
		alice = actor(aliceId),
		bob = actor(bobId)
	await alice
		.insert(app.laser, {
			ownerId: aliceId,
			documentId: doc.id,
			senderId: "stale",
			sequence: 1,
			message: { type: "discover", request: "stale" },
			updatedAt: new Date(Date.now() - 20_000),
		})
		.wait({ tier: "global" })
	let received: LaserMessage[] = []
	let receiver = createLaserChannel(bob, doc.id, message =>
			received.push(message),
		),
		sender = createLaserChannel(alice, doc.id, () => {})
	channels.push(receiver, sender)
	window.dispatchEvent(new Event("pagehide"))
	sender.postMessage({ type: "discover", request: "hidden" })
	window.dispatchEvent(new Event("pageshow"))
	sender.postMessage({ type: "discover", request: "visible" })
	await expect
		.poll(() => received)
		.toEqual([{ type: "discover", request: "visible" }])
	let rows = await bob.all(app.laser.where({ documentId: doc.id }))
	let row = rows.find(row => row.senderId !== "stale")
	if (!row) throw new Error("Sender missing")
	await bob.expectDenied(db => db.update(app.laser, row.id, { ownerId: bobId }))
})
