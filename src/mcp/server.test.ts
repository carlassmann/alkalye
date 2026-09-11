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
import { UserAccount, createSpace } from "@/schema"

let jazzMocks = vi.hoisted(() => ({ runWithAgentAccount: vi.fn() }))

vi.mock("./jazz", () => ({
	openAgentAccount: vi.fn(),
	runWithAgentAccount: jazzMocks.runWithAgentAccount,
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

	it("executes document tools against Jazz and hides archived documents", async () => {
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
		jazzMocks.runWithAgentAccount.mockImplementation(
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
	})
})
