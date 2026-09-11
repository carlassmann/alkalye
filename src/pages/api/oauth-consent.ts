import type { APIRoute } from "astro"
import { getMcpConfig } from "@/mcp/config"
import { consentRequestSchema } from "@/mcp/oauth"

export { GET }

export const prerender = false

let GET: APIRoute = async ({ request }) => {
	try {
		let token = new URL(request.url).searchParams.get("token")
		if (!token) throw new Error("Missing consent token")
		let config = getMcpConfig()
		let consent = await config.tokens.open(
			"consent",
			token,
			consentRequestSchema,
		)
		return Response.json(consent, {
			headers: { "cache-control": "no-store" },
		})
	} catch {
		return Response.json(
			{ error: "Invalid or expired consent" },
			{ status: 400 },
		)
	}
}
