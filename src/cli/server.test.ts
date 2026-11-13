// @vitest-environment node
import { beforeAll, afterAll, expect, test, vi } from "vitest"
import { createJazz, memory, type Jazz } from "jazz-tools/backend"
import { app } from "@/jazz/schema"
import { permissions } from "@/jazz/permissions"
import { executeServerCommand } from "./server"
import { sharingOperation } from "@/jazz/sharing/operations"

let state: { jazz?: Jazz } = vi.hoisted(() => ({}))
vi.mock("@/jazz/server", () => ({
	get jazz() {
		return state.jazz
	},
}))
let alice = "00000000-0000-4000-8000-000000000001"
let bob = "00000000-0000-4000-8000-000000000002"
let documentId: string
let spaceId: string
let origin = "https://alkalye.test"
beforeAll(async () => {
	state.jazz = await createJazz({ app, permissions, store: memory() }).ready()
})
afterAll(async () => {
	await state.jazz?.close()
})
async function run(
	command: string,
	args: Record<string, unknown> = {},
	accountId = alice,
) {
	let db = await state.jazz!.forUser(accountId)
	return executeServerCommand(db, command, args, origin)
}
function field(value: unknown, key: string) {
	if (
		value &&
		typeof value === "object" &&
		key in value &&
		typeof Reflect.get(value, key) === "string"
	) {
		let result: unknown = Reflect.get(value, key)
		if (typeof result === "string") return result
	}
	throw new Error(`Missing ${key}`)
}

test("CLI account, document CRUD, archive/restore, space movement preserve content", async () => {
	await run("auth.signup", { name: "Alice" })
	expect(await run("auth.whoami")).toMatchObject({
		accountId: alice,
		name: "Alice",
	})
	documentId = field(
		await run("doc.create", { content: "# CLI document\n\nBody" }),
		"documentId",
	)
	expect(await run("doc.content", { docId: documentId })).toBe(
		"# CLI document\n\nBody",
	)
	await run("doc.rename", { docId: documentId, title: "Renamed" })
	expect(await run("doc.content", { docId: documentId })).toContain("# Renamed")
	spaceId = field(await run("space.create", { name: "Team" }), "spaceId")
	await run("doc.move", { docId: documentId, scope: `space:${spaceId}` })
	expect(await run("space.docs", { spaceId })).toMatchObject([{ documentId }])
	await run("doc.move", { docId: documentId, scope: "personal" })
	await run("doc.delete", { docId: documentId })
	expect(await run("doc.list", {})).toEqual([])
	await run("doc.restore", { docId: documentId })
	expect(await run("doc.list", {})).toMatchObject([{ documentId }])
})

test("one-use invites, writer edit, reader rejection and revoke remove just that grant", async () => {
	let invite = await run("doc.share.create", {
		docId: documentId,
		role: "writer",
	})
	let link = field(invite, "link")
	expect(await run("invite.accept", { link }, bob)).toMatchObject({
		accepted: true,
	})
	await expect(run("invite.accept", { link }, bob)).rejects.toThrow()
	await run(
		"doc.update",
		{ docId: documentId, content: "# Shared writer" },
		bob,
	)
	await expect(
		run("doc.move", { docId: documentId, scope: "personal" }, bob),
	).rejects.toThrow()
	await run("doc.share.revoke", {
		docId: documentId,
		inviteGroupId: field(invite, "inviteGroupId"),
	})
	await expect(run("doc.content", { docId: documentId }, bob)).rejects.toThrow(
		"not found",
	)
	let reader = await run("doc.share.create", {
		docId: documentId,
		role: "reader",
	})
	await run("invite.accept", { link: field(reader, "link") }, bob)
	await expect(
		run("doc.update", { docId: documentId, content: "Forbidden" }, bob),
	).rejects.toThrow()
})

test("asset references, comment anchors and theme sources use v2 rows", async () => {
	let added = await run("doc.asset.add", {
		docId: documentId,
		file: "photo.png",
		data: "iVBORw0KGgo=",
		name: "Photo",
	})
	let assetId = field(added, "assetId")
	await run("doc.update", {
		docId: documentId,
		content: `# Assets\n\n![Photo](asset:${assetId})\n\nQuote`,
	})
	expect(
		await run("doc.asset.remove", { docId: documentId, assetId }),
	).toMatchObject({ removedFromContent: true })
	expect(await run("doc.content", { docId: documentId })).not.toContain(assetId)
	let comment = await run("doc.comment.add", {
		docId: documentId,
		quote: "Quote",
		body: "Question",
	})
	await run("doc.comment.reply", {
		docId: documentId,
		commentId: field(comment, "commentId"),
		body: "Answer",
	})
	let source = "# QA theme\n\n```css theme\nh1 { color: red; }\n```"
	let themeId = field(
		await run("theme.create", { sourceContent: source, name: "QA theme" }),
		"themeId",
	)
	expect(await run("theme.get", { themeId })).toMatchObject({
		source,
		css: "h1 { color: red; }",
	})
	await run("theme.update", {
		themeId,
		sourceContent: source.replace("red", "blue"),
	})
	expect(await run("theme.get", { themeId })).toMatchObject({
		css: "h1 { color: blue; }",
	})
	await expect(run("theme.get", { themeId }, bob)).rejects.toThrow()
})

test("CLI invitations open in the browser and browser revocation removes CLI redemptions", async () => {
	let invite = await run("doc.share.create", {
		docId: documentId,
		role: "reader",
	})
	let link = new URL(field(invite, "link"))
	let parts = link.hash.split("/")
	expect(parts.slice(0, 4)).toEqual(["#", "doc", documentId, "invite"])
	let inviteId = field(invite, "inviteGroupId")
	let carol = "00000000-0000-4000-8000-000000000003"
	await sharingOperation(
		state.jazz!,
		carol,
		"redeem",
		{ inviteId, secret: parts[5] },
		origin,
	)
	expect(await run("doc.content", { docId: documentId }, carol)).toContain(
		"Quote",
	)
	await run("doc.share.revoke", { docId: documentId, inviteGroupId: inviteId })
	await expect(
		run("doc.content", { docId: documentId }, carol),
	).rejects.toThrow()

	let browser = await sharingOperation(
		state.jazz!,
		alice,
		"create-invite",
		{
			documentId,
			role: "reader",
			singleUse: true,
		},
		origin,
	)
	await run("invite.accept", { link: browser.link }, carol)
	await sharingOperation(
		state.jazz!,
		alice,
		"revoke",
		{ inviteId: browser.id },
		origin,
	)
	await expect(
		run("doc.content", { docId: documentId }, carol),
	).rejects.toThrow()
})
