import { co, z } from "jazz-tools"

export { AgentConnection }

let AgentConnection = co.map({
	provider: z.enum(["openai", "anthropic"]),
	accountId: z.string(),
	credential: z.string(),
	personalDocumentsRole: z.enum(["reader", "writer"]).optional(),
	createdAt: z.date(),
})

export { McpConnection }

let McpConnection = co.map({
	clientId: z.string(),
	clientName: z.string(),
	credential: z.string(),
	createdAt: z.date(),
	revokedAt: z.date().optional(),
})
