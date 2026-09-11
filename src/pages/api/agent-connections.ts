import { createHash } from "node:crypto"
import type { APIRoute } from "astro"
import { z } from "zod"
import { getMcpConfig } from "@/mcp/config"
import { agentCredentialsSchema } from "@/mcp/credentials"
import { credentialRevocationKey } from "@/mcp/oauth"
import { closeAgentAccountRuntime, createAgentAccount } from "@/mcp/jazz"

export { POST, DELETE }

export const prerender = false

let requestSchema = z.object({
	provider: z.enum(["openai", "anthropic"]),
})

let POST: APIRoute = async ({ request }) => {
	try {
		let body: unknown = await request.json()
		let { provider } = requestSchema.parse(body)
		let config = getMcpConfig()
		let requester = provisioningKey(request)
		if (!(await config.replayStore.allow(requester, 5, 60_000))) {
			return json({ error: "Please wait before creating another agent" }, 429)
		}
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

let DELETE: APIRoute = async ({ request }) => {
	try {
		let body: unknown = await request.json()
		let { credential } = z.object({ credential: z.string() }).parse(body)
		let config = getMcpConfig()
		let credentials = await config.tokens.open(
			"connection",
			credential,
			agentCredentialsSchema,
		)
		await config.replayStore.revoke(
			credentialRevocationKey(credential),
			30 * 24 * 60 * 60_000,
		)
		void closeAgentAccountRuntime(credentials.accountId).catch(error => {
			console.error("[agent-connections] runtime cleanup failed", error)
		})
		return json({ ok: true })
	} catch (error) {
		console.error("[agent-connections] revocation failed", error)
		return json({ error: "Could not revoke agent connection" }, 400)
	}
}

function provisioningKey(request: Request) {
	let forwardedFor =
		request.headers.get("x-vercel-forwarded-for") ??
		request.headers.get("x-forwarded-for") ??
		"unknown"
	let address = forwardedFor.split(",")[0]?.trim() ?? "unknown"
	let digest = createHash("sha256").update(address).digest("base64url")
	return `provision:${digest}`
}

function json(body: unknown, status: number = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}
