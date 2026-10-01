import { describe, expect, test, vi } from "vitest"
import { McpConnection, UserAccount } from "@/schema"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { readJsonResponse, disconnectMcpConnection } from "./agent-api"

describe("readJsonResponse", () => {
	test("returns undefined when an upstream failure has no response body", async () => {
		let response = new Response(null, { status: 500 })

		await expect(readJsonResponse(response)).resolves.toBeUndefined()
	})
})

test("revokes locally before contacting an unavailable server", async () => {
	await setupJazzTestSync()
	let account = await createJazzTestAccount({
		AccountSchema: UserAccount,
		isCurrentActiveAccount: true,
	})
	let connection = McpConnection.create(
		{
			clientId: "https://custom.example/client.json",
			clientName: "Custom",
			credential: "old-key-credential",
			createdAt: new Date(),
		},
		account,
	)
	let sync = vi.fn().mockRejectedValue(new Error("Offline"))
	let request = vi.fn(async () => {
		expect(connection.revokedAt).toBeInstanceOf(Date)
		throw new Error("Server unavailable")
	})
	vi.stubGlobal("fetch", request)
	try {
		await expect(
			disconnectMcpConnection(connection, sync),
		).resolves.toBeUndefined()
		expect(connection.revokedAt).toBeInstanceOf(Date)
		expect(sync).toHaveBeenCalledOnce()
	} finally {
		vi.unstubAllGlobals()
	}
})
