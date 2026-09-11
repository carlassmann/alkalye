import { co, z } from "jazz-tools"

export { AgentConnection }

let AgentConnection = co.map({
	provider: z.enum(["openai", "anthropic"]),
	accountId: z.string(),
	credential: z.string(),
	personalDocumentsRole: z.enum(["reader", "writer"]).optional(),
	createdAt: z.date(),
})
