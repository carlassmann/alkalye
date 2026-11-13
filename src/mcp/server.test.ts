import { Buffer } from "node:buffer"
// @vitest-environment node
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import {
	createJazz,
	memory,
	acceptDeviceAccounts,
	type Jazz,
} from "jazz-tools/backend"
import { mintLocalFirstTokenInJs } from "jazz-tools/thin"
import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport } from "@modelcontextprotocol/server"
import { z } from "zod"
import { app } from "@/jazz/schema"
import { permissions } from "@/jazz/permissions"
import { createTokenCodec } from "./token"

let state: { jazz?: Jazz } = vi.hoisted(() => ({}))
vi.mock("@/jazz/server", () => ({
	get jazz() {
		return state.jazz
	},
}))
let tokens = createTokenCodec("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
let aliceRequest: Request
let bobRequest: Request
let client: Client
let server: Awaited<ReturnType<typeof connect>>["server"]
let credential: string
let documentId: string
let revision: string
let accountId: string

beforeAll(async () => {
	state.jazz = await createJazz({
		app,
		permissions,
		store: memory(),
		authenticate: acceptDeviceAccounts,
		publicUrl: "https://alkalye.test/jazz",
	}).ready()
	aliceRequest = request(
		`jazz-auth-v1:${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`,
	)
	bobRequest = request(
		`jazz-auth-v1:${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`,
	)
	let { createUserConnection } = await import("./jazz")
	credential = await createUserConnection(
		aliceRequest,
		{ id: "https://client.test/client.json", name: "QA" },
		tokens,
	)
	let connected = await connect(credential)
	client = connected.client
	server = connected.server
	let db = await state.jazz.forReqUser(aliceRequest)
	accountId = db.getAuthState().session!.user!
}, 30_000)
afterAll(async () => {
	await client?.close()
	await server?.close()
	await state.jazz?.close()
})

function request(phrase: string) {
	return new Request("https://alkalye.test/api/oauth-approve", {
		method: "POST",
		headers: {
			authorization: `Bearer ${mintLocalFirstTokenInJs(phrase, "https://alkalye.test/jazz")}`,
		},
	})
}
async function connect(credential: string) {
	let { createAlkalyeServer } = await import("./server")
	let server = createAlkalyeServer(credential)
	let client = new Client({ name: "QA", version: "1" })
	let [a, b] = InMemoryTransport.createLinkedPair()
	await server.connect(b)
	await client.connect(a)
	return { server, client }
}
async function call(name: string, args: Record<string, unknown> = {}) {
	return client.callTool({ name, arguments: args })
}

test("custom routes reject forged proofs, wrong audiences and foreign browser origins", async () => {
	let authorization = aliceRequest.headers.get("authorization")!
	await expect(
		state.jazz!.forReqUser(
			new Request(aliceRequest.url, {
				headers: { authorization: authorization + "tampered" },
			}),
		),
	).rejects.toThrow()
	await expect(
		state.jazz!.forReqUser(
			new Request(aliceRequest.url, {
				headers: { authorization, origin: "https://attacker.test" },
			}),
		),
	).rejects.toThrow()
	let key = `jazz-auth-v1:${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`
	await expect(
		state.jazz!.forReqUser(
			new Request(aliceRequest.url, {
				headers: {
					authorization: `Bearer ${mintLocalFirstTokenInJs(key, "https://other-app.test/jazz")}`,
				},
			}),
		),
	).rejects.toThrow()
})

test("same eleven tool contracts, create, list, read, revision-safe rename and update", async () => {
	expect((await client.listTools()).tools.map(t => t.name)).toEqual([
		"list_documents",
		"get_document",
		"update_document",
		"create_document",
		"rename_document",
		"archive_document",
		"list_comments",
		"add_comment",
		"reply_to_comment",
		"set_comment_resolved",
		"rename_space",
	])
	let created = await call("create_document", {
		content: "# QA\n\nQuoted text",
	})
	expect(created.isError).toBeFalsy()
	let doc = z
		.object({ documentId: z.string(), revision: z.string() })
		.parse(created.structuredContent)
	documentId = doc.documentId
	revision = doc.revision
	expect((await call("list_documents")).structuredContent).toMatchObject({
		personal: [{ documentId }],
	})
	expect(
		(await call("get_document", { documentId })).structuredContent,
	).toMatchObject({ content: "# QA\n\nQuoted text" })
	expect(
		(
			await call("update_document", {
				documentId,
				content: "Overwrite",
				expectedRevision: "stale",
			})
		).isError,
	).toBe(true)
	let renamed = await call("rename_document", {
		documentId,
		title: "Renamed",
		expectedRevision: revision,
	})
	expect(renamed.isError).toBeFalsy()
	revision = z
		.object({ revision: z.string() })
		.parse(renamed.structuredContent).revision
	let updated = await call("update_document", {
		documentId,
		content: "# Renamed\n\nQuoted text edited",
		expectedRevision: revision,
	})
	expect(updated.isError).toBeFalsy()
})

test("anchored comments, replies, resolve/reopen and space rename", async () => {
	let added = await call("add_comment", {
		documentId,
		quote: "Quoted text",
		body: "Question",
	})
	expect(added.isError).toBeFalsy()
	let { commentId } = z
		.object({ commentId: z.string() })
		.parse(added.structuredContent)
	expect(
		(await call("reply_to_comment", { documentId, commentId, body: "Answer" }))
			.structuredContent,
	).toMatchObject({ replies: [{ body: "Question" }, { body: "Answer" }] })
	expect(
		(
			await call("set_comment_resolved", {
				documentId,
				commentId,
				resolved: true,
			})
		).structuredContent,
	).toMatchObject({ resolved: true })
	expect(
		(
			await call("set_comment_resolved", {
				documentId,
				commentId,
				resolved: false,
			})
		).structuredContent,
	).toMatchObject({ resolved: false })
	expect(
		(await call("list_comments", { documentId })).structuredContent,
	).toMatchObject({ comments: [{ commentId }] })
	let space = await state
		.jazz!.db.insert(app.spaces, {
			ownerId: accountId,
			name: "Team",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.wait({ tier: "global" })
	expect(
		(await call("rename_space", { spaceId: space.id, name: "Renamed team" }))
			.structuredContent,
	).toMatchObject({ name: "Renamed team" })
})

test("outsiders cannot read docs, writers edit, readers cannot edit/archive, forged grants denied", async () => {
	let { createUserConnection } = await import("./jazz")
	let bobCredential = await createUserConnection(
		bobRequest,
		{ id: "https://client.test/client.json", name: "Bob" },
		tokens,
	)
	let bob = await connect(bobCredential)
	try {
		expect(
			(
				await bob.client.callTool({
					name: "get_document",
					arguments: { documentId },
				})
			).isError,
		).toBe(true)
		let db = await state.jazz!.forReqUser(bobRequest)
		let bobId = db.getAuthState().session!.user!
		await expect(
			db
				.insert(app.mcpConnections, {
					ownerId: bobId,
					clientId: "https://client.test/client.json",
					clientName: "Fake",
					credential: "fake",
					createdAt: new Date(),
				})
				.wait({ tier: "global" }),
		).rejects.toThrow()
		let grant = await state
			.jazz!.db.insert(app.documentGrants, {
				documentId,
				accountId: bobId,
				role: "reader",
			})
			.wait({ tier: "global" })
		expect(
			(
				await bob.client.callTool({
					name: "get_document",
					arguments: { documentId },
				})
			).isError,
		).toBeFalsy()
		expect(
			(
				await bob.client.callTool({
					name: "archive_document",
					arguments: { documentId },
				})
			).isError,
		).toBe(true)
		await state
			.jazz!.db.update(app.documentGrants, grant.id, { role: "writer" })
			.wait({ tier: "global" })
		let doc = z
			.object({ revision: z.string() })
			.parse((await call("get_document", { documentId })).structuredContent)
		expect(
			(
				await bob.client.callTool({
					name: "update_document",
					arguments: {
						documentId,
						content: "# Shared writer",
						expectedRevision: doc.revision,
					},
				})
			).isError,
		).toBeFalsy()
	} finally {
		await bob.client.close()
		await bob.server.close()
	}
})

test("revocation checked per tool call and cannot revoke someone else's connection", async () => {
	let { revokeUserConnection, validateCredentials } = await import("./jazz")
	let credentials = await validateCredentials(credential, tokens)
	await expect(
		revokeUserConnection(bobRequest, credentials.connectionId),
	).rejects.toThrow()
	await revokeUserConnection(aliceRequest, credentials.connectionId)
	expect((await call("get_document", { documentId })).isError).toBe(true)
	await expect(validateCredentials(credential, tokens)).rejects.toThrow(
		"disconnected",
	)
})
