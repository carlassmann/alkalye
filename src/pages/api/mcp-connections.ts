import type { APIRoute } from "astro"
import { z } from "zod"
import { getMcpConfig } from "@/mcp/config"
import { connectionCredentialsSchema } from "@/mcp/credentials"
import { revokeUserConnection } from "@/mcp/jazz"

export { DELETE }
export const prerender = false

let DELETE: APIRoute = async ({ request }) => {
	try {
		let body: unknown = await request.json()
		let { credential } = z.object({ credential: z.string() }).parse(body)
		let config = getMcpConfig()
		let credentials = await config.tokens.open(
			"connection",
			credential,
			connectionCredentialsSchema,
		)
		await revokeUserConnection(config.syncServer, credentials)
		return json({ ok: true })
	} catch {
		return json({ error: "Could not disconnect agent connection" }, 400)
	}
}

function json(body: unknown, status = 200) {
	return Response.json(body, {
		status,
		headers: { "cache-control": "no-store" },
	})
}
