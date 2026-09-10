import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport } from "@modelcontextprotocol/server"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./config", () => ({
	getMcpConfig() {
		return { baseUrl: new URL("https://www.alkalye.com") }
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
})
