import type { APIRoute } from "astro"
import { z } from "zod"
import { getMcpConfig } from "@/mcp/config"
import { createAgentAccount } from "@/mcp/jazz"

export { POST }

export const prerender = false

let requestSchema = z.object({
	provider: z.enum(["openai", "anthropic"]),
})

let POST: APIRoute = async ({ request }) => {
	try {
		let body: unknown = await request.json()
		let { provider } = requestSchema.parse(body)
		let config = getMcpConfig()
		let agent = await createAgentAccount(
			config.syncServer,
			provider === "openai" ? "My ChatGPT" : "My Claude",
		)
		try {
			let credential = await config.tokens.seal("connection", agent.credentials)
			return json({
				provider,
				accountId: agent.credentials.accountId,
				credential,
				createdAt: new Date().toISOString(),
			})
		} finally {
			await agent.close()
		}
	} catch (error) {
		console.error("[agent-connections] provisioning failed", error)
		return json({ error: "Could not create agent connection" }, 400)
	}
}

function json(body: unknown, status: number = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}
