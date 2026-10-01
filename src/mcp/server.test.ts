import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport } from "@modelcontextprotocol/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import {
	createJazzTestAccount,
	setActiveAccount,
	setupJazzTestSync,
} from "jazz-tools/testing"
import { createPersonalDocument } from "@/app/features/documents"
import { UserAccount, Document, createSpace } from "@/schema"

let jazzMocks = vi.hoisted(() => ({ runWithUserAccount: vi.fn() }))

vi.mock("./jazz", () => ({
	openUserAccount: vi.fn(),
	runWithUserAccount: jazzMocks.runWithUserAccount,
}))

vi.mock("./config", () => ({
	getMcpConfig() {
		return {
			baseUrl: new URL("https://www.alkalye.com"),
			syncServer: "wss://sync.example.com",
			tokens: { open: vi.fn().mockResolvedValue({ accountId: "agent" }) },
		}
	},
}))

let closeConnections: (() => Promise<void>) | undefined

afterEach(async () => {
	await closeConnections?.()
	closeConnections = undefined
})

describe("Alkalye MCP tool catalog", () => {
	it("rejects legacy HTTP protocol traffic", async () => {
		let { mcpHandler } = await import("./server")
		let response = await mcpHandler.fetch(
			new Request("https://www.alkalye.com/mcp", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: "Bearer test-token",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-03-26",
						capabilities: {},
						clientInfo: { name: "legacy-client", version: "1.0.0" },
					},
				}),
			}),
			{
				authInfo: {
					token: "credential",
					clientId: "https://chatgpt.com/client.json",
					scopes: ["alkalye"],
					resource: new URL("https://www.alkalye.com/mcp"),
				},
			},
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({
			error: { code: -32022 },
		})
	})

	it("publishes review-ready schemas, auth, and safety annotations", async () => {
		let { createAlkalyeServer } = await import("./server")
		let server = createAlkalyeServer(undefined)
		let client = new Client({ name: "submission-qa", version: "1.0.0" })
		let [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair()
		await server.connect(serverTransport)
		await client.connect(clientTransport)
		closeConnections = async () => {
			await client.close()
			await server.close()
		}

		let { tools } = await client.listTools()

		expect(tools.map(tool => tool.name)).toEqual([
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
		for (let tool of tools) {
			expect(tool.title).toBeTruthy()
			expect(tool.description).toBeTruthy()
			expect(tool.outputSchema).toMatchObject({ type: "object" })
			expect(tool.annotations).toEqual(
				expect.objectContaining({
					readOnlyHint: expect.any(Boolean),
					destructiveHint: expect.any(Boolean),
					openWorldHint: false,
				}),
			)
			expect(tool._meta).toEqual({
				securitySchemes: [{ type: "oauth2", scopes: ["alkalye"] }],
			})
		}
	})

	it("uses the user’s Jazz permissions, hides archived documents, and creates personally", async () => {
		await setupJazzTestSync()
		let account = await createJazzTestAccount({
			isCurrentActiveAccount: true,
			AccountSchema: UserAccount,
		})
		setActiveAccount(account)
		let active = await createPersonalDocument(account, "# Active\n\nHello")
		let archived = await createPersonalDocument(account, "# Archived")
		archived.$jazz.set("deletedAt", new Date())
		let spaceDocument = await createPersonalDocument(
			account,
			"# Space document",
		)
		let loaded = await account.$jazz.ensureLoaded({
			resolve: { root: { documents: true, spaces: true } },
		})
		let space = createSpace("Team", loaded.root)
		spaceDocument.$jazz.set("spaceId", space.$jazz.id)
		let loadedSpace = await space.$jazz.ensureLoaded({
			resolve: { documents: { $each: { content: true } } },
		})
		loadedSpace.documents.$jazz.push(spaceDocument)
		jazzMocks.runWithUserAccount.mockImplementation(
			async (
				_syncServer: string,
				_credentials: unknown,
				operation: (agent: {
					account: typeof account
					close(): Promise<void>
				}) => Promise<unknown>,
			) => operation({ account, async close() {} }),
		)
		let { createAlkalyeServer } = await import("./server")
		let server = createAlkalyeServer("credential")
		let client = new Client({ name: "integration-qa", version: "1.0.0" })
		let [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair()
		await server.connect(serverTransport)
		await client.connect(clientTransport)
		closeConnections = async () => {
			await client.close()
			await server.close()
		}

		let listed = await client.callTool({
			name: "list_documents",
			arguments: {},
		})
		expect(listed.structuredContent).toMatchObject({
			personal: expect.arrayContaining([
				expect.objectContaining({
					documentId: active.$jazz.id,
					title: "Active",
				}),
			]),
		})
		expect(JSON.stringify(listed.structuredContent)).not.toContain(
			archived.$jazz.id,
		)
		expect(listed.structuredContent).toMatchObject({
			personal: expect.not.arrayContaining([
				expect.objectContaining({ documentId: spaceDocument.$jazz.id }),
			]),
			spaces: [
				expect.objectContaining({
					spaceId: space.$jazz.id,
					documents: expect.arrayContaining([
						expect.objectContaining({ documentId: spaceDocument.$jazz.id }),
					]),
				}),
			],
		})
		let read = await client.callTool({
			name: "get_document",
			arguments: { documentId: active.$jazz.id },
		})
		expect(read.structuredContent).toMatchObject({
			documentId: active.$jazz.id,
			content: "# Active\n\nHello",
		})
		let readResult = z
			.object({ revision: z.string() })
			.parse(read.structuredContent)
		let updated = await client.callTool({
			name: "update_document",
			arguments: {
				documentId: active.$jazz.id,
				content: "# Active\n\nUpdated by ChatGPT",
				expectedRevision: readResult.revision,
			},
		})
		expect(updated.isError).not.toBe(true)
		expect(active.content.toString()).toBe("# Active\n\nUpdated by ChatGPT")
		let archivedRead = await client.callTool({
			name: "get_document",
			arguments: { documentId: archived.$jazz.id },
		})
		expect(archivedRead.isError).toBe(true)

		let other = await createJazzTestAccount({ AccountSchema: UserAccount })
		setActiveAccount(other)
		let sharedWriter = await createPersonalDocument(other, "Writer content")
		let sharedReader = await createPersonalDocument(other, "Reader content")
		let privateDocument = await createPersonalDocument(other, "Private content")
		sharedWriter.$jazz.owner.addMember(account, "writer")
		sharedReader.$jazz.owner.addMember(account, "reader")
		setActiveAccount(account)
		let writer = await Document.load(sharedWriter.$jazz.id, {
			loadAs: account,
			resolve: { content: true },
		})
		let reader = await Document.load(sharedReader.$jazz.id, {
			loadAs: account,
			resolve: { content: true },
		})
		if (!writer.$isLoaded || !reader.$isLoaded)
			throw new Error("Shared documents unavailable")
		loaded.root.documents.$jazz.push(sharedWriter, sharedReader)
		expect(writer.$jazz.owner.myRole()).toBe("writer")
		let writerRead = await client.callTool({
			name: "get_document",
			arguments: { documentId: writer.$jazz.id },
		})
		let writerRevision = z
			.object({ revision: z.string() })
			.parse(writerRead.structuredContent).revision
		let writerUpdate = await client.callTool({
			name: "update_document",
			arguments: {
				documentId: writer.$jazz.id,
				content: "Updated as user",
				expectedRevision: writerRevision,
			},
		})
		expect(writerUpdate.isError).not.toBe(true)
		expect(writer.content.toString()).toBe("Updated as user")
		let readerRead = await client.callTool({
			name: "get_document",
			arguments: { documentId: reader.$jazz.id },
		})
		let readerRevision = z
			.object({ revision: z.string() })
			.parse(readerRead.structuredContent).revision
		let readerUpdate = await client.callTool({
			name: "update_document",
			arguments: {
				documentId: reader.$jazz.id,
				content: "Unauthorized change",
				expectedRevision: readerRevision,
			},
		})
		expect(readerUpdate.isError).toBe(true)
		expect(reader.content.toString()).toBe("Reader content")
		setActiveAccount(other)
		sharedWriter.$jazz.owner.addMember(account, "manager")
		setActiveAccount(account)
		let managerRead = await client.callTool({
			name: "get_document",
			arguments: { documentId: writer.$jazz.id },
		})
		let managerRevision = z
			.object({ revision: z.string() })
			.parse(managerRead.structuredContent).revision
		let managerUpdate = await client.callTool({
			name: "update_document",
			arguments: {
				documentId: writer.$jazz.id,
				content: "Updated as manager",
				expectedRevision: managerRevision,
			},
		})
		expect(managerUpdate.isError).not.toBe(true)
		expect(writer.content.toString()).toBe("Updated as manager")
		let writerArchive = await client.callTool({
			name: "archive_document",
			arguments: { documentId: writer.$jazz.id },
		})
		expect(writerArchive.isError).toBe(true)
		expect(writer.deletedAt).toBeUndefined()
		let privateRead = await client.callTool({
			name: "get_document",
			arguments: { documentId: privateDocument.$jazz.id },
		})
		expect(privateRead.isError).toBe(true)
		// The server has no global active account; creation must use its explicit user.
		setActiveAccount(other)
		let created = await client.callTool({
			name: "create_document",
			arguments: { content: "# Created personally" },
		})
		expect(created.isError).not.toBe(true)
		let createdId = z
			.object({ documentId: z.string() })
			.parse(created.structuredContent).documentId
		let createdDocument = await Document.load(createdId, { loadAs: account })
		if (!createdDocument.$isLoaded)
			throw new Error("Created document unavailable")
		expect(createdDocument.$jazz.owner.getRoleOf(account.$jazz.id)).toBe(
			"admin",
		)
		expect(
			createdDocument.$jazz.owner.getRoleOf(other.$jazz.id),
		).toBeUndefined()
		setActiveAccount(account)
	})
})
