import { describe, expect, test } from "vitest"
import { Group } from "jazz-tools"
import { LocalNode } from "cojson"
import {
	createJazzTestAccount,
	setupJazzTestSync,
	TestJSCrypto,
} from "jazz-tools/testing"
import { UserAccount, McpConnection, createMcpConnections } from "@/schema"

describe("MCP connection list initialization", () => {
	test("concurrent nodes append to the same list without replacing existing connections", async () => {
		await setupJazzTestSync()
		let account = await createJazzTestAccount({
			AccountSchema: UserAccount,
			isCurrentActiveAccount: true,
		})
		let owner = Group.create(account)
		let crypto = await TestJSCrypto.create()
		let otherNode = new LocalNode(
			account.$jazz.localNode.getCurrentAgent().agentSecret,
			crypto.newRandomSessionID(account.$jazz.raw.id),
			crypto,
		)
		for (let core of account.$jazz.localNode.allCoValues()) {
			for (let chunk of core.verified?.newContentSince(undefined) ?? [])
				otherNode.syncManager.handleNewContent(chunk, "import")
		}
		let other = UserAccount.getCoValueClass().fromNode(otherNode)
		let otherOwner = await Group.load(owner.$jazz.id, { loadAs: other })
		if (!otherOwner.$isLoaded) throw new Error("Owner unavailable")
		let [first, second, repeated] = await Promise.all([
			createMcpConnections(owner),
			createMcpConnections(otherOwner),
			createMcpConnections(owner),
		])
		expect(second.$jazz.id).toBe(first.$jazz.id)
		expect(repeated.$jazz.id).toBe(first.$jazz.id)
		let values = {
			clientId: "https://custom.example/client.json",
			clientName: "Custom",
			credential: "wrapped",
			createdAt: new Date(),
		}
		first.$jazz.push(McpConnection.create(values, owner))
		second.$jazz.push(McpConnection.create(values, otherOwner))
		for (let core of otherNode.allCoValues()) {
			for (let chunk of core.verified?.newContentSince(undefined) ?? [])
				account.$jazz.localNode.syncManager.handleNewContent(chunk, "import")
		}
		expect(first.length).toBe(2)
		expect((await createMcpConnections(owner)).length).toBe(2)
	})
})
