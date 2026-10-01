import { co, z, Account, type Group } from "jazz-tools"
import { isRawCoID } from "cojson"

export { AgentConnection, McpConnection, createMcpConnections }

let AgentConnection = co.map({
	provider: z.enum(["openai", "anthropic"]),
	accountId: z.string(),
	credential: z.string(),
	personalDocumentsRole: z.enum(["reader", "writer"]).optional(),
	createdAt: z.date(),
})

let McpConnection = co.map({
	clientId: z.string(),
	clientName: z.string(),
	credential: z.string(),
	createdAt: z.date(),
	revokedAt: z.date().optional(),
})

async function createMcpConnections(owner: Account | Group) {
	// Concurrent first approvals must append to the same list across server instances.
	let account = Account.fromNode(owner.$jazz.localNode)
	let schema = co.list(McpConnection)
	let id = schema.findUnique("mcp-connections", owner.$jazz.id, owner)
	if (!isRawCoID(id)) throw new Error("Invalid MCP connection list")
	if (owner.$jazz.localNode.getCoValue(id).hasVerifiedContent()) {
		let loaded = await schema.load(id, { loadAs: account })
		if (!loaded.$isLoaded) throw new Error("MCP connections are unavailable")
		return loaded
	}
	if (!account.canWrite(owner))
		throw new Error("MCP connections are unavailable")
	// Creating an empty deterministic list offline preserves entries arriving later.
	return schema.create([], { owner, unique: "mcp-connections" })
}
